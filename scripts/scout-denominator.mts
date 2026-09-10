/**
 * `pnpm scout:denominator` — THE SCOUT-CLASS DENOMINATOR, READ BY A MACHINE.
 * (Lane E, autonomous Scout activation, 2026-09-01.)
 *
 * Before any Scout code changes the project needs a BEFORE reading of how much
 * registered work is Scout-class, how much of it is due, and what the machine
 * has so far been able to do about it — and the SAME instrument run AFTER, so
 * the difference is measured rather than described.
 *
 * READ-ONLY against the control plane: the only write is the JSON readback at
 * `--out`. Every count carries its denominator (RULING 159); a read that fails
 * is reported as a FAILED READ and never as zero; env var names only.
 *
 * ```
 *   node --env-file=.env.local --experimental-strip-types \
 *        scripts/scout-denominator.mts --label=before|after [--out=<path>]
 * ```
 *
 * The registry is the four research-provider subset of
 * `freshness-shadow.mts` (root = cwd); the deterministic promoted-fact
 * provider is outside this Scout-class denominator. "Due" uses the standing
 * runtime's exact derivation:
 * `scheduleObligation` over the durable row's runtime fields, held out when
 * the debt backoff has not elapsed, pulled in when it has.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  controlPlaneUrlFromEnv,
  createPgRepositories,
  CONTROL_PLANE_URL_VAR,
} from "../lib/control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories, DispositionCommit } from "../lib/control-plane/repository/types.ts";
import { buildRegistry, registryLines, type RegisteredUnit } from "../lib/control-plane/scheduler/registry.ts";
import { campaignFinanceProvider } from "../lib/control-plane/scheduler/providers/campaign-finance.ts";
import { trackerIntakeProvider } from "../lib/control-plane/scheduler/providers/tracker-intake.ts";
import { localJurisdictionsProvider } from "../lib/control-plane/scheduler/providers/local-jurisdictions.ts";
import {
  candidateEnrichmentProvider,
  preloadCandidateEnrichmentAuthorities,
} from "../lib/control-plane/scheduler/providers/candidate-enrichment.ts";
import { scheduleObligation, isScheduled } from "../lib/control-plane/scheduler/obligation.ts";
import { retryable } from "../lib/control-plane/scheduler/debt.ts";
import { loadDebts, type StandingObligation } from "../lib/control-plane/scheduler/durable.ts";
import { knownRouteIds } from "../lib/control-plane/scheduler/maturity.ts";
import { EXECUTOR_KINDS, type ExecutorKind } from "../lib/control-plane/scheduler/dispatch.ts";
import {
  RESEARCH_INTENT_LOG_KEY,
  RESEARCH_STATE_ID,
  type ResearchIntent,
  type ResearchState,
} from "../lib/control-plane/scheduler/research-policy.ts";
import { SCOUT_OUTCOMES, type ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import { headSha } from "../lib/ops/git-facts.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";
import { preloadOperationalReferenceBundle } from "../lib/civic-data/operational-references.ts";

const ROOT = process.cwd();
const NOW = new Date().toISOString();
const nowMs = Date.parse(NOW);

/* ------------------------------------------------------------------ flags */

const argv = process.argv.slice(2);
const labelArg = argv.find((a) => a.startsWith("--label="));
const LABEL = labelArg ? labelArg.slice("--label=".length) : null;
const outArg = argv.find((a) => a.startsWith("--out="));
if (outArg === undefined && (LABEL !== "before" && LABEL !== "after")) {
  console.error(
    "scout:denominator · name the reading: --label=before|after (or pass --out=<path>). A reading " +
      "with no label would be filed as neither, and the BEFORE/AFTER comparison is the whole point.",
  );
  process.exit(1);
}
const OUT = outArg
  ? resolve(ROOT, outArg.slice("--out=".length))
  : join(ROOT, "docs", "evidence", `scout-denominator-${LABEL}-${today()}.json`);

/* ---------------------------------------------------------------- reads --- */

/** A read either produced rows or failed BY NAME. There is no third shape and no zero default. */
type Reading<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

/** A connection string could ride inside a driver error. It never reaches the record. */
const redact = (s: string): string => s.replace(/postgres(?:ql)?:\/\/\S+/gi, "<connection string redacted>");

async function read<T>(name: string, fn: () => Promise<T>): Promise<Reading<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: `${name}: ${redact(error instanceof Error ? error.message : String(error))}` };
  }
}

const readStatus = <T,>(r: Reading<T>, rows: (v: T) => number): ReadStatus =>
  r.ok ? { ok: true, rows: rows(r.value) } : { ok: false, error: r.error };

/* ---------------------------------------------------------------- types --- */

type ReadStatus = { readonly ok: true; readonly rows: number } | { readonly ok: false; readonly error: string };

type OpenKind = "HTTP_GET" | "HTTP_POST" | "NOT_MACHINE_EXECUTABLE";
const OPEN_KINDS: readonly OpenKind[] = ["HTTP_GET", "HTTP_POST", "NOT_MACHINE_EXECUTABLE"];

type ScheduleState = "NOT_DURABLE" | "UNSCHEDULED" | "BACKED_OFF" | "DUE" | "NOT_DUE";

interface ClassCounts {
  readonly DETERMINISTIC: number;
  readonly BOUNDED_MODEL_WORKER: number;
}

interface ScheduleCounts {
  readonly registered: number;
  readonly durable: number;
  readonly notDurable: number;
  readonly unscheduled: number;
  readonly backedOff: number;
  /** nextDueAt <= now AND not backed off — the freshness-shadow derivation. */
  readonly due: number;
  readonly notDue: number;
  /** The store's own stored next_due_at <= now, over the durable rows. A cross-check, not the derivation. */
  readonly storedNextDuePassed: number;
}

interface DispositionCounts {
  readonly denominator: number;
  readonly REQUIRES_NEW_ADAPTER: number;
  readonly BLOCKED_CURRENTLY: number;
  readonly INGESTED: number;
  readonly WALKED_NO_YIELD: number;
  readonly other: number;
  readonly otherByDisposition: Record<string, number>;
  readonly none: number;
}

interface RouteIdRow {
  readonly executorClass: ExecutorKind;
  readonly executorReason: string;
  readonly openKinds: Record<string, number>;
  readonly providerIds: readonly string[];
  readonly registered: number;
  readonly durable: number;
  readonly due: number;
  readonly graduatedByMethodStore: boolean;
}

interface UnitReading {
  readonly id: string;
  readonly providerId: string;
  readonly routeId: string;
  readonly executorClass: ExecutorKind;
  readonly openKind: OpenKind;
  readonly schedule: ScheduleState;
  readonly storedNextDuePassed: boolean;
}

interface ScoutDenominatorReadback {
  readonly formatVersion: 1;
  readonly label: string | null;
  readonly measuredAt: string;
  readonly testedSha: string | null;
  readonly store: string;
  readonly reads: Record<string, ReadStatus>;
  readonly registry: {
    readonly totalRegisteredUnits: number;
    readonly providers: readonly {
      readonly providerId: string;
      readonly records: number;
      readonly units: number;
      readonly readFailure: string | null;
      readonly emptyReason: string | null;
    }[];
  };
  readonly byExecutorClass: ClassCounts & { readonly denominator: number };
  readonly byOpenKind: Record<OpenKind, number> & { readonly denominator: number };
  readonly contradictions: {
    readonly expectation: string;
    readonly denominator: number;
    readonly total: number;
    readonly deterministicButNotMachineExecutable: readonly string[];
    readonly modelClassButMachineExecutable: readonly string[];
  };
  readonly durable: {
    readonly registeredUnits: number;
    readonly durableRegistered: number;
    readonly registeredNotDurable: number;
    readonly registeredNotDurableSample: readonly string[];
    readonly durableNotRegistered: number;
    readonly debtRowsOpen: number;
    readonly debtRowsRetryableNow: number;
    readonly debtRowsBackedOff: number;
  } | null;
  readonly due: Record<ExecutorKind, ScheduleCounts> | null;
  readonly byProvider: Record<string, Record<ExecutorKind, { readonly registered: number; readonly due: number | null }>>;
  readonly byRouteId: Record<string, RouteIdRow>;
  readonly methodMaturity: {
    readonly knowledgeRouteIds: number;
    readonly modelClassRouteIds: number;
    readonly modelClassRouteIdsGraduatedByStore: readonly string[];
    readonly modelClassUnits: number;
    readonly modelClassUnitsGraduatedByStore: number;
    readonly deterministicRouteIds: number;
    readonly deterministicRouteIdsUngraduatedByStore: readonly string[];
    readonly deterministicUnits: number;
    readonly deterministicUnitsUngraduatedByStore: number;
    readonly reading: string;
  };
  readonly lastCommittedDisposition: Record<ExecutorKind, DispositionCounts> | null;
  readonly cannotProgressWithoutNovelInvestigation: {
    readonly denominator: number;
    readonly count: number;
    readonly byProvider: Record<string, number>;
    readonly reading: string;
  };
  readonly scout: {
    readonly resultsTotal: number;
    readonly byOutcome: Record<string, number>;
    readonly distinctObligationsWithResult: number;
    readonly resultsOnObligationsNotInRegistry: number;
    readonly modelClassUnits: number;
    readonly modelClassWithAtLeastOneResult: number;
    readonly noMachineCapable: number;
    readonly expectation: string;
  } | null;
  readonly researchState: ResearchState | null | { readonly failedRead: string };
  readonly researchIntents: {
    readonly count: number;
    readonly byKind: Record<string, number>;
    readonly byAction: Record<string, number>;
  } | null;
}

/* -------------------------------------------------------------- helpers --- */

function sortedRecord<V>(entries: Iterable<readonly [string, V]>): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [k, v] of [...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) out[k] = v;
  return out;
}

function tally(keys: Iterable<string>): Record<string, number> {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return sortedRecord(m);
}

const classCounts = (units: readonly { readonly executorClass: ExecutorKind }[]): ClassCounts => ({
  DETERMINISTIC: units.filter((u) => u.executorClass === "DETERMINISTIC").length,
  BOUNDED_MODEL_WORKER: units.filter((u) => u.executorClass === "BOUNDED_MODEL_WORKER").length,
});

const line = (s: string): void => console.log(`  ${s}`);
const floor = (subject: string, where: string, population: number, matched: number, reason?: string): void =>
  line(floorLine(floored(subject, where, population, matched, reason)));

/* ------------------------------------------------------------- the store --- */

const url = controlPlaneUrlFromEnv();
if (url === null) {
  console.error(
    `scout:denominator · ${CONTROL_PLANE_URL_VAR} is not set. Reading the file store instead would be ` +
      "a denominator over a different store than the Scouts write to. Refusing.",
  );
  process.exit(1);
}
let repos: ControlPlaneRepositories;
try {
  repos = await createPgRepositories(url, NOW);
} catch (error) {
  console.error(
    `scout:denominator · could not open the control plane: ${redact(
      error instanceof Error ? error.message : String(error),
    )}`,
  );
  process.exit(1);
}
await preloadOperationalReferenceBundle({ bypassCache: true });
await preloadCandidateEnrichmentAuthorities();

console.log(`scout:denominator · ${LABEL ?? "(unlabelled)"} reading at ${NOW}`);
line(`store: ${repos.describe()}`);
line(`testedSha: ${headSha(ROOT) ?? "null (no HEAD resolvable)"}`);

/* ------------------------------------------------------------ the registry --- */

const registry = buildRegistry(
  [
    campaignFinanceProvider(),
    trackerIntakeProvider(),
    localJurisdictionsProvider(),
    candidateEnrichmentProvider(),
  ],
  { root: ROOT, nowIso: NOW },
);
const units: readonly RegisteredUnit[] = registry.units;
for (const l of registryLines(registry)) console.log(l);
const NO_UNITS = "the registry produced no units at all — a read failure of OUR inputs, never an empty domain";
const unitById = new Map(units.map((u) => [u.obligation.id, u]));
const modelUnits = units.filter((u) => u.route.executorClass === "BOUNDED_MODEL_WORKER");
const NO_MODEL = "no registered unit is declared BOUNDED_MODEL_WORKER";

/* -------------------------------------------------------------- the reads --- */

const obligationsR = await read("obligations.list", () => repos.obligations.list());
const debtsR = await read("debts.list", () => loadDebts(repos));
const occurrencesR = await read("occurrences.list", () => repos.occurrences.list());
const dispositionsR = await read("dispositions.readAll", () => repos.dispositions.readAll());
const scoutResultsR = await read("scoutResults.readAll", () => repos.scoutResults.readAll());
const researchStateR = await read("researchState.read", () => repos.researchState.read(RESEARCH_STATE_ID));
const intentsR = await read("researchIntents.read", () => repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY));

const reads: Record<string, ReadStatus> = sortedRecord<ReadStatus>([
  ["obligations", readStatus(obligationsR, (v) => v.length)],
  ["debts", readStatus(debtsR, (v) => v.length)],
  ["occurrences", readStatus(occurrencesR, (v) => v.length)],
  ["dispositions", readStatus(dispositionsR, (v) => v.length)],
  ["scoutResults", readStatus(scoutResultsR, (v) => v.length)],
  ["researchState", readStatus(researchStateR, (v) => (v === null ? 0 : 1))],
  ["researchIntents", readStatus(intentsR, (v) => v.length)],
]);
const failedReads = Object.entries(reads).filter(([, s]) => !s.ok);
for (const [name, s] of Object.entries(reads)) {
  line(s.ok ? `read ${name.padEnd(16)} ${s.rows} row(s)` : `FAILED READ ${name}: ${s.error}`);
}

/* ------------------------------------------------- classification per unit --- */

/*
 * "Due" is freshness-shadow's derivation, verbatim in shape: the durable row's
 * runtime fields under the provider's current signals, scheduled by
 * `scheduleObligation`; a row whose debt backoff has not elapsed is held out;
 * one whose backoff HAS elapsed is pulled in whatever its next-due says.
 */
const durableById = new Map<string, StandingObligation>();
if (obligationsR.ok) for (const r of obligationsR.value) durableById.set(r.id, r.value);
const debts = debtsR.ok ? debtsR.value : [];
const debtIds = new Set(debts.filter((d) => d.consecutiveFailures > 0).map((d) => d.obligationId));
const retryNow = new Set(retryable(debts, nowMs).map((d) => d.obligationId));
const backedOff = new Set([...debtIds].filter((id) => !retryNow.has(id)));
const scheduleKnown = obligationsR.ok && debtsR.ok;

const readings: UnitReading[] = units.map((u) => {
  const held = durableById.get(u.obligation.id);
  let schedule: ScheduleState = "NOT_DURABLE";
  if (held !== undefined) {
    const merged: StandingObligation = {
      ...u.obligation,
      nextDueAt: held.nextDueAt,
      occurrenceCount: held.occurrenceCount,
      openOccurrenceId: held.openOccurrenceId,
      lastWorkedAt: held.lastWorkedAt,
      updatedAt: held.updatedAt,
    };
    const row = scheduleObligation(merged, nowMs);
    if (!isScheduled(row)) schedule = "UNSCHEDULED";
    else if (backedOff.has(u.obligation.id)) schedule = "BACKED_OFF";
    else schedule = Date.parse(row.nextDueAt) <= nowMs || retryNow.has(u.obligation.id) ? "DUE" : "NOT_DUE";
  }
  return {
    id: u.obligation.id,
    providerId: u.providerId,
    routeId: u.route.routeId,
    executorClass: u.route.executorClass,
    openKind: u.route.open.kind,
    schedule,
    storedNextDuePassed: held !== undefined && held.nextDueAt !== null && held.nextDueAt <= NOW,
  };
});

const scheduleCounts = (rows: readonly UnitReading[]): ScheduleCounts => ({
  registered: rows.length,
  durable: rows.filter((r) => r.schedule !== "NOT_DURABLE").length,
  notDurable: rows.filter((r) => r.schedule === "NOT_DURABLE").length,
  unscheduled: rows.filter((r) => r.schedule === "UNSCHEDULED").length,
  backedOff: rows.filter((r) => r.schedule === "BACKED_OFF").length,
  due: rows.filter((r) => r.schedule === "DUE").length,
  notDue: rows.filter((r) => r.schedule === "NOT_DUE").length,
  storedNextDuePassed: rows.filter((r) => r.storedNextDuePassed).length,
});

/* ------------------------------------------------------- classes and kinds --- */

const byClass = classCounts(readings);
const byOpenKind = {
  HTTP_GET: readings.filter((r) => r.openKind === "HTTP_GET").length,
  HTTP_POST: readings.filter((r) => r.openKind === "HTTP_POST").length,
  NOT_MACHINE_EXECUTABLE: readings.filter((r) => r.openKind === "NOT_MACHINE_EXECUTABLE").length,
};
console.log();
line("registered units by DECLARED executor class (the descriptor's executorClass):");
for (const k of EXECUTOR_KINDS) floor(`    ${k}`, "the registry", units.length, byClass[k], NO_UNITS);
line("registered units by open kind (how the route is opened):");
for (const k of OPEN_KINDS) floor(`    ${k}`, "the registry", units.length, byOpenKind[k], NO_UNITS);

const deterministicNotExecutable = readings
  .filter((r) => r.executorClass === "DETERMINISTIC" && r.openKind === "NOT_MACHINE_EXECUTABLE")
  .map((r) => r.id)
  .sort();
const modelButExecutable = readings
  .filter((r) => r.executorClass === "BOUNDED_MODEL_WORKER" && r.openKind !== "NOT_MACHINE_EXECUTABLE")
  .map((r) => r.id)
  .sort();
const CONTRADICTION_EXPECTATION =
  "0 — a route declared DETERMINISTIC must be machine-openable (HTTP_GET/HTTP_POST), and a route declared " +
  "BOUNDED_MODEL_WORKER is one nothing deterministic can open (NOT_MACHINE_EXECUTABLE). Any unit listed here " +
  "is a descriptor contradicting itself, not a fact about a government.";
floor(
  "contradictions between declared class and open kind",
  "the registry",
  units.length,
  deterministicNotExecutable.length + modelButExecutable.length,
  NO_UNITS,
);
line(`    expected ${CONTRADICTION_EXPECTATION.split(" — ")[0]}: ${CONTRADICTION_EXPECTATION.split(" — ")[1]}`);
if (deterministicNotExecutable.length > 0) {
  line(`    DETERMINISTIC but NOT_MACHINE_EXECUTABLE: ${deterministicNotExecutable.slice(0, 10).join(", ")}`);
}
if (modelButExecutable.length > 0) {
  line(`    BOUNDED_MODEL_WORKER but machine-executable: ${modelButExecutable.slice(0, 10).join(", ")}`);
}

/* ------------------------------------------------------------- durability --- */

let durable: ScoutDenominatorReadback["durable"] = null;
let due: ScoutDenominatorReadback["due"] = null;
console.log();
if (obligationsR.ok && debtsR.ok) {
  const notDurable = readings.filter((r) => r.schedule === "NOT_DURABLE").map((r) => r.id).sort();
  durable = {
    registeredUnits: units.length,
    durableRegistered: units.length - notDurable.length,
    registeredNotDurable: notDurable.length,
    registeredNotDurableSample: notDurable.slice(0, 20),
    durableNotRegistered: obligationsR.value.filter((r) => !unitById.has(r.id)).length,
    debtRowsOpen: debtIds.size,
    debtRowsRetryableNow: [...debtIds].filter((id) => retryNow.has(id)).length,
    debtRowsBackedOff: backedOff.size,
  };
  floor("registry units found DURABLE in repos.obligations", "the registry", units.length, durable.durableRegistered, NO_UNITS);
  line(`    registered but NOT durable: ${durable.registeredNotDurable} (a cycle registers them on its next pass)`);
  line(`    durable rows NOT in this registry: ${durable.durableNotRegistered} (retired or renamed providers keep their rows)`);
  line(
    `    freshness debt: ${durable.debtRowsOpen} open row(s), ${durable.debtRowsRetryableNow} retryable now, ` +
      `${durable.debtRowsBackedOff} backed off`,
  );

  due = {
    DETERMINISTIC: scheduleCounts(readings.filter((r) => r.executorClass === "DETERMINISTIC")),
    BOUNDED_MODEL_WORKER: scheduleCounts(readings.filter((r) => r.executorClass === "BOUNDED_MODEL_WORKER")),
  };
  line("due by class (nextDueAt <= now AND not backed off — freshness-shadow's derivation):");
  for (const k of EXECUTOR_KINDS) {
    const c = due[k];
    floor(
      `    ${k} due`,
      `the ${k} units the control plane holds durable`,
      c.durable,
      c.due,
      c.registered === 0 ? `no registered unit is declared ${k}` : `none of the ${c.registered} ${k} unit(s) is durable yet`,
    );
    line(
      `        registered ${c.registered} · durable ${c.durable} · not durable ${c.notDurable} · unscheduled ` +
        `${c.unscheduled} · backed off ${c.backedOff} · not due ${c.notDue} · stored next_due passed ${c.storedNextDuePassed}`,
    );
  }
} else {
  line("durable/due NOT COMPUTED: the obligations or debts read FAILED (named above). Not zero — unknown.");
}

/* -------------------------------------------------------- provider × class --- */

const byProvider = sortedRecord(
  registry.byProvider.map((p) => {
    const rows = readings.filter((r) => r.providerId === p.providerId);
    const cell = (k: ExecutorKind) => {
      const mine = rows.filter((r) => r.executorClass === k);
      return { registered: mine.length, due: scheduleKnown ? mine.filter((r) => r.schedule === "DUE").length : null };
    };
    return [p.providerId, { DETERMINISTIC: cell("DETERMINISTIC"), BOUNDED_MODEL_WORKER: cell("BOUNDED_MODEL_WORKER") }] as const;
  }),
);
console.log();
line("by provider × class (registered / due):");
for (const [id, cell] of Object.entries(byProvider)) {
  const fmt = (c: { registered: number; due: number | null }) => `${c.registered} / ${c.due === null ? "?" : c.due}`;
  line(`    ${id.padEnd(22)} DETERMINISTIC ${fmt(cell.DETERMINISTIC).padEnd(14)} BOUNDED_MODEL_WORKER ${fmt(cell.BOUNDED_MODEL_WORKER)}`);
}

/* ------------------------------------------------------- routeId × class --- */

const known = knownRouteIds(ROOT);
const byRouteId = sortedRecord(
  [...new Set(readings.map((r) => r.routeId))].map((routeId) => {
    const rows = readings.filter((r) => r.routeId === routeId);
    const representative = unitById.get(rows[0].id)!.route;
    const row: RouteIdRow = {
      executorClass: representative.executorClass,
      executorReason: representative.executorReason,
      openKinds: tally(rows.map((r) => r.openKind)),
      providerIds: [...new Set(rows.map((r) => r.providerId))].sort(),
      registered: rows.length,
      durable: rows.filter((r) => r.schedule !== "NOT_DURABLE").length,
      due: rows.filter((r) => r.schedule === "DUE").length,
      graduatedByMethodStore: known.has(routeId),
    };
    return [routeId, row] as const;
  }),
);
console.log();
line(`by routeId × class (${Object.keys(byRouteId).length} distinct routeId(s); registered / due · store):`);
const routeRows = Object.entries(byRouteId);
for (const [routeId, row] of routeRows.slice(0, 40)) {
  line(
    `    ${routeId.padEnd(44)} ${row.executorClass.padEnd(21)} ${String(row.registered).padStart(5)} / ` +
      `${scheduleKnown ? String(row.due).padStart(4) : "   ?"}  ${row.graduatedByMethodStore ? "GRADUATED" : "ungraduated"}`,
  );
  line(`        ${row.executorReason.slice(0, 150)}`);
}
if (routeRows.length > 40) line(`    … and ${routeRows.length - 40} more routeId(s) in the JSON`);

/* ------------------------------------------------------- method maturity --- */

const modelRouteIds = [...new Set(modelUnits.map((u) => u.route.routeId))].sort();
const modelGraduated = modelRouteIds.filter((id) => known.has(id));
const detUnits = units.filter((u) => u.route.executorClass === "DETERMINISTIC");
const detRouteIds = [...new Set(detUnits.map((u) => u.route.routeId))].sort();
const detUngraduated = detRouteIds.filter((id) => !known.has(id));
const methodMaturity: ScoutDenominatorReadback["methodMaturity"] = {
  knowledgeRouteIds: known.size,
  modelClassRouteIds: modelRouteIds.length,
  modelClassRouteIdsGraduatedByStore: modelGraduated,
  modelClassUnits: modelUnits.length,
  modelClassUnitsGraduatedByStore: modelUnits.filter((u) => known.has(u.route.routeId)).length,
  deterministicRouteIds: detRouteIds.length,
  deterministicRouteIdsUngraduatedByStore: detUngraduated,
  deterministicUnits: detUnits.length,
  deterministicUnitsUngraduatedByStore: detUnits.filter((u) => !known.has(u.route.routeId)).length,
  reading:
    "Two classifications exist and they can disagree. The DESCRIPTOR declares executorClass; " +
    "`chooseExecutor` reads the METHOD STORE (routeId present in the canonical method store = GRADUATED). " +
    "A model-class routeId the store has graduated would be dispatched DETERMINISTIC by chooseExecutor; a " +
    "deterministic routeId the store has not learned would be dispatched to the bounded worker. The counts " +
    "here are that disagreement, stated — not resolved.",
};
console.log();
line(`method store: ${known.size} routeId(s) known in the canonical method store`);
floor(
  "model-class routeIds GRADUATED by the method store (disagreement: descriptor says model, store says known)",
  "the distinct BOUNDED_MODEL_WORKER routeIds",
  modelRouteIds.length,
  modelGraduated.length,
  NO_MODEL,
);
if (modelGraduated.length > 0) line(`    ${modelGraduated.join(", ")}`);
floor(
  "model-class UNITS whose routeId the method store has graduated",
  "the BOUNDED_MODEL_WORKER units",
  modelUnits.length,
  methodMaturity.modelClassUnitsGraduatedByStore,
  NO_MODEL,
);
floor(
  "deterministic routeIds UNGRADUATED by the method store (disagreement the other way)",
  "the distinct DETERMINISTIC routeIds",
  detRouteIds.length,
  detUngraduated.length,
  "no registered unit is declared DETERMINISTIC",
);
if (detUngraduated.length > 0) line(`    ${detUngraduated.slice(0, 12).join(", ")}${detUngraduated.length > 12 ? " …" : ""}`);

/* ----------------------------------------------- last committed disposition --- */

let lastCommittedDisposition: ScoutDenominatorReadback["lastCommittedDisposition"] = null;
console.log();
if (occurrencesR.ok && dispositionsR.ok) {
  const routeTaskToObligation = new Map<string, string>();
  for (const o of occurrencesR.value) routeTaskToObligation.set(o.value.routeTaskId, o.value.obligationId);
  const latest = new Map<string, DispositionCommit>();
  for (const c of dispositionsR.value) {
    const obligationId = routeTaskToObligation.get(c.routeTaskId);
    if (obligationId === undefined || !unitById.has(obligationId)) continue;
    const prior = latest.get(obligationId);
    if (prior === undefined || prior.committedAt < c.committedAt) latest.set(obligationId, c);
  }
  const counts = (rows: readonly RegisteredUnit[]): DispositionCounts => {
    const named = ["REQUIRES_NEW_ADAPTER", "BLOCKED_CURRENTLY", "INGESTED", "WALKED_NO_YIELD"];
    const other: string[] = [];
    let none = 0;
    const tallyOf = (d: string) => rows.filter((u) => latest.get(u.obligation.id)?.disposition.disposition === d).length;
    for (const u of rows) {
      const d = latest.get(u.obligation.id)?.disposition.disposition;
      if (d === undefined) none += 1;
      else if (!named.includes(d)) other.push(d);
    }
    return {
      denominator: rows.length,
      REQUIRES_NEW_ADAPTER: tallyOf("REQUIRES_NEW_ADAPTER"),
      BLOCKED_CURRENTLY: tallyOf("BLOCKED_CURRENTLY"),
      INGESTED: tallyOf("INGESTED"),
      WALKED_NO_YIELD: tallyOf("WALKED_NO_YIELD"),
      other: other.length,
      otherByDisposition: tally(other),
      none,
    };
  };
  lastCommittedDisposition = { DETERMINISTIC: counts(detUnits), BOUNDED_MODEL_WORKER: counts(modelUnits) };
  line("last COMMITTED disposition per unit (repos.dispositions joined through repos.occurrences):");
  for (const k of ["BOUNDED_MODEL_WORKER", "DETERMINISTIC"] as const) {
    const c = lastCommittedDisposition[k];
    line(
      `    ${k.padEnd(21)} of ${c.denominator}: REQUIRES_NEW_ADAPTER ${c.REQUIRES_NEW_ADAPTER} · BLOCKED_CURRENTLY ` +
        `${c.BLOCKED_CURRENTLY} · INGESTED ${c.INGESTED} · WALKED_NO_YIELD ${c.WALKED_NO_YIELD} · other ${c.other} · none ${c.none}`,
    );
    if (c.other > 0) line(`        other: ${Object.entries(c.otherByDisposition).map(([d, n]) => `${d} ${n}`).join(", ")}`);
  }
} else {
  line("last committed disposition NOT COMPUTED: the occurrences or dispositions read FAILED (named above).");
}

/* --------------------------------------------- cannot progress without novelty --- */

const cannotProgress = modelUnits.filter((u) => u.route.open.kind === "NOT_MACHINE_EXECUTABLE");
const cannotProgressWithoutNovelInvestigation: ScoutDenominatorReadback["cannotProgressWithoutNovelInvestigation"] = {
  denominator: modelUnits.length,
  count: cannotProgress.length,
  byProvider: tally(cannotProgress.map((u) => u.providerId)),
  reading:
    "model-class units whose open kind is NOT_MACHINE_EXECUTABLE: this process holds no client for the " +
    "representation, so nothing deterministic can open it and only novel investigation (a Scout) can advance it.",
};
console.log();
floor(
  "cannotProgressWithoutNovelInvestigation (model-class AND NOT_MACHINE_EXECUTABLE)",
  "the BOUNDED_MODEL_WORKER units",
  modelUnits.length,
  cannotProgress.length,
  NO_MODEL,
);

/* ------------------------------------------------------------- scout results --- */

let scout: ScoutDenominatorReadback["scout"] = null;
console.log();
if (scoutResultsR.ok) {
  const results: readonly ScoutResult[] = scoutResultsR.value;
  const byObligation = new Map<string, number>();
  for (const r of results) byObligation.set(r.obligationId, (byObligation.get(r.obligationId) ?? 0) + 1);
  const withResult = modelUnits.filter((u) => byObligation.has(u.obligation.id)).length;
  scout = {
    resultsTotal: results.length,
    byOutcome: tally(results.map((r) => (SCOUT_OUTCOMES.includes(r.outcome) ? r.outcome : `unknown:${String(r.outcome)}`))),
    distinctObligationsWithResult: byObligation.size,
    resultsOnObligationsNotInRegistry: [...byObligation.keys()].filter((id) => !unitById.has(id)).length,
    modelClassUnits: modelUnits.length,
    modelClassWithAtLeastOneResult: withResult,
    noMachineCapable: modelUnits.length - withResult,
    expectation:
      "noMachineCapable = model-class units that HAVE a runnable executor lane (the Scout) and whose result is " +
      "not yet held in repos.scoutResults — 'has a runnable executor lane; result held / not yet', never " +
      "'no machine capable'. BEFORE Scout activation the expectation is ALL of them; AFTER, fewer.",
  };
  const NO_RESULTS =
    "the scoutResults log holds ZERO rows. Either no Scout Attempt has recorded a result yet or the read " +
    "resolved to an empty log — this instrument cannot tell which, and says so rather than asserting either.";
  line(`Scout results in repos.scoutResults: ${results.length}`);
  for (const [k, n] of Object.entries(scout.byOutcome)) {
    floor(`    outcome ${k}`, "the Scout results", results.length, n, NO_RESULTS);
  }
  if (results.length === 0) line(`    by outcome: COULD NOT ASSERT — ${NO_RESULTS}`);
  floor(
    "model-class units with at least one Scout result",
    "the BOUNDED_MODEL_WORKER units",
    modelUnits.length,
    withResult,
    NO_MODEL,
  );
  floor("has a runnable executor lane; result NOT YET held (model-class units with no Scout result)", "the BOUNDED_MODEL_WORKER units", modelUnits.length, scout.noMachineCapable, NO_MODEL);
  line(`    expected ${LABEL === "after" ? "FEWER than the BEFORE reading" : "ALL of them before activation"}`);
  if (scout.resultsOnObligationsNotInRegistry > 0) {
    line(`    ${scout.resultsOnObligationsNotInRegistry} obligation id(s) carry Scout results and are NOT in this registry`);
  }
} else {
  line("Scout results NOT COMPUTED: the scoutResults read FAILED (named above). Not zero — unknown.");
}

/* ------------------------------------------------------------ research state --- */

let researchState: ScoutDenominatorReadback["researchState"];
if (researchStateR.ok) {
  researchState = researchStateR.value === null ? null : researchStateR.value.value;
  line(
    `research state "${RESEARCH_STATE_ID}": ${
      researchState === null
        ? "ABSENT — no cycle has written one"
        : `present, beatAt ${researchState.beatAt}, modelLaneEnabled ${researchState.modelLaneEnabled}` +
          (researchState.modelLaneDisabledReason ? ` (${researchState.modelLaneDisabledReason})` : "") +
          `, credential ${researchState.workerCredential.name} configured ${researchState.workerCredential.configured}`
    }`,
  );
} else {
  researchState = { failedRead: researchStateR.error };
}
let researchIntents: ScoutDenominatorReadback["researchIntents"] = null;
if (intentsR.ok) {
  const log: readonly ResearchIntent[] = intentsR.value;
  researchIntents = { count: log.length, byKind: tally(log.map((i) => i.kind)), byAction: tally(log.map((i) => i.action)) };
  line(`research intents under "${RESEARCH_INTENT_LOG_KEY}": ${log.length}`);
}

/* ------------------------------------------------------------- the record --- */

const readback: ScoutDenominatorReadback = {
  formatVersion: 1,
  label: LABEL,
  measuredAt: NOW,
  testedSha: headSha(ROOT),
  store: repos.describe(),
  reads,
  registry: {
    totalRegisteredUnits: units.length,
    providers: registry.byProvider.map((p) => ({
      providerId: p.providerId,
      records: p.records,
      units: p.units,
      readFailure: p.readFailure,
      emptyReason: p.emptyReason,
    })),
  },
  byExecutorClass: { denominator: units.length, ...byClass },
  byOpenKind: { denominator: units.length, ...byOpenKind },
  contradictions: {
    expectation: CONTRADICTION_EXPECTATION,
    denominator: units.length,
    total: deterministicNotExecutable.length + modelButExecutable.length,
    deterministicButNotMachineExecutable: deterministicNotExecutable,
    modelClassButMachineExecutable: modelButExecutable,
  },
  durable,
  due,
  byProvider,
  byRouteId,
  methodMaturity,
  lastCommittedDisposition,
  cannotProgressWithoutNovelInvestigation,
  scout,
  researchState,
  researchIntents,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(readback, null, 2)}\n`, "utf8");
console.log();
line(`wrote: ${OUT}`);
if (failedReads.length > 0) {
  line(`${failedReads.length} read(s) FAILED — the sections they feed are null in the record, never zero. Exit 1.`);
  process.exit(1);
}
