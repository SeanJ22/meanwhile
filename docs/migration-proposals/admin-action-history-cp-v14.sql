-- STAGED DESIGN ONLY. DO NOT APPLY. This is control-plane DDL, not a serving
-- Drizzle migration. Review atomic receipt+projection writes, bootstrap v14,
-- historical backfill, completeness proof, and gate/drift coverage first.
-- Applying this file alone must never be described as a ready Admin history.

CREATE TABLE cp_admin_action_history_projection (
  gateway_receipt_id text PRIMARY KEY,
  gateway_log_key text NOT NULL DEFAULT 'admin-action' CHECK (gateway_log_key = 'admin-action'),
  projection_version integer NOT NULL CHECK (projection_version = 1),
  gateway_type text NOT NULL,
  idempotency_key text NOT NULL,
  source_position bigint NOT NULL UNIQUE CHECK (source_position >= 0),
  source_recorded_at timestamptz NOT NULL,
  source_hash char(64) NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  mapping_state text NOT NULL CHECK (mapping_state IN ('MAPPED', 'SCOPE_KNOWN_KIND_UNMAPPED', 'UNMAPPED')),
  action_kind text,
  unmapped_reason text,
  target_ref text,
  target_label text,
  CONSTRAINT cp_action_history_mapping_complete CHECK (
    (mapping_state = 'MAPPED' AND action_kind IS NOT NULL AND unmapped_reason IS NULL) OR
    (mapping_state <> 'MAPPED' AND action_kind IS NULL AND unmapped_reason IS NOT NULL)
  ),
  CONSTRAINT cp_action_history_source FOREIGN KEY (gateway_log_key, gateway_receipt_id)
    REFERENCES cp_log_admin_receipts (log_key, record_id)
);

CREATE TABLE cp_admin_action_history_scope_ref (
  gateway_receipt_id text NOT NULL REFERENCES cp_admin_action_history_projection (gateway_receipt_id),
  scope_key text NOT NULL,
  instruction_receipt_id text,
  scope_kind text NOT NULL CHECK (scope_kind IN ('GLOBAL', 'INSTRUCTION')),
  PRIMARY KEY (gateway_receipt_id, scope_key),
  CONSTRAINT cp_action_history_scope_shape CHECK (
    (scope_kind = 'GLOBAL' AND scope_key = 'us' AND instruction_receipt_id IS NULL) OR
    (scope_kind = 'INSTRUCTION' AND scope_key <> 'us' AND instruction_receipt_id IS NOT NULL)
  )
);
CREATE INDEX cp_admin_action_history_by_instruction
  ON cp_admin_action_history_scope_ref (scope_key, instruction_receipt_id, gateway_receipt_id);
CREATE INDEX cp_admin_action_history_by_position
  ON cp_admin_action_history_projection (source_position, gateway_receipt_id);

-- Readiness belongs to the control-plane source window, not merely this table.
-- Future activation must prove an exact set equality of receipt IDs and
-- positions through source_through_position, not only matching counts.
CREATE TABLE cp_admin_action_history_readiness (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  projection_version integer NOT NULL CHECK (projection_version = 1),
  status text NOT NULL CHECK (status IN ('INCOMPLETE', 'READY')),
  source_through_position bigint NOT NULL CHECK (source_through_position >= 0),
  source_count bigint NOT NULL CHECK (source_count >= 0),
  projected_count bigint NOT NULL CHECK (projected_count >= 0),
  source_set_hash char(64) NOT NULL CHECK (source_set_hash ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz NOT NULL,
  CONSTRAINT cp_action_history_ready_counts CHECK (status <> 'READY' OR source_count = projected_count)
);

-- Future bootstrap must also install immutable UPDATE/DELETE rejection on both
-- projection tables, receipt-field parity checks, and a fail-closed append
-- boundary: a receipt insert and companion insert commit together, while a
-- missing companion invalidates READY in the same transaction. No such trigger
-- is installed by this staged proposal. No backfill or live write is included.
