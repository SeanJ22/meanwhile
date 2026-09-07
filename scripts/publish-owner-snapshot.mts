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
  freshnessRiskOf,
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
  latestFreshnessCycle,
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
} from "../lib/control-plane/owner-surface.ts";
import { buildDecisionCards } from "../lib/control-plane/decision-cards.ts";
import { buildCostPanel } from "../lib/control-plane/cost-panel.ts";
import { readPipelineStates, stageCounts } from "../lib/control-plane/promotion/pipeline.ts";
import { RESEARCH_STATE_ID } from "../lib/control-plane/scheduler/research-policy.ts";
import { unitCarriesState } from "../lib/control-plane/scheduler/dispatch-target.ts";
import { US_STATES } from "../lib/control-plane/readiness/catalog.ts";
import { REGISTRY } from "../lib/tracker/registry.mjs";
import { readStore, WORKING_CSV } from "./tracker-core.mjs";
import { today } from "./doc-dates.mjs";

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

/*
 * FRESHNESS reads the newest cycle's MEASURED risk (9.4.26). Both this
 * publisher and `scripts/pilot-health.mts` call the contract the same way, so
 * the page and `pnpm pilot:health` keep matching for the same SHA — that
 * acceptance clause is structural, and it is why the risk projection below
 * is `freshnessRiskOf` in one shared module rather than typed twice.
 */
const newestCycle = latestCycle();
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

/**
 * ADM-4 (9.4.26): the cards are the JOIN of the working store (title,
 * priority, opened date), the RULING 271 registry (what is needed, why no
 * machine can decide it, the options) and the reconciliation outcomes (what
 * the last generation found for a predicated row) — the same join
 * `docs/tracker-owner-view.md` makes. Before this the publisher read the
 * reconciliation file alone, which carries none of those fields, and every
 * card rendered its unrecorded fallback with no buttons.
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
 * The console renders candidacy keys (`…:anderson-jackie-o-donnell`) as the
 * office in words plus the person — and the person's name comes from the
 * committed candidate cards, keyed by the slug the key ends in. A slug cannot
 * give back "O'Donnell", so the page never tries; a slug not in this map
 * renders as the slug, honestly. The map is bounded to the hunts the cards
 * file records (a few hundred rows) and travels on the snapshot.
 */
function candidateNames(): Record<string, string> {
  const path = join(ROOT, "data", "ballot", "candidate-cards-2026.json");
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      hunts?: { key?: string; name?: string }[];
      cards?: Record<string, { name?: string }>;
    };
    const names: Record<string, string> = {};
    const take = (key: string | undefined, name: string | undefined) => {
      if (typeof key !== "string" || typeof name !== "string" || name.trim() === "") return;
      const slug = key.split(":").at(-1)?.trim().toLowerCase();
      if (slug && !(slug in names)) names[slug] = name.trim();
    };
    for (const h of parsed.hunts ?? []) take(h.key, h.name);
    for (const [key, card] of Object.entries(parsed.cards ?? {})) take(key, card?.name);
    return names;
  } catch (error) {
    log(`could not read the candidate cards (${(error as Error).message}) — candidacy keys render by office and slug`);
    return {};
  }
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

/** The newest cycle record, through the shared reader `pnpm pilot:health` also uses. */
function latestCycle(): { record: CycleRecord; file: string } | null {
  const newest = latestFreshnessCycle(ROOT);
  return newest ? { record: newest.record as CycleRecord, file: newest.file } : null;
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
      `The newest reader-suite run, finished ${readerRun.finishedAt ?? "at an unrecorded time"}, records ${results.length} result(s) and ` +
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
  readonly costs: Awaited<ReturnType<ControlPlaneRepositories["costs"]["readAll"]>>;
  readonly attempts: { readonly id: string; readonly worker: { readonly version: string; readonly provider: string } }[];
  readonly obligations: { readonly id: string; readonly subjectId: string }[];
  readonly cacheByRole: Parameters<typeof buildCostPanel>[0]["cacheByRole"];
  readonly share: Parameters<typeof buildCostPanel>[0]["share"];
  readonly verifiedRecords: number | null;
}

async function readControlPlane(repos: ControlPlaneRepositories): Promise<ControlPlaneReads> {
  const [costs, attempts, obligations, research] = await Promise.all([
    repos.costs.readAll(),
    repos.attempts.list(),
    repos.obligations.list(),
    repos.researchState.read(RESEARCH_STATE_ID),
  ]);
  let verifiedRecords: number | null = null;
  try {
    verifiedRecords = stageCounts(await readPipelineStates(repos)).byStage.VERIFIED;
  } catch (error) {
    log(`the promotion pipeline could not be read (${(error as Error).message}) — cost per verified record is a gap`);
  }
  const metrics = research?.value.metrics ?? null;
  return {
    costs,
    attempts: attempts.map((a) => ({ id: a.value.id, worker: a.value.worker })),
    obligations: obligations.map((o) => ({ id: o.value.id, subjectId: o.value.subjectId })),
    cacheByRole: metrics?.cacheByRole ?? null,
    share: metrics?.share ?? null,
    verifiedRecords,
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

function buildSnapshot(reads: ControlPlaneReads | null): OwnerSnapshot {
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
    candidateNames: candidateNames(),
    spendByDay: spendByDay(reads),

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
 * publish moment, so a hand-run `pnpm owner:publish` made a stopped runner
 * read ALIVE for ninety minutes. Liveness is derived from the beat; a beat
 * the runner did not write is a false liveness. It is not written here.
 */

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
  return createPgRepositories(url, NOW_ISO);
}

async function main(): Promise<void> {
  log(`HEAD ${HEAD?.slice(0, 8) ?? "unknown"} · pilot ${rollup.green ? "GREEN" : "NOT GREEN"}`);
  for (const r of rollup.readings) log(`  ${r.contract.padEnd(9)} ${r.state}`);

  // Opened FIRST so the cost panel and the by-state deployment read the same
  // instant the snapshot is stamped with.
  const repos = await repositories();
  if (repos) log(repos.describe());
  const reads = repos ? await readControlPlane(repos) : null;
  const snapshot = buildSnapshot(reads);

  /* The cheapest place to catch an aggregate-only violation is before it is durable. */
  assertAggregateOnly(snapshot, "owner snapshot");
  if (digest) assertAggregateOnly(digest, "owner digest");

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

  if (DRY_RUN || repos === null) {
    log("--dry-run: nothing written");
    return;
  }

  // The snapshot is a SINGLE aggregate that moves, so a put on an existing id
  // is a no-op — compare-and-set is the write that actually replaces it.
  const existing = await repos.ownerSnapshots.read(SNAPSHOT_ID);
  if (existing === null) {
    await repos.ownerSnapshots.put(SNAPSHOT_ID, snapshot, NOW_ISO);
  } else {
    await repos.ownerSnapshots.compareAndSet(SNAPSHOT_ID, existing.revision, snapshot, NOW_ISO);
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
    `published: snapshot${digest ? ", digest" : " (no cycle record — no digest)"}; the heartbeat is the runner's own; ` +
      `${decisions.length} owner decision intent(s) on record`,
  );
}

await main();
