/**
 * `pnpm scout:readback` — WHAT THE SCOUTS ACTUALLY DID, READ BACK FROM THE STORE.
 * (Lane E, autonomous Scout activation, 2026-09-01.)
 *
 * A separate process that only reads. The claim it supports is that a REAL
 * model ran a REAL civic Scout Attempt, under a persisted identity, with
 * provider-reported usage, a measured cost, at least one controlled research
 * tool, vaulted evidence, a typed outcome, and NO canonical promotion. Every
 * proof condition is answered from the persisted Attempt, cost-ledger and
 * disposition rows — never from the ScoutResult's account of itself alone.
 *
 * ```
 *   node --env-file=.env.local --experimental-strip-types scripts/scout-readback.mts \
 *        [--last=N] [--obligation=<prefix>] [--out=<path>]
 * ```
 *
 * The only write is the optional JSON at `--out`. Env var names only.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  controlPlaneUrlFromEnv,
  createPgRepositories,
  CONTROL_PLANE_URL_VAR,
} from "../lib/control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories, DispositionCommit } from "../lib/control-plane/repository/types.ts";
import type { Attempt } from "../lib/control-plane/attempt.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";
import { SCOUT_OUTCOMES, type ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import { headSha } from "../lib/ops/git-facts.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";

const ROOT = process.cwd();
const NOW = new Date().toISOString();

/* ------------------------------------------------------------------ flags */

const argv = process.argv.slice(2);
const lastArg = argv.find((a) => a.startsWith("--last="));
const LAST = lastArg ? Number(lastArg.slice("--last=".length)) : 25;
if (!Number.isInteger(LAST) || LAST <= 0) {
  console.error(`scout:readback · --last must be a positive integer, got ${JSON.stringify(lastArg)}`);
  process.exit(1);
}
const obligationArg = argv.find((a) => a.startsWith("--obligation="));
const PREFIX = obligationArg ? obligationArg.slice("--obligation=".length) : "";
const outArg = argv.find((a) => a.startsWith("--out="));
const OUT = outArg ? resolve(ROOT, outArg.slice("--out=".length)) : null;

/* ------------------------------------------------------------------ types */

interface ProofCondition {
  readonly name: string;
  readonly holds: boolean;
  /** What the persisted rows said. Quoted, never inferred. */
  readonly evidence: string;
}

interface PersistedAttemptView {
  readonly found: boolean;
  readonly readError: string | null;
  readonly worker: { readonly role: string; readonly provider: string; readonly version: string } | null;
  readonly outcome: string | null;
  readonly abortReason: string | null;
  readonly cost: Attempt["cost"] | null;
  readonly artifactIds: readonly string[];
  readonly startedAt: string | null;
  readonly endedAt: string | null;
}

interface ResultReadback {
  readonly attemptId: string;
  readonly obligationId: string;
  readonly subjectId: string;
  readonly routeId: string | null;
  readonly recordClass: string;
  readonly providerId: string | null;
  readonly reason: string;
  readonly outcome: string;
  readonly stoppedBy: string;
  readonly recordedAt: string;
  readonly rungs: readonly {
    readonly index: number;
    readonly rung: string;
    readonly tool: string;
    readonly target: string;
    readonly observed: string;
    readonly artifactIds: number;
  }[];
  readonly distinctEvidenceRungs: number;
  readonly candidates: readonly {
    readonly routeId: string;
    readonly url: string;
    readonly permission: string;
    readonly evidenceArtifactIds: readonly string[];
  }[];
  readonly findings: ScoutResult["findings"];
  readonly nextRungs: readonly string[];
  readonly worker: ScoutResult["worker"];
  readonly usage: ScoutResult["usage"];
  readonly usd: number | null;
  readonly elapsedMs: number;
  readonly artifactIds: readonly string[];
  readonly attempt: PersistedAttemptView;
  readonly costLedger: readonly { readonly role: string; readonly usd: number | null; readonly recordedAt: string }[];
  readonly committedDisposition: {
    readonly disposition: string;
    readonly committedAt: string;
    readonly permission: string;
    readonly transport: string;
    readonly artifactIds: number;
  } | null;
  readonly proof: {
    readonly conditions: readonly ProofCondition[];
    readonly failed: number;
    readonly of: number;
  };
}

interface ScoutReadbackRecord {
  readonly formatVersion: 1;
  readonly measuredAt: string;
  readonly testedSha: string | null;
  readonly store: string;
  readonly resultsInLog: number;
  readonly matchingPrefix: { readonly prefix: string; readonly count: number };
  readonly shown: number;
  readonly results: readonly ResultReadback[];
  readonly proofTotals: { readonly failed: number; readonly of: number };
}

/* -------------------------------------------------------------- helpers --- */

const redact = (s: string): string => s.replace(/postgres(?:ql)?:\/\/\S+/gi, "<connection string redacted>");
const line = (s: string): void => console.log(`  ${s}`);
const PROMOTION_STATEMENT =
  "promotion OFF: dispositions land in the control plane and staging only; no reader surface reads " +
  "repos.dispositions, so a committed disposition here is inventory, never product";

/* ------------------------------------------------------------- the store --- */

const url = controlPlaneUrlFromEnv();
if (url === null) {
  console.error(
    `scout:readback · ${CONTROL_PLANE_URL_VAR} is not set. Reading the file store instead would be ` +
      "evidence about a different store than the Scouts write to. Refusing.",
  );
  process.exit(1);
}
let repos: ControlPlaneRepositories;
try {
  repos = await createPgRepositories(url, NOW);
} catch (error) {
  console.error(
    `scout:readback · could not open the control plane: ${redact(error instanceof Error ? error.message : String(error))}`,
  );
  process.exit(1);
}

/* -------------------------------------------------------------- the reads --- */

/*
 * Three whole-log reads, each of which is allowed to FAIL by name. A failed
 * costs or dispositions read does not zero those columns: every dependent
 * proof condition is answered "FAILED READ" and counted as not holding,
 * because a condition nobody could check is not a condition that held.
 */
let all: readonly ScoutResult[];
try {
  all = await repos.scoutResults.readAll();
} catch (error) {
  console.error(
    `scout:readback · FAILED READ scoutResults.readAll: ${redact(error instanceof Error ? error.message : String(error))}`,
  );
  process.exit(1);
}
let costsByAttempt: Map<string, CostEntry[]> | null = null;
let costsReadError: string | null = null;
try {
  costsByAttempt = new Map();
  for (const c of await repos.costs.readAll()) {
    const rows = costsByAttempt.get(c.attemptId) ?? [];
    rows.push(c);
    costsByAttempt.set(c.attemptId, rows);
  }
} catch (error) {
  costsByAttempt = null;
  costsReadError = redact(error instanceof Error ? error.message : String(error));
}
let dispositionsByRouteTask: Map<string, DispositionCommit[]> | null = null;
let dispositionsReadError: string | null = null;
try {
  dispositionsByRouteTask = new Map();
  for (const d of await repos.dispositions.readAll()) {
    const rows = dispositionsByRouteTask.get(d.routeTaskId) ?? [];
    rows.push(d);
    dispositionsByRouteTask.set(d.routeTaskId, rows);
  }
} catch (error) {
  dispositionsByRouteTask = null;
  dispositionsReadError = redact(error instanceof Error ? error.message : String(error));
}

console.log(`scout:readback · READ BACK FROM ${repos.describe()} at ${NOW}`);
line(`testedSha: ${headSha(ROOT) ?? "null (no HEAD resolvable)"}`);
if (costsReadError !== null) line(`FAILED READ costs.readAll: ${costsReadError}`);
if (dispositionsReadError !== null) line(`FAILED READ dispositions.readAll: ${dispositionsReadError}`);

const NO_RESULTS =
  "the scoutResults log holds ZERO rows. Either no Scout Attempt has recorded a result yet or the read " +
  "resolved to an empty log — this instrument cannot tell which, and says so rather than asserting either.";
const matching = all.filter((r) => r.obligationId.startsWith(PREFIX));
line(floorLine(floored(`Scout results matching --obligation=${JSON.stringify(PREFIX)}`, "the scoutResults log", all.length, matching.length, NO_RESULTS)));

/* Newest first: recordedAt descending, attemptId as the tie-break so the order is stable. */
const ordered = [...matching].sort((a, b) =>
  a.recordedAt > b.recordedAt ? -1 : a.recordedAt < b.recordedAt ? 1 : a.attemptId < b.attemptId ? -1 : a.attemptId > b.attemptId ? 1 : 0,
);
const shown = ordered.slice(0, LAST);
line(`showing the newest ${shown.length} of ${matching.length} (--last=${LAST})`);

/* ------------------------------------------------------------ per result --- */

async function readAttempt(id: string): Promise<PersistedAttemptView> {
  let row: Awaited<ReturnType<typeof repos.attempts.read>>;
  try {
    row = await repos.attempts.read(id);
  } catch (error) {
    return {
      found: false,
      readError: redact(error instanceof Error ? error.message : String(error)),
      worker: null,
      outcome: null,
      abortReason: null,
      cost: null,
      artifactIds: [],
      startedAt: null,
      endedAt: null,
    };
  }
  if (row === null) {
    return { found: false, readError: null, worker: null, outcome: null, abortReason: null, cost: null, artifactIds: [], startedAt: null, endedAt: null };
  }
  const a = row.value;
  return {
    found: true,
    readError: null,
    worker: { role: a.worker.role, provider: a.worker.provider, version: a.worker.version },
    outcome: a.outcome,
    abortReason: a.abortReason,
    cost: a.cost,
    artifactIds: a.artifactIds,
    startedAt: a.startedAt,
    endedAt: a.endedAt,
  };
}

function proofConditions(
  r: ScoutResult,
  attempt: PersistedAttemptView,
  ledger: readonly CostEntry[] | null,
): ProofCondition[] {
  const missing = attempt.readError !== null ? `FAILED READ of Attempt ${r.attemptId}: ${attempt.readError}` : `Attempt ${r.attemptId} is NOT in repos.attempts`;
  const w = attempt.worker;
  const c = attempt.cost;
  const toolNamed = r.rungs.filter((g) => typeof g.tool === "string" && g.tool.trim().length > 0);
  const scoutLedger = ledger === null ? null : ledger.filter((e) => e.role === "SCOUT");
  return [
    {
      name: "real model ran (persisted Attempt.worker.provider === anthropic AND role === SCOUT)",
      holds: attempt.found && w !== null && w.provider === "anthropic" && w.role === "SCOUT",
      evidence: attempt.found && w !== null ? `Attempt.worker = ${w.role}/${w.provider}/${w.version}` : missing,
    },
    {
      name: "provider/model identity persisted (Attempt.worker.version is a model id, not the placeholder)",
      holds: attempt.found && w !== null && w.provider.length > 0 && w.version.length > 0 && w.version !== "unspecified-model",
      evidence: attempt.found && w !== null ? `Attempt.worker.version = ${JSON.stringify(w.version)}; result.worker.model = ${JSON.stringify(r.worker.model)}` : missing,
    },
    {
      name: "provider-reported usage persisted (Attempt.cost.inputTokens and outputTokens non-null)",
      holds: attempt.found && c !== null && c.inputTokens !== null && c.outputTokens !== null,
      evidence: attempt.found && c !== null ? `Attempt.cost.inputTokens = ${c.inputTokens}, outputTokens = ${c.outputTokens}` : missing,
    },
    {
      name: "actual cost persisted (Attempt.cost.usd non-null AND a SCOUT cost-ledger entry exists for the attemptId)",
      holds: attempt.found && c !== null && c.usd !== null && scoutLedger !== null && scoutLedger.length >= 1,
      evidence:
        (attempt.found && c !== null ? `Attempt.cost.usd = ${c.usd}` : missing) +
        (scoutLedger === null
          ? `; cost ledger FAILED READ (${costsReadError ?? "unknown"})`
          : `; cost ledger entries for this attemptId: ${scoutLedger.length} SCOUT of ${ledger?.length ?? 0}`),
    },
    {
      name: ">= 1 controlled research tool used (rungs.length >= 1 with a tool name)",
      holds: toolNamed.length >= 1,
      evidence: `rungs = ${r.rungs.length}, with a tool name = ${toolNamed.length}${toolNamed.length > 0 ? ` (${[...new Set(toolNamed.map((g) => g.tool))].join(", ")})` : ""}`,
    },
    {
      name: "evidence vaulted (artifactIds non-empty on BOTH the result and the persisted Attempt)",
      holds: r.artifactIds.length > 0 && attempt.found && attempt.artifactIds.length > 0,
      evidence: `result.artifactIds = ${r.artifactIds.length}; ${attempt.found ? `Attempt.artifactIds = ${attempt.artifactIds.length}` : missing}`,
    },
    {
      name: "typed outcome persisted (result.outcome in SCOUT_OUTCOMES AND the Attempt closed with an outcome)",
      holds: SCOUT_OUTCOMES.includes(r.outcome) && attempt.found && attempt.outcome !== null,
      evidence: `result.outcome = ${JSON.stringify(r.outcome)}; ${attempt.found ? `Attempt.outcome = ${attempt.outcome ?? "null (still open)"}` : missing}`,
    },
    {
      name: "no canonical promotion",
      holds: true,
      evidence: PROMOTION_STATEMENT,
    },
  ];
}

const results: ResultReadback[] = [];
let index = 0;
for (const r of shown) {
  index += 1;
  const attempt = await readAttempt(r.attemptId);
  const ledger = costsByAttempt === null ? null : (costsByAttempt.get(r.attemptId) ?? []);
  const commits = dispositionsByRouteTask === null ? null : (dispositionsByRouteTask.get(r.routeTaskId) ?? []);
  const latest = commits === null || commits.length === 0 ? null : commits.reduce((a, b) => (a.committedAt >= b.committedAt ? a : b));
  const conditions = proofConditions(r, attempt, ledger);
  const failed = conditions.filter((c) => !c.holds).length;

  const view: ResultReadback = {
    attemptId: r.attemptId,
    obligationId: r.obligationId,
    subjectId: r.subjectId,
    routeId: r.routeId,
    recordClass: r.recordClass,
    providerId: r.providerId,
    reason: r.reason,
    outcome: r.outcome,
    stoppedBy: r.stoppedBy,
    recordedAt: r.recordedAt,
    rungs: r.rungs.map((g) => ({ index: g.index, rung: g.rung, tool: g.tool, target: g.target, observed: g.observed, artifactIds: g.artifactIds.length })),
    distinctEvidenceRungs: r.distinctEvidenceRungs,
    candidates: r.candidates.map((c) => ({ routeId: c.routeId, url: c.url, permission: c.permission, evidenceArtifactIds: c.evidenceArtifactIds })),
    findings: r.findings,
    nextRungs: r.nextRungs,
    worker: r.worker,
    usage: r.usage,
    usd: r.usd,
    elapsedMs: r.elapsedMs,
    artifactIds: r.artifactIds,
    attempt,
    costLedger: ledger === null ? [] : ledger.map((e) => ({ role: e.role, usd: e.cost.usd, recordedAt: e.recordedAt })),
    committedDisposition:
      latest === null
        ? null
        : {
            disposition: latest.disposition.disposition,
            committedAt: latest.committedAt,
            permission: latest.disposition.permission,
            transport: latest.disposition.transport,
            artifactIds: latest.disposition.artifactIds.length,
          },
    proof: { conditions, failed, of: conditions.length },
  };
  results.push(view);

  console.log();
  console.log(`#${index}  ${r.obligationId}`);
  line(`subject=${r.subjectId} route=${r.routeId ?? "null"} class=${r.recordClass} provider=${r.providerId ?? "null"}`);
  line(`reason: ${r.reason.slice(0, 200)}`);
  line(`outcome=${r.outcome} stoppedBy=${r.stoppedBy} distinctEvidenceRungs=${r.distinctEvidenceRungs} elapsedMs=${r.elapsedMs} usd=${r.usd ?? "null"} recordedAt=${r.recordedAt}`);
  line(`result.worker: ${r.worker.provider}/${r.worker.model} (modelReported ${r.worker.modelReported ?? "null"})`);
  line(
    `result.usage: in=${r.usage.inputTokens ?? "null"} out=${r.usage.outputTokens ?? "null"} cacheRead=${r.usage.cacheReadInputTokens ?? "null"} ` +
      `cacheCreate=${r.usage.cacheCreationInputTokens ?? "null"} turns=${r.usage.turns} toolCalls=${r.usage.toolCalls}`,
  );
  line(`rungs (${r.rungs.length}):`);
  for (const g of r.rungs) line(`    [${g.index}] ${g.rung} · ${g.tool} -> ${g.target} — ${g.observed.slice(0, 120)} (artifacts ${g.artifactIds.length})`);
  line(`candidates (${r.candidates.length}):`);
  for (const c of r.candidates) line(`    ${c.routeId} ${c.url} permission=${c.permission} evidence=${c.evidenceArtifactIds.length}`);
  line(`findings (${r.findings.length}):`);
  for (const f of r.findings) line(`    ${f.kind} "${f.summary.slice(0, 120)}" artifacts=${f.artifactIds.length}`);
  line(`nextRungs: ${r.nextRungs.length === 0 ? "(none)" : r.nextRungs.join(" | ")}`);
  line(`result.artifactIds: ${r.artifactIds.length}`);
  if (attempt.found && attempt.worker !== null) {
    line(
      `ATTEMPT ${r.attemptId} (persisted): worker ${attempt.worker.role}/${attempt.worker.provider}/${attempt.worker.version} ` +
        `outcome=${attempt.outcome ?? "null"} cost{in=${attempt.cost?.inputTokens ?? "null"} out=${attempt.cost?.outputTokens ?? "null"} ` +
        `usd=${attempt.cost?.usd ?? "null"} durationMs=${attempt.cost?.durationMs ?? "null"} requests=${attempt.cost?.requestCount ?? "null"}} ` +
        `artifacts=${attempt.artifactIds.length}`,
    );
    if (attempt.abortReason !== null) line(`    abortReason: ${attempt.abortReason.slice(0, 200)}`);
  } else {
    line(`ATTEMPT ${r.attemptId}: ${attempt.readError !== null ? `FAILED READ — ${attempt.readError}` : "NOT FOUND in repos.attempts"}`);
  }
  line(
    `COST LEDGER: ${ledger === null ? `FAILED READ (${costsReadError ?? "unknown"})` : `${ledger.length} entry(ies)` + (ledger.length > 0 ? ` — ${ledger.map((e) => `${e.role} usd=${e.cost.usd ?? "null"}`).join(", ")}` : "")}`,
  );
  line(
    `DISPOSITION for routeTask ${r.routeTaskId.slice(0, 16)}: ${
      commits === null
        ? `FAILED READ (${dispositionsReadError ?? "unknown"})`
        : latest === null
          ? "none committed"
          : `${latest.disposition.disposition} at ${latest.committedAt} permission=${latest.disposition.permission} transport=${latest.disposition.transport}`
    }`,
  );
  line(`PROOF CONDITIONS: ${failed} FAILED of ${conditions.length}`);
  for (const c of conditions) line(`    [${c.holds ? " ok " : "FAIL"}] ${c.name} — ${c.evidence}`);
}

/* ---------------------------------------------------------------- totals --- */

const proofOf = results.reduce((n, r) => n + r.proof.of, 0);
const proofFailed = results.reduce((n, r) => n + r.proof.failed, 0);
console.log();
line(
  floorLine(
    floored(
      "proof conditions FAILED",
      "every proof condition over the results shown",
      proofOf,
      proofFailed,
      shown.length === 0 ? NO_RESULTS : undefined,
    ),
  ),
);

if (OUT !== null) {
  const record: ScoutReadbackRecord = {
    formatVersion: 1,
    measuredAt: NOW,
    testedSha: headSha(ROOT),
    store: repos.describe(),
    resultsInLog: all.length,
    matchingPrefix: { prefix: PREFIX, count: matching.length },
    shown: shown.length,
    results,
    proofTotals: { failed: proofFailed, of: proofOf },
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  line(`wrote: ${OUT}`);
}
if (costsReadError !== null || dispositionsReadError !== null) {
  line("a whole-log read FAILED (named above); the conditions it feeds were counted as NOT holding. Exit 1.");
  process.exit(1);
}
