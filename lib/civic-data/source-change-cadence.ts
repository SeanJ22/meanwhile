import type { FieldKind } from "../facts/check.ts";
import { factClocks } from "../facts/clocks.ts";
import type { Clocks, Query } from "../facts/publish.ts";
import type { RoutineSourceTask, RoutineTaskClock } from "./runner.ts";
import type { RoutineRecordClass } from "./types.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The fact kind each source serves owns its retry and freshness bounds. */
const FACT_KIND: Readonly<Record<RoutineRecordClass, FieldKind>> = {
  FEC_FUNDING: "money", STATE_CAMPAIGN_FINANCE: "money", LOCAL_CAMPAIGN_FINANCE: "money",
  STATE_LEGISLATOR: "officeholder", STATE_ROLL_CALL: "vote", STATE_LEGISLATOR_VOTES: "vote",
  STATE_BILL: "law", FEDERAL_ROLL_CALL: "vote", FEDERAL_KEY_VOTE: "vote", FEDERAL_DIRECTORY: "officeholder",
  FEDERAL_CIVIC_RECORD: "officeholder", REGISTRY_RUNTIME_BINDING: "officeholder", VOTING_SITE: "ballot",
  GOOGLE_CIVIC_VOTERINFO: "ballot", PRL_PROFILE: "statement", PRL_ARCHIVE: "statement",
  CENSUS_REFERENCE: "officeholder", CENSUS_GEOGRAPHY: "officeholder", MEETING: "meeting",
  BALLOT_CANDIDACY: "ballot", CANDIDATE_PROFILE: "officeholder", CANDIDATE_PUBLICATION: "statement",
  OFFICEHOLDER_STATEMENT: "statement", STATE_EXECUTIVE_ACTION: "law", MEETING_OUTCOME: "outcome",
  CURATED_READER_RECORD: "officeholder", DOTGOV_REFERENCE: "officeholder", OPERATIONAL_REFERENCE: "officeholder",
  REGISTRATION: "officeholder", FEDERAL_MONEY: "money", CAMPAIGN_FINANCE: "money",
};

export function routineFactKind(task: Pick<RoutineSourceTask, "id" | "sourceId" | "recordClass">): FieldKind {
  if (task.sourceId === "people-portraits") return "portrait";
  if (task.id === "member-offices") return "contact";
  if (task.sourceId === "candidate-campaign-site-chain") return "contact";
  if (task.id.startsWith("ballot-navigation")) return "ballot";
  return FACT_KIND[task.recordClass];
}

export function factRefreshBounds(task: Pick<RoutineSourceTask, "id" | "sourceId" | "recordClass">, clocks: Clocks = factClocks(null)) {
  const kind = routineFactKind(task);
  return { minimumRefreshMs: clocks.retryMinutes(kind) * MINUTE, freshnessWindowMs: clocks.windowHours(kind) * HOUR };
}

/** Election sources retain their installed checks; meeting/outcome obligations keep their pace throughout the year. */
export function timeSensitiveSource(task: Pick<RoutineSourceTask, "id" | "recordClass" | "contract">, nowMs: number): boolean {
  return task.contract.schedule?.kind === "SITTING_WINDOW" || task.recordClass === "MEETING" || task.recordClass === "MEETING_OUTCOME" ||
    nowMs < Date.parse("2026-11-04T12:00:00.000Z") && (
      task.recordClass === "VOTING_SITE" || task.recordClass === "BALLOT_CANDIDACY" || task.recordClass === "GOOGLE_CIVIC_VOTERINFO" ||
      task.id.startsWith("ballot-navigation"));
}

export interface SourceChangeHistory {
  readonly rawHash: string;
  readonly observedFrom: string;
  readonly lastChangedAt: string;
  readonly changes: number;
  readonly meanChangeMs: number | null;
}

/** Include an unchanged observation's elapsed interval without inventing a hash movement. */
export function observedSourceEveryMs(history: SourceChangeHistory | undefined, clock: RoutineTaskClock | undefined): number | undefined {
  if (!history) return undefined;
  const checked = Date.parse(clock?.lastSucceededObservedAt ?? "");
  const unchangedFor = checked - Date.parse(history.lastChangedAt);
  const interval = Math.max(history.meanChangeMs ?? 0, Number.isFinite(unchangedFor) ? unchangedFor : 0);
  return interval > 0 ? interval : undefined;
}

/**
 * One bounded source history per task, aggregated inside Postgres. A promotion is not a source change: only a different
 * raw_hash at the same parser/hash format counts. Source bodies, identity sets and candidate events never leave Neon.
 */
export async function readSourceChangeHistory(query: Query, tasks: readonly Pick<RoutineSourceTask, "id" | "sourceId" | "recordClass" | "scope" | "parserVersion">[]):
  Promise<ReadonlyMap<string, SourceChangeHistory>> {
  if (!tasks.length) return new Map();
  const rows = await query(`WITH tasks AS (
    SELECT id,source_id,record_class,scope,parser_version FROM jsonb_to_recordset($1::jsonb) AS t(id text, source_id text, record_class text, scope text, parser_version text)
  ) SELECT t.id,h.raw_hash,h.observed_from,h.last_changed_at,h.changes,h.mean_change_ms FROM tasks t CROSS JOIN LATERAL (
    WITH recent_candidates AS (
      SELECT c.id,c.raw_hash
      FROM civic_data_candidates c
      WHERE c.source_id=t.source_id AND c.record_class=t.record_class AND c.scope=t.scope
        AND c.parser_version=t.parser_version AND c.state='PROMOTED' AND c.acquisition_succeeded=true
        AND c.raw_hash ~ '^[a-f0-9]{64}$'
        AND NOT (c.candidate ? 'bootstrapImport')
        AND coalesce(c.candidate#>>'{stateRetirement,kind}','') <> 'STATE_AUTHORITY_RETIREMENT'
        AND coalesce(c.candidate#>>'{retrieval,rawHashBasis}','') = coalesce((
          SELECT head.candidate#>>'{retrieval,rawHashBasis}' FROM civic_data_promotions p
          JOIN civic_data_candidates head ON head.id=p.current_version_id
          WHERE p.record_class=t.record_class AND p.scope=t.scope AND p.source_id=t.source_id), '')
      ORDER BY c.retrieved_at DESC,c.id DESC LIMIT 64
    ), recent AS (
      SELECT c.id,c.raw_hash,e.at AS observed_at FROM recent_candidates c
      JOIN civic_data_candidate_events e ON e.candidate_id=c.id AND e.sequence=1
    ), ordered AS (
      SELECT id,raw_hash,observed_at, lag(raw_hash) OVER (ORDER BY observed_at,id) AS previous_hash FROM recent
    ), changes AS (
      SELECT id,raw_hash,observed_at FROM ordered WHERE previous_hash IS NULL OR raw_hash <> previous_hash
    ) SELECT (array_agg(raw_hash ORDER BY observed_at DESC,id DESC))[1] AS raw_hash,
      min(observed_at)::text AS observed_from, max(observed_at)::text AS last_changed_at,
      (count(*)-1)::int AS changes,
      CASE WHEN count(*)>1 THEN extract(epoch FROM max(observed_at)-min(observed_at))*1000/(count(*)-1) END AS mean_change_ms
      FROM changes HAVING count(*)>0
  ) h`, [JSON.stringify(tasks.map(task => ({ id: task.id, source_id: task.sourceId, record_class: task.recordClass,
    scope: task.scope, parser_version: task.parserVersion })))]);
  return new Map(rows.map(row => [String(row.id), {
    rawHash: String(row.raw_hash), observedFrom: new Date(String(row.observed_from)).toISOString(),
    lastChangedAt: new Date(String(row.last_changed_at)).toISOString(), changes: Number(row.changes),
    meanChangeMs: row.mean_change_ms === null ? null : Number(row.mean_change_ms),
  }]));
}
