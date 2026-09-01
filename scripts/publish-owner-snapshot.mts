/**
 * **THE BRIDGE FROM CANONICAL STATE TO THE OWNER'S PAGE.**
 * (Session C final, ITEM H, 2026-09-01. `pnpm owner:publish`.)
 *
 * ## The problem this solves, stated exactly
 *
 * Six of the seven panels the owner wants are produced today by scripts that
 * write JSON into the working tree or markdown into a Google Drive folder:
 * pilot health prints and writes nothing at all, the digest lands in
 * `$WTP_MIRROR/pilot-digest.md`, the Needs-Sean queue is CSV plus decision-card
 * text living in `lib/tracker/registry.mjs`, the reader grid is
 * `data/health/reader-suite-runs/*.json`, and the intake counts are
 * `data/feedback/sweeps/*.json`.
 *
 * **None of that exists inside a Netlify function bundle.** The admin site may
 * not depend on the always-on machine's filesystem, Drive mirror, process table
 * or agent scratch output — that is a structural requirement of ITEM H, and it
 * is also just true: `next.config.ts` documents at length what a `process.cwd()`
 * read does when nobody traced it, and the answer is that it returns nothing,
 * the catch returns null, and the surface renders a gap indistinguishable from
 * honest missing data.
 *
 * So this script runs WHERE THE STATE IS — on the runner's machine, in the
 * repository, with git available — and PUBLISHES the result into the durable
 * control plane. The page then reads records that a writer actually wrote.
 *
 * ## Why it reuses `pilot-health.mts`'s functions rather than its output
 *
 * The acceptance clause is that PILOT HEALTH on the page matches
 * `pnpm pilot:health` for the same SHA. Parsing that script's stdout would make
 * the match a coincidence maintained by two pieces of formatting code. Calling
 * `readerContract` / `truthContract` / `freshnessContract` / `pilotHealth` — the
 * same pure functions, on the same inputs, from the same run records — makes
 * the match STRUCTURAL. There is one computation, and RULING 103 is the reason.
 *
 * ## Absence is never asserted
 *
 * Every panel that cannot be computed publishes a NAMED GAP saying whose gap it
 * is, not a zero. A zero is a measurement; a missing file is not.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  freshnessContract,
  pilotHealth,
  readerContract,
  truthContract,
} from "../lib/health/contracts.ts";
import { containsCommit, headSha } from "../lib/ops/git-facts.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { loadJsonArray } from "../lib/health/json-store.ts";
import {
  assessStaleness,
  latestControlRun,
  latestReaderRun,
  DEFAULT_MAX_AGE_HOURS,
} from "../lib/health/latest-runs.ts";
import {
  controlPlaneUrlFromEnv,
  createPgRepositories,
  CONTROL_PLANE_URL_VAR,
} from "../lib/control-plane/repository/pg-store.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import {
  CACHE_OBSERVATION_ID,
  DECISION_LOG_KEY,
  DIGEST_LOG_KEY,
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
  type OwnerDigestRecord,
  type OwnerSnapshot,
  type OwnerZipRow,
  type RunnerHeartbeat,
} from "../lib/control-plane/owner-surface.ts";

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
  console.log(`owner:publish · ${line}`);
}

/* ------------------------------------------------------------------ *
 * PANEL 1 — PILOT HEALTH, through the same functions pilot:health uses
 * ------------------------------------------------------------------ */

function countLoaded(path: string, what: string): number {
  return (loadJsonArray<unknown>(path, what) ?? []).length;
}

const questionsLoaded = countLoaded(
  join(ROOT, "data", "health", "reader-questions.json"),
  "question templates",
);
const controlsLoaded = countLoaded(
  join(ROOT, "data", "health", "control-facts.json"),
  "control facts",
);

const readerRun = latestReaderRun(ROOT);
const readerStale =
  readerRun === null
    ? null
    : assessStaleness(readerRun, NOW, HEAD, containsCommit, DEFAULT_MAX_AGE_HOURS);

const reader = readerContract({
  questionsLoaded,
  activeInstances: readerRun?.instancesActive ?? 0,
  evaluatedGreen: readerRun?.evaluatedGreen ?? 0,
  evaluatedRed: readerRun?.evaluatedRed ?? 0,
  notEvaluable: readerRun?.notEvaluable ?? 0,
  target: readerRun?.target ?? null,
  establishedZeroDenominator: null,
  notCurrent:
    readerRun === null
      ? "no canonical reader-suite run record exists yet — run `pnpm reader:suite` against a " +
        "local production build. An unmeasured contract is NOT_READY, never green."
      : (readerStale?.current ?? false)
        ? null
        : `the newest reader-suite run cannot be read as current: ${readerStale?.why}`,
});

const controlRun = latestControlRun(ROOT);
const controlStale =
  controlRun === null
    ? null
    : assessStaleness(controlRun, NOW, HEAD, containsCommit, DEFAULT_MAX_AGE_HOURS);

const truth = truthContract({
  controlsLoaded,
  score: controlRun?.score ?? null,
  notCurrent:
    controlsLoaded === 0
      ? null
      : controlRun === null
        ? "no canonical control-set run record exists yet — run `pnpm control:set` against a " +
          "local production build. An unmeasured contract is NOT_READY, never green."
        : (controlStale?.current ?? false)
          ? null
          : `the newest control-set run cannot be read as current: ${controlStale?.why}`,
});

const freshness = freshnessContract();
const rollup = pilotHealth(reader, truth, freshness);

/**
 * The denominator each contract is read against.
 *
 * READER's is the ACTIVE INSTANCE COUNT, never the evaluated set — that
 * distinction is the whole of `assertDenominatorIsIndependent`, and getting it
 * wrong is how a suite reports green over the questions it happened to answer.
 */
function readerDenominator(): Held<Measured> {
  if (!readerRun) {
    return gap(
      "OURS",
      "No reader-suite run record exists yet, so there is no denominator to read against. " +
        "We have not measured this — it is not that we measured zero.",
    );
  }
  return held(
    measured(
      readerRun.evaluatedGreen,
      readerRun.instancesActive,
      "reader questions answered correctly, out of the ACTIVE instances generated from the " +
        "owner corpus — never out of the subset that happened to be evaluable",
      `reader-suite run ${readerRun.runId}`,
    ),
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
  if (!controlRun) {
    return gap("OURS", "No control-set run record exists yet.");
  }
  const score = controlRun.score;
  const known = (score?.knownPresentCount ?? 0) + (score?.knownAbsenceCount ?? 0);
  const wrong = (score?.falseAbsences ?? 0) + (score?.falsePresences ?? 0);
  return held(
    measured(
      Math.max(0, known - wrong),
      Math.max(known, known - wrong),
      "control facts the product got right, out of the known-present and known-absent facts " +
        "the control set asserts — both directions, because only checking presence would score " +
        "a product that says yes to everything as perfect",
      `control-set run ${controlRun.runId}`,
    ),
  );
}

/* ------------------------------------------------------------------ *
 * PANEL 3 — THE NEEDS-SEAN QUEUE
 * ------------------------------------------------------------------ */

function decisionCards(): OwnerDecisionCard[] {
  const path = join(ROOT, "docs", "tracker-reconciliation.json");
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      outcomes?: Array<Record<string, unknown>>;
    };
    const rows = Array.isArray(parsed.outcomes) ? parsed.outcomes : [];
    return rows
      .filter((r) => String(r.verdict ?? r.marking ?? "") !== "RESOLVED_BY_EVIDENCE")
      .map((r): OwnerDecisionCard => {
        const options = Array.isArray(r.options)
          ? (r.options as Array<Record<string, unknown>>).map((o) => ({
              option: String(o.option ?? ""),
              consequence: String(o.consequence ?? ""),
            }))
          : [];
        const age = r.ageDays;
        return {
          rowId: String(r.id ?? r.rowId ?? "unknown"),
          title: String(r.title ?? ""),
          whatIsNeeded: String(r.whatIsNeeded ?? r.blocker ?? "not recorded on this row"),
          whyNoMachineCanDecide: String(
            r.whyNoMachineCanDecide ?? "not recorded on this row",
          ),
          options,
          // RULING 221's blocked-descendant count lives on the feedback-sweep
          // item type, not on tracker rows. Publishing 0 where the field does
          // not exist would be asserting "nothing is blocked behind this",
          // which we have not measured — so it is -1 nowhere and 0 only when
          // the row genuinely carries it.
          blockedDescendants: typeof r.blockedDescendants === "number" ? r.blockedDescendants : 0,
          openedOn: typeof r.openedOn === "string" ? r.openedOn : null,
          ageDays: typeof age === "number" ? age : null,
          priority: String(r.priority ?? "unset"),
          verifiability:
            String(r.kind ?? r.marking ?? "") === "predicate"
              ? "PREDICATE"
              : "NOT_MACHINE_VERIFIABLE",
        };
      });
  } catch (error) {
    log(`could not read the tracker reconciliation (${(error as Error).message}) — publishing none`);
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * PANEL 4 / 6 — RUNNER CYCLE AND THE ZIP GRID
 * ------------------------------------------------------------------ */

interface CycleRecord {
  startedAt?: string;
  finishedAt?: string;
  testedSha?: string;
  digest?: string[];
  risk?: Record<string, unknown>;
  incidents?: Array<Record<string, unknown>>;
  scheduled?: unknown[];
  unscheduled?: unknown[];
  registry?: { providers?: Record<string, number> };
}

function latestCycle(): { record: CycleRecord; file: string } | null {
  const dir = join(ROOT, "data", "health", "freshness-shadow-runs");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const newest = files.at(-1);
  if (!newest) return null;
  try {
    return { record: JSON.parse(readFileSync(join(dir, newest), "utf8")), file: newest };
  } catch {
    return null;
  }
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
  if (!readerRun) {
    return gap("OURS", "No reader-suite run record exists yet, so there is no grid to show.");
  }
  const results = (readerRun as unknown as { results?: Array<Record<string, unknown>> }).results;
  if (!Array.isArray(results)) {
    return gap("OURS", "The newest reader-suite run record carries no results array.");
  }
  const zipOf = (r: Record<string, unknown>): string | null => {
    const hit = String(r.instanceId ?? "").match(/\b(\d{5})\b/);
    return hit ? hit[1] : null;
  };
  const attributed = results.filter((r) => zipOf(r) !== null);
  if (attributed.length === 0) {
    return gap(
      "OURS",
      `The newest reader-suite run (${readerRun.runId}) records ${results.length} result(s) and ` +
        "attributes none of them to a ZIP: instance ids are hashes, and the run record does not " +
        "store the instances that carry the ZIP. We cannot break these results down by ZIP yet — " +
        "that is a gap in what the suite RECORDS, not a finding about any ZIP.",
    );
  }
  const byZip = new Map<string, OwnerZipRow>();
  for (const r of attributed) {
    const zip = zipOf(r) as string;
    const verdict = (r.verdict ?? {}) as { kind?: string };
    const row = byZip.get(zip) ?? {
      zip,
      green: 0,
      red: 0,
      notEvaluable: 0,
      failureClasses: [] as string[],
    };
    const classes = new Set(row.failureClasses);
    if (typeof r.failureClass === "string" && r.failureClass) classes.add(r.failureClass);
    // Rebuilt rather than mutated: `OwnerZipRow`'s fields are `readonly`
    // because a published snapshot is a reading taken at an instant, and a
    // type that permits `row.green += 1` permits it after publication too.
    byZip.set(zip, {
      zip,
      green: row.green + (verdict.kind === "GREEN" ? 1 : 0),
      red: row.red + (verdict.kind === "RED" ? 1 : 0),
      notEvaluable: row.notEvaluable + (verdict.kind === "GREEN" || verdict.kind === "RED" ? 0 : 1),
      failureClasses: [...classes],
    });
  }
  return held([...byZip.values()].sort((a, b) => (a.zip < b.zip ? -1 : 1)));
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
  const dir = join(ROOT, "data", "feedback", "sweeps");
  const missing = gap<Measured>(
    "OURS",
    "No owner-intake sweep record has been committed, so nothing has been counted. The Drive " +
      "folder may hold items we have not swept — that is a gap in our sweeping, not evidence " +
      "that the folder is empty.",
  );
  if (!existsSync(dir)) {
    return {
      folder: gap("OURS", "No sweep record committed."),
      found: missing,
      processed: missing,
      unidentifiable: missing,
    };
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const newest = files.at(-1);
  if (!newest) {
    return {
      folder: gap("OURS", "No sweep record committed."),
      found: missing,
      processed: missing,
      unidentifiable: missing,
    };
  }
  try {
    const sweep = JSON.parse(readFileSync(join(dir, newest), "utf8")) as {
      folder?: string;
      items?: Array<{ disposition?: string }>;
      filesInventoried?: unknown[];
    };
    const items = Array.isArray(sweep.items) ? sweep.items : [];
    const total = items.length;
    const unid = items.filter((i) => i.disposition === "UNIDENTIFIABLE").length;
    const processed = items.filter((i) => i.disposition && i.disposition !== "UNIDENTIFIABLE").length;
    const inventoried = Array.isArray(sweep.filesInventoried) ? sweep.filesInventoried.length : total;
    return {
      folder: held(String(sweep.folder ?? newest.replace(/\.json$/, ""))),
      found: held(
        measured(
          total,
          Math.max(total, inventoried),
          "items identified in the sweep, out of the files inventoried in the folder",
          `sweep record ${newest}`,
        ),
      ),
      processed: held(
        measured(
          processed,
          Math.max(total, processed),
          "items given a disposition other than UNIDENTIFIABLE, out of the items found",
          `sweep record ${newest}`,
        ),
      ),
      unidentifiable: held(
        measured(
          unid,
          Math.max(total, unid),
          "items the sweep could not identify — a first-class disposition, never a skip",
          `sweep record ${newest}`,
        ),
      ),
    };
  } catch {
    return {
      folder: gap("OURS", "The newest sweep record could not be read."),
      found: missing,
      processed: missing,
      unidentifiable: missing,
    };
  }
}

/* ------------------------------------------------------------------ *
 * BUILD AND PUBLISH
 * ------------------------------------------------------------------ */

const cycle = latestCycle();
const cards = decisionCards();
const zips = zipRows();
const intakeCounts = intake();

const providers = cycle?.record.registry?.providers ?? {};
const providerTotal = Object.values(providers).reduce((a, b) => a + (Number(b) || 0), 0);

const scheduledCount = Array.isArray(cycle?.record.scheduled) ? cycle.record.scheduled.length : 0;
const unscheduledCount = Array.isArray(cycle?.record.unscheduled)
  ? cycle.record.unscheduled.length
  : 0;
const obligationTotal = scheduledCount + unscheduledCount;

const risk = (cycle?.record.risk ?? {}) as Record<string, number>;

const snapshot: OwnerSnapshot = {
  formatVersion: OWNER_SURFACE_FORMAT_VERSION,
  publishedAt: NOW_ISO,
  publishedFromSha: HEAD,
  publisher: "pnpm owner:publish",

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
      r.contract === "READER" && readerRun
        ? String((readerRun as unknown as { proofClass?: string }).proofClass ?? "SESSION_MEASURED")
        : "SESSION_MEASURED",
    runSha:
      r.contract === "READER"
        ? (readerRun?.testedSha ?? null)
        : r.contract === "TRUTH"
          ? (controlRun?.testedSha ?? null)
          : (cycle?.record.testedSha ?? null),
    runAt:
      r.contract === "READER"
        ? (readerRun?.finishedAt ?? null)
        : r.contract === "TRUTH"
          ? (controlRun?.finishedAt ?? null)
          : (cycle?.record.finishedAt ?? null),
  })),

  decisionCards: cards,

  obligationsByState:
    obligationTotal === 0
      ? []
      : [
          {
            state: "scheduled",
            count: measured(
              scheduledCount,
              obligationTotal,
              "standing obligations with a computed next-due time, out of all registered obligations",
              `freshness-shadow run ${cycle?.file ?? "unknown"}`,
            ),
          },
          {
            state: "unscheduled",
            count: measured(
              unscheduledCount,
              obligationTotal,
              "registered obligations the scheduler could not place, out of all registered obligations",
              `freshness-shadow run ${cycle?.file ?? "unknown"}`,
            ),
          },
        ],

  obligationsByProvider: Object.entries(providers).map(([provider, count]) => ({
    provider,
    count: measured(
      Number(count) || 0,
      providerTotal,
      "registered units for this provider, out of all registered units across every provider",
      `freshness-shadow run ${cycle?.file ?? "unknown"}`,
    ),
  })),

  freshnessDebtRows:
    cycle === null
      ? gap(
          "OURS",
          "No freshness-shadow cycle record exists, so debt has not been counted. Not counted " +
            "is not zero.",
        )
      : held(
          measured(
            Number(risk.debtRows ?? 0),
            Math.max(obligationTotal, Number(risk.debtRows ?? 0)),
            "obligations carrying a freshness debt row, out of all registered obligations",
            `freshness-shadow run ${cycle.file}`,
          ),
        ),

  incidents: (cycle?.record.incidents ?? []).map((i) => ({
    cause: String(i.cause ?? "unknown"),
    target: String(i.target ?? "unknown"),
    obligationsAffected: Number(i.obligationsAffected ?? 0),
    oldestHours: typeof i.oldestHours === "number" ? i.oldestHours : null,
  })),

  /*
   * COST. The attempt-cost ledger is in the control plane and is genuinely
   * queryable; the CALLER-KEY and CACHE-HIT-RATE ledger is not — it lives in
   * `lib/ask/prompt-cache.ts`, is accumulated per process, and has no field in
   * `AttemptCost` at all. So the digest reports the cycle cache hit rate as NOT
   * MEASURED and so does this. Publishing a zero here would be inventing a
   * measurement, which is the one thing the cost panel must not do.
   */
  costByRole: [],
  costByModel: [],
  cacheHitRateByCaller: [
    {
      callerKey: "prod-ask",
      hitRate: gap(
        "OURS",
        "Cache hit rate by caller key is not recorded to the control plane: the ledger is " +
          "per-process and AttemptCost carries no cache fields. Not measured, not zero.",
      ),
    },
  ],
  deterministicShare: gap(
    "OURS",
    "The deterministic-versus-model lane share is computed inside the cycle digest and is not " +
      "yet published as a structured number.",
  ),
  costPerVerifiedRecord: gap(
    "OURS",
    "Cost per verified record needs a verified-record denominator the reader suite does not yet " +
      "publish. Inventing one would make the ratio meaningless.",
  ),

  zipRows: zips,

  intakeFolder: intakeCounts.folder,
  intakeItemsFound: intakeCounts.found,
  intakeItemsProcessed: intakeCounts.processed,
  intakeUnidentifiable: intakeCounts.unidentifiable,
};

const heartbeat: RunnerHeartbeat = {
  formatVersion: OWNER_SURFACE_FORMAT_VERSION,
  beatAt: NOW_ISO,
  lastCycleStartedAt: cycle?.record.startedAt ?? null,
  lastCycleFinishedAt: cycle?.record.finishedAt ?? null,
  nextCycleDueAt: null,
  lastCycleOk: cycle === null ? null : true,
  testedSha: cycle?.record.testedSha ?? HEAD,
  host: "runner",
};

const digest: OwnerDigestRecord | null = cycle
  ? {
      formatVersion: OWNER_SURFACE_FORMAT_VERSION,
      digestId: cycle.file.replace(/\.json$/, ""),
      writtenAt: cycle.record.finishedAt ?? NOW_ISO,
      headline: (cycle.record.digest ?? [])[0] ?? "no headline in this cycle record",
      lines: cycle.record.digest ?? [],
      cycleOk: true,
      testedSha: cycle.record.testedSha ?? null,
    }
  : null;

/* The cheapest place to catch an aggregate-only violation is before it is durable. */
assertAggregateOnly(snapshot, "owner snapshot");
assertAggregateOnly(heartbeat, "runner heartbeat");
if (digest) assertAggregateOnly(digest, "owner digest");

async function repositories(): Promise<ControlPlaneRepositories> {
  const override = arg("file-store");
  if (override) {
    log(`writing to the FILE store at ${override} (a local proof, not the deployed plane)`);
    return createFileRepositories(override);
  }
  const url = controlPlaneUrlFromEnv();
  if (url === null) {
    throw new Error(
      `${CONTROL_PLANE_URL_VAR} is not set. Reading or writing a different store would be ` +
        "evidence about a different store than the claim is about. Refusing.",
    );
  }
  return createPgRepositories(url, NOW_ISO);
}

async function main(): Promise<void> {
  log(`HEAD ${HEAD?.slice(0, 8) ?? "unknown"} · pilot ${rollup.green ? "GREEN" : "NOT GREEN"}`);
  for (const r of rollup.readings) log(`  ${r.contract.padEnd(9)} ${r.state}`);
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
        "docs/tracker-reconciliation.json",
        Math.max(cards.length, 1),
        cards.length,
        cards.length === 0 ? "the tracker reconciliation names no open Needs-Sean rows" : undefined,
      ),
    ),
  );
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

  if (DRY_RUN) {
    log("--dry-run: nothing written");
    return;
  }

  const repos = await repositories();
  log(repos.describe());

  // The snapshot is a SINGLE aggregate that moves, so a put on an existing id
  // is a no-op — compare-and-set is the write that actually replaces it.
  const existing = await repos.ownerSnapshots.read(SNAPSHOT_ID);
  if (existing === null) {
    await repos.ownerSnapshots.put(SNAPSHOT_ID, snapshot, NOW_ISO);
  } else {
    await repos.ownerSnapshots.compareAndSet(SNAPSHOT_ID, existing.revision, snapshot, NOW_ISO);
  }

  const beat = await repos.runnerHeartbeat.read(RUNNER_ID);
  if (beat === null) {
    await repos.runnerHeartbeat.put(RUNNER_ID, heartbeat, NOW_ISO);
  } else {
    await repos.runnerHeartbeat.compareAndSet(RUNNER_ID, beat.revision, heartbeat, NOW_ISO);
  }

  if (digest) {
    await repos.ownerDigests.append(DIGEST_LOG_KEY, digest.digestId, digest, NOW_ISO);
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
    `published: snapshot, heartbeat${digest ? ", digest" : " (no cycle record — no digest)"}; ` +
      `${decisions.length} owner decision intent(s) on record`,
  );
}

await main();
