// Generated from Gateway OpenAPI. Do not edit manually.
export const PROJECTION_V2_GOLDEN = {
  "delta": {
    "authorization_revision": 7,
    "base_cursor": 1,
    "detail_scope": "summary",
    "execution_id": "execution-golden",
    "from_revision": 1,
    "operations": [
      {
        "mission_id": "mission-golden",
        "op": "set_projection_header",
        "revision": 2,
        "session_id": "session-golden",
        "task_id": "task-golden",
        "turn_id": "turn-golden"
      },
      {
        "commit_cursor": 2,
        "objective": "verify projection reducer",
        "op": "set_graph_metadata",
        "parent_execution": null,
        "revision": 2,
        "service_class": "interactive"
      },
      {
        "edges": [
          {
            "from": "node-a",
            "kind": "produces",
            "to": "node-b"
          }
        ],
        "node_ids": [
          "node-a",
          "node-b"
        ],
        "op": "replace_graph_topology"
      },
      {
        "node": {
          "evidence_refs": [],
          "executor_kind": "runtime",
          "kind": "tool_batch",
          "node_id": "node-a",
          "result_ref": "result:node-a",
          "status": "completed",
          "usage": {
            "cached_tokens": 0,
            "duplicate_tool_calls": 0,
            "duration_ms": 12,
            "input_tokens": 0,
            "model": null,
            "output_tokens": 0,
            "runtime_observed_resource_scopes": [],
            "runtime_write_attempt_paths": [],
            "tool_calls": 1
          }
        },
        "op": "upsert_graph_node"
      },
      {
        "node": {
          "evidence_refs": [],
          "executor_kind": "runtime",
          "kind": "synthesize",
          "node_id": "node-b",
          "result_ref": "result:node-b",
          "status": "completed",
          "usage": {
            "cached_tokens": 0,
            "duplicate_tool_calls": 0,
            "duration_ms": 3,
            "input_tokens": 0,
            "model": null,
            "output_tokens": 0,
            "runtime_observed_resource_scopes": [],
            "runtime_write_attempt_paths": [],
            "tool_calls": 0
          }
        },
        "op": "upsert_graph_node"
      },
      {
        "node_id": "node-obsolete",
        "op": "remove_graph_node"
      },
      {
        "child": {
          "cursor": 2,
          "execution_id": "child-current",
          "objective": "current child",
          "parent_execution_id": "execution-golden",
          "parent_node_id": "node-b",
          "revision": 2,
          "status": "completed"
        },
        "op": "upsert_child_execution"
      },
      {
        "execution_id": "child-obsolete",
        "op": "remove_child_execution"
      },
      {
        "activities": [
          {
            "activity_id": "activity:execution:execution-golden",
            "artifact_refs": [
              "result:node-a"
            ],
            "causal_parent_ids": [],
            "commit_cursor": 2,
            "completed_at_ms": 25,
            "dependency_ids": [],
            "duration_ms": 15,
            "evidence_refs": [
              "evidence:node-a"
            ],
            "kind": "execution",
            "public_summary": "verify projection reducer",
            "schema_version": 1,
            "scope": {
              "execution_id": "execution-golden",
              "mission_id": "mission-golden",
              "session_id": "session-golden",
              "task_id": "task-golden",
              "turn_id": "turn-golden",
              "workspace_id": "workspace-golden"
            },
            "sequence": 1,
            "started_at_ms": 10,
            "status": "completed",
            "visibility": [
              "narrative",
              "operational",
              "audit"
            ]
          }
        ],
        "op": "replace_activities",
        "relations": []
      },
      {
        "activity": {
          "activity_id": "activity:execution:execution-golden:tool:node-a",
          "artifact_refs": [
            "result:node-a"
          ],
          "causal_parent_ids": [
            "activity:execution:execution-golden"
          ],
          "commit_cursor": 2,
          "completed_at_ms": 22,
          "dependency_ids": [],
          "duration_ms": 12,
          "evidence_refs": [
            "evidence:node-a"
          ],
          "kind": "tool",
          "parent_activity_id": "activity:execution:execution-golden",
          "public_summary": "read projected evidence",
          "schema_version": 1,
          "scope": {
            "execution_id": "execution-golden",
            "mission_id": "mission-golden",
            "session_id": "session-golden",
            "task_id": "task-golden",
            "turn_id": "turn-golden",
            "workspace_id": "workspace-golden"
          },
          "sequence": 2,
          "started_at_ms": 10,
          "status": "completed",
          "tool_call_id": "node-a",
          "visibility": [
            "narrative",
            "operational",
            "audit"
          ]
        },
        "op": "upsert_activity"
      },
      {
        "op": "upsert_activity_relation",
        "relation": {
          "evidence_ref": "evidence:node-a",
          "from_activity_id": "activity:execution:execution-golden",
          "kind": "contains",
          "relation_id": "activity-relation:execution-tool",
          "to_activity_id": "activity:execution:execution-golden:tool:node-a"
        }
      },
      {
        "op": "replace_strategy",
        "strategy": null
      },
      {
        "collection": "admissions",
        "entity": {
          "evidence_refs": [
            "execution-golden"
          ],
          "id": "admission:request-node-a",
          "kind": "admission",
          "payload": {
            "type": "admission",
            "value": {
              "accepted_at_ms": 20,
              "blocker": null,
              "deadline_at_ms": null,
              "normalized_scope": "graph:execution-golden",
              "policy_revision": 3,
              "queue_age_ms": 8,
              "refs": [
                "execution_graph:execution-golden"
              ],
              "request_id": "request-node-a",
              "requested_priority": 7,
              "requested_service_class": "interactive",
              "resolved_service_class": "interactive",
              "resource_demands": [
                "provider_slot:1"
              ],
              "status": "materialized",
              "wait_reason": null
            }
          },
          "revision": 2,
          "status": "materialized",
          "summary": "resource.admission.granted"
        },
        "op": "upsert_entity"
      },
      {
        "collection": "outcomes",
        "entity": {
          "evidence_refs": [
            "evidence:node-a"
          ],
          "id": "outcome:execution-golden",
          "kind": "outcome",
          "payload": {
            "type": "outcome",
            "value": {
              "agent_id": null,
              "cached_tokens": 8,
              "config_revision": "config-3",
              "duplicate_tool_calls": 0,
              "duration_ms": 12,
              "evidence_completeness": "sufficient",
              "evidence_refs": [
                {
                  "boundary": "observed",
                  "confidence_bp": null,
                  "id": "node-a",
                  "ref_type": "tool",
                  "source": "runtime"
                }
              ],
              "execution_graph_ref": "execution-golden",
              "execution_id": "execution-golden",
              "freshness_ms": 2,
              "input_tokens": 40,
              "mission_id": "mission-golden",
              "model": "deepseek-pro",
              "output_tokens": 12,
              "profile": "pro",
              "protocol": "responses",
              "provider": "deepseek",
              "quality": "unknown",
              "retries": 0,
              "session_id": "session-golden",
              "strategy_revision": "strategy-2",
              "task_id": null,
              "team_id": null,
              "terminal_class": "completed",
              "tool_calls": 1,
              "turn_id": "turn-golden"
            }
          },
          "revision": 2,
          "status": "completed",
          "summary": "runtime.outcome.recorded.v1"
        },
        "op": "upsert_entity"
      },
      {
        "collection": "evidence",
        "entity": {
          "evidence_refs": [
            "evidence:node-a"
          ],
          "id": "evidence-node-a",
          "kind": "tool_outcome",
          "payload": {
            "type": "evidence",
            "value": {
              "completeness": "sufficient",
              "evidence_ref": {
                "boundary": "observed",
                "confidence_bp": null,
                "id": "node-a",
                "ref_type": "tool",
                "source": "runtime"
              },
              "freshness_ms": 2,
              "projector_lag_commits": 0,
              "support": "supported"
            }
          },
          "revision": 2,
          "status": "supported",
          "summary": "tool result is durably supported"
        },
        "op": "upsert_entity"
      },
      {
        "collection": "health",
        "entity_key": "health-obsolete",
        "op": "remove_entity"
      },
      {
        "commands": [],
        "op": "replace_available_commands"
      },
      {
        "op": "set_terminal",
        "terminal_result_ref": "result:node-a"
      },
      {
        "cursor": 2,
        "op": "advance_cursor"
      }
    ],
    "redaction_revision": "sha256:golden",
    "reducer_version": 2,
    "resync_reason": null,
    "schema_version": 2,
    "source_health": "fresh",
    "target_cursor": 2,
    "target_revision": 2
  },
  "expected": {
    "activities": [
      {
        "activity_id": "activity:execution:execution-golden",
        "artifact_refs": [
          "result:node-a"
        ],
        "causal_parent_ids": [],
        "commit_cursor": 2,
        "completed_at_ms": 25,
        "dependency_ids": [],
        "duration_ms": 15,
        "evidence_refs": [
          "evidence:node-a"
        ],
        "kind": "execution",
        "public_summary": "verify projection reducer",
        "schema_version": 1,
        "scope": {
          "execution_id": "execution-golden",
          "mission_id": "mission-golden",
          "session_id": "session-golden",
          "task_id": "task-golden",
          "turn_id": "turn-golden",
          "workspace_id": "workspace-golden"
        },
        "sequence": 1,
        "started_at_ms": 10,
        "status": "completed",
        "visibility": [
          "narrative",
          "operational",
          "audit"
        ]
      },
      {
        "activity_id": "activity:execution:execution-golden:tool:node-a",
        "artifact_refs": [
          "result:node-a"
        ],
        "causal_parent_ids": [
          "activity:execution:execution-golden"
        ],
        "commit_cursor": 2,
        "completed_at_ms": 22,
        "dependency_ids": [],
        "duration_ms": 12,
        "evidence_refs": [
          "evidence:node-a"
        ],
        "kind": "tool",
        "parent_activity_id": "activity:execution:execution-golden",
        "public_summary": "read projected evidence",
        "schema_version": 1,
        "scope": {
          "execution_id": "execution-golden",
          "mission_id": "mission-golden",
          "session_id": "session-golden",
          "task_id": "task-golden",
          "turn_id": "turn-golden",
          "workspace_id": "workspace-golden"
        },
        "sequence": 2,
        "started_at_ms": 10,
        "status": "completed",
        "tool_call_id": "node-a",
        "visibility": [
          "narrative",
          "operational",
          "audit"
        ]
      }
    ],
    "activity_relations": [
      {
        "evidence_ref": "evidence:node-a",
        "from_activity_id": "activity:execution:execution-golden",
        "kind": "contains",
        "relation_id": "activity-relation:execution-tool",
        "to_activity_id": "activity:execution:execution-golden:tool:node-a"
      }
    ],
    "admissions": [
      {
        "evidence_refs": [
          "execution-golden"
        ],
        "id": "admission:request-node-a",
        "kind": "admission",
        "payload": {
          "type": "admission",
          "value": {
            "accepted_at_ms": 20,
            "blocker": null,
            "deadline_at_ms": null,
            "normalized_scope": "graph:execution-golden",
            "policy_revision": 3,
            "queue_age_ms": 8,
            "refs": [
              "execution_graph:execution-golden"
            ],
            "request_id": "request-node-a",
            "requested_priority": 7,
            "requested_service_class": "interactive",
            "resolved_service_class": "interactive",
            "resource_demands": [
              "provider_slot:1"
            ],
            "status": "materialized",
            "wait_reason": null
          }
        },
        "revision": 2,
        "status": "materialized",
        "summary": "resource.admission.granted"
      }
    ],
    "agents": [],
    "approvals": [],
    "authorization_revision": 7,
    "available_commands": [],
    "child_executions": [
      {
        "cursor": 2,
        "execution_id": "child-current",
        "objective": "current child",
        "parent_execution_id": "execution-golden",
        "parent_node_id": "node-b",
        "revision": 2,
        "status": "completed"
      }
    ],
    "context": [],
    "cursor": 2,
    "detail_scope": "summary",
    "evidence": [
      {
        "evidence_refs": [
          "evidence:node-a"
        ],
        "id": "evidence-node-a",
        "kind": "tool_outcome",
        "payload": {
          "type": "evidence",
          "value": {
            "completeness": "sufficient",
            "evidence_ref": {
              "boundary": "observed",
              "confidence_bp": null,
              "id": "node-a",
              "ref_type": "tool",
              "source": "runtime"
            },
            "freshness_ms": 2,
            "projector_lag_commits": 0,
            "support": "supported"
          }
        },
        "revision": 2,
        "status": "supported",
        "summary": "tool result is durably supported"
      }
    ],
    "execution_id": "execution-golden",
    "goals": [],
    "graph": {
      "commit_cursor": 2,
      "edges": [
        {
          "from": "node-a",
          "kind": "produces",
          "to": "node-b"
        }
      ],
      "graph_id": "execution-golden",
      "nodes": [
        {
          "evidence_refs": [],
          "executor_kind": "runtime",
          "kind": "tool_batch",
          "node_id": "node-a",
          "result_ref": "result:node-a",
          "status": "completed",
          "usage": {
            "cached_tokens": 0,
            "duplicate_tool_calls": 0,
            "duration_ms": 12,
            "input_tokens": 0,
            "model": null,
            "output_tokens": 0,
            "runtime_observed_resource_scopes": [],
            "runtime_write_attempt_paths": [],
            "tool_calls": 1
          }
        },
        {
          "evidence_refs": [],
          "executor_kind": "runtime",
          "kind": "synthesize",
          "node_id": "node-b",
          "result_ref": "result:node-b",
          "status": "completed",
          "usage": {
            "cached_tokens": 0,
            "duplicate_tool_calls": 0,
            "duration_ms": 3,
            "input_tokens": 0,
            "model": null,
            "output_tokens": 0,
            "runtime_observed_resource_scopes": [],
            "runtime_write_attempt_paths": [],
            "tool_calls": 0
          }
        }
      ],
      "objective": "verify projection reducer",
      "parent_execution": null,
      "revision": 2,
      "service_class": "interactive",
      "terminal_result_ref": "result:node-a"
    },
    "health": [],
    "interventions": [],
    "live": null,
    "mission_id": "mission-golden",
    "outcomes": [
      {
        "evidence_refs": [
          "evidence:node-a"
        ],
        "id": "outcome:execution-golden",
        "kind": "outcome",
        "payload": {
          "type": "outcome",
          "value": {
            "agent_id": null,
            "cached_tokens": 8,
            "config_revision": "config-3",
            "duplicate_tool_calls": 0,
            "duration_ms": 12,
            "evidence_completeness": "sufficient",
            "evidence_refs": [
              {
                "boundary": "observed",
                "confidence_bp": null,
                "id": "node-a",
                "ref_type": "tool",
                "source": "runtime"
              }
            ],
            "execution_graph_ref": "execution-golden",
            "execution_id": "execution-golden",
            "freshness_ms": 2,
            "input_tokens": 40,
            "mission_id": "mission-golden",
            "model": "deepseek-pro",
            "output_tokens": 12,
            "profile": "pro",
            "protocol": "responses",
            "provider": "deepseek",
            "quality": "unknown",
            "retries": 0,
            "session_id": "session-golden",
            "strategy_revision": "strategy-2",
            "task_id": null,
            "team_id": null,
            "terminal_class": "completed",
            "tool_calls": 1,
            "turn_id": "turn-golden"
          }
        },
        "revision": 2,
        "status": "completed",
        "summary": "runtime.outcome.recorded.v1"
      }
    ],
    "recovery": [],
    "redaction_revision": "sha256:golden",
    "relations": [],
    "revision": 2,
    "schema_version": 2,
    "session_id": "session-golden",
    "strategy": null,
    "task_id": "task-golden",
    "teams": [],
    "turn_id": "turn-golden",
    "usage": []
  },
  "initial": {
    "activities": [],
    "activity_relations": [],
    "admissions": [],
    "agents": [],
    "approvals": [],
    "authorization_revision": 7,
    "available_commands": [
      {
        "available": true,
        "command": "pause",
        "reason": null
      }
    ],
    "child_executions": [
      {
        "cursor": 1,
        "execution_id": "child-obsolete",
        "objective": "obsolete child",
        "parent_execution_id": "execution-golden",
        "parent_node_id": "node-obsolete",
        "revision": 1,
        "status": "planned"
      }
    ],
    "context": [],
    "cursor": 1,
    "detail_scope": "summary",
    "evidence": [],
    "execution_id": "execution-golden",
    "goals": [],
    "graph": {
      "commit_cursor": 1,
      "edges": [
        {
          "from": "node-a",
          "kind": "verifies",
          "to": "node-obsolete"
        }
      ],
      "graph_id": "execution-golden",
      "nodes": [
        {
          "evidence_refs": [],
          "executor_kind": "runtime",
          "kind": "tool_batch",
          "node_id": "node-a",
          "result_ref": null,
          "status": "running",
          "usage": {
            "cached_tokens": 0,
            "duplicate_tool_calls": 0,
            "duration_ms": 0,
            "input_tokens": 0,
            "model": null,
            "output_tokens": 0,
            "runtime_observed_resource_scopes": [],
            "runtime_write_attempt_paths": [],
            "tool_calls": 0
          }
        },
        {
          "evidence_refs": [],
          "executor_kind": "runtime",
          "kind": "verify",
          "node_id": "node-obsolete",
          "result_ref": null,
          "status": "planned",
          "usage": {
            "cached_tokens": 0,
            "duplicate_tool_calls": 0,
            "duration_ms": 0,
            "input_tokens": 0,
            "model": null,
            "output_tokens": 0,
            "runtime_observed_resource_scopes": [],
            "runtime_write_attempt_paths": [],
            "tool_calls": 0
          }
        }
      ],
      "objective": "verify projection reducer",
      "parent_execution": null,
      "revision": 1,
      "service_class": "interactive",
      "terminal_result_ref": null
    },
    "health": [
      {
        "evidence_refs": [],
        "id": "health-obsolete",
        "kind": "execution_health",
        "revision": 1,
        "status": "stale",
        "summary": "obsolete health"
      }
    ],
    "interventions": [],
    "live": null,
    "mission_id": "mission-golden",
    "outcomes": [],
    "recovery": [],
    "redaction_revision": "sha256:golden",
    "relations": [],
    "revision": 1,
    "schema_version": 2,
    "session_id": "session-golden",
    "strategy": null,
    "task_id": "task-golden",
    "teams": [],
    "turn_id": "turn-golden",
    "usage": []
  }
} as const;
