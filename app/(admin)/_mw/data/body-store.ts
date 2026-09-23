import "server-only";

/**
 * **EVERY WATCHED BODY, READ NARROWLY.** (Admin redesign, 2026-09-23.)
 *
 * A body we watch is a public body with a registered meeting source: one
 * routine meeting contract per (source, body) in the production data plane.
 * The Fleet · Now screen shows each one's standing, so this reads, in one
 * read-only transaction (one MVCC snapshot, so the figures agree with each
 * other) and under a statement limit, only what that needs:
 *
 * ```
 *   versions   each body's CURRENT promoted version: how many meetings it
 *              holds, how many the last read re-confirmed ("fresh") versus
 *              carried forward, how many it held back, the change it made,
 *              and the furthest meeting it lists — counts only, never the
 *              payload (measured 2026-09-23: 84 bodies in ~180 ms)
 *   attempts   the last five reads per body in the last seven days, from
 *              the local attempt event (never the adapter's claimed time)
 *   readbacks  the typed Reader readback of each current version
 *   day        per body, the last 24 hours: reads, reads that got in,
 *              versions promoted and the change counts they carried
 * ```
 *
 * The heavy observability read (every candidate's full envelope) is not used:
 * unbounded it returned 3.8 GB and it times out on an Admin render.
 * Any failure is thrown to the loader, which renders the section as unread —
 * never as zero bodies.
 */
import { Pool } from "@neondatabase/serverless";

import { READER_PROJECTION_READBACK_PREFIX, parseReaderProjectionReadback } from "@/lib/civic-data/reader-readback.ts";

export const BODY_STORE_STATEMENT_TIMEOUT_MS = 4_000;

export interface BodyVersionRow {
  readonly scope: string;
  readonly versionId: string;
  readonly promotedAt: string;
  readonly meetings: number;
  readonly fresh: number | null;
  readonly carried: number | null;
  readonly docs: number;
  /** Meetings already held that carry neither an agenda link nor an attached agenda document. */
  readonly noAgendaLink: number;
  /** Meetings still ahead with no agenda yet — not a gap: agendas post shortly before a sitting. */
  readonly noAgendaAhead: number;
  readonly upcoming: number;
  readonly furthestAhead: string | null;
  readonly bodyName: string | null;
  readonly jurisdiction: string | null;
  readonly outcome: "CHANGED" | "UNCHANGED" | null;
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
  readonly held: number;
}

export interface BodyAttemptRow {
  readonly scope: string;
  readonly candidateId: string;
  readonly state: string;
  readonly failureCode: string | null;
  /** The failure's own sentence (e.g. "HTTP 403 for <url>"), clipped; null when the read did not fail. */
  readonly failureDetail: string | null;
  readonly acquisitionSucceeded: boolean;
  readonly attemptedAt: string;
}

export interface BodyReadbackRow {
  readonly candidateId: string;
  readonly at: string;
  readonly passed: boolean;
}

export interface BodyDayRow {
  readonly scope: string;
  readonly reads: number;
  readonly gotIn: number;
  readonly versions: number;
  readonly changedVersions: number;
  /** Reads that got in but found the source listing no meetings: a zero, which is not proof of none. */
  readonly cannotTell: number;
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
}

export interface BodyStoreRead {
  readonly asOf: string;
  readonly versions: readonly BodyVersionRow[];
  readonly attempts: readonly BodyAttemptRow[];
  readonly readbacks: readonly BodyReadbackRow[];
  readonly day: readonly BodyDayRow[];
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}
function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}
function int(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function intOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export async function readBodyStore(connection: string, nowIso: string): Promise<BodyStoreRead> {
  const pool = new Pool({ connectionString: connection, max: 1, connectionTimeoutMillis: 15_000 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ");
    await client.query(`SET LOCAL statement_timeout = ${BODY_STORE_STATEMENT_TIMEOUT_MS}`);

    const versions = await client.query(
      `SELECT p.scope, p.current_version_id, p.promoted_at,
              jsonb_array_length(COALESCE(p.payload->'meetings', '[]'::jsonb)) AS meetings,
              (p.payload->'counts'->>'fresh')::int AS fresh,
              (p.payload->'counts'->>'carried')::int AS carried,
              jsonb_array_length(COALESCE(p.payload->'agendaDocuments', '[]'::jsonb)) AS docs,
              (SELECT count(*) FROM jsonb_array_elements(COALESCE(p.payload->'meetings', '[]'::jsonb)) m
                WHERE (m->>'startsAt')::timestamptz <= $1::timestamptz
                  AND COALESCE(m->>'agendaUrl', '') = ''
                  AND NOT EXISTS (
                    SELECT 1 FROM jsonb_array_elements(COALESCE(p.payload->'agendaDocuments', '[]'::jsonb)) d
                     WHERE d->>'meetingId' = m->>'id')) AS no_agenda,
              (SELECT count(*) FROM jsonb_array_elements(COALESCE(p.payload->'meetings', '[]'::jsonb)) m
                WHERE (m->>'startsAt')::timestamptz > $1::timestamptz
                  AND COALESCE(m->>'agendaUrl', '') = ''
                  AND NOT EXISTS (
                    SELECT 1 FROM jsonb_array_elements(COALESCE(p.payload->'agendaDocuments', '[]'::jsonb)) d
                     WHERE d->>'meetingId' = m->>'id')) AS no_agenda_ahead,
              (SELECT count(*) FROM jsonb_array_elements(COALESCE(p.payload->'meetings', '[]'::jsonb)) m
                WHERE (m->>'startsAt')::timestamptz > $1::timestamptz) AS upcoming,
              (SELECT max((m->>'startsAt')::timestamptz) FROM jsonb_array_elements(COALESCE(p.payload->'meetings', '[]'::jsonb)) m) AS furthest,
              p.payload->'meetings'->0->>'bodyName' AS body_name,
              p.payload->'meetings'->0->>'jurisdiction' AS jurisdiction,
              cd.candidate->'changeSet'->>'outcome' AS outcome,
              jsonb_array_length(COALESCE(cd.candidate->'changeSet'->'added', '[]'::jsonb)) AS added,
              jsonb_array_length(COALESCE(cd.candidate->'changeSet'->'changed', '[]'::jsonb)) AS changed,
              jsonb_array_length(COALESCE(cd.candidate->'changeSet'->'removed', '[]'::jsonb)) AS removed,
              jsonb_array_length(COALESCE(cd.candidate->'changeSet'->'held', '[]'::jsonb)) AS held
         FROM civic_data_promotions p
         LEFT JOIN civic_data_candidates cd ON cd.id = p.current_version_id
        WHERE p.record_class = 'MEETING'`,
      [nowIso],
    );

    const attempts = await client.query(
      `SELECT scope, candidate_id, state, failure_code, failure_detail, acquisition_succeeded, attempted_at FROM (
          SELECT c.scope, c.id AS candidate_id, c.state, c.failure_code, left(c.failure_detail, 300) AS failure_detail, c.acquisition_succeeded, e.at AS attempted_at,
                 row_number() OVER (PARTITION BY c.scope ORDER BY e.at DESC, c.id DESC) AS rn
            FROM civic_data_candidates c
            JOIN civic_data_candidate_events e ON e.candidate_id = c.id AND e.sequence = 1
           WHERE c.record_class = 'MEETING'
             AND c.retrieved_at > $1::timestamptz - interval '7 days') x
        WHERE rn <= 5`,
      [nowIso],
    );

    const currentIds = [...new Set(versions.rows.map((r) => String(r.current_version_id)))];
    const readbacks =
      currentIds.length === 0
        ? { rows: [] as Record<string, unknown>[] }
        : await client.query(
            `SELECT candidate_id, at, detail FROM civic_data_candidate_events
              WHERE candidate_id = ANY($1::text[]) AND detail LIKE $2`,
            [currentIds, `${READER_PROJECTION_READBACK_PREFIX}%`],
          );

    const day = await client.query(
      `SELECT scope,
              count(*) AS reads,
              count(*) FILTER (WHERE acquisition_succeeded) AS got_in,
              count(*) FILTER (WHERE state = 'PROMOTED') AS versions,
              count(*) FILTER (WHERE state = 'PROMOTED' AND candidate->'changeSet'->>'outcome' = 'CHANGED') AS changed_versions,
              count(*) FILTER (WHERE state = 'CANNOT_TELL') AS cannot_tell,
              COALESCE(sum(jsonb_array_length(COALESCE(candidate->'changeSet'->'added', '[]'::jsonb))) FILTER (WHERE state = 'PROMOTED'), 0) AS added,
              COALESCE(sum(jsonb_array_length(COALESCE(candidate->'changeSet'->'changed', '[]'::jsonb))) FILTER (WHERE state = 'PROMOTED'), 0) AS changed,
              COALESCE(sum(jsonb_array_length(COALESCE(candidate->'changeSet'->'removed', '[]'::jsonb))) FILTER (WHERE state = 'PROMOTED'), 0) AS removed
         FROM civic_data_candidates
        WHERE record_class = 'MEETING'
          AND retrieved_at > $1::timestamptz - interval '24 hours'
        GROUP BY scope`,
      [nowIso],
    );

    await client.query("ROLLBACK");

    return {
      asOf: nowIso,
      versions: versions.rows.map((r) => ({
        scope: String(r.scope),
        versionId: String(r.current_version_id),
        promotedAt: iso(r.promoted_at),
        meetings: int(r.meetings),
        fresh: intOrNull(r.fresh),
        carried: intOrNull(r.carried),
        docs: int(r.docs),
        noAgendaLink: int(r.no_agenda),
        noAgendaAhead: int(r.no_agenda_ahead),
        upcoming: int(r.upcoming),
        furthestAhead: isoOrNull(r.furthest),
        bodyName: textOrNull(r.body_name),
        jurisdiction: textOrNull(r.jurisdiction),
        outcome: r.outcome === "CHANGED" || r.outcome === "UNCHANGED" ? r.outcome : null,
        added: int(r.added),
        changed: int(r.changed),
        removed: int(r.removed),
        held: int(r.held),
      })),
      attempts: attempts.rows.map((r) => ({
        scope: String(r.scope),
        candidateId: String(r.candidate_id),
        state: String(r.state),
        failureCode: textOrNull(r.failure_code),
        failureDetail: textOrNull(r.failure_detail),
        acquisitionSucceeded: r.acquisition_succeeded === true,
        attemptedAt: iso(r.attempted_at),
      })),
      /* A readback event that does not parse as the V2 receipt proves nothing
         about the version, so it is dropped rather than read as a pass. */
      readbacks: readbacks.rows.flatMap((r) => {
        const receipt = parseReaderProjectionReadback(String(r.detail ?? ""));
        return receipt === null ? [] : [{ candidateId: String(r.candidate_id), at: iso(r.at), passed: receipt.status === "PASS" }];
      }),
      day: day.rows.map((r) => ({
        scope: String(r.scope),
        reads: int(r.reads),
        gotIn: int(r.got_in),
        versions: int(r.versions),
        changedVersions: int(r.changed_versions),
        cannotTell: int(r.cannot_tell),
        added: int(r.added),
        changed: int(r.changed),
        removed: int(r.removed),
      })),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
