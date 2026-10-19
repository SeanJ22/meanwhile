import { REGISTRY_STATES } from "../lib/civic-data/state-scopes.ts";

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
import type { ControlPlaneRepositories, Persisted } from "../lib/control-plane/repository/types.ts";
import { collectMapTilerUsage } from "../lib/control-plane/maptiler/collector.ts";
import { collectProviderBilling } from "../lib/control-plane/provider-billing-collector.ts";
import { billingAttributionOf } from "../lib/control-plane/provider-billing-attribution.ts";
import { expansionScopesOf } from "../lib/control-plane/expansion/scopes.ts";
import { readLiveSpendHolds } from "../lib/control-plane/expansion/spend-holds.ts";
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
import { costPanelOf, spendByDayOf } from "../lib/control-plane/cost-panel.ts";
import { collectPublishedCampaignReadback, collectPublishedWorkerReadback, collectPublishedManualReaderReadback } from "../lib/control-plane/served-reader-production.ts";
import type { ServedReaderReadback } from "../lib/control-plane/served-reader.ts";
import type { AssignmentPublication, AssignmentView } from "../lib/control-plane/assignment-view.ts";
import { readAskGapObservations } from "../lib/control-plane/ask-gap-observations.ts";
import { OWNER_SNAPSHOT_TOTALS_ID, OwnerSnapshotFold, readingWindows, type OwnerSnapshotTotals } from "../lib/control-plane/owner-snapshot-totals.ts";
import { RESEARCH_STATE_ID } from "../lib/control-plane/scheduler/research-policy.ts";
import { assertRuntimeAuthority } from "../lib/civic-data/runtime-authority.ts";
import { readFromHeldCopies } from "../lib/control-plane/repository/incremental-reads.ts";

readFromHeldCopies();
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

function stepDone(what: string): void {
  log(`${what} (${Math.round((Date.now() - NOW.getTime()) / 1000)}s into this publish)`);
}

const publisherRepos = await repositories();
const canonicalCycle = publisherRepos === null ? null : await readLatestFreshnessCycleOutcome(publisherRepos);
const newestCycle: { record: CycleRecord; file: string } | null = canonicalCycle
  ? { record: canonicalCycle.outcome as unknown as CycleRecord, file: canonicalCycle.digestId }
  : null;

function candidateNames(): Record<string, string> {
  return {};
}

function spendByDay(reads: ControlPlaneReads | null): OwnerSnapshot["spendByDay"] {
  return reads === null ? [] : spendByDayOf(reads.fold.costs.days);
}

interface CycleRecord {
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
  registry?: {
    providers?: Array<{ providerId?: string; units?: number; records?: number; readFailure?: string | null }>;
    registeredUnits?: number;
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

interface ControlPlaneReads {
  readonly runnerHeartbeat: RunnerHeartbeat | null;
  readonly billingScopes: Parameters<typeof billingAttributionOf>[0]["scopes"];
  readonly billingHolds: Parameters<typeof billingAttributionOf>[0]["holds"];
  readonly fold: OwnerSnapshotFold;
  readonly cacheByRole: Parameters<typeof costPanelOf>[2]["cacheByRole"];
  readonly share: Parameters<typeof costPanelOf>[2]["share"];
  /** The totals row this publish started from, which it replaces. */
  readonly prior: Persisted<OwnerSnapshotTotals> | null;
}

/** The totals carried from the last publish, with every control-plane row changed since then folded in state by state. */
async function readControlPlane(repos: ControlPlaneRepositories, existing: CarriedForward | null): Promise<ControlPlaneReads> {
  const runnerHeartbeat = await repos.runnerHeartbeat.read(RUNNER_ID).then(row=>row?.value??null).catch(()=>null);
  const [billingScopes, billingHolds, prior, research, askGaps] = await Promise.all([
    repos.adminConfig.read(ADMIN_CONFIG_ID,{expansionScopes:true}).then(r => { const parsed = expansionScopesOf(r?.value ?? null); return parsed.malformed ? null : parsed.scopes; }).catch(() => null),
    // Only live holds count as set aside.
    readLiveSpendHolds(repos, new Date().toISOString()).catch(() => null),
    repos.ownerSnapshotTotals.read(OWNER_SNAPSHOT_TOTALS_ID),
    repos.researchState.read(RESEARCH_STATE_ID),
    readAskGapObservations(repos.askGapObservations),
  ]);
  const fold = await OwnerSnapshotFold.fold(repos, prior?.value ?? null, { nowIso: NOW_ISO, servedReader: existing?.servedReaderReadback ?? null,
    askGapObservations: "unreadable" in askGaps ? null : askGaps.rows, scopes: billingScopes, carried: existing?.providerBilling?.readings ?? [], write: !DRY_RUN, log });
  const metrics = research?.value.metrics ?? null;
  return { runnerHeartbeat, billingScopes, billingHolds, fold, cacheByRole: metrics?.cacheByRole ?? null, share: metrics?.share ?? null, prior };
}

function assignmentView(fold: OwnerSnapshotFold): Promise<AssignmentView> {
  return fold.view({
    activation: null,
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
        held: true,
        says: "read for the items whose source names an assignment's attempt or work item; its counts fold every record appended since the last publish",
      },
      {
        what: "the clock",
        held: false,
        says: "not read for the counts: each state's figures stand as of the last publish whose changed rows reached it; each state's index rows carry the instants they change at, so a reader shows them as they hold when read",
      },
    ],
  });
}

function obligationsByState(reads: ControlPlaneReads | null): OwnerSnapshot["obligationsByState"] {
  const counts = reads === null ? {} : reads.fold.obligationsByState();
  const total = Object.values(counts).reduce((n, c) => n + c, 0);
  if (total === 0) return [];
  return Object.entries(counts)
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
  servedReader: ServedReaderReadback | null,
  assignments: AssignmentPublication | undefined,
): OwnerSnapshot {
  const risk = cycle?.record.risk ?? {};
  const debtRows = typeof risk.debtRows === "number" ? risk.debtRows : null;
  const cost = reads
    ? costPanelOf(reads.fold.costs.ledger, reads.fold.costs.scouts, {
        cacheByRole: reads.cacheByRole,
        share: reads.share,
        verifiedRecords: reads.fold.pipeline.verified,
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
    spendByPlace: reads ? reads.fold.spendByPlace() : undefined,
    assignments,
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

  installNeonRequestDeadline();
  return createPgRepositories(url, NOW_ISO);
}

const CARRIED_FORWARD = { maptiler: true, providerBilling: true, servedReaderReadback: true, placeHistory: true } as const;
type CarriedForward = Partial<Pick<OwnerSnapshot, keyof typeof CARRIED_FORWARD>>;

async function main(): Promise<void> {
  log(`HEAD ${HEAD?.slice(0, 8) ?? "unknown"}`);

  const repos = publisherRepos;
  if (repos) log(repos.describe());
  const existing = repos ? await repos.ownerSnapshots.readNarrowed(SNAPSHOT_ID, CARRIED_FORWARD) as Persisted<CarriedForward> | null : null;
  const reads = repos ? await readControlPlane(repos, existing?.value ?? null) : null;
  stepDone("control plane read");
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
  stepDone("map usage collected");
  const providerBilling = DRY_RUN ? existing?.value.providerBilling ?? null : await collectProviderBilling({ now: NOW_ISO, previous: existing?.value.providerBilling,
    searches: reads ? reads.fold.costs.searches[NOW_ISO.slice(0, 7)] ?? {} : null });
  stepDone("provider bills collected");
  const billingAttribution = reads && providerBilling ? billingAttributionOf({ now: NOW_ISO, scopes: reads.billingScopes, holds: reads.billingHolds,
    readings: providerBilling.readings, hunts: reads.fold.costs.hunts, windowOf: readingWindows(reads.fold.costs, providerBilling.readings, NOW_ISO) }) : null;
  let servedReader = existing?.value.servedReaderReadback ?? null;
  if (!DRY_RUN) {
    const combined = { checkedAt: NOW_ISO, witnesses: [] as NonNullable<typeof servedReader>["witnesses"][number][], errors: [] as string[] };
    for (const state of REGISTRY_STATES) {
      try {
        const read = await collectPublishedCampaignReadback(state, NOW_ISO);
        combined.witnesses.push(...read.witnesses);
        combined.errors.push(...read.errors);
      } catch {
        combined.errors.push(`${state} public readback collection failed; earlier witnesses retain their original expiry.`);
      }
    }
    const observed = new Set(combined.witnesses.map(row => `${row.itemId}:${row.readerKey}`));
    combined.witnesses.push(...(servedReader?.witnesses ?? []).filter(row => !observed.has(`${row.itemId}:${row.readerKey}`)));
    servedReader = combined;
  }
  stepDone("campaign page readback collected");
  const fold = reads?.fold ?? null;
  if (!DRY_RUN && fold) {
    const publications = fold.publications();
    const [workerReadback, manualReadback] = await Promise.all([
      collectPublishedWorkerReadback(publications, NOW_ISO, existing?.value.servedReaderReadback ?? null)
        .catch(() => ({ checkedAt: NOW_ISO, witnesses: [], errors: ["Worker public readback collection failed; prior observations retain their original time and expiry."] })),
      collectPublishedManualReaderReadback(publications, NOW_ISO, existing?.value.servedReaderReadback ?? null)
        .catch(() => ({ checkedAt: NOW_ISO, witnesses: [], errors: ["Public help readback collection failed; prior observations retain their original time and expiry."] })),
    ]);
    const joined = new Map([...(existing?.value.servedReaderReadback?.witnesses ?? []), ...(servedReader?.witnesses ?? []), ...workerReadback.witnesses, ...manualReadback.witnesses]
      .map(w => [`${w.itemId}:${w.approvalId}`, w]));
    servedReader = { checkedAt: NOW_ISO, witnesses: [...joined.values()], errors: [...(servedReader?.errors ?? []), ...workerReadback.errors, ...manualReadback.errors] };
    stepDone("worker and help page readbacks collected");
  }
  const placeHistory = DRY_RUN ? existing?.value.placeHistory
    : await collectPlaceHistory({ scopes: reads?.billingScopes ?? null, previous: existing?.value.placeHistory, now: NOW_ISO, read: key => readPlaceOwed(key).finally(() => stepDone(`place history read for ${key}`)) })
      .catch(() => existing?.value.placeHistory);
  let assignments: AssignmentPublication | undefined;
  if (fold) {
    try {
      await fold.readBack(servedReader);
      assignments = { kind: "BUILT", view: await assignmentView(fold) };
    } catch (error) {
      // The error NAME only: a driver message can carry the connection string.
      const name = (error as Error)?.name ?? "error";
      log(`the assignment view's records could not be read (${name}) — the assignment view publishes as NOT_BUILT`);
      assignments = { kind: "NOT_BUILT", at: NOW_ISO, says: `The records the assignment view joins could not be read on this publish (${name}); nothing is claimed about the work.` };
    }
  }
  stepDone("assignments derived");
  const snapshot: OwnerSnapshot = { ...buildSnapshot(reads, maptiler, servedReader, assignments), providerBilling, billingAttribution, ...(placeHistory ? { placeHistory } : {}) };

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
  const clocks = snapshot.obligationsByState.reduce((n, r) => n + r.count.value, 0);
  log(
    floorLine(
      floored(
        "obligations by state",
        "cp_obligations",
        clocks,
        snapshot.obligationsByState.reduce((n, r) => n + r.count.value, 0),
        reads === null ? "the control plane was not opened" : clocks === 0 ? "the control plane holds no standing obligation" : undefined,
      ),
    ),
  );
  if (reads) {
    const s = snapshot.costSummary;
    log(
      `  cost ledger: ${reads.fold.costs.ledger.entries} entr${reads.fold.costs.ledger.entries === 1 ? "y" : "ies"}; ` +
        `${s?.attemptsMeasured ?? 0} measured ($${(s?.measuredUsd ?? 0).toFixed(4)}), ${s?.attemptsUnmeasured ?? 0} unmeasured; ` +
        `${snapshot.costByRole.length} role row(s), ${snapshot.costByModel.length} model row(s)`,
    );
  }
  const published = snapshot.assignments;
  if (published?.kind === "BUILT") {
    const v = published.view;
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
  } else if (published?.kind === "NOT_BUILT") {
    log(`  assignment view NOT BUILT: ${published.says}`);
  }

  if (DRY_RUN || repos === null) {
    log("--dry-run: nothing written");
    return;
  }

  /* The totals go first, by compare-and-set, so two publishers never fold the same rows into one total; they pair with the
     state rows the fold already wrote, so they are written even when the view could not be assembled. */
  if (reads) {
    const totals: OwnerSnapshotTotals = reads.fold.totals();
    if (reads.prior === null) await repos.ownerSnapshotTotals.put(OWNER_SNAPSHOT_TOTALS_ID, totals, NOW_ISO);
    else await repos.ownerSnapshotTotals.compareAndSet(OWNER_SNAPSHOT_TOTALS_ID, reads.prior.revision, totals, NOW_ISO);
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
  if (reads && (assignments?.kind !== "BUILT" || reads.billingScopes === null || reads.billingHolds === null)) {
    log("published with incomplete control-plane inputs; the standing runner will retry");
    process.exitCode = 1;
  }
}

await main();
