export const MS_01_MODEL_CHARGES = `DO $$ BEGIN
  IF coalesce((SELECT version FROM cp_schema_version WHERE singleton),0) < 33 THEN
  IF to_regclass('cp_spend_window') IS NOT NULL THEN
    INSERT INTO cp_model_charges (id,recorded_at,charge)
      SELECT charge->>'id', (charge->>'at')::timestamptz, charge
      FROM cp_spend_window, LATERAL jsonb_array_elements(value->'charges') charge
      ON CONFLICT (id) DO NOTHING;
  END IF;
  INSERT INTO cp_model_charge_pending (id,recorded_at,log_key,position)
    SELECT cp_cost_record_id(record),cp_cost_recorded_at(record),log_key,position FROM cp_log_costs l
    WHERE cp_cost_recorded_at(record) >= now() - interval '30 hours'
      AND NOT EXISTS (SELECT 1 FROM cp_model_charges c WHERE c.id=cp_cost_record_id(l.record))
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;`;
