import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import { CHECKLIST_PROFILE } from "../readiness/checklist-score.ts";
import { US_STATES } from "../readiness/catalog.ts";
import { PUBLIC_SITE_ORIGIN } from "../../ops/origins.ts";
import { groupOf, type OwedRowLike } from "./place-scorecard.ts";
import { GROUP_NAMES, PLACE_GROUPS } from "./v6-checklist-section.ts";
import type { V6PlaceScope } from "./v6-hunts-read.ts";

/** A stage nothing records is `unreported`, never a guess; one behind an unmet stage is `waiting`; one known not to have happened is `not-yet`. */
export const ADMIN_V6_RESULTS_CONTRACT = "admin-v6/results@1" as const;
export const RESULTS_WITNESS_MAX_AGE_HOURS = 3;

export const RESULT_STAGE_NAMES = ["Found", "Saved", "Facts pulled out", "Facts checked against sources", "Published", "Checked on the public page"] as const;

/** Structurally `StageMark` in app/(admin)/_mw/admin-v6/model.ts, plus `unreported` for a stage nothing records. */
export type ResultMark = "done" | "not-yet" | "wrong" | "partial" | "reported" | "waiting" | "unreported";

/** Structurally `TrailStage` in model.ts. */
export interface AdminV6ResultStage {
  readonly name: string;
  readonly mark: ResultMark;
  readonly when: string;
  readonly what: string;
  readonly publicLink?: { readonly url: string; readonly label: string; readonly seenAt: string | null };
  readonly technical?: readonly string[];
}
/** Structurally `ReaderResult` in model.ts. `kind` is null: nothing here records whether a result is new, reused or updated. */
export interface AdminV6Result {
  readonly id: string;
  readonly title: string;
  readonly applies: readonly string[];
  readonly kind: null;
  readonly stages: readonly ResultMark[];
  readonly readerSees: string;
  readonly problem: boolean;
  readonly trail: readonly AdminV6ResultStage[];
}

const NONE = "—";
const STATE_CODES: ReadonlySet<string> = new Set(US_STATES.map((s) => s.code.toLowerCase()));

export const PIPELINE_STAGE_ORDER = ["SCOUTED", "VERIFIED", "APPROVED_FOR_PROMOTION"] as const;
export type PipelineStageName = (typeof PIPELINE_STAGE_ORDER)[number];

const SNAPSHOT_ARRAY = (path: string) => `CASE WHEN jsonb_typeof(${path}) = 'array' THEN ${path} ELSE '[]'::jsonb END`;
const PENDING = "s.value->'deliveryTrail'->'pending'";
const PROMOTIONS = "s.value->'deliveryTrail'->'promotions'";
const WITNESSES = "s.value->'servedReaderReadback'->'witnesses'";

export const PIPELINE_HEAD_SQL = `SELECT s.updated_at AS published_at, s.revision AS revision,
  jsonb_typeof(${PENDING}) AS pending_kind, jsonb_typeof(${PROMOTIONS}) AS promotions_kind,
  jsonb_typeof(s.value->'servedReaderReadback') AS readback_kind
  FROM cp_owner_snapshots s WHERE s.id = 'current'`;
export const PIPELINE_PENDING_SQL = `SELECT x->>'recordClass' AS record_class, x->>'stage' AS stage,
  split_part(coalesce(x->>'subjectId', ''), ':', 1) AS prefix, count(*)::int AS n
  FROM cp_owner_snapshots s, jsonb_array_elements(${SNAPSHOT_ARRAY(PENDING)}) AS x
  WHERE s.id = 'current' AND x->>'recordClass' IS NOT NULL GROUP BY 1, 2, 3`;
export const PIPELINE_APPROVED_SQL = `SELECT p->>'recordClass' AS record_class, split_part(coalesce(p->>'subjectId', ''), ':', 1) AS prefix,
  CASE WHEN w.state IS NULL THEN 'NONE'
    WHEN w.state = 'CONFIRMED' AND w.checked_at >= $1::timestamptz - interval '${RESULTS_WITNESS_MAX_AGE_HOURS} hours' THEN 'CONFIRMED_FRESH'
    WHEN w.state = 'CONFIRMED' THEN 'CONFIRMED_STALE' ELSE 'NOT_OBSERVED' END AS witness,
  count(*)::int AS n, max(p->>'approvedAt') AS approved_at, max(w.checked_at) AS checked_at, max(w.url) AS url
  FROM cp_owner_snapshots s
  CROSS JOIN LATERAL jsonb_array_elements(${SNAPSHOT_ARRAY(PROMOTIONS)}) AS p
  LEFT JOIN LATERAL (SELECT e->>'state' AS state, (e->>'checkedAt')::timestamptz AS checked_at, e->>'url' AS url
    FROM jsonb_array_elements(${SNAPSHOT_ARRAY(WITNESSES)}) AS e
    WHERE e->>'approvalId' = p->>'version' ORDER BY (e->>'checkedAt')::timestamptz DESC LIMIT 1) AS w ON true
  WHERE s.id = 'current' AND p->>'recordClass' IS NOT NULL GROUP BY 1, 2, 3`;

export interface PipelineGroupRow { readonly recordClass: string; readonly stage: PipelineStageName; readonly prefix: string; readonly n: number }
export type ApprovalWitness = "NONE" | "CONFIRMED_FRESH" | "CONFIRMED_STALE" | "NOT_OBSERVED";
export interface ApprovedGroupRow {
  readonly recordClass: string; readonly prefix: string; readonly witness: ApprovalWitness; readonly n: number;
  readonly approvedAt: string | null; readonly checkedAt: string | null; readonly url: string | null;
}
export interface PipelineRead {
  readonly state: "READ";
  readonly publishedAt: string | null;
  readonly revision: string | null;
  readonly pending: readonly PipelineGroupRow[];
  readonly approved: readonly ApprovedGroupRow[];
}
export interface PipelineUnread { readonly state: "UNREAD"; readonly says: string }

const isoOf = (v: unknown): string | null => {
  const d = v instanceof Date ? v : typeof v === "string" ? new Date(v) : null;
  return d !== null && Number.isFinite(d.getTime()) ? d.toISOString() : null;
};
const count = (v: unknown): number => {
  const n = typeof v === "number" || typeof v === "string" ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};

/** Three small grouped reads of the published snapshot. A snapshot without the pipeline lists is unread, never zero. */
export async function readPipeline(sql: Sql, nowIso: string): Promise<PipelineRead | PipelineUnread> {
  const head = await boundedQuery(sql, { operation: "cp_owner_snapshots.results_head", callClass: "POINT" }, PIPELINE_HEAD_SQL, []) as readonly Record<string, unknown>[];
  const h = head[0];
  if (h === undefined) return { state: "UNREAD", says: "No owner snapshot has been published." };
  if (h.pending_kind !== "array" || h.promotions_kind !== "array") return { state: "UNREAD", says: "The published snapshot does not list its promotion pipeline items." };
  const [pending, approved] = await Promise.all([
    boundedQuery(sql, { operation: "cp_owner_snapshots.results_pending", callClass: "DOCUMENT" }, PIPELINE_PENDING_SQL, []),
    boundedQuery(sql, { operation: "cp_owner_snapshots.results_approved", callClass: "DOCUMENT" }, PIPELINE_APPROVED_SQL, [nowIso]),
  ]) as [readonly Record<string, unknown>[], readonly Record<string, unknown>[]];
  const stages: readonly string[] = PIPELINE_STAGE_ORDER;
  return {
    state: "READ", publishedAt: isoOf(h.published_at), revision: h.revision === null || h.revision === undefined ? null : String(h.revision),
    pending: pending.flatMap((r) => typeof r.record_class === "string" && typeof r.stage === "string" && stages.includes(r.stage) && count(r.n) > 0
      ? [{ recordClass: r.record_class, stage: r.stage as PipelineStageName, prefix: typeof r.prefix === "string" ? r.prefix : "", n: count(r.n) }] : []),
    approved: approved.flatMap((r) => typeof r.record_class === "string" && count(r.n) > 0
      ? [{ recordClass: r.record_class, prefix: typeof r.prefix === "string" ? r.prefix : "",
        witness: (["CONFIRMED_FRESH", "CONFIRMED_STALE", "NOT_OBSERVED"] as const).find((w) => w === r.witness) ?? "NONE",
        n: count(r.n), approvedAt: isoOf(r.approved_at), checkedAt: isoOf(r.checked_at), url: typeof r.url === "string" ? r.url : null }] : []),
  };
}

export function stateOfSubjectPrefix(prefix: string): string | null {
  const p = prefix.toLowerCase();
  if (STATE_CODES.has(p)) return p;
  const ballot = /^ballot-([a-z]{2})-/.exec(p);
  return ballot !== null && STATE_CODES.has(ballot[1]) ? ballot[1] : null;
}

export function recordClassTitle(recordClass: string): string {
  const words = recordClass.replace(/[-_]+/g, " ").trim().toLowerCase();
  return words === "" ? recordClass : words[0].toUpperCase() + words.slice(1);
}

function share(k: number, n: number, none: ResultMark): ResultMark {
  return n > 0 && k >= n ? "done" : k > 0 ? "partial" : none;
}
const num = (k: number) => k.toLocaleString("en-US");
const of = (k: number, n: number) => `${num(k)} of ${num(n)}`;

interface ClassTally {
  n: number; atScouted: number; atVerified: number; approved: number;
  fresh: number; stale: number; notObserved: number; unread: number;
  approvedAt: string | null; checkedAt: string | null; url: string | null;
}
const emptyTally = (): ClassTally => ({ n: 0, atScouted: 0, atVerified: 0, approved: 0, fresh: 0, stale: 0, notObserved: 0, unread: 0, approvedAt: null, checkedAt: null, url: null });
const later = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a >= b ? a : b);

export function pipelineResults(read: PipelineRead, scopeKey: string, scope: V6PlaceScope): readonly AdminV6Result[] {
  const inScope = (prefix: string) => scope.kind === "country" || (scope.kind === "state" && stateOfSubjectPrefix(prefix) === scope.state);
  const by = new Map<string, ClassTally>();
  const tally = (rc: string) => { const t = by.get(rc) ?? emptyTally(); by.set(rc, t); return t; };
  for (const r of read.pending) {
    if (!inScope(r.prefix)) continue;
    const t = tally(r.recordClass);
    t.n += r.n;
    if (r.stage === "SCOUTED") t.atScouted += r.n;
    else if (r.stage === "VERIFIED") t.atVerified += r.n;
    else t.approved += r.n;
  }
  for (const r of read.approved) {
    if (!inScope(r.prefix)) continue;
    const t = tally(r.recordClass);
    t.n += r.n;
    t.approved += r.n;
    if (r.witness === "CONFIRMED_FRESH") t.fresh += r.n;
    else if (r.witness === "CONFIRMED_STALE") t.stale += r.n;
    else if (r.witness === "NOT_OBSERVED") t.notObserved += r.n;
    else t.unread += r.n;
    t.approvedAt = later(t.approvedAt, r.approvedAt);
    t.checkedAt = later(t.checkedAt, r.checkedAt);
    t.url = t.url === null && r.witness === "CONFIRMED_FRESH" ? r.url : t.url;
  }
  const out = [...by.entries()].map(([rc, t]): AdminV6Result => {
    const checked = t.atVerified + t.approved;
    const seen = t.fresh;
    const stage6: ResultMark = t.approved === 0 ? "waiting" : seen >= t.approved ? "done" : seen > 0 ? "partial" : t.notObserved > 0 ? "wrong" : "reported";
    const stages: readonly ResultMark[] = [
      "done",
      share(checked, t.n, "unreported"),
      share(checked, t.n, "unreported"),
      share(checked, t.n, "not-yet"),
      share(t.approved, t.n, "not-yet"),
      stage6,
    ];
    const url = t.url !== null && t.url.startsWith(`${PUBLIC_SITE_ORIGIN}/`) ? t.url : null;
    const trail: readonly AdminV6ResultStage[] = [
      { name: RESULT_STAGE_NAMES[0], mark: stages[0], when: NONE, what: `${num(t.n)} items` },
      { name: RESULT_STAGE_NAMES[1], mark: stages[1], when: NONE, what: checked > 0 ? `${of(checked, t.n)} with a saved copy` : NONE },
      { name: RESULT_STAGE_NAMES[2], mark: stages[2], when: NONE, what: checked > 0 ? `${of(checked, t.n)}` : NONE },
      { name: RESULT_STAGE_NAMES[3], mark: stages[3], when: NONE, what: of(checked, t.n) },
      { name: RESULT_STAGE_NAMES[4], mark: stages[4], when: t.approvedAt ?? NONE, what: of(t.approved, t.n) },
      { name: RESULT_STAGE_NAMES[5], mark: stages[5], when: t.checkedAt ?? NONE,
        what: t.approved === 0 ? NONE : `${of(seen, t.approved)} seen on the page${t.notObserved > 0 ? ` · ${num(t.notObserved)} not found there` : ""}${t.stale > 0 ? ` · ${num(t.stale)} last seen over ${RESULTS_WITNESS_MAX_AGE_HOURS} hours ago` : ""}`,
        ...(url === null ? {} : { publicLink: { url, label: "The public page", seenAt: t.checkedAt } }) },
    ];
    return {
      id: `results:${scopeKey}:${rc}`, title: recordClassTitle(rc), applies: [scopeKey], kind: null, stages,
      readerSees: t.approved === 0 ? `${of(0, t.n)} published` : `${of(t.approved, t.n)} published · ${of(seen, t.approved)} checked on the page`,
      problem: stages.includes("wrong"), trail: trail.map((s) => ({ ...s, technical: [`record class ${rc}`] })),
    };
  });
  return out.sort((a, b) => readerRank(b) - readerRank(a) || stageRank(b) - stageRank(a) || a.title.localeCompare(b.title));
}

const markRank = (m: ResultMark) => (m === "done" ? 2 : m === "partial" || m === "reported" ? 1 : 0);
function readerRank(r: AdminV6Result): number {
  return markRank(r.stages[4]) * 10 + markRank(r.stages[5]);
}
function stageRank(r: AdminV6Result): number {
  return r.stages.reduce((sum, m) => sum + markRank(m), 0);
}

export const ZIP_WITNESS_SQL = `SELECT DISTINCT ON (e->>'readerKey') e->>'readerKey' AS reader_key, e->>'state' AS state,
  (e->>'checkedAt')::timestamptz AS checked_at, e->>'url' AS url
  FROM cp_owner_snapshots s, jsonb_array_elements(${SNAPSHOT_ARRAY(WITNESSES)}) AS e
  WHERE s.id = 'current' AND e->>'url' = $1 AND e->>'readerKey' IS NOT NULL
  ORDER BY e->>'readerKey', (e->>'checkedAt')::timestamptz DESC`;

export interface ZipWitnessRow { readonly readerKey: string; readonly state: "CONFIRMED" | "NOT_OBSERVED"; readonly checkedAt: string; readonly url: string }
export function zipBallotUrl(zip: string): string { return `${PUBLIC_SITE_ORIGIN}/ballot?zip=${zip}`; }

export async function readZipWitnesses(sql: Sql, zip: string): Promise<readonly ZipWitnessRow[]> {
  if (!/^\d{5}$/.test(zip)) return [];
  const rows = await boundedQuery(sql, { operation: "cp_owner_snapshots.results_zip_witnesses", callClass: "DOCUMENT" }, ZIP_WITNESS_SQL, [zipBallotUrl(zip)]) as readonly Record<string, unknown>[];
  return rows.flatMap((r) => {
    const at = isoOf(r.checked_at);
    return typeof r.reader_key === "string" && (r.state === "CONFIRMED" || r.state === "NOT_OBSERVED") && at !== null && typeof r.url === "string"
      ? [{ readerKey: r.reader_key, state: r.state, checkedAt: at, url: r.url }] : [];
  });
}

export interface OwedResultRow extends OwedRowLike {
  readonly held: readonly { readonly sourceUrl: string; readonly checkedAt: string; readonly state: string; readonly value?: unknown }[];
}

const GROUP_ORDER: readonly string[] = [...new Set(CHECKLIST_PROFILE.definitions.map((d) => d.group))].filter((g) => PLACE_GROUPS.has(g));
const BALLOT_GROUPS: ReadonlySet<string> = new Set(["ELE", "CAN"]);

export function owedResults(input: { readonly placeKey: string; readonly rows: readonly OwedResultRow[]; readonly zip: string | null; readonly witnesses: readonly ZipWitnessRow[] | null }): readonly AdminV6Result[] {
  const groups = new Map<string, OwedResultRow[]>();
  for (const row of input.rows) {
    const g = groupOf(row.checklistId);
    if (!PLACE_GROUPS.has(g)) continue;
    groups.set(g, [...(groups.get(g) ?? []), row]);
  }
  const ordered = [...GROUP_ORDER.filter((g) => groups.has(g)), ...[...groups.keys()].filter((g) => !GROUP_ORDER.includes(g)).sort()];
  return ordered.map((g): AdminV6Result => {
    const rows = groups.get(g)!;
    const n = rows.length;
    const state = (s: OwedRowLike["state"]) => rows.filter((r) => r.state === s).length;
    const published = state("published"), held = state("held"), unpublished = state("unpublished"), stale = state("stale"), missing = state("missing");
    const found = rows.filter((r) => r.held.length > 0).length;
    const pulled = rows.filter((r) => r.held.some((h) => h.value !== undefined && h.value !== null)).length;
    const owedPublic = n - unpublished;
    const latestHeld = rows.flatMap((r) => r.held.map((h) => h.checkedAt)).reduce<string | null>((a, b) => later(a, isoOf(b)), null);
    const marks: ResultMark[] = [
      share(found, n, "not-yet"),
      "unreported",
      pulled >= n ? "done" : pulled > 0 ? "partial" : found === 0 ? "waiting" : "not-yet",
      owedPublic === 0 ? "unreported" : share(published, owedPublic, found === 0 ? "waiting" : "not-yet"),
      owedPublic === 0 ? "unreported" : share(published, owedPublic, found === 0 ? "waiting" : "not-yet"),
      "waiting",
    ];
    const ballot = input.zip !== null && BALLOT_GROUPS.has(g);
    const w = ballot && input.witnesses !== null ? input.witnesses : [];
    const seen = w.filter((x) => x.state === "CONFIRMED").length;
    const gone = w.filter((x) => x.state === "NOT_OBSERVED").length;
    const witnessAt = w.reduce<string | null>((a, x) => later(a, x.checkedAt), null);
    marks[5] = ballot && w.length > 0 ? (seen >= w.length ? "done" : seen > 0 ? "partial" : "wrong")
      : published > 0 ? (ballot && input.witnesses === null ? "unreported" : "reported") : owedPublic === 0 ? "unreported" : "waiting";
    const newest = rows.flatMap((r) => r.held).filter((h) => h.state === "published").map((h) => isoOf(h.checkedAt)).reduce<string | null>((a, b) => later(a, b), null);
    const trail: AdminV6ResultStage[] = [
      { name: RESULT_STAGE_NAMES[0], mark: marks[0], when: latestHeld ?? NONE, what: of(found, n) },
      { name: RESULT_STAGE_NAMES[1], mark: marks[1], when: NONE, what: NONE },
      { name: RESULT_STAGE_NAMES[2], mark: marks[2], when: latestHeld ?? NONE, what: of(pulled, n) },
      { name: RESULT_STAGE_NAMES[3], mark: marks[3], when: newest ?? NONE, what: owedPublic === 0 ? NONE : of(published, owedPublic) },
      { name: RESULT_STAGE_NAMES[4], mark: marks[4], when: newest ?? NONE, what: owedPublic === 0 ? NONE : of(published, owedPublic) },
      { name: RESULT_STAGE_NAMES[5], mark: marks[5], when: witnessAt ?? NONE,
        what: w.length > 0 ? `${of(seen, w.length)} seen on the page${gone > 0 ? ` · ${gone} not found there` : ""}` : NONE,
        ...(w.length > 0 ? { publicLink: { url: w[0].url, label: "The public ballot page", seenAt: witnessAt } } : {}) },
    ];
    const parts = [`${of(published, n)} published`, ...(held > 0 ? [`${num(held)} captured, not published`] : []), ...(stale > 0 ? [`${num(stale)} due for refresh`] : []),
      ...(missing > 0 ? [`${num(missing)} not captured`] : []), ...(unpublished > 0 ? [`${num(unpublished)} not published by the government`] : [])];
    return {
      id: `results:${input.placeKey}:${g}`, title: GROUP_NAMES[g] === undefined ? g : GROUP_NAMES[g], applies: [input.placeKey], kind: null,
      stages: marks, readerSees: parts.join(" · "), problem: marks.includes("wrong"),
      trail: trail.map((s) => ({ ...s, technical: [`checklist group ${g}`, `${n} owed rows`] })),
    };
  });
}
