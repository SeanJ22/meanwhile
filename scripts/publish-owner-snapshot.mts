/**
 * **THE BRIDGE FROM CANONICAL STATE TO THE OWNER'S PAGE.**
 * (Session C final, ITEM H, 2026-09-01; now an admitted standing-runtime child.)
 *
 * ## The problem this solves, stated exactly
 *
 * The deployed Admin site cannot depend on the standing machine's filesystem,
 * process table, or scratch output. This admitted standing-runtime child reads
 * canonical control-plane state and explicitly classified, release-pinned
 * software acceptance/governance inputs, then publishes one durable owner
 * snapshot directly to that same control plane. Mutable civic and operational
 * truth never arrives through a tracked file or a Git commit. Historical
 * software run outputs and feedback sweeps are not projected as current. The
 * page reads the one record this production writer wrote.
 *
 * ## Why it uses the shared pure health-contract functions
 *
 * PILOT HEALTH on the page is computed by `readerContract` / `truthContract` /
 * `freshnessContract` / `pilotHealth`, directly from its named inputs. The
 * tracked-health CLI that once repeated this projection is retired: Admin and
 * canonical runtime receipts are the owner-facing operational authority.
 *
 * ## Absence is never asserted
 *
 * Every panel that cannot be computed publishes a NAMED GAP saying whose gap it
 * is, not a zero. A zero is a measurement; a missing file is not.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";

import {
  freshnessContract,
  freshnessRiskOf,
  pilotHealth,
  readerContract,
  truthContract,
} from "../lib/health/contracts.ts";
import { headSha } from "../lib/ops/git-facts.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { loadJsonArray } from "../lib/health/json-store.ts";
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
import { buildChecklistCensus, exactScopeMembers } from "../lib/control-plane/readiness/checklist-census.ts";
import { CHECKLIST_INDEX_ENABLED_VAR, publishChecklistIndexAfterSnapshot } from "../lib/control-plane/admin-view/checklist-index-publisher.ts";
import { isFundedHunt } from "../lib/control-plane/scheduler/hunt-continuation.ts";
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
  type OwnerDecisionCard,
  type OwnerSnapshot,
  type RunnerHeartbeat,
  type OwnerZipRow,
} from "../lib/control-plane/owner-surface.ts";
import { buildDecisionCards } from "../lib/control-plane/decision-cards.ts";
import { buildCostPanel, buildSpendByPlace } from "../lib/control-plane/cost-panel.ts";
import { buildDeliveryTrail } from "../lib/control-plane/delivery-trail.ts";
import { collectPublishedCampaignReadback, collectPublishedWorkerReadback, collectPublishedManualReaderReadback } from "../lib/control-plane/served-reader-production.ts";
import type { ServedReaderReadback } from "../lib/control-plane/served-reader.ts";
import { buildAssignmentView, type AssignmentPublication, type AssignmentSources } from "../lib/control-plane/assignment-view.ts";
import { ASSIGNMENT_ATTEMPT_PROJECTION, ASSIGNMENT_OBLIGATION_PROJECTION, readAllAssignmentSources } from "../lib/control-plane/assignment-read.ts";
import { readPipelineStates, stageCounts } from "../lib/control-plane/promotion/pipeline.ts";
import { readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import { PILOT_ZIPS } from "../lib/health/owner-corpus-compile.ts";
import { RESEARCH_STATE_ID } from "../lib/control-plane/scheduler/research-policy.ts";
import { unitCarriesState } from "../lib/control-plane/scheduler/dispatch-target.ts";
import { US_STATES } from "../lib/control-plane/readiness/catalog.ts";
import { REGISTRY } from "../lib/tracker/registry.mjs";
import { readStore, WORKING_CSV } from "./tracker-core.mjs";
import { today } from "./doc-dates.mjs";
import { assertRuntimeAuthority } from "../lib/civic-data/runtime-authority.ts";

const ROOT = process.cwd();
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

/* ------------------------------------------------------------------ *
 * PANEL 1 — PILOT HEALTH, through the shared pure health contracts
 * ------------------------------------------------------------------ */

function countLoaded(path: string, what: string): number {
  return (loadJsonArray<unknown>(path, what) ?? []).length;
}

/*
 * TRACKED-INPUT CLASSIFICATION (PDC terminal census, 2026-09-09).
 *
 * These two JSON files are release-pinned acceptance corpora: owner-authored
 * software contract INPUTS, not observations written by a routine process.
 * It is safe to count their denominator from the immutable installed release.
 *
 * The adjacent `reader-suite-runs/` and `control-set-runs/` directories are a
 * different class: historical outputs of local software instruments. A
 * standing publisher that selects the newest tracked output and republishes it
 * as present health makes Git the live evidence store and can misattribute an
 * unrelated software result to runtime civic data. Those directories are
 * intentionally not read here; software certification remains in software CI.
 */
const questionsLoaded = countLoaded(
  join(ROOT, "data", "health", "reader-questions.json"),
  "question templates",
);
const controlsLoaded = countLoaded(
  join(ROOT, "data", "health", "control-facts.json"),
  "control facts",
);

const reader = readerContract({
  questionsLoaded,
  activeInstances: 0,
  evaluatedGreen: 0,
  evaluatedRed: 0,
  notEvaluable: 0,
  target: null,
  establishedZeroDenominator: null,
  notCurrent:
    "Reader/UI certification is software evidence, not a routine data-plane observation. " +
    "This runtime publisher does not read tracked local suite outputs; the software CI/release " +
    "surface must supply a canonical release receipt before this contract can be current here.",
});

const truth = truthContract({
  controlsLoaded,
  score: null,
  notCurrent: controlsLoaded === 0
    ? null
    : "Truth/control-set certification is software evidence, not a routine data-plane " +
      "observation. This runtime publisher does not read tracked local run outputs; an " +
      "unmeasured software contract is NOT_READY, never green.",
});

/*
 * FRESHNESS reads the newest canonical cycle's MEASURED risk (9.4.26). The
 * projection below stays in the shared `freshnessRiskOf` module so the page
 * cannot grow a second interpretation of the durable runtime receipt.
 */
const publisherRepos = await repositories();
const canonicalCycle = publisherRepos === null ? null : await readLatestFreshnessCycleOutcome(publisherRepos);
const newestCycle: { record: CycleRecord; file: string } | null = canonicalCycle
  ? { record: canonicalCycle.outcome as unknown as CycleRecord, file: canonicalCycle.digest.digestId }
  : null;
const freshness = freshnessContract(freshnessRiskOf(newestCycle?.record ?? null));
const rollup = pilotHealth(reader, truth, freshness);

/**
 * The denominator each contract is read against.
 *
 * READER's is the ACTIVE INSTANCE COUNT, never the evaluated set — that
 * distinction is the whole of `assertDenominatorIsIndependent`, and getting it
 * wrong is how a suite reports green over the questions it happened to answer.
 */
function readerDenominator(): Held<Measured> {
  return gap(
    "OURS",
    "Reader certification belongs to the exact software release receipt. The standing " +
      "data-plane publisher refuses to promote a tracked local suite output into live health.",
  );
}

function truthDenominator(): Held<Measured> {
  if (controlsLoaded === 0) {
    return gap(
      "OURS",
      "No control facts have been supplied yet, so the truth contract has nothing to score " +
        "against. This is awaiting owner data, not a failing measurement.",
    );
  }
  return gap(
    "OURS",
    "Control-set certification belongs to the exact software release receipt. The standing " +
      "data-plane publisher refuses to promote a tracked local run output into live health.",
  );
}

/* ------------------------------------------------------------------ *
 * PANEL 3 — THE NEEDS-SEAN QUEUE
 * ------------------------------------------------------------------ */

/**
 * ADM-4 (9.4.26): the cards are the JOIN of the working store (title,
 * priority, opened date), the RULING 271 registry (what is needed, why no
 * machine can decide it, the options) and the reconciliation outcomes (what
 * the last generation found for a predicated row) — the same join
 * `docs/tracker-owner-view.md` makes. Before this the publisher read the
 * reconciliation file alone, which carries none of those fields, and every
 * card rendered its unrecorded fallback with no buttons.
 *
 * PDC classification: `docs/tracker-working.csv`, the generated reconciliation
 * and `lib/tracker/registry.mjs` are release-pinned SOFTWARE GOVERNANCE inputs.
 * They may change only through a reviewed software/governance commit and do
 * not claim that a civic source ran, changed, promoted, failed, or stayed
 * fresh. They therefore remain distinct from mutable routine operational
 * truth. No standing child writes them.
 */
function decisionCards(): OwnerDecisionCard[] {
  let rows: Readonly<Record<string, string>>[];
  try {
    rows = readStore(WORKING_CSV, ROOT) as Readonly<Record<string, string>>[];
  } catch (error) {
    log(`could not read ${WORKING_CSV} (${(error as Error).message}) — publishing no cards`);
    return [];
  }
  let outcomes: { rowId: string; kind: string; verdict: string; why: string }[] = [];
  const reconciliation = join(ROOT, "docs", "tracker-reconciliation.json");
  if (existsSync(reconciliation)) {
    try {
      const parsed = JSON.parse(readFileSync(reconciliation, "utf8")) as { outcomes?: unknown };
      if (Array.isArray(parsed.outcomes)) {
        outcomes = parsed.outcomes as { rowId: string; kind: string; verdict: string; why: string }[];
      }
    } catch (error) {
      log(`could not read the tracker reconciliation (${(error as Error).message}) — cards carry no recheck`);
    }
  }
  return buildDecisionCards({
    rows,
    registry: REGISTRY as Parameters<typeof buildDecisionCards>[0]["registry"],
    outcomes,
    stamp: today(NOW),
  });
}

/**
 * **A CANDIDATE IS NAMED FROM THE RECORD, NEVER FROM A SLUG.** (ADM-12, the
 * 9.4.26 evening feedback.)
 *
 * Candidate display names are civic data. The legacy snapshot copy is retired:
 * current names belong to the canonical candidate-profile projection and may
 * not be republished into this operational snapshot as a second ledger.
 */
function candidateNames(): Record<string, string> {
  return {};
}

/** Measured spend per Eastern calendar day over the trailing fortnight (ADM-17). */
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

/* ------------------------------------------------------------------ *
 * PANEL 4 / 6 — RUNNER CYCLE AND THE ZIP GRID
 * ------------------------------------------------------------------ */

/**
 * The run record's REAL shapes, as `scripts/freshness-shadow.mts` writes them
 * (9.4.26 fix): `scheduled` is a NUMBER, `unscheduled` an array of named
 * units, `registry.providers` an ARRAY of provider rows carrying `units`, and
 * `registry.registeredUnits` the whole denominator. The previous interface
 * guessed at these and produced an empty "by state" panel, five "0 of 0"
 * provider rows keyed 0..4, and a debt figure of "180 of 180".
 */
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

/**
 * The per-ZIP grid, or the named gap where it would be.
 *
 * **Measured 2026-09-01: the reader-suite run record does not attribute its
 * results to ZIPs.** `InstanceResult` carries `instanceId` (a hash, of the form
 * `rq:` followed by hex), `questionText`, `verdict` and `failureClass`; the ZIP
 * lives on the ReaderQuestionInstance, which the run record does not store.
 * Reconstructing it would mean re-running `generateInstances` here and MATCHING
 * BY HASH against a record written by another process at another SHA — and a
 * mismatch would surface as a confidently wrong grid rather than as an error.
 *
 * So the grid is a GAP, and the gap says why. A single row labelled
 * "unattributed" holding all seven results would have looked exactly like a
 * measurement, which is the failure this whole module is built to refuse.
 */
function zipRows(): Held<readonly OwnerZipRow[]> {
  return gap(
    "OURS",
    "The ZIP-by-ZIP reader check is software certification. Its historical tracked run " +
      "records are not live operational truth and this standing publisher will not read or " +
      "republish them. A canonical exact-release certification projection is not wired here.",
  );
}

/* ------------------------------------------------------------------ *
 * PANEL 7 — OWNER INTAKE
 * ------------------------------------------------------------------ */

function intake(): {
  folder: Held<string>;
  found: Held<Measured>;
  processed: Held<Measured>;
  unidentifiable: Held<Measured>;
} {
  /*
   * `data/feedback/sweeps/*` is immutable engineering evidence of completed
   * feedback audits. Selecting its lexically newest file and calling that the
   * current intake state made a historical Git artifact look like a live
   * operational reading. The permanent intake observer already appends exact
   * production outcomes to ownerDigests and `/admin/feedback` consumes them;
   * this legacy duplicate projection is therefore an explicit gap, not a
   * second ledger and not a synthetic zero.
   */
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

/* ------------------------------------------------------------------ *
 * BUILD AND PUBLISH
 * ------------------------------------------------------------------ */

const cycle = newestCycle;
const cards = decisionCards();
const zips = zipRows();
const intakeCounts = intake();

/*
 * The run record's registry rows (9.4.26). `registeredUnits` is the whole
 * denominator the cycle scheduled over; each provider row carries its own
 * `units`. The old publisher treated the array as a Record<string, number>
 * and published five "0 of 0" rows keyed "0".."4".
 */
const providerRows = Array.isArray(cycle?.record.registry?.providers) ? cycle.record.registry.providers : [];
const registeredUnits =
  typeof cycle?.record.registry?.registeredUnits === "number"
    ? cycle.record.registry.registeredUnits
    : providerRows.reduce((n, p) => n + (typeof p.units === "number" ? p.units : 0), 0);
const cycleSource = `freshness-shadow run ${cycle?.file ?? "unknown"}`;

/**
 * What the control plane holds, read once so every cost row and the by-state
 * deployment come from ONE instant. Null when the store was not opened (a
 * dry run without a store): every dependent panel then publishes its named
 * gap rather than a zero.
 */
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
  /** The full pipeline states, kept for the delivery trail (not thrown away after the VERIFIED count). */
  readonly pipelineStates: Awaited<ReturnType<typeof readPipelineStates>>;
  /**
   * Every record the assignment view joins, read at this same instant, or the
   * named reason it could not be read (the view then publishes as NOT_BUILT,
   * never as an empty list).
   */
  readonly assignmentSources: { readonly ok: true; readonly value: AssignmentSources } | { readonly ok: false; readonly says: string };
}

async function readControlPlane(repos: ControlPlaneRepositories): Promise<ControlPlaneReads> {
  const runnerHeartbeat = await repos.runnerHeartbeat.read(RUNNER_ID).then(row=>row?.value??null).catch(()=>null);
  const [billingScopes, billingHolds] = await Promise.all([
    repos.adminConfig.read(ADMIN_CONFIG_ID).then(r => { const parsed = expansionScopesOf(r?.value ?? null); return parsed.malformed ? null : parsed.scopes; }).catch(() => null),
    repos.budget.read().then(r => r.value.spendHolds ?? {}).catch(() => null),
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
    log(`the promotion pipeline could not be read (${(error as Error).message}) — cost per verified record and the delivery trail are gaps`);
  }
  let assignmentSources: ControlPlaneReads["assignmentSources"];
  try {
    assignmentSources = {
      ok: true,
      value: await readAllAssignmentSources(
        repos,
        { nowIso: NOW_ISO, activation: readActivationGate(process.cwd()), pilotZips: PILOT_ZIPS },
        {
          costs,
          attempts: attempts.map((a) => a.value),
          obligations: obligations.map((o) => o.value),
          // A pipeline that could not be read is a named gap on every assignment, never "nothing offered".
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

/**
 * The assignment view as the snapshot carries it: BUILT over the records read
 * at this publish's instant, or NOT_BUILT with the named reason.
 */
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

/**
 * Standing obligations by STATE, from the control plane's own obligation
 * ids (9.4.26). This is the one per-state deployment figure the console has;
 * an obligation naming no state lands in "other", named, never dropped.
 */
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
        /*
         * §9A.23 and §9A.4: the capacity reading and the UTC monthly window
         * each need an instant, and the cost panel may not read a clock for
         * itself. The publisher has one — this publish's own — so it hands it
         * over. Without it both figures publish as null and the console says
         * the publisher is not wired, which was true until now.
         */
        nowIso: NOW_ISO,
      })
    : null;
  const notOpened = gap<Measured>("OURS", "not read — the control plane was not opened for this publish.");

  return {
    formatVersion: OWNER_SURFACE_FORMAT_VERSION,
    publishedAt: NOW_ISO,
    publishedFromSha: HEAD,
    publisher: "pilot-runner/console-publisher",

    pilotGreen: rollup.green,
    contracts: rollup.readings.map((r) => ({
      contract: r.contract,
      state: r.state,
      reason: r.reason,
      denominator:
        r.contract === "READER"
          ? readerDenominator()
          : r.contract === "TRUTH"
            ? truthDenominator()
            : gap<Measured>(
                "OURS",
                "The freshness contract is NOT_READY by construction while the scheduler is in " +
                "shadow: it has a risk reading, not a denominator it can be scored against.",
              ),
      proofClass:
        r.contract === "FRESHNESS"
          ? "CANONICAL_RUNTIME_RECEIPT"
          : "NOT_PROJECTED_FROM_TRACKED_SOFTWARE_RUN",
      runSha: r.contract === "FRESHNESS" ? (cycle?.record.testedSha ?? null) : null,
      runAt: r.contract === "FRESHNESS" ? (cycle?.record.finishedAt ?? null) : null,
    })),

    decisionCards: cards,
    candidateNames: candidateNames(),
    spendByDay: spendByDay(reads),
    spendByPlace: reads ? buildSpendByPlace(reads.costs) : undefined,
    deliveryTrail: reads
      ? buildDeliveryTrail(reads.pipelineStates, {
          activation: readActivationGate(process.cwd()),
          servedReader,
          now: NOW_ISO,
          costSummary: cost ? cost.summary : null,
          costPerVerifiedRecord: cost ? cost.costPerVerifiedRecord : notOpened,
        })
      : undefined,
    // The assignment view: whole-universe counts and a bounded, ordered list (absent when the store was not opened).
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

    /*
     * COST (ADM-6, 9.4.26): read from the control plane's own ledger,
     * attempts, research metrics and promotion pipeline, joined in
     * `lib/control-plane/cost-panel.ts`. A store that was not opened publishes
     * a named gap per row rather than an empty list — an empty list rendered
     * as a heading over nothing, which reads as "nothing to report".
     */
    costByRole: cost ? cost.costByRole : [{ key: "every role", usd: notOpened, attemptsMeasured: 0, attemptsUnmeasured: 0 }],
    costByModel: cost ? cost.costByModel : [{ key: "every model", usd: notOpened, attemptsMeasured: 0, attemptsUnmeasured: 0 }],
    cacheHitRateByCaller: cost ? cost.cacheHitRateByCaller : [{ callerKey: "every caller", hitRate: notOpened }],
    deterministicShare: cost ? cost.deterministicShare : notOpened,
    costPerVerifiedRecord: cost ? cost.costPerVerifiedRecord : notOpened,
    costSummary: cost ? cost.summary : undefined,
    /* §9A.4 capacity and §9A.23 monthly spend, both dated by this publish. */
    costCapacity: cost ? cost.capacity : null,
    monthlySpend: cost ? cost.monthlySpend : null,

    zipRows: zips,

    intakeFolder: intakeCounts.folder,
    intakeItemsFound: intakeCounts.found,
    intakeItemsProcessed: intakeCounts.processed,
    intakeUnidentifiable: intakeCounts.unidentifiable,
  };
}

/*
 * THE HEARTBEAT IS THE RUNNER'S TO WRITE, AND ONLY THE RUNNER'S (ADM-5,
 * 9.4.26). This publisher used to overwrite `pilot-runner` with beatAt = the
 * publish moment, so the former hand-run publisher made a stopped runner
 * read ALIVE for ninety minutes. Liveness is derived from the beat; a beat
 * the runner did not write is a false liveness. It is not written here.
 */

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
  // Bound each Neon request. This child reads every record the assignment view
  // joins, several hundred pages; without a deadline one hung request holds it
  // until the runner's 5-minute publisher ceiling kills the whole publish.
  installNeonRequestDeadline();
  return createPgRepositories(url, NOW_ISO);
}

async function main(): Promise<void> {
  log(`HEAD ${HEAD?.slice(0, 8) ?? "unknown"} · pilot ${rollup.green ? "GREEN" : "NOT GREEN"}`);
  for (const r of rollup.readings) log(`  ${r.contract.padEnd(9)} ${r.state}`);

  // Opened FIRST so the cost panel and the by-state deployment read the same
  // instant the snapshot is stamped with.
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
  const checklists = reads?.billingScopes?.filter(isFundedHunt)
    .map(scope => buildChecklistCensus({ scope,
    sources: reads.assignmentSources.ok ? { ...reads.assignmentSources.value, servedReader } : null,
    observedAt: NOW_ISO, heartbeat: reads.runnerHeartbeat,
    previous: existing?.value.checklists?.find(row => row.scopeId === scope.key) }))
    ?? existing?.value.checklists?.map(row => ({ ...row, readsComplete: false }));
  const snapshot: OwnerSnapshot = { ...buildSnapshot(reads, maptiler, servedReader), providerBilling, billingAttribution, checklists };

  /* The cheapest place to catch an aggregate-only violation is before it is durable. */
  assertAggregateOnly(snapshot, "owner snapshot");

  /*
   * RULING 159. Every count printed here carries its population, and a ZERO is
   * only printable when it was EARNED — when the population was actually
   * measured. A ZIP grid we could not attribute at all is COULD_NOT_ASSERT, not
   * "0 ZIP rows", because those two sentences send a reader to different halves
   * of the problem.
   */
  log(floorLine(floored("contracts", "the pilot-health rollup", 3, snapshot.contracts.length)));
  log(
    floorLine(
      floored(
        "decision cards",
        `open Needs-Sean rows in ${WORKING_CSV}`,
        Math.max(cards.length, 1),
        cards.length,
        cards.length === 0 ? "the working store holds no open Needs-Sean row" : undefined,
      ),
    ),
  );
  const decisionKinds = cards.reduce<Record<string, number>>((acc, c) => {
    acc[c.kind ?? "DECISION"] = (acc[c.kind ?? "DECISION"] ?? 0) + 1;
    return acc;
  }, {});
  log(`  card kinds: ${Object.entries(decisionKinds).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`);
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

  // The snapshot is a SINGLE aggregate that moves, so a put on an existing id
  // is a no-op — compare-and-set is the write that actually replaces it.
  const persistedSnapshot = existing === null
    ? (await repos.ownerSnapshots.put(SNAPSHOT_ID, snapshot, NOW_ISO)).persisted
    : await repos.ownerSnapshots.compareAndSet(SNAPSHOT_ID, existing.revision, snapshot, NOW_ISO);
  // Only a successfully persisted revision may be indexed. This optional private
  // projection cannot fail the authoritative snapshot or the normal cycle.
  if (process.env[CHECKLIST_INDEX_ENABLED_VAR] === "1") {
    let indexState: string;
    try {
      const url = controlPlaneUrlFromEnv();
      const result = await publishChecklistIndexAfterSnapshot({ enabled: true, persisted: persistedSnapshot,
        sql: url === null ? null : neon(url) });
      indexState = result.state === "FAILED" ? `${result.state}:${result.code}` : result.state;
    } catch {
      indexState = "FAILED:INDEX_CONNECT_UNAVAILABLE";
    }
    log(`  checklist index: ${indexState}; snapshot revision ${persistedSnapshot.revision}`);
  }

  /*
   * The H1 waiver's standing check. The recorder is NOT wired — production
   * does not write cache observations to the control plane — so the published
   * state says exactly that rather than "not yet observed". Those are
   * different facts and the owner asked for them to stay different.
   */
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
  // A named gap is still published, but a transient failed input read must not
  // become the standing runner's reusable successful publication.
  if (reads && (!reads.assignmentSources.ok || reads.billingScopes === null ||
      reads.billingHolds === null || reads.verifiedRecords === null)) {
    log("published with incomplete control-plane inputs; the standing runner will retry");
    process.exitCode = 1;
  }
}

await main();
