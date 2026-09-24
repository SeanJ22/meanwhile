import "server-only";

/**
 * **EVERY WATCHED BODY, READ NARROWLY.** (Admin redesign, 2026-09-23.)
 *
 * A body we watch is a public body with a registered meeting source: one
 * routine meeting contract per (source, body) in the production data plane.
 * The Fleet · Now screen shows each one's standing, so this reads only what
 * that needs, under a statement limit, in two read-only transactions sent at
 * once over HTTP (one round trip each, no socket to open): the figures that
 * must agree with each other in one MVCC snapshot, and the change history,
 * which may fail alone, in the other:
 *
 * ```
 *   versions   each body's CURRENT promoted version: how many meetings it
 *              holds, how many the last read re-confirmed ("fresh") versus
 *              carried forward, how many it held back, the change it made,
 *              and the furthest meeting it lists — counts only, never the
 *              payload (measured 2026-09-23: 84 bodies in ~180 ms)
 *   attempts   the last five reads per body in the last seven days, from
 *              the local attempt event (never the adapter's claimed time)
 *   changes    each body's LATEST version that changed something readers are
 *              served: when it was retrieved, validated and promoted (its own
 *              events), its change counts and the first meetings it added.
 *              Later reads that changed nothing move the pointer on, so the
 *              current version alone cannot say when a record reached readers
 *              (measured 2026-09-23: 85 bodies in ~1.4 s)
 *   readbacks  the typed Reader readback of each current version, and of
 *              each latest change
 *   day        per body, the last 24 hours: reads, reads that got in,
 *              versions promoted and the change counts they carried
 * ```
 *
 * A cold server paid about three seconds for this read on 2026-09-24: a socket
 * to open, six statements one after another, and a day tally that decoded each
 * candidate's envelope once per change-set field (885 ms on the server; 220 ms
 * decoding it once). A load over three seconds is not a win (Sean, 2026-09-24).
 *
 * The heavy observability read (every candidate's full envelope) is not used:
 * unbounded it returned 3.8 GB and it times out on an Admin render.
 * Any failure is thrown to the loader, which renders the section as unread —
 * never as zero bodies.
 */
import { neon } from "@neondatabase/serverless";

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

export interface BodyChangeRow {
  readonly scope: string;
  readonly versionId: string;
  readonly retrievedAt: string;
  /** Its "Atomic pointer … moved" event; null when none is recorded. */
  readonly promotedAt: string | null;
  /** Its "Every applicable GOOD check passed" event; null when none is recorded. */
  readonly validatedAt: string | null;
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
  readonly held: number;
  /** How many of the added records are meetings; the rest are agenda documents. */
  readonly meetingsAdded: number;
  /** Up to three added meetings, earliest first, as the record names them. */
  readonly named: readonly { readonly title: string | null; readonly startsAt: string | null }[];
  /** How many of the changed records are meetings; the rest are agenda documents. */
  readonly meetingsChanged: number;
  /** Up to three changed meetings, earliest first. */
  readonly changedNamed: readonly { readonly title: string | null; readonly startsAt: string | null }[];
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
  /** Null when the change history did not answer: the bodies render without it, and say so. */
  readonly changes: readonly BodyChangeRow[] | null;
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
function meetingsOf(value: unknown): { readonly title: string | null; readonly startsAt: string | null }[] {
  return (Array.isArray(value) ? (value as Record<string, unknown>[]) : []).map((m) => ({ title: textOrNull(m.title), startsAt: textOrNull(m.startsAt) }));
}

/* ------------------------------------------------------------------ the statements */

/** Each body's current promoted version: counts only, never the payload. */
const VERSIONS = `SELECT p.scope, p.current_version_id, p.promoted_at,
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
        cs.outcome, cs.added, cs.changed, cs.removed, cs.held
   FROM civic_data_promotions p
   LEFT JOIN LATERAL (
     SELECT x.cs->>'outcome' AS outcome,
            jsonb_array_length(COALESCE(x.cs->'added', '[]'::jsonb)) AS added,
            jsonb_array_length(COALESCE(x.cs->'changed', '[]'::jsonb)) AS changed,
            jsonb_array_length(COALESCE(x.cs->'removed', '[]'::jsonb)) AS removed,
            jsonb_array_length(COALESCE(x.cs->'held', '[]'::jsonb)) AS held
       FROM (SELECT cd.candidate->'changeSet' AS cs FROM civic_data_candidates cd WHERE cd.id = p.current_version_id OFFSET 0) x
   ) cs ON true
  WHERE p.record_class = 'MEETING'`;

/** The last five reads per body in the last seven days, from the local attempt event. */
const ATTEMPTS = `SELECT scope, candidate_id, state, failure_code, failure_detail, acquisition_succeeded, attempted_at FROM (
    SELECT c.scope, c.id AS candidate_id, c.state, c.failure_code, left(c.failure_detail, 300) AS failure_detail, c.acquisition_succeeded, e.at AS attempted_at,
           row_number() OVER (PARTITION BY c.scope ORDER BY e.at DESC, c.id DESC) AS rn
      FROM civic_data_candidates c
      JOIN civic_data_candidate_events e ON e.candidate_id = c.id AND e.sequence = 1
     WHERE c.record_class = 'MEETING'
       AND c.retrieved_at > $1::timestamptz - interval '7 days') x
  WHERE rn <= 5`;

/** The typed Reader readback of each current version. */
const VERSION_READBACKS = `SELECT e.candidate_id, e.at, e.detail
   FROM civic_data_candidate_events e
   JOIN civic_data_promotions p ON p.current_version_id = e.candidate_id AND p.record_class = 'MEETING'
  WHERE e.detail LIKE $1`;

/** Per body, the last 24 hours; each candidate's change set is decoded once, and only for promoted ones. */
const DAY = `SELECT c.scope,
        count(*) AS reads,
        count(*) FILTER (WHERE c.acquisition_succeeded) AS got_in,
        count(*) FILTER (WHERE c.state = 'PROMOTED') AS versions,
        count(*) FILTER (WHERE c.state = 'PROMOTED' AND x.cs->>'outcome' = 'CHANGED') AS changed_versions,
        count(*) FILTER (WHERE c.state = 'CANNOT_TELL') AS cannot_tell,
        COALESCE(sum(jsonb_array_length(COALESCE(x.cs->'added', '[]'::jsonb))) FILTER (WHERE c.state = 'PROMOTED'), 0) AS added,
        COALESCE(sum(jsonb_array_length(COALESCE(x.cs->'changed', '[]'::jsonb))) FILTER (WHERE c.state = 'PROMOTED'), 0) AS changed,
        COALESCE(sum(jsonb_array_length(COALESCE(x.cs->'removed', '[]'::jsonb))) FILTER (WHERE c.state = 'PROMOTED'), 0) AS removed
   FROM civic_data_candidates c
  CROSS JOIN LATERAL (SELECT CASE WHEN c.state = 'PROMOTED' THEN c.candidate->'changeSet' END AS cs OFFSET 0) x
  WHERE c.record_class = 'MEETING'
    AND c.retrieved_at > $1::timestamptz - interval '24 hours'
  GROUP BY c.scope`;

/** Each body's latest version that changed something readers are served, with its own readbacks. */
const CHANGES = `WITH latest AS (
     SELECT p.scope, l.id
       FROM civic_data_promotions p
       CROSS JOIN LATERAL (
         SELECT x.id
           FROM civic_data_candidates x
          WHERE x.record_class = 'MEETING' AND x.scope = p.scope AND x.state = 'PROMOTED'
            AND (CASE WHEN x.state = 'PROMOTED' THEN x.candidate->'changeSet'->>'outcome' END) = 'CHANGED'
          ORDER BY x.retrieved_at DESC, x.id DESC
          LIMIT 1) l
      WHERE p.record_class = 'MEETING')
   SELECT l.scope, l.id, c.retrieved_at,
        jsonb_array_length(COALESCE(cs.cs->'added', '[]'::jsonb)) AS added,
        jsonb_array_length(COALESCE(cs.cs->'changed', '[]'::jsonb)) AS changed,
        jsonb_array_length(COALESCE(cs.cs->'removed', '[]'::jsonb)) AS removed,
        jsonb_array_length(COALESCE(cs.cs->'held', '[]'::jsonb)) AS held,
        (SELECT count(*) FROM jsonb_array_elements(COALESCE(cs.cs->'added', '[]'::jsonb)) e
          WHERE e->>'key' LIKE 'meeting:%') AS meetings_added,
        (SELECT jsonb_agg(x) FROM (
           SELECT jsonb_build_object('title', e->'after'->>'title', 'startsAt', e->'after'->>'startsAt') AS x
             FROM jsonb_array_elements(COALESCE(cs.cs->'added', '[]'::jsonb)) e
            WHERE e->>'key' LIKE 'meeting:%'
            ORDER BY e->'after'->>'startsAt'
            LIMIT 3) s) AS named,
        (SELECT count(*) FROM jsonb_array_elements(COALESCE(cs.cs->'changed', '[]'::jsonb)) e
          WHERE e->>'key' LIKE 'meeting:%') AS meetings_changed,
        (SELECT jsonb_agg(x) FROM (
           SELECT jsonb_build_object('title', e->'after'->>'title', 'startsAt', e->'after'->>'startsAt') AS x
             FROM jsonb_array_elements(COALESCE(cs.cs->'changed', '[]'::jsonb)) e
            WHERE e->>'key' LIKE 'meeting:%'
            ORDER BY e->'after'->>'startsAt'
            LIMIT 3) s) AS changed_named,
        (SELECT min(ev.at) FROM civic_data_candidate_events ev
          WHERE ev.candidate_id = l.id AND ev.detail LIKE 'Atomic pointer %') AS promoted_at,
        (SELECT min(ev.at) FROM civic_data_candidate_events ev
          WHERE ev.candidate_id = l.id AND ev.detail LIKE 'Every applicable GOOD check passed%') AS validated_at,
        (SELECT jsonb_agg(jsonb_build_object('at', ev.at, 'detail', ev.detail)) FROM civic_data_candidate_events ev
          WHERE ev.candidate_id = l.id AND ev.detail LIKE $1) AS readbacks
   FROM latest l
   JOIN civic_data_candidates c ON c.id = l.id
   CROSS JOIN LATERAL (SELECT c.candidate->'changeSet' AS cs OFFSET 0) cs`;

/* ------------------------------------------------------------------ the rows */

type Rows = Record<string, unknown>[];

function versionsOf(rows: Rows): BodyVersionRow[] {
  return rows.map((r) => ({
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
  }));
}

function attemptsOf(rows: Rows): BodyAttemptRow[] {
  return rows.map((r) => ({
    scope: String(r.scope),
    candidateId: String(r.candidate_id),
    state: String(r.state),
    failureCode: textOrNull(r.failure_code),
    failureDetail: textOrNull(r.failure_detail),
    acquisitionSucceeded: r.acquisition_succeeded === true,
    attemptedAt: iso(r.attempted_at),
  }));
}

/*
 * A readback event that does not parse as the V2 receipt proves nothing about
 * the version, so it is dropped rather than read as a pass. A version that is
 * both current and the latest change is counted once.
 */
function readbacksOf(rows: readonly { readonly candidateId: string; readonly at: unknown; readonly detail: unknown }[]): BodyReadbackRow[] {
  const seen = new Set<string>();
  return rows.flatMap((r) => {
    const at = iso(r.at);
    const key = `${r.candidateId}|${at}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const receipt = parseReaderProjectionReadback(String(r.detail ?? ""));
    return receipt === null ? [] : [{ candidateId: r.candidateId, at, passed: receipt.status === "PASS" }];
  });
}

function versionReadbacksOf(rows: Rows): { readonly candidateId: string; readonly at: unknown; readonly detail: unknown }[] {
  return rows.map((r) => ({ candidateId: String(r.candidate_id), at: r.at, detail: r.detail }));
}

function dayOf(rows: Rows): BodyDayRow[] {
  return rows.map((r) => ({
    scope: String(r.scope),
    reads: int(r.reads),
    gotIn: int(r.got_in),
    versions: int(r.versions),
    changedVersions: int(r.changed_versions),
    cannotTell: int(r.cannot_tell),
    added: int(r.added),
    changed: int(r.changed),
    removed: int(r.removed),
  }));
}

function changesOf(rows: Rows): BodyChangeRow[] {
  return rows.map((r) => ({
    scope: String(r.scope),
    versionId: String(r.id),
    retrievedAt: iso(r.retrieved_at),
    promotedAt: isoOrNull(r.promoted_at),
    validatedAt: isoOrNull(r.validated_at),
    added: int(r.added),
    changed: int(r.changed),
    removed: int(r.removed),
    held: int(r.held),
    meetingsAdded: int(r.meetings_added),
    named: meetingsOf(r.named),
    meetingsChanged: int(r.meetings_changed),
    changedNamed: meetingsOf(r.changed_named),
  }));
}

/* ------------------------------------------------------------------ the reads */

export async function readBodyStore(connection: string, nowIso: string): Promise<BodyStoreRead> {
  const sql = neon(connection);
  const limit = `SET LOCAL statement_timeout = ${BODY_STORE_STATEMENT_TIMEOUT_MS}`;
  const readbackLike = `${READER_PROJECTION_READBACK_PREFIX}%`;

  /* The figures that must agree: one snapshot. */
  const snapshot = sql.transaction(
    [sql.query(limit), sql.query(VERSIONS, [nowIso]), sql.query(ATTEMPTS, [nowIso]), sql.query(VERSION_READBACKS, [readbackLike]), sql.query(DAY, [nowIso])],
    { readOnly: true, isolationLevel: "RepeatableRead" },
  );

  /*
   * The latest changing version of each source serving readers, found by
   * walking that source's versions newest first and stopping at the first
   * change. It runs beside the snapshot: if it does not answer, the bodies
   * still render, and each trail says its change history was not read rather
   * than borrowing one. Its own readbacks come with it.
   */
  const history = sql
    .transaction([sql.query(limit), sql.query(CHANGES, [readbackLike])], { readOnly: true })
    .then((results) => results[1] as unknown as Rows)
    .catch((error: unknown) => {
      console.error(
        "[admin] body change history not read",
        error instanceof Error ? `${error.name}: ${error.message.replace(/postgres(ql)?:\/\/\S+/gi, "<connection>")}` : error,
      );
      return null;
    });

  const [results, changeRows] = await Promise.all([snapshot, history]);
  const [, versionRows, attemptRows, versionReadbackRows, dayRows] = results as unknown as Rows[];
  return {
    asOf: nowIso,
    versions: versionsOf(versionRows),
    attempts: attemptsOf(attemptRows),
    readbacks: readbacksOf([
      ...versionReadbacksOf(versionReadbackRows),
      ...(changeRows ?? []).flatMap((r) =>
        (Array.isArray(r.readbacks) ? (r.readbacks as Record<string, unknown>[]) : []).map((e) => ({ candidateId: String(r.id), at: e.at, detail: e.detail })),
      ),
    ]),
    day: dayOf(dayRows),
    changes: changeRows === null ? null : changesOf(changeRows),
  };
}

/**
 * Only what a body's standing is decided from: its current version, its last
 * reads and the readback of the version it serves (WORKING, NEEDS ATTENTION,
 * STUCK or NOT READ YET, and how many records readers can see). One snapshot,
 * one round trip, the same statements as `readBodyStore`. It carries no day
 * tally and no change history, and says so (`changes: null`); a view built
 * from it has the same standing as one built from the whole read. The
 * composer's preview reads this, on its first pick (Sean, 2026-09-24: a load
 * over three seconds is not a win).
 */
export async function readBodyStanding(connection: string, nowIso: string): Promise<BodyStoreRead> {
  const sql = neon(connection);
  const results = await sql.transaction(
    [
      sql.query(`SET LOCAL statement_timeout = ${BODY_STORE_STATEMENT_TIMEOUT_MS}`),
      sql.query(VERSIONS, [nowIso]),
      sql.query(ATTEMPTS, [nowIso]),
      sql.query(VERSION_READBACKS, [`${READER_PROJECTION_READBACK_PREFIX}%`]),
    ],
    { readOnly: true, isolationLevel: "RepeatableRead" },
  );
  const [, versionRows, attemptRows, versionReadbackRows] = results as unknown as Rows[];
  return {
    asOf: nowIso,
    versions: versionsOf(versionRows),
    attempts: attemptsOf(attemptRows),
    readbacks: readbacksOf(versionReadbacksOf(versionReadbackRows)),
    day: [],
    changes: null,
  };
}
