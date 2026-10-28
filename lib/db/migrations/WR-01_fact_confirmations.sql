-- One confirmation per saved source and publication scope. Membership names the
-- exact immutable fact versions checked, so a partial read cannot confirm others.
CREATE TABLE fact_confirmation (
  source_copy_id bigint NOT NULL REFERENCES source_copy(id),
  scope text NOT NULL,
  checked_at timestamptz NOT NULL,
  fact_ids bigint[] NOT NULL,
  receipts jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(source_copy_id,scope)
);
--> statement-breakpoint
CREATE INDEX fact_confirmation_members ON fact_confirmation USING gin(fact_ids);
--> statement-breakpoint
CREATE VIEW checked_fact AS
SELECT f.id,f.entity_id,f.field,f.value,
  coalesce(c.receipt->>'value_text',f.value_text) AS value_text,f.status,
  coalesce(c.receipt->>'provenance_kind',f.provenance_kind) AS provenance_kind,
  coalesce(c.source_copy_id,f.source_copy_id) AS source_copy_id,
  coalesce(c.receipt->>'quote',f.quote) AS quote,
  CASE WHEN c.receipt ? 'quote_start' THEN (c.receipt->>'quote_start')::integer ELSE f.quote_start END AS quote_start,
  CASE WHEN c.receipt ? 'second_copy_id' THEN (c.receipt->>'second_copy_id')::bigint ELSE f.second_copy_id END AS second_copy_id,
  greatest(f.checked_at,c.checked_at) AS checked_at,
  f.live_at,f.held_reason,f.produced_by,f.cost_usd
FROM fact f LEFT JOIN LATERAL (
  SELECT confirmation.source_copy_id,(confirmation.receipts->f.id::text->>'checked_at')::timestamptz AS checked_at,confirmation.receipts->f.id::text AS receipt
  FROM fact_confirmation confirmation
  WHERE confirmation.fact_ids @> ARRAY[f.id]
    AND confirmation.receipts->f.id::text->>'value_hash'=md5(f.value::text) AND (confirmation.receipts->f.id::text->>'checked_at')::timestamptz>=f.checked_at
  ORDER BY (confirmation.receipts->f.id::text->>'checked_at')::timestamptz DESC,confirmation.source_copy_id DESC,confirmation.scope LIMIT 1
) c ON f.status='live';
--> statement-breakpoint
CREATE FUNCTION skip_unchanged_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NULL; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER entity_skip_unchanged BEFORE UPDATE ON entity FOR EACH ROW EXECUTE FUNCTION skip_unchanged_row();
--> statement-breakpoint
CREATE TRIGGER blank_skip_unchanged BEFORE UPDATE ON blank FOR EACH ROW EXECUTE FUNCTION skip_unchanged_row();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='readonly') THEN
    GRANT SELECT ON fact_confirmation,checked_fact TO readonly;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='wtp_cp_release_readonly') THEN
    GRANT SELECT ON fact_confirmation,checked_fact TO wtp_cp_release_readonly;
  END IF;
END $$;
