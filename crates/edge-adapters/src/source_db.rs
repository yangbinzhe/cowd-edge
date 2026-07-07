use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value};
use sqlx::mysql::{MySqlPoolOptions, MySqlRow};
use sqlx::postgres::{PgPoolOptions, PgRow};
use sqlx::{Column, Row, TypeInfo, ValueRef};

use crate::source_sidecar::{
    checksum_rows, SourceBatchCursor, SourceFieldSchema, SourceReadPlan, SourceRecordBatch,
    SourceTableSchema,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DatabaseDialect {
    Postgres,
    MySql,
    MariaDb,
}

impl DatabaseDialect {
    pub(crate) fn from_adapter(adapter_id: &str) -> Option<Self> {
        match adapter_id {
            "postgres" => Some(Self::Postgres),
            "mysql" => Some(Self::MySql),
            "mariadb" => Some(Self::MariaDb),
            _ => None,
        }
    }

    fn adapter_id(self) -> &'static str {
        match self {
            Self::Postgres => "postgres",
            Self::MySql => "mysql",
            Self::MariaDb => "mariadb",
        }
    }

    fn default_port(self) -> u16 {
        match self {
            Self::Postgres => 5432,
            Self::MySql | Self::MariaDb => 3306,
        }
    }
}

#[derive(Debug, Clone)]
struct TableRef {
    schema: Option<String>,
    table: String,
}

#[derive(Debug, Clone)]
struct IncrementalStrategy {
    field: String,
    value: String,
}

pub(crate) async fn read_database_batch(
    mut plan: SourceReadPlan,
    config: Value,
    dialect: DatabaseDialect,
) -> Result<SourceRecordBatch, String> {
    let table = table_ref(&plan)?;
    let limit = plan.limit.unwrap_or(100).clamp(1, 1000);
    let offset = plan.offset.unwrap_or(0);
    let fields = plan.fields.clone();
    let resolved = database_url(&plan, &config, dialect)?;
    let url = resolved.url;
    if plan.resource_ref.trim().is_empty() || resolved.structured {
        plan.resource_ref = sanitize_resource_ref(&url);
    }
    match dialect {
        DatabaseDialect::Postgres => {
            read_postgres_batch(plan, table, fields, limit, offset, &url).await
        }
        DatabaseDialect::MySql | DatabaseDialect::MariaDb => {
            read_mysql_batch(
                plan,
                table,
                fields,
                limit,
                offset,
                &normalize_mysql_url(&url),
            )
            .await
        }
    }
}

pub(crate) async fn discover_database_schema(
    payload: Value,
    adapter_id: &str,
    config: Value,
) -> Result<Value, String> {
    let dialect = DatabaseDialect::from_adapter(adapter_id).ok_or_else(|| {
        format!("unsupported database adapter for schema discovery: {adapter_id}")
    })?;
    let plan = plan_from_payload(payload, adapter_id)?;
    let resolved = database_url(&plan, &config, dialect)?;
    let url = resolved.url;
    let table_filter = plan.table.as_deref().map(parse_table_ref).transpose()?;
    let resource_ref = if plan.resource_ref.trim().is_empty() || resolved.structured {
        sanitize_resource_ref(&url)
    } else {
        sanitize_resource_ref(&plan.resource_ref)
    };
    let tables = match dialect {
        DatabaseDialect::Postgres => discover_postgres_schema(&url, table_filter).await?,
        DatabaseDialect::MySql | DatabaseDialect::MariaDb => {
            discover_mysql_schema(&normalize_mysql_url(&url), table_filter).await?
        }
    };
    Ok(serde_json::json!({
        "status": "ok",
        "adapter_id": adapter_id,
        "resource_ref": resource_ref,
        "source_schema": {
            "tables": tables,
        }
    }))
}

pub(crate) fn incremental_plan(payload: Value, adapter_id: &str) -> Result<Value, String> {
    let mut plan = plan_from_payload(payload, adapter_id)?;
    let limit = plan.limit.unwrap_or(100).clamp(1, 1000);
    let current = plan.offset.unwrap_or(0);
    let cursor_field = plan.metadata.get("cursor_field").and_then(Value::as_str);
    let updated_at_field = plan
        .metadata
        .get("updated_at_field")
        .and_then(Value::as_str);
    let mode = if updated_at_field.is_some() {
        "updated_at_field"
    } else if cursor_field.is_some() {
        "cursor_field"
    } else {
        "offset"
    };
    let next_offset = current.saturating_add(limit);
    if mode == "offset" {
        plan.offset = Some(next_offset);
    }
    Ok(serde_json::json!({
        "status": "ok",
        "adapter_id": adapter_id,
        "incremental_plan": {
            "mode": mode,
            "updated_at_field": updated_at_field,
            "cursor_field": cursor_field,
            "current_offset": current,
            "next_offset": next_offset,
            "next_read_plan": plan,
            "degraded_reason": if mode == "offset" { Some("degraded_incremental_offset_only") } else { None },
            "notes": [
                "updated_at_field and cursor_field are executed as bounded incremental WHERE clauses",
                "true CDC/event streaming should be supplied by an external source event connector"
            ]
        }
    }))
}

fn plan_from_payload(payload: Value, adapter_id: &str) -> Result<SourceReadPlan, String> {
    let value = payload
        .get("read_plan")
        .or_else(|| payload.get("source_read_plan"))
        .cloned()
        .unwrap_or(payload);
    let mut plan = serde_json::from_value::<SourceReadPlan>(value)
        .map_err(|error| format!("invalid source read plan: {error}"))?;
    if plan.adapter_id.trim().is_empty() {
        plan.adapter_id = adapter_id.to_string();
    }
    if plan.adapter_id != adapter_id {
        return Err(format!(
            "adapter mismatch: request `{}` routed to `{adapter_id}`",
            plan.adapter_id
        ));
    }
    Ok(plan)
}

async fn read_postgres_batch(
    plan: SourceReadPlan,
    table: TableRef,
    requested_fields: Vec<String>,
    limit: usize,
    offset: usize,
    url: &str,
) -> Result<SourceRecordBatch, String> {
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(url)
        .await
        .map_err(|error| format!("postgres connect failed: {error}"))?;
    let schema = postgres_table_schema(&pool, &table).await?;
    let fields = selected_fields(&schema, requested_fields)?;
    let strategy = incremental_strategy(&plan, &schema)?;
    let mut sql = format!(
        "SELECT {} FROM {}",
        fields
            .iter()
            .map(|field| quote_pg_ident(field))
            .collect::<Vec<_>>()
            .join(", "),
        quote_pg_table(&table)
    );
    if let Some(strategy) = strategy.as_ref() {
        sql.push_str(&format!(
            " WHERE {} > $1 ORDER BY {} ASC LIMIT $2",
            quote_pg_ident(&strategy.field),
            quote_pg_ident(&strategy.field),
        ));
    } else {
        sql.push_str(" LIMIT $1 OFFSET $2");
    }
    let mut query = sqlx::query(&sql);
    if let Some(strategy) = strategy {
        query = query.bind(strategy.value).bind(limit as i64);
    } else {
        query = query.bind(limit as i64).bind(offset as i64);
    }
    let rows = query
        .fetch_all(&pool)
        .await
        .map_err(|error| format!("postgres read failed: {error}"))?;
    let total =
        sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM {}", quote_pg_table(&table)))
            .fetch_one(&pool)
            .await
            .map_err(|error| format!("postgres count failed: {error}"))? as usize;
    let values = rows.iter().map(pg_row_to_json).collect::<Vec<_>>();
    Ok(record_batch_from_database_rows(
        plan, schema, values, total, limit, offset,
    ))
}

async fn read_mysql_batch(
    plan: SourceReadPlan,
    table: TableRef,
    requested_fields: Vec<String>,
    limit: usize,
    offset: usize,
    url: &str,
) -> Result<SourceRecordBatch, String> {
    let pool = MySqlPoolOptions::new()
        .max_connections(2)
        .connect(url)
        .await
        .map_err(|error| format!("mysql/mariadb connect failed: {error}"))?;
    let schema = mysql_table_schema(&pool, &table).await?;
    let fields = selected_fields(&schema, requested_fields)?;
    let strategy = incremental_strategy(&plan, &schema)?;
    let mut sql = format!(
        "SELECT {} FROM {}",
        fields
            .iter()
            .map(|field| quote_mysql_ident(field))
            .collect::<Vec<_>>()
            .join(", "),
        quote_mysql_table(&table)
    );
    if let Some(strategy) = strategy.as_ref() {
        sql.push_str(&format!(
            " WHERE {} > ? ORDER BY {} ASC LIMIT ?",
            quote_mysql_ident(&strategy.field),
            quote_mysql_ident(&strategy.field),
        ));
    } else {
        sql.push_str(" LIMIT ? OFFSET ?");
    }
    let mut query = sqlx::query(&sql);
    if let Some(strategy) = strategy {
        query = query.bind(strategy.value).bind(limit as i64);
    } else {
        query = query.bind(limit as i64).bind(offset as i64);
    }
    let rows = query
        .fetch_all(&pool)
        .await
        .map_err(|error| format!("mysql/mariadb read failed: {error}"))?;
    let total = sqlx::query_scalar::<_, i64>(&format!(
        "SELECT COUNT(*) FROM {}",
        quote_mysql_table(&table)
    ))
    .fetch_one(&pool)
    .await
    .map_err(|error| format!("mysql/mariadb count failed: {error}"))? as usize;
    let values = rows.iter().map(mysql_row_to_json).collect::<Vec<_>>();
    Ok(record_batch_from_database_rows(
        plan, schema, values, total, limit, offset,
    ))
}

async fn discover_postgres_schema(
    url: &str,
    table_filter: Option<TableRef>,
) -> Result<Vec<SourceTableSchema>, String> {
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(url)
        .await
        .map_err(|error| format!("postgres connect failed: {error}"))?;
    if let Some(table) = table_filter {
        return Ok(vec![postgres_table_schema(&pool, &table).await?]);
    }
    let rows = sqlx::query(
        "SELECT table_schema, table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
         ORDER BY table_schema, table_name, ordinal_position",
    )
    .fetch_all(&pool)
    .await
    .map_err(|error| format!("postgres schema discovery failed: {error}"))?;
    Ok(group_schema_rows(rows.into_iter().map(|row| {
        (
            Some(row.get::<String, _>("table_schema")),
            row.get::<String, _>("table_name"),
            SourceFieldSchema {
                name: row.get::<String, _>("column_name"),
                data_type: row.get::<String, _>("data_type"),
                nullable: row
                    .get::<String, _>("is_nullable")
                    .eq_ignore_ascii_case("yes"),
            },
        )
    })))
}

async fn discover_mysql_schema(
    url: &str,
    table_filter: Option<TableRef>,
) -> Result<Vec<SourceTableSchema>, String> {
    let pool = MySqlPoolOptions::new()
        .max_connections(2)
        .connect(url)
        .await
        .map_err(|error| format!("mysql/mariadb connect failed: {error}"))?;
    if let Some(table) = table_filter {
        return Ok(vec![mysql_table_schema(&pool, &table).await?]);
    }
    let rows = sqlx::query(
        "SELECT table_schema, table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
         ORDER BY table_schema, table_name, ordinal_position",
    )
    .fetch_all(&pool)
    .await
    .map_err(|error| format!("mysql/mariadb schema discovery failed: {error}"))?;
    Ok(group_schema_rows(rows.into_iter().map(|row| {
        (
            Some(row.get::<String, _>("table_schema")),
            row.get::<String, _>("table_name"),
            SourceFieldSchema {
                name: row.get::<String, _>("column_name"),
                data_type: row.get::<String, _>("data_type"),
                nullable: row
                    .get::<String, _>("is_nullable")
                    .eq_ignore_ascii_case("yes"),
            },
        )
    })))
}

async fn postgres_table_schema(
    pool: &sqlx::Pool<sqlx::Postgres>,
    table: &TableRef,
) -> Result<SourceTableSchema, String> {
    let schema_name = table.schema.as_deref().unwrap_or("public");
    let rows = sqlx::query(
        "SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position",
    )
    .bind(schema_name)
    .bind(&table.table)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("postgres table schema failed: {error}"))?;
    if rows.is_empty() {
        return Err(format!("postgres table not found: {}", table.display()));
    }
    let pk = sqlx::query_scalar::<_, String>(
        "SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
         WHERE tc.constraint_type = 'PRIMARY KEY'
           AND tc.table_schema = $1
           AND tc.table_name = $2
         ORDER BY kcu.ordinal_position",
    )
    .bind(schema_name)
    .bind(&table.table)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    Ok(SourceTableSchema {
        table_name: table.display(),
        fields: rows
            .into_iter()
            .map(|row| SourceFieldSchema {
                name: row.get("column_name"),
                data_type: row.get("data_type"),
                nullable: row
                    .get::<String, _>("is_nullable")
                    .eq_ignore_ascii_case("yes"),
            })
            .collect(),
        primary_key: pk,
    })
}

async fn mysql_table_schema(
    pool: &sqlx::Pool<sqlx::MySql>,
    table: &TableRef,
) -> Result<SourceTableSchema, String> {
    let rows = if let Some(schema) = table.schema.as_deref() {
        sqlx::query(
            "SELECT column_name, data_type, is_nullable, column_key
             FROM information_schema.columns
             WHERE table_schema = ? AND table_name = ?
             ORDER BY ordinal_position",
        )
        .bind(schema)
        .bind(&table.table)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query(
            "SELECT column_name, data_type, is_nullable, column_key
             FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = ?
             ORDER BY ordinal_position",
        )
        .bind(&table.table)
        .fetch_all(pool)
        .await
    }
    .map_err(|error| format!("mysql/mariadb table schema failed: {error}"))?;
    if rows.is_empty() {
        return Err(format!(
            "mysql/mariadb table not found: {}",
            table.display()
        ));
    }
    let mut primary_key = Vec::new();
    let fields = rows
        .into_iter()
        .map(|row| {
            let name = row.get::<String, _>("column_name");
            if row
                .get::<String, _>("column_key")
                .eq_ignore_ascii_case("PRI")
            {
                primary_key.push(name.clone());
            }
            SourceFieldSchema {
                name,
                data_type: row.get("data_type"),
                nullable: row
                    .get::<String, _>("is_nullable")
                    .eq_ignore_ascii_case("yes"),
            }
        })
        .collect();
    Ok(SourceTableSchema {
        table_name: table.display(),
        fields,
        primary_key,
    })
}

fn group_schema_rows<I>(rows: I) -> Vec<SourceTableSchema>
where
    I: IntoIterator<Item = (Option<String>, String, SourceFieldSchema)>,
{
    let mut grouped: BTreeMap<String, Vec<SourceFieldSchema>> = BTreeMap::new();
    for (schema, table, field) in rows {
        let table_name = schema
            .filter(|value| !value.is_empty())
            .map(|schema| format!("{schema}.{table}"))
            .unwrap_or(table);
        grouped.entry(table_name).or_default().push(field);
    }
    grouped
        .into_iter()
        .map(|(table_name, fields)| SourceTableSchema {
            table_name,
            fields,
            primary_key: Vec::new(),
        })
        .collect()
}

fn selected_fields(
    schema: &SourceTableSchema,
    requested_fields: Vec<String>,
) -> Result<Vec<String>, String> {
    let available = schema
        .fields
        .iter()
        .map(|field| field.name.as_str())
        .collect::<BTreeSet<_>>();
    if requested_fields.is_empty() {
        return Ok(schema
            .fields
            .iter()
            .map(|field| field.name.clone())
            .collect());
    }
    for field in &requested_fields {
        validate_identifier(field)?;
        if !available.contains(field.as_str()) {
            return Err(format!(
                "field `{field}` is not present in source table `{}`",
                schema.table_name
            ));
        }
    }
    Ok(requested_fields)
}

fn incremental_strategy(
    plan: &SourceReadPlan,
    schema: &SourceTableSchema,
) -> Result<Option<IncrementalStrategy>, String> {
    let candidate = plan
        .metadata
        .get("updated_at_field")
        .and_then(Value::as_str)
        .map(|field| ("updated_at_field", field))
        .or_else(|| {
            plan.metadata
                .get("cursor_field")
                .and_then(Value::as_str)
                .map(|field| ("cursor_field", field))
        });
    let Some((mode, field)) = candidate else {
        return Ok(None);
    };
    validate_identifier(field)?;
    let available = schema
        .fields
        .iter()
        .any(|schema_field| schema_field.name == field);
    if !available {
        return Err(format!(
            "{mode} `{field}` is not present in source table `{}`",
            schema.table_name
        ));
    }
    let value = plan
        .cursor
        .as_deref()
        .or_else(|| {
            plan.metadata
                .get("watermark_before")
                .and_then(|watermark| watermark.get("high_watermark"))
                .and_then(Value::as_str)
        })
        .or_else(|| {
            plan.metadata
                .get("watermark_before")
                .and_then(|watermark| watermark.get("cursor"))
                .and_then(Value::as_str)
        })
        .unwrap_or("");
    if value.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(IncrementalStrategy {
        field: field.to_string(),
        value: value.to_string(),
    }))
}

fn record_batch_from_database_rows(
    mut plan: SourceReadPlan,
    schema: SourceTableSchema,
    rows: Vec<Value>,
    total: usize,
    limit: usize,
    offset: usize,
) -> SourceRecordBatch {
    plan.resource_ref = sanitize_resource_ref(&plan.resource_ref);
    let next_offset = if offset + rows.len() < total {
        Some(offset + rows.len())
    } else {
        None
    };
    let checksum = checksum_rows(&rows);
    SourceRecordBatch {
        adapter_id: plan.adapter_id,
        resource_ref: plan.resource_ref,
        table: Some(schema.table_name.clone()),
        schema,
        cursor: SourceBatchCursor {
            offset,
            limit,
            next_offset,
        },
        row_count: total,
        truncated: next_offset.is_some(),
        checksum,
        rows,
    }
}

fn pg_row_to_json(row: &PgRow) -> Value {
    let mut object = Map::new();
    for (index, column) in row.columns().iter().enumerate() {
        object.insert(column.name().to_string(), pg_value_to_json(row, index));
    }
    Value::Object(object)
}

fn mysql_row_to_json(row: &MySqlRow) -> Value {
    let mut object = Map::new();
    for (index, column) in row.columns().iter().enumerate() {
        object.insert(column.name().to_string(), mysql_value_to_json(row, index));
    }
    Value::Object(object)
}

fn pg_value_to_json(row: &PgRow, index: usize) -> Value {
    if row
        .try_get_raw(index)
        .map(|value| value.is_null())
        .unwrap_or(true)
    {
        return Value::Null;
    }
    let type_name = row.columns()[index].type_info().name().to_ascii_uppercase();
    match type_name.as_str() {
        "BOOL" => row
            .try_get::<bool, _>(index)
            .map(Value::Bool)
            .unwrap_or_else(|_| unsupported_pg_value(row, index)),
        "INT2" => row
            .try_get::<i16, _>(index)
            .map(|value| Value::Number(i64::from(value).into()))
            .unwrap_or_else(|_| unsupported_pg_value(row, index)),
        "INT4" => row
            .try_get::<i32, _>(index)
            .map(|value| Value::Number(i64::from(value).into()))
            .unwrap_or_else(|_| unsupported_pg_value(row, index)),
        "INT8" => row
            .try_get::<i64, _>(index)
            .map(|value| Value::Number(value.into()))
            .unwrap_or_else(|_| unsupported_pg_value(row, index)),
        "FLOAT4" => row
            .try_get::<f32, _>(index)
            .ok()
            .and_then(|value| serde_json::Number::from_f64(f64::from(value)))
            .map(Value::Number)
            .unwrap_or_else(|| unsupported_pg_value(row, index)),
        "FLOAT8" => row
            .try_get::<f64, _>(index)
            .ok()
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number)
            .unwrap_or_else(|| unsupported_pg_value(row, index)),
        "NUMERIC" => row
            .try_get::<rust_decimal::Decimal, _>(index)
            .map(|value| Value::String(value.to_string()))
            .unwrap_or_else(|_| unsupported_pg_value(row, index)),
        "JSON" | "JSONB" => row
            .try_get::<serde_json::Value, _>(index)
            .unwrap_or_else(|_| unsupported_pg_value(row, index)),
        "TIMESTAMPTZ" => row
            .try_get::<chrono::DateTime<chrono::Utc>, _>(index)
            .map(|value| Value::String(value.to_rfc3339()))
            .unwrap_or_else(|_| unsupported_pg_value(row, index)),
        "TIMESTAMP" => row
            .try_get::<chrono::NaiveDateTime, _>(index)
            .map(|value| Value::String(value.to_string()))
            .unwrap_or_else(|_| unsupported_pg_value(row, index)),
        "DATE" => row
            .try_get::<chrono::NaiveDate, _>(index)
            .map(|value| Value::String(value.to_string()))
            .unwrap_or_else(|_| unsupported_pg_value(row, index)),
        "TEXT" | "VARCHAR" | "BPCHAR" | "CHAR" | "NAME" | "UUID" => row
            .try_get::<String, _>(index)
            .map(Value::String)
            .unwrap_or_else(|_| unsupported_pg_value(row, index)),
        _ => row
            .try_get::<String, _>(index)
            .map(Value::String)
            .unwrap_or_else(|_| unsupported_pg_value(row, index)),
    }
}

fn unsupported_pg_value(row: &PgRow, index: usize) -> Value {
    Value::String(format!(
        "<unsupported:{}>",
        row.columns()[index].type_info().name()
    ))
}

fn mysql_value_to_json(row: &MySqlRow, index: usize) -> Value {
    if row
        .try_get_raw(index)
        .map(|value| value.is_null())
        .unwrap_or(true)
    {
        return Value::Null;
    }
    if let Ok(value) = row.try_get::<bool, _>(index) {
        return Value::Bool(value);
    }
    if let Ok(value) = row.try_get::<i64, _>(index) {
        return Value::Number(value.into());
    }
    if let Ok(value) = row.try_get::<u64, _>(index) {
        return Value::Number(value.into());
    }
    if let Ok(value) = row.try_get::<f64, _>(index) {
        if let Some(number) = serde_json::Number::from_f64(value) {
            return Value::Number(number);
        }
    }
    if let Ok(value) = row.try_get::<serde_json::Value, _>(index) {
        return value;
    }
    if let Ok(value) = row.try_get::<chrono::NaiveDateTime, _>(index) {
        return Value::String(value.to_string());
    }
    if let Ok(value) = row.try_get::<chrono::NaiveDate, _>(index) {
        return Value::String(value.to_string());
    }
    if let Ok(value) = row.try_get::<String, _>(index) {
        return Value::String(value);
    }
    if let Ok(bytes) = row.try_get::<Vec<u8>, _>(index) {
        if let Ok(text) = String::from_utf8(bytes) {
            return Value::String(text);
        }
    }
    Value::String(format!(
        "<unsupported:{}>",
        row.columns()[index].type_info().name()
    ))
}

fn table_ref(plan: &SourceReadPlan) -> Result<TableRef, String> {
    let table = plan
        .table
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "database source read requires table".to_string())?;
    parse_table_ref(table)
}

fn parse_table_ref(value: &str) -> Result<TableRef, String> {
    let parts = value.split('.').collect::<Vec<_>>();
    match parts.as_slice() {
        [table] => {
            validate_identifier(table)?;
            Ok(TableRef {
                schema: None,
                table: (*table).to_string(),
            })
        }
        [schema, table] => {
            validate_identifier(schema)?;
            validate_identifier(table)?;
            Ok(TableRef {
                schema: Some((*schema).to_string()),
                table: (*table).to_string(),
            })
        }
        _ => Err(format!("invalid database table reference: {value}")),
    }
}

fn validate_identifier(value: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && value
            .chars()
            .all(|ch| ch == '_' || ch.is_ascii_alphanumeric());
    if valid {
        Ok(())
    } else {
        Err(format!("invalid database identifier: {value}"))
    }
}

fn quote_pg_ident(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn quote_mysql_ident(value: &str) -> String {
    format!("`{}`", value.replace('`', "``"))
}

fn quote_pg_table(table: &TableRef) -> String {
    table
        .schema
        .as_ref()
        .map(|schema| {
            format!(
                "{}.{}",
                quote_pg_ident(schema),
                quote_pg_ident(&table.table)
            )
        })
        .unwrap_or_else(|| quote_pg_ident(&table.table))
}

fn quote_mysql_table(table: &TableRef) -> String {
    table
        .schema
        .as_ref()
        .map(|schema| {
            format!(
                "{}.{}",
                quote_mysql_ident(schema),
                quote_mysql_ident(&table.table)
            )
        })
        .unwrap_or_else(|| quote_mysql_ident(&table.table))
}

impl TableRef {
    fn display(&self) -> String {
        self.schema
            .as_ref()
            .map(|schema| format!("{schema}.{}", self.table))
            .unwrap_or_else(|| self.table.clone())
    }
}

#[derive(Debug, Clone)]
struct ResolvedDatabaseUrl {
    url: String,
    structured: bool,
}

fn database_url(
    plan: &SourceReadPlan,
    config: &Value,
    dialect: DatabaseDialect,
) -> Result<ResolvedDatabaseUrl, String> {
    if let Some(url) = plan
        .metadata
        .get("database_url")
        .and_then(Value::as_str)
        .or_else(|| config.get("database_url").and_then(Value::as_str))
    {
        return Ok(ResolvedDatabaseUrl {
            url: url.to_string(),
            structured: false,
        });
    }
    if let Some(env_name) = plan
        .metadata
        .get("database_url_env")
        .and_then(Value::as_str)
        .or_else(|| config.get("database_url_env").and_then(Value::as_str))
    {
        return std::env::var(env_name)
            .map(|url| ResolvedDatabaseUrl {
                url,
                structured: false,
            })
            .map_err(|_| format!("database_url_env `{env_name}` is not set"));
    }
    if has_complete_structured_database_config(config) {
        return build_database_url(config, dialect).map(|url| ResolvedDatabaseUrl {
            url,
            structured: true,
        });
    }
    if plan.resource_ref.starts_with("postgres://")
        || plan.resource_ref.starts_with("postgresql://")
        || plan.resource_ref.starts_with("mysql://")
        || plan.resource_ref.starts_with("mariadb://")
    {
        return Ok(ResolvedDatabaseUrl {
            url: plan.resource_ref.clone(),
            structured: false,
        });
    }
    build_database_url(config, dialect).map(|url| ResolvedDatabaseUrl {
        url,
        structured: true,
    })
}

fn has_complete_structured_database_config(config: &Value) -> bool {
    config.get("host").and_then(Value::as_str).is_some()
        && config
            .get("database")
            .or_else(|| config.get("database_name"))
            .and_then(Value::as_str)
            .is_some()
        && config
            .get("user")
            .or_else(|| config.get("username"))
            .and_then(Value::as_str)
            .is_some()
}

fn build_database_url(config: &Value, dialect: DatabaseDialect) -> Result<String, String> {
    let host = config
        .get("host")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{} source config missing host", dialect.adapter_id()))?;
    let database = config
        .get("database")
        .or_else(|| config.get("database_name"))
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{} source config missing database", dialect.adapter_id()))?;
    let user = config
        .get("user")
        .or_else(|| config.get("username"))
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{} source config missing user", dialect.adapter_id()))?;
    let password = config.get("password").and_then(Value::as_str).unwrap_or("");
    let port = config
        .get("port")
        .and_then(Value::as_u64)
        .unwrap_or_else(|| u64::from(dialect.default_port()));
    let scheme = match dialect {
        DatabaseDialect::Postgres => "postgres",
        DatabaseDialect::MySql | DatabaseDialect::MariaDb => "mysql",
    };
    Ok(format!(
        "{scheme}://{}:{}@{host}:{port}/{}",
        percent_encode_uri_component(user),
        percent_encode_uri_component(password),
        percent_encode_uri_component(database)
    ))
}

fn percent_encode_uri_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn normalize_mysql_url(url: &str) -> String {
    url.strip_prefix("mariadb://")
        .map(|tail| format!("mysql://{tail}"))
        .unwrap_or_else(|| url.to_string())
}

fn sanitize_resource_ref(resource_ref: &str) -> String {
    let Some((scheme, tail)) = resource_ref.split_once("://") else {
        return resource_ref.to_string();
    };
    let Some((userinfo, rest)) = tail.split_once('@') else {
        return resource_ref.to_string();
    };
    if userinfo.contains(':') {
        format!("{scheme}://***:***@{rest}")
    } else {
        resource_ref.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_quotes_safe_table_refs() {
        let parsed = parse_table_ref("public.orders").unwrap();
        assert_eq!(quote_pg_table(&parsed), "\"public\".\"orders\"");
        assert_eq!(quote_mysql_table(&parsed), "`public`.`orders`");
    }

    #[test]
    fn rejects_unsafe_identifiers() {
        assert!(parse_table_ref("orders;drop").is_err());
        assert!(selected_fields(
            &SourceTableSchema {
                table_name: "orders".to_string(),
                fields: vec![SourceFieldSchema {
                    name: "qty".to_string(),
                    data_type: "integer".to_string(),
                    nullable: false,
                }],
                primary_key: Vec::new(),
            },
            vec!["qty;drop".to_string()],
        )
        .is_err());
    }

    #[test]
    fn masks_database_url_credentials() {
        assert_eq!(
            sanitize_resource_ref("postgres://user:secret@localhost/db"),
            "postgres://***:***@localhost/db"
        );
    }

    #[test]
    fn structured_database_config_encodes_special_credentials() {
        let url = build_database_url(
            &serde_json::json!({
                "host": "localhost",
                "port": 5432,
                "database": "ai_customer_service",
                "user": "ai",
                "password": "p@ss word#demo",
            }),
            DatabaseDialect::Postgres,
        )
        .unwrap();

        assert_eq!(
            url,
            "postgres://ai:p%40ss%20word%23demo@localhost:5432/ai_customer_service"
        );
    }

    #[test]
    fn structured_database_config_takes_precedence_over_raw_resource_ref() {
        let plan = plan_from_payload(
            serde_json::json!({
                "resource_ref": "postgres://ai:&raw@localhost/ignored",
                "table": "orders"
            }),
            "postgres",
        )
        .unwrap();
        let resolved = database_url(
            &plan,
            &serde_json::json!({
                "host": "localhost",
                "port": 5432,
                "database": "ai_customer_service",
                "user": "ai",
                "password": "&safe@encoded",
            }),
            DatabaseDialect::Postgres,
        )
        .unwrap();

        assert_eq!(
            resolved.url,
            "postgres://ai:%26safe%40encoded@localhost:5432/ai_customer_service"
        );
        assert!(resolved.structured);
    }

    #[test]
    fn plan_defaults_adapter_and_resource_ref_for_configured_connections() {
        let plan = plan_from_payload(
            serde_json::json!({
                "table": "orders",
                "metadata": {}
            }),
            "postgres",
        )
        .unwrap();

        assert_eq!(plan.adapter_id, "postgres");
        assert!(plan.resource_ref.is_empty());
        assert_eq!(plan.table.as_deref(), Some("orders"));
    }

    #[test]
    fn database_incremental_plan_uses_updated_at_or_cursor() {
        let updated_at = incremental_plan(
            serde_json::json!({
                "adapter_id": "postgres",
                "resource_ref": "postgres://user:secret@localhost/db",
                "table": "orders",
                "limit": 20,
                "metadata": {"updated_at_field": "updated_at"}
            }),
            "postgres",
        )
        .unwrap();
        assert_eq!(updated_at["incremental_plan"]["mode"], "updated_at_field");
        assert!(updated_at["incremental_plan"]["degraded_reason"].is_null());

        let cursor = incremental_plan(
            serde_json::json!({
                "adapter_id": "postgres",
                "resource_ref": "postgres://user:secret@localhost/db",
                "table": "orders",
                "metadata": {"cursor_field": "id"}
            }),
            "postgres",
        )
        .unwrap();
        assert_eq!(cursor["incremental_plan"]["mode"], "cursor_field");

        let offset = incremental_plan(
            serde_json::json!({
                "adapter_id": "postgres",
                "resource_ref": "postgres://user:secret@localhost/db",
                "table": "orders",
                "limit": 10,
                "offset": 5,
                "metadata": {}
            }),
            "postgres",
        )
        .unwrap();
        assert_eq!(offset["incremental_plan"]["mode"], "offset");
        assert_eq!(
            offset["incremental_plan"]["degraded_reason"],
            "degraded_incremental_offset_only"
        );
        assert_eq!(offset["incremental_plan"]["next_read_plan"]["offset"], 15);
    }

    #[test]
    fn incremental_strategy_requires_declared_schema_field() {
        let schema = SourceTableSchema {
            table_name: "orders".to_string(),
            fields: vec![SourceFieldSchema {
                name: "updated_at".to_string(),
                data_type: "timestamp".to_string(),
                nullable: false,
            }],
            primary_key: Vec::new(),
        };
        let plan = SourceReadPlan {
            adapter_id: "postgres".to_string(),
            resource_ref: "postgres://localhost/db".to_string(),
            table: Some("orders".to_string()),
            fields: Vec::new(),
            limit: Some(10),
            offset: None,
            cursor: Some("2026-07-08T00:00:00Z".to_string()),
            metadata: serde_json::json!({"updated_at_field": "updated_at"}),
        };
        assert_eq!(
            incremental_strategy(&plan, &schema).unwrap().unwrap().field,
            "updated_at"
        );

        let mut invalid = plan.clone();
        invalid.metadata = serde_json::json!({"updated_at_field": "missing"});
        assert!(incremental_strategy(&invalid, &schema).is_err());
    }
}
