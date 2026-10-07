/**
 * Publishes the one owner snapshot Admin reads, from canonical control-plane
 * state. Mutable civic and operational truth never arrives through a tracked
 * file. Every panel that cannot be computed publishes a named gap, never a zero.
 */

import { collectPlaceHistory } from "../lib/control-plane/admin-view/place-history-collect.ts";
import { readPlaceOwed } from "../lib/control-plane/admin-view/place-owed-read.ts";

import { headSha } from "../lib/ops/git-facts.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import {
  appendMapTilerUsageCollectionDigest,
  mapTilerUsageCollectionOutcome,
  readLatestFreshnessCycleOutcome,
} from "../lib/control-plane/freshness-cycle-outcome.ts";
import {
  controlPlaneUrlFromEnv,
  createPgRepositories,
  CONTROL_PLANE_URL_VAR,
} from "../lib/control-plane/repository/pg-store.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { collectMapTilerUsage } from "../lib/control-plane/maptiler/collector.ts";
import { collectProviderBilling } from "../lib/control-plane/provider-billing-collector.ts";
import { providerBillingAttribution } from "../lib/control-plane/provider-billing-attribution.ts";
import { expansionScopesOf } from "../lib/control-plane/expansion/scopes.ts";
import { readLiveSpendHolds } from "../lib/control-plane/expansion/spend-holds.ts";
import { exactScopeMembers } from "../lib/control-plane/provider-billing-scope-members.ts";
import { ADMIN_CONFIG_ID } from "../lib/control-plane/gateway/admin-config.ts";
import { retainMapTilerLastKnownGood } from "../lib/control-plane/maptiler/usage.ts";
import {
  CACHE_OBSERVATION_ID,
  DECISION_LOG_KEY,
  RUNNER_ID,
  SNAPSHOT_ID,
} from "../lib/control-plane/admin-data.ts";
import {
  OWNER_SURFACE_FORMAT_VERSION,
  assertAggregateOnly,
  gap,
  held,
  measured,
  type Held,
  type Measured,
  type OwnerSnapshot,
  type RunnerHeartbeat,
  type OwnerZipRow,
} from "../lib/control-plane/owner-surface.ts";
import { buildCostPanel, buildSpendByPlace } from "../lib/control-plane/cost-panel.ts";
import { collectPublishedCampaignReadback, collectPublishedWorkerReadback, collectPublishedManualReaderReadback } from "../lib/control-plane/served-reader-production.ts";
import type { ServedReaderReadback } from "../lib/control-plane/served-reader.ts";
import { buildAssignmentView, type AssignmentPublication, type AssignmentSources } from "../lib/control-plane/assignment-view.ts";
import { ASSIGNMENT_ATTEMPT_PROJECTION, ASSIGNMENT_OBLIGATION_PROJECTION, readAllAssignmentSources } from "../lib/control-plane/assignment-read.ts";
import { readPipelineStates, stageCounts } from "../lib/control-plane/promotion/pipeline.ts";
import { RESEARCH_STATE_ID } from "../lib/control-plane/scheduler/research-policy.ts";
import { unitCarriesState } from "../lib/control-plane/scheduler/dispatch-target.ts";
import { US_STATES } from "../lib/control-plane/readiness/catalog.ts";
import { assertRuntimeAuthority } from "../lib/civic-data/runtime-authority.ts";
const NOW = new Date();
const NOW_ISO = NOW.toISOString();
const HEAD = headSha();

const arg = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const DRY_RUN = process.argv.includes("--dry-run");

function log(line: string): void {
  console.log(`owner-snapshot · ${line}`);
}

const publisherRepos = await repositories();
const canonicalCycle = publisherRepos === null ? null : await readLatestFreshnessCycleOutcome(publisherRepos);
const newestCycle: { record: CycleRecord; file: string } | null = canonicalCycle
  ? { record: canonicalCycle.outcome as unknown as CycleRecord, file: canonicalCycle.digest.digestId }
  : null;

/** Candidate display names belong to the canonical candidate-profile projection, not this snapshot. */
function candidateNames(): Record<string, string> {
  return {};
}

/** Measured spend per Eastern calendar day over the trailing fortnight. */
function spendByDay(reads: ControlPlaneReads | null): OwnerSnapshot["spendByDay"] {
  if (reads === null) return [];
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const since = NOW.getTime() - 14 * 86_400_000;
  const byDay = new Map<string, { usd: number; attempts: number }>();
  for (const entry of reads.costs) {
    const at = Date.parse(entry.recordedAt);
    if (!Number.isFinite(at) || at < since) continue;
    const key = day.format(new Date(at));
    const acc = byDay.get(key) ?? { usd: 0, attempts: 0 };
    if (typeof entry.cost.usd === "number" && Number.isFinite(entry.cost.usd)) acc.usd += entry.cost.usd;
    acc.attempts += 1;
    byDay.set(key, acc);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([d, v]) => ({ day: d, usd: Math.round(v.usd * 10_000) / 10_000, attempts: v.attempts }));
}

/** The run record's shapes as `scripts/freshness-shadow.mts` writes them. */
interface CycleRecord {
  startedAt?: string;
  finishedAt?: string;
  testedSha?: string;
  digest?: string[];
  risk?: {
    obligationsScheduled?: number;
    obligationsUnscheduled?: number;
    obligationsOverdue?: number;
    debtRows?: number;
    incidents?: number;
    oldestDebtHours?: number;
    activation?: string;
  };
  incidents?: Array<Record<string, unknown>>;
  scheduled?: number;
  unscheduled?: Array<{ id?: string; reason?: string }>;
  registry?: {
    providers?: Array<{ providerId?: string; units?: number; records?: number; readFailure?: string | null }>;
    registeredUnits?: number;
  };
  research?: {
    lanes?: {
      deterministic?: { due?: number; dispatched?: number };
      model?: { due?: number; dispatched?: number };
    } | null;
  };
}

function zipRows(): Held<readonly OwnerZipRow[]> {
  return gap(
    "OURS",
    "The ZIP-by-ZIP reader check is software certification. Its historical tracked run " +
      "records are not live operational truth and this standing publisher will not read or " +
      "republish them. A canonical exact-release certification projection is not wired here.",
  );
}


function intake(): {
  folder: Held<string>;
  found: Held<Measured>;
  processed: Held<Measured>;
  unidentifiable: Held<Measured>;
} {
  const says =
    "Historical feedback-sweep files are engineering evidence, not the live intake authority. " +
    "Current intake observations and history are read from the canonical control plane on the " +
    "Admin feedback page.";
  return {
    folder: gap("OURS", says),
    found: gap("OURS", says),
    processed: gap("OURS", says),
    unidentifiable: gap("OURS", says),
  };
}

const cycle = newestCycle;
const zips = zipRows();
const intakeCounts = intake();

const providerRows = Array.isArray(cycle?.record.registry?.providers) ? cycle.record.registry.providers : [];
const registeredUnits =
  typeof cycle?.record.registry?.registeredUnits === "number"
    ? cycle.record.registry.registeredUnits
    : providerRows.reduce((n, p) => n + (typeof p.units === "number" ? p.units : 0), 0);
const cycleSource = `freshness-shadow run ${cycle?.file ?? "unknown"}`;

/** Read once so every cost row and the by-state deployment come from one instant. Null when the store was not opened. */
interface ControlPlaneReads {
  readonly runnerHeartbeat: RunnerHeartbeat | null;
  readonly billingScopes: Parameters<typeof providerBillingAttribution>[0]["scopes"];
  readonly billingHolds: Parameters<typeof providerBillingAttribution>[0]["holds"];
  readonly costs: Awaited<ReturnType<ControlPlaneRepositories["costs"]["readAll"]>>;
  readonly attempts: { readonly id: string; readonly worker: { readonly version: string; readonly provider: string } }[];
  readonly obligations: { readonly id: string; readonly subjectId: string }[];
  readonly cacheByRole: Parameters<typeof buildCostPanel>[0]["cacheByRole"];
  readonly share: Parameters<typeof buildCostPanel>[0]["share"];
  readonly verifiedRecords: number | null;
  readonly pipelineStates: Awaited<ReturnType<typeof readPipelineStates>>;
  readonly assignmentSources: { readonly ok: true; readonly value: AssignmentSources } | { readonly ok: false; readonly says: string };
}

async function readControlPlane(repos: ControlPlaneRepositories): Promise<ControlPlaneReads> {
  const runnerHeartbeat = await repos.runnerHeartbeat.read(RUNNER_ID).then(row=>row?.value??null).catch(()=>null);
  const [billingScopes, billingHolds] = await Promise.all([
    repos.adminConfig.read(ADMIN_CONFIG_ID).then(r => { const parsed = expansionScopesOf(r?.value ?? null); return parsed.malformed ? null : parsed.scopes; }).catch(() => null),
    // Only live holds count as set aside.
    readLiveSpendHolds(repos, new Date().toISOString()).catch(() => null),
  ]);
  const [costs, attempts, obligations, research] = await Promise.all([
    repos.costs.readAll(),
    repos.attempts.listNarrowed(ASSIGNMENT_ATTEMPT_PROJECTION).then(rows => rows.map(row => ({ ...row, value: row.value as AssignmentSources["attempts"][number] }))),
    repos.obligations.listNarrowed(ASSIGNMENT_OBLIGATION_PROJECTION).then(rows => rows.map(row => ({ ...row, value: row.value as AssignmentSources["obligations"][number] }))),
    repos.researchState.read(RESEARCH_STATE_ID),
  ]);
  let verifiedRecords: number | null = null;
  let pipelineStates: Awaited<ReturnType<typeof readPipelineStates>> = [];
  let pipelineRead = false;
  try {
    pipelineStates = await readPipelineStates(repos);
    verifiedRecords = stageCounts(pipelineStates).byStage.VERIFIED;
    pipelineRead = true;
  } catch (error) {
    log(`the promotion pipeline could not be read (${(error as Error).message}) — cost per verified record is a gap`);
  }
  let assignmentSources: ControlPlaneReads["assignmentSources"];
  try {
    assignmentSources = {
      ok: true,
      value: await readAllAssignmentSources(
        repos,
        { nowIso: NOW_ISO, activation: null, pilotZips: [] },
        {
          costs,
          attempts: attempts.map((a) => a.value),
          obligations: obligations.map((o) => o.value),
          pipeline: pipelineRead ? pipelineStates : null,
        },
      ),
    };
  } catch (error) {
    // The error NAME only: a driver message can carry the connection string.
    const name = (error as Error)?.name ?? "error";
    log(`the assignment view's records could not be read (${name}) — the assignment view publishes as NOT_BUILT`);
    assignmentSources = { ok: false, says: `The records the assignment view joins could not be read on this publish (${name}); nothing is claimed about the work.` };
  }
  const metrics = research?.value.metrics ?? null;
  return {
    runnerHeartbeat,
    billingScopes, billingHolds,
    costs,
    attempts: attempts.map((a) => ({ id: a.value.id, worker: a.value.worker })),
    obligations: obligations.map((o) => ({ id: o.value.id, subjectId: o.value.subjectId })),
    cacheByRole: metrics?.cacheByRole ?? null,
    share: metrics?.share ?? null,
    verifiedRecords,
    pipelineStates,
    assignmentSources,
  };
}

function assignmentPublication(reads: ControlPlaneReads): AssignmentPublication {
  if (!reads.assignmentSources.ok) return { kind: "NOT_BUILT", at: NOW_ISO, says: reads.assignmentSources.says };
  const sources = reads.assignmentSources.value;
  return {
    kind: "BUILT",
    view: buildAssignmentView(sources, {
      reads: [
        {
          what: "leases",
          held: true,
          says: "read for the route tasks that hold an open attempt — the one question a lease answers here (is a worker on it now)",
        },
        {
          what: "disposition commits",
          held: false,
          says: "not read at publish: each route task carries its applied disposition; the drilldown reads the commits by route task",
        },
        {
          what: "promotion pipeline",
          held: sources.pipeline !== null,
          says: sources.pipeline !== null ? "read whole at publish" : "could not be read at publish; verification shows as a named gap",
        },
      ],
    }),
  };
}

/** Standing obligations by state from obligation ids; an obligation naming no state lands in "other". */
function obligationsByState(reads: ControlPlaneReads | null): OwnerSnapshot["obligationsByState"] {
  if (reads === null || reads.obligations.length === 0) return [];
  const counts = new Map<string, number>();
  for (const o of reads.obligations) {
    const hay = `${o.id} ${o.subjectId}`.toLowerCase();
    const state = US_STATES.find((s) => unitCarriesState(hay, s.code));
    const key = state ? state.name : "other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = reads.obligations.length;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([state, count]) => ({
      state,
      count: measured(
        count,
        total,
        "standing obligations whose id or subject names this state, out of every standing obligation in the control plane",
        "cp_obligations (control-plane standing obligations)",
      ),
    }));
}

function buildSnapshot(
  reads: ControlPlaneReads | null,
  maptiler: OwnerSnapshot["maptiler"],
  servedReader: ServedReaderReadback | null = null,
): OwnerSnapshot {
  const risk = cycle?.record.risk ?? {};
  const debtRows = typeof risk.debtRows === "number" ? risk.debtRows : null;
  const cost = reads
    ? buildCostPanel({
        costs: reads.costs,
        attempts: reads.attempts,
        cacheByRole: reads.cacheByRole,
        share: reads.share,
        verifiedRecords: reads.verifiedRecords,
        nowIso: NOW_ISO,
      })
    : null;
  const notOpened = gap<Measured>("OURS", "not read — the control plane was not opened for this publish.");

  return {
    formatVersion: OWNER_SURFACE_FORMAT_VERSION,
    publishedAt: NOW_ISO,
    publishedFromSha: HEAD,
    publisher: "pilot-runner/console-publisher",

    pilotGreen: null,
    contracts: [],

    decisionCards: [],
    candidateNames: candidateNames(),
    spendByDay: spendByDay(reads),
    spendByPlace: reads ? buildSpendByPlace(reads.costs) : undefined,
    assignments: reads ? assignmentPublication(reads.assignmentSources.ok ? { ...reads, assignmentSources: { ok: true, value: { ...reads.assignmentSources.value, servedReader } } } : reads) : undefined,
    servedReaderReadback: servedReader,
    maptiler,

    obligationsByState: obligationsByState(reads),

    obligationsByProvider: providerRows
      .filter((p) => typeof p.providerId === "string")
      .map((p) => ({
        provider: String(p.providerId),
        count: measured(
          typeof p.units === "number" ? p.units : 0,
          Math.max(registeredUnits, typeof p.units === "number" ? p.units : 0),
          "route units this provider registered in the newest cycle, out of every unit registered across all providers",
          cycleSource,
        ),
      })),

    freshnessDebtRows:
      cycle === null || debtRows === null
        ? gap(
            "OURS",
            "No freshness-shadow cycle record carries a debt count, so debt has not been counted. Not counted is not zero.",
          )
        : held(
            measured(
              debtRows,
              Math.max(registeredUnits, debtRows),
              "route units carrying a freshness debt row, out of every unit the newest cycle registered",
              cycleSource,
            ),
          ),

    incidents: (cycle?.record.incidents ?? []).map((i) => ({
      cause: String(i.cause ?? "unknown"),
      target: String(i.target ?? "unknown"),
      obligationsAffected: Number(i.obligationsAffected ?? 0),
      oldestHours: typeof i.oldestHours === "number" ? i.oldestHours : null,
    })),

    costByRole: cost ? cost.costByRole : [{ key: "every role", usd: notOpened, attemptsMeasured: 0, attemptsUnmeasured: 0 }],
    costByModel: cost ? cost.costByModel : [{ key: "every model", usd: notOpened, attemptsMeasured: 0, attemptsUnmeasured: 0 }],
    cacheHitRateByCaller: cost ? cost.cacheHitRateByCaller : [{ callerKey: "every caller", hitRate: notOpened }],
    deterministicShare: cost ? cost.deterministicShare : notOpened,
    costPerVerifiedRecord: cost ? cost.costPerVerifiedRecord : notOpened,
    costSummary: cost ? cost.summary : undefined,
    costCapacity: cost ? cost.capacity : null,
    monthlySpend: cost ? cost.monthlySpend : null,

    zipRows: zips,

    intakeFolder: intakeCounts.folder,
    intakeItemsFound: intakeCounts.found,
    intakeItemsProcessed: intakeCounts.processed,
    intakeUnidentifiable: intakeCounts.unidentifiable,
  };
}

async function repositories(): Promise<ControlPlaneRepositories | null> {
  const override = arg("file-store");
  if (override) {
    log(`writing to the FILE store at ${override} (a local proof, not the deployed plane)`);
    return createFileRepositories(override);
  }
  const url = controlPlaneUrlFromEnv();
  if (url === null) {
    if (DRY_RUN) {
      log(`${CONTROL_PLANE_URL_VAR} is not set — dry run builds the snapshot with every control-plane panel as a named gap`);
      return null;
    }
    throw new Error(
      `${CONTROL_PLANE_URL_VAR} is not set. Reading or writing a different store would be ` +
        "evidence about a different store than the claim is about. Refusing.",
    );
  }
  if (!DRY_RUN) assertRuntimeAuthority({ capabilities: ["CONSOLE_PUBLISHER"] });
  // Without a per-request deadline one hung request holds the publisher until the runner's ceiling kills it.
  installNeonRequestDeadline();
  return createPgRepositories(url, NOW_ISO);
}

async function main(): Promise<void> {
  log(`HEAD ${HEAD?.slice(0, 8) ?? "unknown"}`);

  // Opened first so the cost panel and the by-state deployment read the same instant.
  const repos = publisherRepos;
  if (repos) log(repos.describe());
  const reads = repos ? await readControlPlane(repos) : null;
  const existing = repos ? await repos.ownerSnapshots.read(SNAPSHOT_ID) : null;
  const maptilerCandidate = await collectMapTilerUsage({ nowIso: NOW_ISO });
  const maptiler = retainMapTilerLastKnownGood({
    candidate: maptilerCandidate,
    previous: existing?.value.maptiler,
  });
  if (repos !== null && !DRY_RUN) {
    const outcome = mapTilerUsageCollectionOutcome({
      candidate: maptilerCandidate,
      visible: maptiler,
      finishedAt: new Date().toISOString(),
      testedSha: HEAD,
      host: process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? "standing-runner",
      provider: repos.describe(),
      durable: repos.durable,
    });
    await appendMapTilerUsageCollectionDigest(repos, {
      outcome,
      lines: [
        `Map provider automatic collection: ${outcome.disposition}.`,
        `Provider attempt ${outcome.attempt.connection}; ${outcome.candidate.rows} candidate row(s); ` +
          `visible measurement ${outcome.visibleMeasurement?.collectedAt ?? "UNKNOWN"}.`,
        "The attempt is in the canonical append-only owner history; the current/LKG projection is the owner snapshot.",
      ],
    });
  }
  const providerBilling = DRY_RUN ? existing?.value.providerBilling ?? null : await collectProviderBilling({ now: NOW_ISO, previous: existing?.value.providerBilling, costs: reads?.costs ?? null });
  const scopeMembers = reads?.assignmentSources.ok && reads.billingScopes ? exactScopeMembers(reads.billingScopes, reads.assignmentSources.value) : undefined;
  const billingAttribution = reads && providerBilling ? providerBillingAttribution({ now: NOW_ISO, costs: reads.costs, attempts: reads.attempts, scopes: reads.billingScopes, holds: reads.billingHolds, scopeMembers, readings: providerBilling.readings }) : null;
  let servedReader = DRY_RUN ? existing?.value.servedReaderReadback ?? null : await collectPublishedCampaignReadback(NOW_ISO).catch(() => ({ checkedAt: NOW_ISO, witnesses: existing?.value.servedReaderReadback?.witnesses ?? [], errors: ["Public readback collection failed; earlier witnesses retain their original time and expire after three hours."] }));
  if (!DRY_RUN && reads?.assignmentSources.ok) {
    const [workerReadback, manualReadback] = await Promise.all([
      collectPublishedWorkerReadback(reads.assignmentSources.value.workItems, NOW_ISO, existing?.value.servedReaderReadback ?? null)
        .catch(() => ({ checkedAt: NOW_ISO, witnesses: [], errors: ["Worker public readback collection failed; prior observations retain their original time and expiry."] })),
      collectPublishedManualReaderReadback(reads.assignmentSources.value.workItems, NOW_ISO, existing?.value.servedReaderReadback ?? null)
        .catch(() => ({ checkedAt: NOW_ISO, witnesses: [], errors: ["Public help readback collection failed; prior observations retain their original time and expiry."] })),
    ]);
    const joined = new Map([...(existing?.value.servedReaderReadback?.witnesses ?? []), ...(servedReader?.witnesses ?? []), ...workerReadback.witnesses, ...manualReadback.witnesses]
      .map(w => [`${w.itemId}:${w.approvalId}`, w]));
    servedReader = { checkedAt: NOW_ISO, witnesses: [...joined.values()], errors: [...(servedReader?.errors ?? []), ...workerReadback.errors, ...manualReadback.errors] };
  }
  const placeHistory = DRY_RUN ? existing?.value.placeHistory
    : await collectPlaceHistory({ scopes: reads?.billingScopes ?? null, previous: existing?.value.placeHistory, now: NOW_ISO, read: key => readPlaceOwed(key) })
      .catch(() => existing?.value.placeHistory);
  const snapshot: OwnerSnapshot = { ...buildSnapshot(reads, maptiler, servedReader), providerBilling, billingAttribution, ...(placeHistory ? { placeHistory } : {}) };

  assertAggregateOnly(snapshot, "owner snapshot");
  log(
    floorLine(
      zips.held
        ? floored("ZIP rows", "the newest reader-suite run", zips.value.length, zips.value.length)
        : floored("ZIP rows", "the newest reader-suite run", 0, 0, zips.gap.says),
    ),
  );
  log(
    floorLine(
      floored(
        "incidents",
        "the newest freshness-shadow cycle",
        Math.max(snapshot.incidents.length, 1),
        snapshot.incidents.length,
        snapshot.incidents.length === 0 && cycle === null
          ? "no freshness-shadow cycle record exists, so incidents were never counted"
          : undefined,
      ),
    ),
  );
  log(
    floorLine(
      floored(
        "obligations by state",
        "cp_obligations",
        reads ? reads.obligations.length : 0,
        snapshot.obligationsByState.reduce((n, r) => n + r.count.value, 0),
        reads === null ? "the control plane was not opened" : reads.obligations.length === 0 ? "the control plane holds no standing obligation" : undefined,
      ),
    ),
  );
  if (reads) {
    const s = snapshot.costSummary;
    log(
      `  cost ledger: ${reads.costs.length} entr${reads.costs.length === 1 ? "y" : "ies"}; ` +
        `${s?.attemptsMeasured ?? 0} measured ($${(s?.measuredUsd ?? 0).toFixed(4)}), ${s?.attemptsUnmeasured ?? 0} unmeasured; ` +
        `${snapshot.costByRole.length} role row(s), ${snapshot.costByModel.length} model row(s)`,
    );
  }
  const assignments = snapshot.assignments;
  if (assignments?.kind === "BUILT") {
    const v = assignments.view;
    log(
      floorLine(
        floored(
          "assignments",
          "every obligation, work item and orphaned execution record",
          v.summary.total,
          v.summary.total,
          v.summary.total === 0 ? "the control plane holds no standing obligation and no work item" : undefined,
        ),
      ),
    );
    log(
      `  assignment list: ${v.selection.published} of ${v.summary.total} published ` +
        `(${v.selection.trimmedForBytes} trimmed for the ${v.selection.byteBudget}-byte budget); ${JSON.stringify(v).length} bytes`,
    );
  } else if (assignments?.kind === "NOT_BUILT") {
    log(`  assignment view NOT BUILT: ${assignments.says}`);
  }

  if (DRY_RUN || repos === null) {
    log("--dry-run: nothing written");
    return;
  }

  // The snapshot is one aggregate that moves, so compare-and-set is the write that replaces it.
  if (existing === null) await repos.ownerSnapshots.put(SNAPSHOT_ID, snapshot, NOW_ISO);
  else await repos.ownerSnapshots.compareAndSet(SNAPSHOT_ID, existing.revision, snapshot, NOW_ISO);
  const cacheExisting = await repos.cacheObservations.read(CACHE_OBSERVATION_ID);
  if (cacheExisting === null) {
    await repos.cacheObservations.put(
      CACHE_OBSERVATION_ID,
      {
        formatVersion: OWNER_SURFACE_FORMAT_VERSION,
        state: "RECORDING_NOT_WIRED",
        firstObservedAt: null,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
        recorderLastSeenAt: null,
      },
      NOW_ISO,
    );
  }

  const decisions = await repos.ownerDecisions.read(DECISION_LOG_KEY);
  log(
    `published: snapshot; ${canonicalCycle ? `canonical cycle ${canonicalCycle.outcome.cycleId}` : "no canonical cycle recorded"}; the heartbeat is the runner's own; ` +
      `${decisions.length} owner decision intent(s) on record`,
  );
  // A transient failed input read must not count as a successful publication.
  if (reads && (!reads.assignmentSources.ok || reads.billingScopes === null ||
      reads.billingHolds === null || reads.verifiedRecords === null)) {
    log("published with incomplete control-plane inputs; the standing runner will retry");
    process.exitCode = 1;
  }
}

await main();
