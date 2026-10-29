import type { Sql } from "../control-plane/repository/pg-store.ts";
import type { WorkItemLike } from "./loss-readings.ts";
import type { LossStudy, SharedTrait } from "./study-losses.ts";

/** Counts, not saved obligations: expiration buckets preserve the study's clock-dependent population. */
export const LOSS_STUDY_COUNTS_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS cp_loss_obligation_counts (
    record_class text NOT NULL, place_id text NOT NULL, absent_until text NOT NULL,
    worked bigint NOT NULL, absent bigint NOT NULL,
    PRIMARY KEY (record_class, place_id, absent_until), CHECK (worked >= 0 AND absent >= 0));`,
  `CREATE TABLE IF NOT EXISTS cp_loss_obligation_heads (record_class text PRIMARY KEY, changed_at timestamptz NOT NULL);`,
  `CREATE INDEX IF NOT EXISTS cp_loss_obligation_expiry ON cp_loss_obligation_counts (absent_until) WHERE absent > 0;`,
  `CREATE OR REPLACE FUNCTION cp_fold_loss_obligation(v jsonb, direction integer) RETURNS void LANGUAGE plpgsql AS $$
  DECLARE cls text := v->>'recordClass'; place text := v->>'subjectId';
    until_at text := coalesce(v->>'absentUntil', '');
    n_worked integer := CASE WHEN v->>'lastWorkedAt' IS NULL THEN 0 ELSE 1 END;
    n_absent integer;
  BEGIN
    IF cls IS NULL OR place IS NULL THEN RETURN; END IF;
    IF until_at !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$' THEN until_at := ''; END IF;
    n_absent := CASE WHEN until_at = '' THEN 0 ELSE 1 END;
    IF n_worked + n_absent = 0 THEN RETURN; END IF;
    IF direction = 1 THEN
      INSERT INTO cp_loss_obligation_counts VALUES (cls, place, until_at, n_worked, n_absent)
        ON CONFLICT (record_class, place_id, absent_until) DO UPDATE
          SET worked = cp_loss_obligation_counts.worked + excluded.worked, absent = cp_loss_obligation_counts.absent + excluded.absent;
    ELSE
      UPDATE cp_loss_obligation_counts SET worked = worked - n_worked, absent = absent - n_absent
        WHERE record_class = cls AND place_id = place AND absent_until = until_at;
      DELETE FROM cp_loss_obligation_counts WHERE record_class = cls AND place_id = place AND absent_until = until_at AND worked = 0 AND absent = 0;
    END IF;
    INSERT INTO cp_loss_obligation_heads VALUES (cls, clock_timestamp())
      ON CONFLICT (record_class) DO UPDATE SET changed_at = excluded.changed_at;
  END $$;`,
  `CREATE OR REPLACE FUNCTION cp_count_loss_obligation() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF TG_OP = 'UPDATE' AND (OLD.value->>'recordClass', OLD.value->>'subjectId', OLD.value->>'lastWorkedAt', OLD.value->>'absentUntil')
      IS NOT DISTINCT FROM (NEW.value->>'recordClass', NEW.value->>'subjectId', NEW.value->>'lastWorkedAt', NEW.value->>'absentUntil') THEN RETURN NEW; END IF;
    IF TG_OP <> 'INSERT' THEN PERFORM cp_fold_loss_obligation(OLD.value, -1); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM cp_fold_loss_obligation(NEW.value, 1); RETURN NEW; END IF;
    RETURN OLD;
  END $$;`,
  `CREATE OR REPLACE FUNCTION cp_loss_trait_changed() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF TG_OP = 'UPDATE' THEN
      IF TG_TABLE_NAME = 'cp_doors' AND (OLD.value->>'ocdId', OLD.value->>'kind') IS NOT DISTINCT FROM (NEW.value->>'ocdId', NEW.value->>'kind') THEN RETURN NEW; END IF;
      IF TG_TABLE_NAME <> 'cp_doors' AND (OLD.value->>'subject', OLD.value#>>'{autonomousPlan,jurisdiction}', OLD.value#>>'{publicationOutcome,status}')
        IS NOT DISTINCT FROM (NEW.value->>'subject', NEW.value#>>'{autonomousPlan,jurisdiction}', NEW.value#>>'{publicationOutcome,status}') THEN RETURN NEW; END IF;
    END IF;
    INSERT INTO cp_loss_obligation_heads VALUES ('*', clock_timestamp()) ON CONFLICT (record_class) DO UPDATE SET changed_at = excluded.changed_at;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$;`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM cp_loss_obligation_heads WHERE record_class = '*') THEN
      LOCK TABLE cp_obligations IN SHARE ROW EXCLUSIVE MODE;
      INSERT INTO cp_loss_obligation_counts (record_class, place_id, absent_until, worked, absent)
        SELECT value->>'recordClass', value->>'subjectId',
          CASE WHEN coalesce(value->>'absentUntil','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$' THEN value->>'absentUntil' ELSE '' END,
          count(*) FILTER (WHERE value->>'lastWorkedAt' IS NOT NULL),
          count(*) FILTER (WHERE coalesce(value->>'absentUntil','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$')
        FROM cp_obligations WHERE value->>'recordClass' IS NOT NULL AND value->>'subjectId' IS NOT NULL
        GROUP BY 1,2,3 HAVING count(*) FILTER (WHERE value->>'lastWorkedAt' IS NOT NULL OR value->>'absentUntil' IS NOT NULL) > 0
        ON CONFLICT (record_class, place_id, absent_until) DO NOTHING;
      INSERT INTO cp_loss_obligation_heads SELECT DISTINCT record_class, clock_timestamp() FROM cp_loss_obligation_counts ON CONFLICT DO NOTHING;
      INSERT INTO cp_loss_obligation_heads VALUES ('*', clock_timestamp());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cp_loss_obligation_counts_touch' AND tgrelid = 'cp_obligations'::regclass) THEN
      CREATE TRIGGER cp_loss_obligation_counts_touch AFTER INSERT OR UPDATE OR DELETE ON cp_obligations FOR EACH ROW EXECUTE FUNCTION cp_count_loss_obligation();
    END IF;
  END $$;`,
  `DO $$ DECLARE source_table text; BEGIN
    FOREACH source_table IN ARRAY ARRAY['cp_doors','cp_work_items','cp_work_items_archive'] LOOP
      IF to_regclass(source_table) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cp_loss_trait_touch' AND tgrelid = to_regclass(source_table)) THEN
        EXECUTE format('CREATE TRIGGER cp_loss_trait_touch AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION cp_loss_trait_changed()', source_table);
      END IF;
    END LOOP;
  END $$;`,
];

/** Only changed classes and absence deadlines crossing the cursor are studied again. The population stays complete. */
export const LOSS_OBLIGATION_STUDIES_SQL = `WITH changed AS (
  SELECT record_class FROM cp_loss_obligation_heads WHERE record_class <> '*' AND ($1::timestamptz IS NULL OR changed_at >= $1::timestamptz
    OR EXISTS (SELECT 1 FROM cp_loss_obligation_heads h WHERE h.record_class='*' AND h.changed_at >= $1::timestamptz))
  UNION SELECT record_class FROM cp_loss_obligation_counts WHERE absent > 0 AND absent_until > coalesce($1::text, '') AND absent_until <= $2
), populations AS (
  SELECT c.record_class, c.place_id, bool_or(c.absent > 0 AND c.absent_until > $2) AS failed, bool_or(c.worked > 0) AS worked
  FROM cp_loss_obligation_counts c JOIN changed d USING (record_class) GROUP BY c.record_class, c.place_id
), door_platforms AS (
  SELECT value->>'ocdId' AS place_id, CASE WHEN count(DISTINCT lower(value->>'kind')) = 1 THEN min(lower(value->>'kind')) END AS platform
  FROM cp_doors WHERE value->>'ocdId' IN (SELECT place_id FROM populations) GROUP BY 1
), plan_states AS (
  SELECT DISTINCT ON (value->>'subject') value->>'subject' AS place_id, lower(value#>>'{autonomousPlan,jurisdiction}') AS state
  FROM cp_work_items_history WHERE value#>>'{publicationOutcome,status}' IN ('HELD','PUBLISHED')
    AND value#>>'{autonomousPlan,jurisdiction}' ~ '^[a-zA-Z]{2}$' AND value->>'subject' IN (SELECT place_id FROM populations)
  ORDER BY value->>'subject', (value#>>'{publicationOutcome,status}' = 'PUBLISHED') DESC, id DESC
), places AS (
  SELECT p.record_class, p.place_id, p.failed, d.platform,
    coalesce(lower(substring(p.place_id from '(?i)(?:^|/)state:([a-z]{2})(?:/|$)')), s.state) AS state
  FROM populations p LEFT JOIN door_platforms d USING (place_id) LEFT JOIN plan_states s USING (place_id)
  WHERE p.failed OR p.worked
), totals AS (
  SELECT record_class, count(*) FILTER (WHERE failed) AS failures, count(*) FILTER (WHERE NOT failed) AS works FROM places GROUP BY record_class
), traits AS (
  SELECT p.record_class, p.failed, t.trait, t.value FROM places p
  CROSS JOIN LATERAL (VALUES ('platform', p.platform), ('state', p.state)) t(trait,value)
), shared AS (
  SELECT t.record_class, t.trait, min(t.value) FILTER (WHERE t.failed) AS value FROM traits t JOIN totals s USING(record_class)
  GROUP BY t.record_class,t.trait,s.failures HAVING count(t.value) FILTER (WHERE t.failed) = s.failures
    AND min(t.value) FILTER (WHERE t.failed) = max(t.value) FILTER (WHERE t.failed)
    AND NOT bool_or(NOT t.failed AND t.value = (SELECT min(f.value) FROM traits f WHERE f.record_class=t.record_class AND f.trait=t.trait AND f.failed))
)
SELECT t.record_class, t.failures, t.works, coalesce(jsonb_agg(jsonb_build_object('trait', s.trait, 'value', s.value) ORDER BY s.trait) FILTER (WHERE s.trait IS NOT NULL), '[]'::jsonb) AS shared
FROM totals t LEFT JOIN shared s USING(record_class) WHERE t.failures >= 2 GROUP BY t.record_class,t.failures,t.works ORDER BY t.record_class`;

export async function readLossObligationStudies(sql: Sql, since: string | null, now: string): Promise<{ readonly studies: readonly LossStudy[]; readonly through: string; readonly failures: number; readonly readings: number }> {
  // The read-start clock plus overlap leaves commits racing this read for the next pass.
  const [clock] = await sql.query("SELECT clock_timestamp() AS through", []) as { through: string | Date }[];
  const through = new Date(clock.through).toISOString();
  const rows = await sql.query(LOSS_OBLIGATION_STUDIES_SQL, [since, now]) as Record<string, unknown>[];
  const [totals] = await sql.query(`SELECT coalesce(sum(absent) FILTER (WHERE absent_until > $1),0) AS failures,
    coalesce(sum(worked),0) + coalesce(sum(absent-worked) FILTER (WHERE absent_until > $1),0) AS readings FROM cp_loss_obligation_counts`, [now]) as Record<string, unknown>[];
  return { through, failures: Number(totals.failures), readings: Number(totals.readings), studies: rows.map(row => ({ methodId: `empty-hunt|${row.record_class}`, failures: Number(row.failures), works: Number(row.works),
    shared: row.shared as SharedTrait[], says: "" })) };
}

/** A checker study needs the class and result clock, never the work plan or acquisition history. */
export async function readLossCheckerItems(sql: Sql): Promise<readonly WorkItemLike[]> {
  const rows = await sql.query(`SELECT value->>'subject' AS subject, value#>>'{autonomousPlan,jurisdiction}' AS jurisdiction,
    value#>>'{autonomousPlan,contract,recordClass}' AS record_class, value#>>'{publicationOutcome,status}' AS status,
    value#>>'{publicationOutcome,at}' AS at FROM cp_work_items_history
    WHERE value#>>'{publicationOutcome,status}' IN ('HELD','PUBLISHED')
    ORDER BY (value#>>'{publicationOutcome,status}' = 'PUBLISHED'), id`, []) as Record<string, unknown>[];
  return rows.map(row => ({ subject: String(row.subject), autonomousPlan: { jurisdiction: row.jurisdiction as string | undefined,
    contract: { recordClass: row.record_class as string | undefined } }, publicationOutcome: { status: String(row.status), at: String(row.at) } }));
}
