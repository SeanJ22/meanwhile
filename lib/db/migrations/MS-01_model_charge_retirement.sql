DO $$ BEGIN
  IF to_regclass('cp_spend_window') IS NOT NULL THEN
    LOCK TABLE cp_spend_window IN ACCESS EXCLUSIVE MODE;
    INSERT INTO cp_model_charges (id,recorded_at,charge)
      SELECT charge->>'id', (charge->>'at')::timestamptz, charge
      FROM cp_spend_window, LATERAL jsonb_array_elements(value->'charges') charge
      ON CONFLICT (id) DO NOTHING;
    DROP TABLE cp_spend_window;
  END IF;
END $$;
--> statement-breakpoint
DO $do$
DECLARE held jsonb;
BEGIN
  SELECT value->'spendHolds' INTO held FROM cp_budget WHERE id = 'shared-budget-ledger' FOR UPDATE;
  IF held IS NULL OR jsonb_typeof(held) <> 'object' OR held = '{}'::jsonb THEN RETURN; END IF;
  INSERT INTO cp_spend_holds (hold_id, job_id, obligation_id, keys, lifetime_keys, usd, held_at, what, settled_usd, cost_recorded_at)
  SELECT e.key, e.value->>'jobId', coalesce(e.value->>'obligationId', ''),
    ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(e.value->'keys') = 'array' THEN e.value->'keys' ELSE '[]'::jsonb END)),
    ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(e.value->'lifetimeKeys') = 'array' THEN e.value->'lifetimeKeys' ELSE '[]'::jsonb END)),
    (e.value->>'usd')::numeric, (e.value->>'heldAt')::timestamptz, coalesce(e.value->>'what', ''),
    CASE WHEN jsonb_typeof(e.value->'settled') = 'object' AND e.value->'settled'->>'costRecordedAt' IS NOT NULL
      THEN coalesce((e.value->'settled'->>'usd')::numeric, 0) END,
    CASE WHEN jsonb_typeof(e.value->'settled') = 'object' THEN (e.value->'settled'->>'costRecordedAt')::timestamptz END
  FROM jsonb_each(held) AS e
  WHERE jsonb_typeof(e.value) = 'object' AND e.value->>'jobId' IS NOT NULL
    AND jsonb_typeof(e.value->'usd') = 'number' AND e.value->>'heldAt' IS NOT NULL
  ON CONFLICT (hold_id) DO NOTHING;
  UPDATE cp_budget SET value = jsonb_set(value, '{spendHolds}', '{}'::jsonb), revision = revision + 1, changed_at = now()
    WHERE id = 'shared-budget-ledger';
END $do$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cp_budget_holds_indexed' AND conrelid='cp_budget'::regclass) THEN
    ALTER TABLE cp_budget ADD CONSTRAINT cp_budget_holds_indexed
      CHECK (value->'spendHolds' IS NULL OR value->'spendHolds' = '{}'::jsonb);
  END IF;
END $$;
