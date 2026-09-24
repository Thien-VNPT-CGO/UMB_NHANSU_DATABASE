export type OperationState = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'NEEDS_RECONCILIATION' | 'FAILED';

export interface OperationRecord {
  operation_id: string;
  idempotency_key: string;
  entity_type: string;
  entity_id: string;
  expected_version: number;
  operation_state: OperationState;
  actor_id: string;
  outcome?: string;
  error?: string;
  created_at: string;
  updated_at: string;
}

export interface AuditLogEntry {
  log_id: string;
  timestamp: string; // ISO 8601
  actor_id: string;
  actor_role: string;
  action: string;
  target_entity: string;
  target_id: string;
  details: string;
  ip_address?: string;
}
