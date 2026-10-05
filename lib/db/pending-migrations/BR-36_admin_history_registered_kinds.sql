-- BR-36 expand: River assigns the number/journal entry and applies through the build path.
-- Keep receipt parity, immutable rows, cardinality and readiness checks intact.
CREATE OR REPLACE FUNCTION cp_admin_action_history_assert_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  action_type text;
  projected_kind text;
  action_subject text;
  requested_subject text;
  action_outcome text;
  original_subject text;
  original_type text;
  original_outcome text;
BEGIN
  SELECT p.gateway_type, p.action_kind, a.record->>'subject', a.record->>'requestedSubject', a.record->>'outcome'
    INTO action_type, projected_kind, action_subject, requested_subject, action_outcome
    FROM cp_admin_action_history_projection p
    JOIN cp_log_admin_receipts a ON a.log_key = p.gateway_log_key AND a.record_id = p.gateway_receipt_id
    WHERE p.gateway_receipt_id = NEW.gateway_receipt_id;
  -- New receipt-owned mappings describe the order's identity, not a proven effect.
  IF projected_kind IS NOT NULL AND projected_kind = action_type THEN
    IF NEW.scope_kind = 'GLOBAL' THEN
      IF NEW.scope_key IS DISTINCT FROM 'us' OR NEW.instruction_receipt_id IS NOT NULL
      THEN RAISE EXCEPTION 'admin history global scope mismatch' USING ERRCODE = '23514'; END IF;
    ELSE
      IF NEW.instruction_receipt_id IS DISTINCT FROM NEW.gateway_receipt_id OR
         (NEW.scope_key IS DISTINCT FROM action_subject AND NEW.scope_key IS DISTINCT FROM requested_subject)
      THEN RAISE EXCEPTION 'admin history receipt scope mismatch' USING ERRCODE = '23514'; END IF;
    END IF;
    RETURN NEW;
  END IF;
  -- Preserve checks for historical mappings already on record.
  IF NEW.scope_kind = 'GLOBAL' THEN
    IF NEW.scope_key IS DISTINCT FROM 'us' OR
       ((action_type = 'runner.pause' AND projected_kind = 'global-runner-pause') OR
        (action_type = 'runner.resume' AND projected_kind = 'global-runner-resume')) IS NOT TRUE
    THEN RAISE EXCEPTION 'unproven global action scope' USING ERRCODE = '23514'; END IF;
  ELSE
    SELECT record->>'subject', record->>'type', record->>'outcome'
      INTO original_subject, original_type, original_outcome
      FROM cp_log_admin_receipts WHERE log_key = 'admin-action' AND record_id = NEW.instruction_receipt_id;
    IF action_type IS DISTINCT FROM 'expansion.scope.set' OR projected_kind IS NOT NULL OR
       action_subject IS DISTINCT FROM NEW.scope_key OR action_outcome IS DISTINCT FROM 'DONE' OR
       original_type IS DISTINCT FROM 'expansion.scope.set' OR
       original_subject IS DISTINCT FROM NEW.scope_key OR original_outcome IS DISTINCT FROM 'DONE'
    THEN RAISE EXCEPTION 'unproven instruction action scope' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
