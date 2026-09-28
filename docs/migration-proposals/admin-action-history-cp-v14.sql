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
  instruction_log_key text NOT NULL DEFAULT 'admin-action' CHECK (instruction_log_key = 'admin-action'),
  instruction_receipt_id text,
  scope_kind text NOT NULL CHECK (scope_kind IN ('GLOBAL', 'INSTRUCTION')),
  PRIMARY KEY (gateway_receipt_id, scope_key),
  CONSTRAINT cp_action_history_scope_shape CHECK (
    (scope_kind = 'GLOBAL' AND scope_key = 'us' AND instruction_receipt_id IS NULL) OR
    (scope_kind = 'INSTRUCTION' AND scope_key <> 'us' AND instruction_receipt_id IS NOT NULL)
  ),
  CONSTRAINT cp_action_history_instruction_source FOREIGN KEY (instruction_log_key, instruction_receipt_id)
    REFERENCES cp_log_admin_receipts (log_key, record_id)
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

-- These guards are STAGED with the tables. They must not be applied to an old
-- gateway: its generic receipt append does not write the companion and would
-- correctly fail at COMMIT. Deferred checks see the final state of the one
-- atomic receipt+companion statement, not the intermediate CTE snapshot.
CREATE FUNCTION cp_admin_action_history_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin action history is immutable' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER cp_admin_action_history_projection_immutable
BEFORE UPDATE OR DELETE ON cp_admin_action_history_projection
FOR EACH ROW EXECUTE FUNCTION cp_admin_action_history_reject_mutation();
CREATE TRIGGER cp_admin_action_history_scope_immutable
BEFORE UPDATE OR DELETE ON cp_admin_action_history_scope_ref
FOR EACH ROW EXECUTE FUNCTION cp_admin_action_history_reject_mutation();

CREATE FUNCTION cp_admin_action_history_assert_projection() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  source_row cp_log_admin_receipts%ROWTYPE;
  scope_count bigint;
BEGIN
  SELECT * INTO source_row FROM cp_log_admin_receipts
    WHERE log_key = NEW.gateway_log_key AND record_id = NEW.gateway_receipt_id;
  IF NOT FOUND OR source_row.position <> NEW.source_position OR
     source_row.recorded_at <> NEW.source_recorded_at OR
     source_row.record->>'receiptId' <> NEW.gateway_receipt_id OR
     source_row.record->>'type' <> NEW.gateway_type OR
     source_row.record->>'idempotencyKey' <> NEW.idempotency_key
  THEN RAISE EXCEPTION 'admin history/source receipt mismatch' USING ERRCODE = '23514'; END IF;
  SELECT count(*) INTO scope_count FROM cp_admin_action_history_scope_ref
    WHERE gateway_receipt_id = NEW.gateway_receipt_id;
  IF (NEW.mapping_state = 'UNMAPPED' AND scope_count <> 0) OR
     (NEW.mapping_state <> 'UNMAPPED' AND scope_count <> 1)
  THEN RAISE EXCEPTION 'admin history scope cardinality mismatch' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER cp_admin_action_history_projection_parity
AFTER INSERT ON cp_admin_action_history_projection DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cp_admin_action_history_assert_projection();

CREATE FUNCTION cp_admin_action_history_assert_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  action_type text;
  action_subject text;
  original_subject text;
  original_type text;
BEGIN
  SELECT p.gateway_type, a.record->>'subject' INTO action_type, action_subject
    FROM cp_admin_action_history_projection p
    JOIN cp_log_admin_receipts a ON a.log_key = p.gateway_log_key AND a.record_id = p.gateway_receipt_id
    WHERE p.gateway_receipt_id = NEW.gateway_receipt_id;
  IF NEW.scope_kind = 'GLOBAL' THEN
    IF action_type NOT IN ('runner.pause', 'runner.resume') OR NEW.scope_key <> 'us'
    THEN RAISE EXCEPTION 'unproven global action scope' USING ERRCODE = '23514'; END IF;
  ELSE
    SELECT record->>'subject', record->>'type' INTO original_subject, original_type
      FROM cp_log_admin_receipts WHERE log_key = 'admin-action' AND record_id = NEW.instruction_receipt_id;
    IF action_type <> 'expansion.scope.set' OR action_subject <> NEW.scope_key OR
       original_type <> 'expansion.scope.set' OR original_subject <> NEW.scope_key
    THEN RAISE EXCEPTION 'unproven instruction action scope' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER cp_admin_action_history_scope_parity
AFTER INSERT ON cp_admin_action_history_scope_ref DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cp_admin_action_history_assert_scope();

CREATE FUNCTION cp_admin_action_history_assert_receipt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.log_key <> 'admin-action' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM cp_admin_action_history_projection
    WHERE gateway_receipt_id = NEW.record_id AND source_position = NEW.position)
  THEN RAISE EXCEPTION 'admin receipt lacks atomic history companion' USING ERRCODE = '23514'; END IF;
  IF EXISTS (SELECT 1 FROM cp_admin_action_history_readiness
    WHERE singleton = true AND status = 'READY' AND source_through_position < NEW.position)
  THEN RAISE EXCEPTION 'admin history READY watermark was not invalidated' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER cp_admin_action_history_receipt_companion
AFTER INSERT ON cp_log_admin_receipts DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cp_admin_action_history_assert_receipt();

-- No historical backfill, readiness activation, bootstrap registration, or
-- live write is included. A later reviewed activation must prove source set
-- equality and set READY only once old receipts have explicit mapped/unmapped
-- rows, then atomically keep it valid or INCOMPLETE on every append.
