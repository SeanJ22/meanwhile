import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import { MODELS, canonicalModelId, modelTierFor, type ModelTier } from "../../models.ts";
import { stateCodeOf } from "../unit-state.ts";
import { US_STATES } from "../readiness/catalog.ts";

export const ADMIN_V6_AGENTS_CONTRACT = "admin-v6/agents@1" as const;
export const AGENT_RUN_LIMIT = 40;
/** The runner kills a child at 15 minutes; an attempt open longer than this is not running. */
const RUNNING_WINDOW_MS = 16 * 60_000;

export const ROLE_WORDS: Readonly<Record<string, string>> = {
  SCOUT: "Scout", PARSER: "Parser", VALIDATOR: "Validator", ADVERSARIAL_AUDITOR: "Auditor", DETECTIVE: "Detective",
  ACQUIRER: "Plain-code reader", DISCOVERY_SEARCH: "Search",
};
const SCOUT_OUTCOME_WORDS: Readonly<Record<string, string>> = {
  EVIDENCE_FOUND: "Found the record.", ROUTE_CANDIDATE: "Found a way in that still has to be confirmed.",
  NEEDS_ADAPTER: "Found where it lives, but we need a reader for that kind of source.", HUMAN_REQUIRED: "Only a person can take it from here.",
  NO_PROGRESS: "Found nothing new.", BLOCKED: "Hit a wall at every step.",
};

export interface AgentRunRaw {
  readonly id: string; readonly role: string; readonly version: string | null; readonly startedAt: string | null; readonly endedAt: string | null;
  readonly outcome: string | null; readonly workItemId: string | null; readonly project: string | null; readonly attemptUsd: number | null;
  readonly artifactCount: number;
}
export interface AgentCostRaw {
  readonly attemptId: string; readonly usd: number | null; readonly jurisdiction: string | null; readonly obligationId: string | null;
  readonly byModel: readonly { readonly model?: unknown; readonly usd?: unknown }[] | null;
}
export interface AgentArtifactRaw {
  readonly attemptId: string; readonly artifactId: string; readonly workItemId: string; readonly url: string | null; readonly byteLength: number;
  readonly tier: string; readonly partial: boolean; readonly count: number;
}
export interface AgentResultRaw { readonly attemptId: string; readonly kind: "scout" | "worker"; readonly verdict: string | null; readonly narrative: string | null; readonly records: number | null }

/** Structurally `AgentRun` in app/(admin)/_mw/admin-v6/model.ts. */
export interface AdminV6AgentRun {
  readonly id: string;
  readonly role: string;
  readonly state: "running" | "done" | "stopped" | "did-not-finish";
  readonly stateWords: string;
  readonly title: string;
  readonly placeKey: string;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly model: { readonly tier: ModelTier | "plain-code" | "older"; readonly name: string };
  /** Dollars for this run, or null when the ledger has no price for it. */
  readonly costUsd: number | null;
  readonly costWords: string;
  readonly found: string;
  readonly source: { readonly url: string | null; readonly savedPages: number; readonly copy: { readonly path: string; readonly byteLength: number } | null } | null;
}

const stateName = (code: string | null) => (code ? US_STATES.find((s) => s.code === code)?.name ?? null : null);

function modelOf(run: AgentRunRaw, cost: AgentCostRaw | undefined): AdminV6AgentRun["model"] {
  if (run.role === "ACQUIRER") return { tier: "plain-code", name: "Plain code" };
  const shares = (cost?.byModel ?? []).filter((s) => typeof s.model === "string");
  // The model that took the most of the charge is the one named; a run that moved up a tier says so in its cost words.
  const top = [...shares].sort((a, b) => (Number(b.usd) || 0) - (Number(a.usd) || 0))[0];
  const id = typeof top?.model === "string" ? top.model : run.version;
  if (typeof id !== "string" || !/claude/i.test(id)) return { tier: "plain-code", name: "—" };
  const tier = modelTierFor(canonicalModelId(id));
  return tier ? { tier, name: MODELS[tier].name } : { tier: "older", name: id };
}

function humanSubject(jurisdiction: string | null, obligationId: string | null): string {
  const raw = jurisdiction ?? obligationId ?? "";
  const parts = raw.split(":");
  const slug = (parts.length > 2 ? parts.slice(2).join(" ") : parts[parts.length - 1] ?? raw).replace(/[#].*$/, "");
  const name = slug.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());
  const kind = parts.length > 2 ? ` (${parts[1]})` : "";
  const what = /#([a-z0-9-]+)/.exec(obligationId ?? "")?.[1]?.replace(/-/g, " ");
  return `${name || "unnamed work"}${kind}${what ? ` — ${what}` : ""}`;
}

const usdWords = (n: number | null) => (n === null ? "—" : n === 0 ? "$0.00" : n < 0.01 ? "under $0.01" : `$${n.toFixed(2)}`);

export function agentRuns(input: {
  readonly runs: readonly AgentRunRaw[]; readonly costs: readonly AgentCostRaw[]; readonly artifacts: readonly AgentArtifactRaw[];
  readonly results: readonly AgentResultRaw[]; readonly nowIso: string;
}): readonly AdminV6AgentRun[] {
  const now = Date.parse(input.nowIso);
  const costBy = new Map(input.costs.map((c) => [c.attemptId, c]));
  const artifactBy = new Map(input.artifacts.map((a) => [a.attemptId, a]));
  const resultBy = new Map(input.results.map((r) => [r.attemptId, r]));
  return input.runs.map((run): AdminV6AgentRun => {
    const cost = costBy.get(run.id);
    const started = run.startedAt === null ? NaN : Date.parse(run.startedAt);
    const open = run.endedAt === null;
    const state = open ? (Number.isFinite(started) && now - started <= RUNNING_WINDOW_MS ? "running" : "did-not-finish")
      : run.outcome === "COMPLETED" ? "done" : "stopped";
    const usd = cost?.usd ?? (run.role === "ACQUIRER" ? 0 : run.attemptUsd);
    const model = modelOf(run, cost);
    const shares = (cost?.byModel ?? []).length;
    const result = resultBy.get(run.id);
    const art = artifactBy.get(run.id);
    const found = result?.kind === "scout" && result.verdict
      ? `${SCOUT_OUTCOME_WORDS[result.verdict] ?? `Ended: ${result.verdict.toLowerCase().replace(/_/g, " ")}.`}${result.narrative ? ` ${result.narrative}` : ""}`
      : result?.kind === "worker" ? `${run.role === "PARSER" ? `Pulled out ${result.records ?? 0} record${result.records === 1 ? "" : "s"}.` : `Verdict: ${(result.verdict ?? "none recorded").toLowerCase().replace(/_/g, " ")}.`}`
      : state === "running" ? "Still working."
      : run.role === "ACQUIRER" ? `${run.outcome === "COMPLETED" ? "Finished" : "Stopped"}; kept ${run.artifactCount} saved page${run.artifactCount === 1 ? "" : "s"}.`
      : "—";
    const eligible = art !== undefined && art.tier === "RAW" && !art.partial && art.byteLength > 0 && art.byteLength <= 32 * 1024 * 1024 && run.project === "freshness" &&
      [art.workItemId, art.attemptId, art.artifactId].every((id) => /^[a-z][a-z0-9-]{1,120}$/.test(id)) && art.artifactId.startsWith("ar-");
    const code = stateCodeOf(cost?.jurisdiction ?? cost?.obligationId ?? "", "");
    const placeKey = code && stateName(code) ? `st:${code}` : "us";
    const role = ROLE_WORDS[run.role] ?? run.role.toLowerCase().replace(/_/g, " ");
    return {
      id: run.id, role, state,
      stateWords: state === "running" ? "Working now" : state === "done" ? "Finished" : state === "did-not-finish" ? "Did not finish" : `Stopped${run.outcome ? `: ${run.outcome.toLowerCase().replace(/_/g, " ")}` : ""}`,
      title: `${role} · ${humanSubject(cost?.jurisdiction ?? null, cost?.obligationId ?? null)}`,
      placeKey, startedAt: run.startedAt, endedAt: run.endedAt, model,
      costUsd: usd, costWords: `${usdWords(usd)}${shares > 1 ? " · moved up a model partway" : ""}`,
      found,
      source: art ? { url: art.url && /^https:\/\//.test(art.url) ? art.url : null, savedPages: art.count,
        copy: eligible ? { path: `/api/admin/evidence/${art.workItemId}/${art.attemptId}/${art.artifactId}`, byteLength: art.byteLength } : null } : null,
    };
  });
}

export async function readAgentRuns(sql: Sql, nowIso: string): Promise<readonly AdminV6AgentRun[]> {
  const POINT = { callClass: "PAGE" } as const;
  const runsRaw = await boundedQuery(sql, { operation: "cp_attempts.agent_runs", ...POINT },
    `SELECT a.value->>'id' AS id, a.value->'worker'->>'role' AS role, a.value->'worker'->>'version' AS version,
       a.value->>'startedAt' AS started_at, a.value->>'endedAt' AS ended_at, a.value->>'outcome' AS outcome,
       a.value->>'workItemId' AS work_item_id, w.value->>'project' AS project, (a.value->'cost'->>'usd')::float8 AS attempt_usd,
       jsonb_array_length(COALESCE(a.value->'artifactIds', '[]'::jsonb)) AS artifact_count
     FROM (SELECT value, updated_at FROM cp_attempts ORDER BY updated_at DESC LIMIT ${AGENT_RUN_LIMIT}) a
     LEFT JOIN cp_work_items w ON w.id = a.value->>'workItemId' ORDER BY a.updated_at DESC`, []) as readonly Record<string, unknown>[];
  const ids = runsRaw.map((r) => String(r.id));
  if (ids.length === 0) return [];
  const [costsRaw, artifactsRaw, scoutsRaw, workersRaw] = await Promise.all([
    boundedQuery(sql, { operation: "cp_log_costs.agent_runs", ...POINT },
      `SELECT record->>'attemptId' AS attempt_id, (record->'cost'->>'usd')::float8 AS usd, record->>'jurisdiction' AS jurisdiction,
         record->>'obligationId' AS obligation_id, record->'byModel' AS by_model
       FROM cp_log_costs WHERE record->>'attemptId' = ANY($1::text[])`, [ids]),
    boundedQuery(sql, { operation: "cp_log_artifacts.agent_runs", ...POINT },
      `SELECT DISTINCT ON (record->>'attemptId') record->>'attemptId' AS attempt_id, record->>'artifactId' AS artifact_id,
         record->>'workItemId' AS work_item_id, record->>'canonicalUrl' AS url, (record->>'byteLength')::int AS byte_length,
         record->>'tier' AS tier, (record->>'partial')::boolean AS partial,
         count(*) OVER (PARTITION BY record->>'attemptId') AS n
       FROM cp_log_artifacts WHERE record->>'attemptId' = ANY($1::text[]) ORDER BY record->>'attemptId', position`, [ids]),
    boundedQuery(sql, { operation: "cp_log_scout_results.agent_runs", ...POINT },
      `SELECT record->>'attemptId' AS attempt_id, record->>'outcome' AS outcome, left(record->>'narrative', 280) AS narrative
       FROM cp_log_scout_results WHERE record->>'attemptId' = ANY($1::text[])`, [ids]),
    boundedQuery(sql, { operation: "cp_log_worker_results.agent_runs", ...POINT },
      `SELECT record->>'attemptId' AS attempt_id, record->'result'->>'verdict' AS verdict,
         CASE WHEN jsonb_typeof(record->'result'->'records') = 'array' THEN jsonb_array_length(record->'result'->'records') END AS records
       FROM cp_log_worker_results WHERE record->>'attemptId' = ANY($1::text[])`, [ids]),
  ]) as readonly (readonly Record<string, unknown>[])[];
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  const n = (v: unknown) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
  return agentRuns({
    nowIso,
    runs: runsRaw.map((r) => ({ id: String(r.id), role: s(r.role) ?? "UNKNOWN", version: s(r.version), startedAt: s(r.started_at), endedAt: s(r.ended_at), outcome: s(r.outcome),
      workItemId: s(r.work_item_id), project: s(r.project), attemptUsd: n(r.attempt_usd), artifactCount: n(r.artifact_count) ?? 0 })),
    costs: costsRaw.map((r) => ({ attemptId: String(r.attempt_id), usd: n(r.usd), jurisdiction: s(r.jurisdiction), obligationId: s(r.obligation_id),
      byModel: Array.isArray(r.by_model) ? r.by_model as AgentCostRaw["byModel"] : null })),
    artifacts: artifactsRaw.map((r) => ({ attemptId: String(r.attempt_id), artifactId: String(r.artifact_id), workItemId: String(r.work_item_id), url: s(r.url),
      byteLength: n(r.byte_length) ?? 0, tier: s(r.tier) ?? "", partial: r.partial === true, count: n(r.n) ?? 1 })),
    results: [
      ...scoutsRaw.map((r): AgentResultRaw => ({ attemptId: String(r.attempt_id), kind: "scout", verdict: s(r.outcome), narrative: s(r.narrative), records: null })),
      ...workersRaw.map((r): AgentResultRaw => ({ attemptId: String(r.attempt_id), kind: "worker", verdict: s(r.verdict), narrative: null, records: n(r.records) })),
    ],
  });
}
