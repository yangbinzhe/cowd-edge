import type { ExecutionProjection, ExecutionProjectionDelta } from '../types';
import type { components } from '../generated/gateway-api';
import {
  EXECUTION_PROJECTION_REDUCER_VERSION,
  EXECUTION_PROJECTION_SCHEMA_VERSION,
} from '../generated/projection-contract-meta';

export {
  EXECUTION_PROJECTION_REDUCER_VERSION,
  EXECUTION_PROJECTION_SCHEMA_VERSION,
} from '../generated/projection-contract-meta';

type ProjectionOperation = components['schemas']['ProjectionOperation'];
type ProjectionEntity = components['schemas']['ProjectionEntity'];
type ProjectionEntityCollection = components['schemas']['ProjectionEntityCollection'];

export class ProjectionDeltaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectionDeltaError';
  }
}

export function reduceExecutionProjectionDelta(
  current: ExecutionProjection,
  delta: ExecutionProjectionDelta,
): ExecutionProjection {
  validateEnvelope(current, delta);
  const next = structuredClone(current) as ExecutionProjection;
  for (const operation of delta.operations) applyOperation(next, operation);
  if (Number(next.revision) !== Number(delta.target_revision)) {
    throw new ProjectionDeltaError(
      `target revision ${delta.target_revision} was not materialized`,
    );
  }
  if (Number(next.cursor) !== Number(delta.target_cursor)) {
    throw new ProjectionDeltaError(
      `target cursor ${delta.target_cursor} was not materialized`,
    );
  }
  validateUniqueKeys(next);
  return next;
}

function validateEnvelope(
  current: ExecutionProjection,
  delta: ExecutionProjectionDelta,
) {
  if (
    Number(current.schema_version) !== EXECUTION_PROJECTION_SCHEMA_VERSION
    || Number(delta.schema_version) !== EXECUTION_PROJECTION_SCHEMA_VERSION
    || Number(delta.reducer_version) !== EXECUTION_PROJECTION_REDUCER_VERSION
  ) {
    throw new ProjectionDeltaError('projection schema/reducer version mismatch');
  }
  if (current.execution_id !== delta.execution_id) {
    throw new ProjectionDeltaError('projection execution identity mismatch');
  }
  if (
    Number(current.revision) !== Number(delta.from_revision)
    || Number(current.cursor) !== Number(delta.base_cursor)
    || Number(delta.target_revision) < Number(delta.from_revision)
    || Number(delta.target_cursor) < Number(delta.base_cursor)
  ) {
    throw new ProjectionDeltaError('projection revision or cursor is not contiguous');
  }
  if (
    current.detail_scope !== delta.detail_scope
    || Number(current.authorization_revision) !== Number(delta.authorization_revision)
    || current.redaction_revision !== delta.redaction_revision
  ) {
    throw new ProjectionDeltaError('projection authority, detail, or redaction scope changed');
  }
  if (delta.resync_reason) {
    throw new ProjectionDeltaError(`projection resync required: ${delta.resync_reason}`);
  }
}

function applyOperation(
  projection: ExecutionProjection,
  operation: ProjectionOperation,
) {
  switch (operation.op) {
    case 'set_projection_header':
      projection.revision = operation.revision;
      projection.session_id = operation.session_id;
      projection.mission_id = operation.mission_id;
      projection.task_id = operation.task_id;
      projection.turn_id = operation.turn_id;
      break;
    case 'set_graph_metadata':
      projection.graph.revision = operation.revision;
      projection.graph.commit_cursor = operation.commit_cursor;
      projection.graph.objective = operation.objective;
      projection.graph.service_class = operation.service_class;
      projection.graph.parent_execution = operation.parent_execution;
      break;
    case 'replace_graph_topology': {
      const retained = new Set(operation.node_ids);
      projection.graph.nodes = projection.graph.nodes
        .filter((node) => retained.has(node.node_id));
      projection.graph.edges = operation.edges;
      break;
    }
    case 'upsert_graph_node':
      projection.graph.nodes = upsert(
        projection.graph.nodes,
        operation.node,
        (node) => node.node_id,
      );
      break;
    case 'remove_graph_node':
      projection.graph.nodes = projection.graph.nodes
        .filter((node) => node.node_id !== operation.node_id);
      break;
    case 'upsert_child_execution':
      projection.child_executions = upsert(
        projection.child_executions,
        operation.child,
        (child) => child.execution_id,
      );
      break;
    case 'remove_child_execution':
      projection.child_executions = projection.child_executions
        .filter((child) => child.execution_id !== operation.execution_id);
      break;
    case 'replace_activities':
      projection.activities = operation.activities;
      projection.activity_relations = operation.relations;
      break;
    case 'replace_concurrency':
      projection.concurrency = operation.concurrency;
      break;
    case 'upsert_activity':
      projection.activities = upsert(
        projection.activities || [],
        operation.activity,
        (activity) => activity.activity_id,
      );
      break;
    case 'upsert_activity_relation':
      projection.activity_relations = upsert(
        projection.activity_relations || [],
        operation.relation,
        (relation) => relation.relation_id,
      );
      break;
    case 'replace_strategy':
      projection.strategy = operation.strategy;
      break;
    case 'upsert_entity': {
      const collection = entityCollection(projection, operation.collection);
      projection[operation.collection] = upsert(
        collection,
        operation.entity,
        (entity) => entity.id,
      ) as never;
      break;
    }
    case 'remove_entity':
      projection[operation.collection] = entityCollection(projection, operation.collection)
        .filter((entity) => entity.id !== operation.entity_key) as never;
      break;
    case 'replace_available_commands':
      projection.available_commands = operation.commands;
      break;
    case 'set_terminal':
      projection.graph.terminal_result_ref = operation.terminal_result_ref;
      if (operation.live) projection.live = operation.live;
      break;
    case 'set_delivery_truth':
      projection.delivery_envelope = operation.delivery_envelope ?? null;
      projection.terminal_presentation = operation.terminal_presentation ?? null;
      projection.cancellation_receipt = operation.cancellation_receipt ?? null;
      break;
    case 'advance_cursor':
      if (Number(operation.cursor) < Number(projection.cursor)) {
        throw new ProjectionDeltaError('projection cursor regressed');
      }
      projection.cursor = operation.cursor;
      break;
    default:
      throw new ProjectionDeltaError(
        `unsupported projection operation ${(operation as { op?: string }).op || 'missing'}`,
      );
  }
}

function entityCollection(
  projection: ExecutionProjection,
  collection: ProjectionEntityCollection,
): ProjectionEntity[] {
  return projection[collection] as ProjectionEntity[];
}

function upsert<T>(values: T[], incoming: T, key: (value: T) => string): T[] {
  const incomingKey = key(incoming);
  const next = values.filter((value) => key(value) !== incomingKey);
  next.push(incoming);
  next.sort((left, right) => key(left).localeCompare(key(right)));
  return next;
}

function validateUniqueKeys(projection: ExecutionProjection) {
  assertUnique(projection.graph.nodes.map((node) => node.node_id), 'graph node');
  assertUnique(
    projection.child_executions.map((child) => child.execution_id),
    'child execution',
  );
  assertUnique(
    (projection.activities || []).map((activity) => activity.activity_id),
    'activity',
  );
  assertUnique(
    (projection.activity_relations || []).map((relation) => relation.relation_id),
    'activity relation',
  );
  const collections: ProjectionEntityCollection[] = [
    'goals',
    'agents',
    'teams',
    'relations',
    'approvals',
    'admissions',
    'outcomes',
    'interventions',
    'usage',
    'context',
    'evidence',
    'health',
    'recovery',
  ];
  for (const collection of collections) {
    assertUnique(entityCollection(projection, collection).map((entity) => entity.id), collection);
  }
}

function assertUnique(values: string[], label: string) {
  if (new Set(values).size !== values.length) {
    throw new ProjectionDeltaError(`duplicate ${label} key`);
  }
}
