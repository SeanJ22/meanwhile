/**
 * **THE READINESS PUBLISHER — a thin IO shell over a pure derivation.**
 * (State Readiness Control Panel, 2026-09-03/04. Rewritten 2026-09-04 to stop
 * hand-authoring readiness facts, R-H. Extended 2026-09-06 for ADM-40/41: the
 * grid was contradicting the live product, because the instruments the Reader
 * actually renders from were never tallied here.)
 *
 * This script's ONLY job is IO: read the committed authorities off disk, tally
 * them into the typed `StateAuthorities` shape, and write the computed snapshot
 * to the control plane the panel reads. Every readiness FACT — which gate is
 * current, at what count, as of when — is DERIVED in `lib/control-plane/
 * readiness/extract.ts`, a pure module a test can pin. The publisher may
 * materialize derived truth; it may not author it. Where an instrument does not
 * exist on current main, the gate is NOT_WALKED — never a typed-in success.
 *
 * ## What the 9.6.26 pass added, and why
 *
 * The owner opened the live site and disproved the grid: NH and NJ candidate
 * listings are served, federal FEC money renders on a senator's card, and the
 * districts come from .gov geometry the Reader and Ask both use — while the
 * Admin showed blanks. Four tallies were missing here, not four facts:
 *
 *   - `ballotFor()`      the state's committed ballot holdings: candidacies,
 *                        contests, the filing documents they cite, and whether
 *                        those documents are official government sources (§8).
 *   - `fecFor()`         the per-state slice of `data/fec/fec-2026.json`, keyed
 *                        on each candidate's own `state` and each absence's
 *                        state-bearing `targetKey`.
 *   - `heldAgendasFor()` bodies with at least one HELD meeting in
 *                        `data/meetings-snapshot.json`, the same snapshot
 *                        `/api/meetings` serves.
 *   - `deliveryFor()`    which of those holdings the canonical system DECLARES
 *                        the Reader is served from, read out of
 *                        `lib/holdings/datasets.ts` and
 *                        `lib/holdings/reader-trace.ts` rather than asserted.
 *
 * TARGET IS SAFE BY DEFAULT (CC-F3). This script writes to the LOCAL FILE STORE
 * unless the caller passes the explicit `--target=control-plane`. The presence
 * of `WTP_CONTROL_PLANE_DATABASE_URL` in the environment does NOT select
 * production — so `pnpm readiness:refresh`, even with `.env.local` loaded, only
 * derives locally and never contacts production. Production publication is the
 * separate, deliberate `pnpm readiness:publish` (which passes
 * `--target=control-plane`). `--out=<dir>` overrides the file-store directory.
 *
 * Run (local, safe): `pnpm readiness:refresh`  (→ data/control-plane file store)
 * Run (dev file store elsewhere): `pnpm exec tsx scripts/readiness-refresh.mts --out=<dir>`
 * Publish to PRODUCTION (deliberate): `pnpm readiness:publish`  (--target=control-plane)
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { gap, held } from "../lib/control-plane/owner-surface.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import {
  controlPlaneUrlFromEnv,
  createPgRepositories,
} from "../lib/control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { coverageTierForZip } from "../lib/coverage/zip-tier.ts";
import { STATE_FIPS, refreshPopulationFromPromoted, statePopulation, zipPopulationReading } from "../lib/reference/acs-population.ts";
import { ACS_SOURCE_LABEL, ACS_VINTAGE_LABEL, ACS_ZCTA_GEOGRAPHY_LABEL } from "../lib/reference/acs-labels.ts";
import { datasetFamily } from "../lib/holdings/datasets.ts";
import { readerTraceRequirements } from "../lib/holdings/reader-trace.ts";
import { held as heldValue, measured } from "../lib/control-plane/owner-surface.ts";
import {
  type BallotFilingInstrument,
  type BodyLevelStat,
  type FecInstrument,
  type HeldAgendaStat,
  type MeasureInstrument,
  type ReconInstrument,
  type SourcedAbsence,
  type StateAuthorities,
  chooseReadinessStoreTarget,
  deriveStateInputs,
} from "../lib/control-plane/readiness/extract.ts";
import type { ReaderDelivery } from "../lib/control-plane/readiness/model.ts";
import {
  type ReadinessInputs,
  type ZipInput,
  computeReadinessSnapshot,
} from "../lib/control-plane/readiness/compute.ts";

const ROOT = process.cwd();
const NOW = new Date().toISOString();
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"] as const;
  }),
);

/* The loose shapes of the committed JSON authorities this reads. */
interface Provenance {
  readonly sourceUrl?: string;
  readonly sourceOrg?: string;
  readonly collectedAt?: string;
  readonly verifiedAt?: string;
}
interface Division {
  readonly ocdId: string;
  readonly divisionType: string;
  readonly state?: string;
  readonly provenance?: { readonly collectedAt?: string };
}
interface Body {
  readonly ocdId?: string;
  readonly id?: string;
  readonly alsoServesOcdIds?: readonly string[];
  readonly name?: string;
  readonly bodyClass?: string;
  readonly coverageStatus?: string;
  readonly provenance?: { readonly collectedAt?: string };
}
interface Registry {
  readonly divisions: readonly Division[];
  readonly bodies: readonly Body[];
}
interface ZipDivisionIds {
  readonly zips?: Record<string, readonly string[]>;
}
interface Jurisdictions {
  readonly counts?: Record<string, number>;
}
interface GeoJson {
  readonly features?: readonly unknown[];
}
interface BallotContest {
  readonly id?: string;
  readonly ocdId?: string;
  readonly type?: string;
  readonly provenance?: Provenance;
}
interface BallotCandidacy {
  readonly id?: string;
  readonly contestId?: string;
  readonly provenance?: Provenance;
}
interface BallotMeasure {
  readonly id?: string;
  readonly contestId?: string;
}
interface BallotAbsence {
  readonly ocdId?: string;
  readonly statement?: string;
  readonly provenance?: Provenance;
}
interface BallotFile {
  readonly contests?: readonly BallotContest[];
  readonly candidacies?: readonly BallotCandidacy[];
  readonly measures?: readonly BallotMeasure[];
  readonly absences?: readonly BallotAbsence[];
}
interface FecCandidate {
  readonly state?: string;
  readonly totals?: { readonly receipts?: number } | null;
}
interface FecAbsence {
  readonly targetKey?: string;
  readonly reason?: string;
  readonly checkedAt?: string;
}
interface FecFile {
  readonly fetchedAt?: string;
  readonly candidates?: readonly FecCandidate[];
  readonly absences?: readonly FecAbsence[];
}
interface Meeting {
  readonly id?: string;
  readonly ocdId?: string;
  readonly bodyId?: string;
}
interface MeetingsFile {
  readonly generatedAt?: string;
  readonly meetings?: readonly Meeting[];
}
interface StateMoneyFile {
  readonly collectedAt?: string;
  readonly split?: Record<string, number>;
  readonly records?: readonly Record<string, unknown>[];
}
interface OfficeholdersFile {
  readonly generatedAt?: string;
  readonly officeholders?: readonly Record<string, unknown>[];
}

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as T;
}
function readJsonIf<T>(rel: string): T | null {
  return existsSync(join(ROOT, rel)) ? readJson<T>(rel) : null;
}

const REGISTRY = readJson<Registry>("lib/registry/registry.json");
const ZIP_DIVISION_IDS = readJson<ZipDivisionIds>("data/derived/zip-division-ids.json");
const DIV_BY_OCD = new Map<string, Division>(REGISTRY.divisions.map((d) => [d.ocdId, d]));

/* ------------------------------------------------------------- instrument tallies */

const dateOf = (iso: string | undefined): string | null =>
  typeof iso === "string" && iso.length >= 10 ? iso.slice(0, 10) : null;
const maxDate = (a: string | null, b: string | null): string | null =>
  a === null ? b : b === null ? a : a >= b ? a : b;

/** Held divisions of a state, counted by type, with the newest collectedAt.
 *  NOTE: `division.state` is UPPERCASE (e.g. "AZ") in the registry. */
function heldDivisions(code: string): { byType: Record<string, number>; asOf: string | null } {
  const upper = code.toUpperCase();
  const byType: Record<string, number> = {};
  let asOf: string | null = null;
  for (const d of REGISTRY.divisions) {
    if (d.state !== upper) continue;
    byType[d.divisionType] = (byType[d.divisionType] ?? 0) + 1;
    asOf = maxDate(asOf, dateOf(d.provenance?.collectedAt));
  }
  return { byType, asOf };
}

/** Classify a body or a meeting by its OCD level segment (lowercase `state:xx`). */
function levelOf(id: string): "county" | "place" | "school" | "other" {
  if (/school_district:/.test(id)) return "school";
  if (/\bplace:/.test(id)) return "place";
  if (/county:/.test(id)) return "county";
  return "other";
}

/** Governing-body statistics per level for one state. */
function bodyStats(code: string): { county: BodyLevelStat; place: BodyLevelStat; school: BodyLevelStat } {
  const blank = (): { sourceLocated: number; live: number; asOf: string | null } => ({
    sourceLocated: 0,
    live: 0,
    asOf: null,
  });
  const acc = { county: blank(), place: blank(), school: blank() };
  for (const b of REGISTRY.bodies) {
    const idStr = String(b.ocdId ?? b.id ?? "");
    if (!idStr.includes(`state:${code}`)) continue;
    const level = levelOf(idStr);
    if (level === "other") continue;
    const bucket = acc[level];
    const status = b.coverageStatus;
    if (status === "LIVE" || status === "KNOWN_UNCOVERED" || status === "MANUAL") bucket.sourceLocated += 1;
    if (status === "LIVE" || status === "MANUAL") bucket.live += 1;
    if (status === "LIVE" || status === "KNOWN_UNCOVERED" || status === "MANUAL") {
      bucket.asOf = maxDate(bucket.asOf, dateOf(b.provenance?.collectedAt));
    }
  }
  return acc;
}

/**
 * HELD agenda material per level, from the normalized meetings snapshot that
 * `/api/meetings` serves. A body counts once however many meetings it has: the
 * gate asks whether a body's agendas are held at all, not how busy it is.
 */
const MEETINGS = readJsonIf<MeetingsFile>("data/meetings-snapshot.json");
const MEETINGS_AS_OF = dateOf(MEETINGS?.generatedAt);

function heldAgendasFor(code: string): { county: HeldAgendaStat; place: HeldAgendaStat; school: HeldAgendaStat } {
  const acc = {
    county: { bodies: new Set<string>(), meetings: 0 },
    place: { bodies: new Set<string>(), meetings: 0 },
    school: { bodies: new Set<string>(), meetings: 0 },
  };
  for (const m of MEETINGS?.meetings ?? []) {
    const bodyId = String(m.bodyId ?? m.ocdId ?? "");
    if (!bodyId.includes(`state:${code}`)) continue;
    const level = levelOf(bodyId);
    if (level === "other") continue;
    acc[level].bodies.add(bodyId);
    acc[level].meetings += 1;
  }
  const stat = (b: { bodies: Set<string>; meetings: number }): HeldAgendaStat => ({
    bodies: b.bodies.size,
    meetings: b.meetings,
    asOf: b.bodies.size > 0 ? MEETINGS_AS_OF : null,
  });
  return { county: stat(acc.county), place: stat(acc.place), school: stat(acc.school) };
}

/**
 * The INDEPENDENT external count of congressional districts: the cd119
 * cartographic FeatureCollection's feature count (CC-F2), never the held count.
 * AZ=9, NH=2, NJ=12. The file is FOUND BY GLOB (`cd119-<fips>.geojson`) so no
 * hand-kept state→FIPS list lives here (coverage-manifest guard). Null when no
 * committed cd119 geojson exists → the capability renders a named gap.
 */
function cdUniverse(code: string): number | null {
  const geoRel = join("data", "states", code, "geo");
  const geoDir = join(ROOT, geoRel);
  if (!existsSync(geoDir)) return null;
  const file = readdirSync(geoDir).find((f) => /^cd119-\d+\.geojson$/.test(f));
  if (!file) return null;
  const geo = readJsonIf<GeoJson>(join(geoRel, file));
  const n = Array.isArray(geo?.features) ? geo.features.length : 0;
  return n > 0 ? n : null;
}

/* ------------------------------------------------------------- ballot holdings */

/**
 * Every committed ballot holding for a state, as one path list. A ballot file
 * is one carrying a `candidacies` or `contests` array; the contacts, analyses
 * and measure-summary siblings in the same directory are different record
 * classes and are not counted as filings.
 */
function ballotFiles(code: string): { path: string; file: BallotFile }[] {
  const rel = join("data", "states", code, "ballot");
  const dir = join(ROOT, rel);
  if (!existsSync(dir)) return [];
  const out: { path: string; file: BallotFile }[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json") || /-contacts\.json$/.test(name) || /analyses|measure-summaries/.test(name)) continue;
    const file = readJsonIf<BallotFile>(join(rel, name).replaceAll("\\", "/"));
    if (!file || (!Array.isArray(file.candidacies) && !Array.isArray(file.contests))) continue;
    out.push({ path: join(rel, name).replaceAll("\\", "/"), file });
  }
  return out;
}

/**
 * An official government source under §8: a `.gov` host, or an established
 * official publication platform whose government ownership is established by
 * the record itself naming the government as the publishing organisation. This
 * does NOT waive extraction correctness or provenance — it refuses to invent a
 * "needs a second publisher" bar the project never adopted.
 */
function officialSource(url: string, org: string): boolean {
  const host = /^https?:\/\/([^/]+)/i.exec(url)?.[1]?.toLowerCase() ?? "";
  if (/(^|\.)gov$/.test(host.replace(/:\d+$/, ""))) return true;
  // A county clerk's own domain is the government's official publication even
  // where the office does not sit on a .gov host; the ownership is established
  // by the record naming the office as the publisher AND the document living on
  // that office's own site.
  return /clerk|elections|county|secretary of state|board of elections/i.test(org) && host !== "";
}

/** The candidate filings a state's committed ballot holdings actually carry. */
function ballotFor(code: string): BallotFilingInstrument | null {
  const files = ballotFiles(code);
  if (files.length === 0) return null;
  let candidacies = 0;
  let sourced = 0;
  let contests = 0;
  const documents = new Set<string>();
  const orgs = new Set<string>();
  let allOfficial = true;
  let asOf: string | null = null;
  for (const { file } of files) {
    contests += (file.contests ?? []).length;
    for (const cand of file.candidacies ?? []) {
      candidacies += 1;
      const p = cand.provenance;
      const url = String(p?.sourceUrl ?? "");
      const org = String(p?.sourceOrg ?? "");
      if (url !== "" && org !== "") {
        sourced += 1;
        documents.add(url);
        orgs.add(org);
        if (!officialSource(url, org)) allOfficial = false;
      }
      asOf = maxDate(asOf, dateOf(p?.verifiedAt ?? p?.collectedAt));
    }
  }
  if (candidacies === 0 || asOf === null) return null;
  return {
    candidacies,
    sourced,
    contests,
    documents: documents.size,
    authority: [...orgs].sort().join(" and "),
    officialSource: allOfficial && orgs.size > 0,
    asOf,
  };
}

/** Statewide and local ballot-measure contests, and how many carry question text. */
function measuresFor(code: string): { statewide: MeasureInstrument | null; local: MeasureInstrument | null } {
  const files = ballotFiles(code);
  const statewideOcd = new RegExp(`^ocd-division/country:us/state:${code}$`);
  let swContests = 0;
  let swAcquired = 0;
  let loContests = 0;
  let loAcquired = 0;
  const orgs = new Set<string>();
  let asOf: string | null = null;
  for (const { file } of files) {
    const haveText = new Set((file.measures ?? []).map((m) => String(m.contestId ?? "")));
    for (const contest of file.contests ?? []) {
      if (contest.type !== "MEASURE") continue;
      const isStatewide = statewideOcd.test(String(contest.ocdId ?? ""));
      const acquired = haveText.has(String(contest.id ?? "")) ? 1 : 0;
      if (isStatewide) {
        swContests += 1;
        swAcquired += acquired;
      } else {
        loContests += 1;
        loAcquired += acquired;
      }
      if (contest.provenance?.sourceOrg) orgs.add(String(contest.provenance.sourceOrg));
      asOf = maxDate(asOf, dateOf(contest.provenance?.verifiedAt ?? contest.provenance?.collectedAt));
    }
  }
  const authority = [...orgs].sort().join(" and ");
  const make = (contests: number, acquired: number): MeasureInstrument | null =>
    contests > 0 && asOf !== null && authority !== "" ? { contests, acquired, authority, asOf } : null;
  return { statewide: make(swContests, swAcquired), local: make(loContests, loAcquired) };
}

/**
 * A government's own statement that no statewide ballot question exists here.
 *
 * The ballot holdings record absences as sourced statements scoped to an OCD
 * division. Only a STATEWIDE-scoped one may argue the statewide-propositions
 * capability absent (CC-F1: an absence proves what it is scoped to and nothing
 * else). A per-municipality "no local election" statement is real, and it
 * argues nothing about the whole state, so it is not projected here.
 */
function sourcedAbsencesFor(code: string): SourcedAbsence[] {
  const statewideOcd = `ocd-division/country:us/state:${code}`;
  const out: SourcedAbsence[] = [];
  for (const { file } of ballotFiles(code)) {
    for (const a of file.absences ?? []) {
      if (String(a.ocdId ?? "") !== statewideOcd) continue;
      const statement = String(a.statement ?? "");
      const asOf = dateOf(a.provenance?.verifiedAt ?? a.provenance?.collectedAt);
      const ref = String(a.provenance?.sourceUrl ?? "");
      const org = String(a.provenance?.sourceOrg ?? "");
      if (statement === "" || asOf === null || ref === "" || org === "") continue;
      // The statement must be about a ballot question to argue that capability.
      if (!/ballot question|constitutional amendment|question/i.test(statement)) continue;
      out.push({ capabilityId: "ballot.statewide-propositions", statement, authority: org, ref, asOf });
    }
  }
  return out;
}

/* ------------------------------------------------------------- federal finance */

const FEC = readJsonIf<FecFile>("data/fec/fec-2026.json");

/**
 * **THE PER-STATE FEDERAL SLICE (CC-F5, corrected 2026-09-06 for ADM-40).**
 *
 * The previous note here said the committed FEC reconciliation was national and
 * that "its absences carry no state, so no deterministic state slice exists".
 * That was false at the record level, and it is exactly why Federal · FEC
 * rendered blank for every state while a senator's card showed his filings in
 * full. Two deterministic state keys are in the file:
 *
 *   - every `candidates[]` row carries its own `state`, as the two-letter postal
 *     code in upper case;
 *   - every `absences[]` row carries a `targetKey` of the shape
 *     `ballot-<state>-<county>:<contest>:<slug>`, and a `reason` naming the
 *     office as `NJ-S` / `NH-H02`. The targetKey is read first and the reason
 *     is the cross-check; a row that neither key attributes is counted for no
 *     state at all rather than guessed at.
 *
 * The national counter is still never a state's own denominator: this slice is
 * built from the state's own rows only.
 */
function fecFor(code: string): FecInstrument | null {
  if (!FEC) return null;
  const asOf = dateOf(FEC.fetchedAt);
  if (asOf === null) return null;
  const upper = code.toUpperCase();
  const candidates = (FEC.candidates ?? []).filter((c) => String(c.state ?? "").toUpperCase() === upper);
  const held_ = candidates.filter((c) => c.totals && typeof c.totals.receipts === "number").length;
  const absences = (FEC.absences ?? []).filter((a) => {
    const byKey = /^ballot-([a-z]{2})-/.exec(String(a.targetKey ?? ""))?.[1];
    if (byKey) return byKey === code;
    const byReason = /\b([A-Z]{2})-(?:S|H\d{2})\b/.exec(String(a.reason ?? ""))?.[1];
    return byReason === upper;
  }).length;
  const total = candidates.length + absences;
  if (total === 0) return null;
  return {
    matched: held_,
    // Every absence carries the FEC search URL that established it, so the whole
    // universe is resolved against the FEC one way or the other.
    total,
    authority: `Federal Election Commission (openFEC) — federal candidacies for ${upper} in the 2026 cycle`,
    asOf,
  };
}

/* ------------------------------------------------------------- state disclosure */

/**
 * Held state-disclosure filings against the candidacies in scope for the
 * state's own disclosure system, from the normalized reader snapshot the
 * candidate and official cards render (`state-money-<st>-2026.json`).
 */
function stateDisclosureFor(code: string): ReconInstrument | null {
  const rel = `data/states/${code}/funding/state-money-${code}-2026.json`;
  const file = readJsonIf<StateMoneyFile>(rel);
  const asOf = dateOf(file?.collectedAt);
  const inScope = file?.split?.candidaciesInScope;
  const filed = file?.split?.filed;
  if (!file || asOf === null || typeof inScope !== "number" || inScope <= 0 || typeof filed !== "number") return null;
  return {
    covered: Math.min(filed, inScope),
    total: inScope,
    authority: `${code.toUpperCase()} state campaign-finance disclosure system`,
    asOf,
  };
}

/** AZ candidate-filings reconciliation against the SoS certified canvass. */
function azBallotVerification(): ReconInstrument | null {
  const r = readJsonIf<{
    generatedAt?: string;
    proof?: { uniquelyReconciled?: number; lineupNominees?: number };
  }>("data/states/az/identity/az-2026-certified-lineup-reconciliation.json");
  const p = r?.proof;
  const asOf = dateOf(r?.generatedAt);
  if (!p || asOf === null || typeof p.lineupNominees !== "number" || p.lineupNominees <= 0) return null;
  return {
    covered: p.uniquelyReconciled ?? 0,
    total: p.lineupNominees,
    authority: "AZ Secretary of State certified primary canvass",
    asOf,
  };
}

/** AZ state-disclosure reconciliation against AZ SeeTheMoney. */
function azStateDisclosureVerification(): ReconInstrument | null {
  const r = readJsonIf<{
    collectedAt?: string;
    reconciliation?: { committeesTested?: number; agreed?: number };
  }>("data/states/az/campaign-finance/az-seethemoney-2026-reconciliation.json");
  const rec = r?.reconciliation;
  const asOf = dateOf(r?.collectedAt);
  if (!rec || asOf === null || typeof rec.committeesTested !== "number" || rec.committeesTested <= 0) return null;
  return {
    covered: rec.agreed ?? 0,
    total: rec.committeesTested,
    authority: "AZ SeeTheMoney (state disclosure system)",
    asOf,
  };
}

/*
 * NOTE (CC-F1): the committed argued-absence files (data/hunt/argued-absences-*.json)
 * are PER-CANDIDACY, PER-FIELD records (a missing verifiedPage/phone/photo for one
 * candidate) that carry an `expiresOn` and prove nothing about officials or seats
 * at the capability level — and every row is currently expired. They must NOT be
 * projected onto officials.state-federal-seats, so this publisher supplies NO
 * officials closed walk; that capability derives honestly as NOT_WALKED. The
 * capability+expiry-scoped ARGUED_ABSENT guard lives in extract.ts for a future
 * correctly-scoped, unexpired instrument.
 */

/* ------------------------------------------------------------- reader delivery */

/**
 * **WHAT THE READER IS DECLARED TO BE SERVED.** (ADM-40, §9A.9.)
 *
 * Never asserted here. Both halves are read out of declarations the repository
 * already enforces elsewhere:
 *
 *   `datasetFamily(path).surfaces`  — lib/holdings/datasets.ts; the reader
 *       surfaces a holdings path feeds. `validateDatasetMapping` fails the
 *       build when a declared surface or consumer module does not exist.
 *   `readerTraceRequirements(root)` — lib/holdings/reader-trace.ts; the reader
 *       ROUTES whose emitted deployment traces must contain the file.
 *       `checkReaderTraces` fails a build whose trace does not.
 *
 * A path neither declaration names produces NO delivery instrument, and the
 * capability's last two gates stay NOT_WALKED — the honest state for a holding
 * nothing says the Reader reads.
 *
 * The trace requirements need `data/derived/resolver-geometry.json` and a
 * non-empty state-money glob; if either is missing this refuses to guess and
 * simply contributes no routes, rather than crashing the runner's console
 * publish (the surfaces half still stands on its own).
 */
const TRACE_ROUTES: ReadonlyMap<string, string[]> = (() => {
  const byFile = new Map<string, string[]>();
  try {
    for (const req of readerTraceRequirements(ROOT)) {
      for (const file of req.files) {
        const routes = byFile.get(file) ?? [];
        if (!routes.includes(req.route)) routes.push(req.route);
        byFile.set(file, routes);
      }
    }
  } catch (error) {
    console.warn(
      `readiness-refresh: the reader-trace declaration could not be read (${(error as Error)?.message ?? "unknown"}); ` +
        "delivery is derived from the dataset→surface declaration alone this run.",
    );
  }
  return byFile;
})();

const ASK_SURFACE = "ask";
const ASK_ROUTES = ["api/ask/grounded/route", "api/ask/agenda/route"];

/** One delivery row, or null when nothing declares this path a reader input. */
function deliveryOf(capabilityId: string, holding: string, rows: number, unit: string, asOf: string | null): ReaderDelivery | null {
  if (rows <= 0) return null;
  if (!existsSync(join(ROOT, holding))) return null;
  const surfaces = [...(datasetFamily(holding)?.surfaces ?? [])];
  const routes = TRACE_ROUTES.get(holding) ?? [];
  if (surfaces.length === 0 && routes.length === 0) return null;
  return {
    capabilityId,
    holding,
    rows,
    unit,
    surfaces,
    routes,
    askAnswers: surfaces.includes(ASK_SURFACE) || routes.some((r) => ASK_ROUTES.includes(r)),
    asOf,
  };
}

function deliveryFor(spec: StateSpec, ballot: BallotFilingInstrument | null, measures: ReturnType<typeof measuresFor>): ReaderDelivery[] {
  const code = spec.code;
  const { byType, asOf: divisionsAsOf } = heldDivisions(code);
  const registry = "lib/registry/registry.json";
  const out: (ReaderDelivery | null)[] = [];

  /* Districts and geography — the registry divisions the map, representation,
   * ballot and grounded-Ask routes all read through lib/registry/server.ts. */
  out.push(deliveryOf("districts.congressional", registry, byType.cd ?? 0, "congressional district boundaries", divisionsAsOf));
  out.push(deliveryOf("districts.state-legislative", registry, (byType.sldu ?? 0) + (byType.sldl ?? 0), "legislative district boundaries", divisionsAsOf));
  out.push(deliveryOf("districts.county-precinct", registry, byType.county ?? 0, "county boundaries", divisionsAsOf));
  out.push(deliveryOf("districts.school", registry, byType.school_district ?? 0, "school-district boundaries", divisionsAsOf));

  /* Officials — the state officeholder corpus the registry loader serves. The
   * corpus is filed under the state's FIPS code, which is DERIVED from the one
   * authoritative FIPS table (`lib/ocd/fips.ts`, via STATE_FIPS) and never a
   * second hand-kept state list here — tests/coverage-manifest.test.ts refuses
   * one by design, and rightly: a hand-kept list is a denominator that quietly
   * stops growing. */
  const fips = STATE_FIPS[code];
  if (fips) {
    const rel = `data/states/${code}/officials/officeholders-${fips}.json`;
    const file = readJsonIf<OfficeholdersFile>(rel);
    out.push(deliveryOf("officials.state-federal-seats", rel, (file?.officeholders ?? []).length, "officeholder records", dateOf(file?.generatedAt)));
  }

  /* Ballot — the candidacies and measure questions the ballot page and Ask
   * render. A state's holdings may be split across several filing documents, so
   * the rows are SUMMED and the holding named is the file carrying the most of
   * them; naming one file and counting only its rows would understate the row
   * the operator is looking at. */
  const files = ballotFiles(code);
  const ballotRows = (pick: (f: BallotFile) => number): { path: string; rows: number } | null => {
    let best: { path: string; rows: number } | null = null;
    let total = 0;
    for (const { path, file } of files) {
      const n = pick(file);
      total += n;
      if (n > 0 && (best === null || n > best.rows)) best = { path, rows: n };
    }
    return best === null ? null : { path: best.path, rows: total };
  };
  if (ballot) {
    const c = ballotRows((f) => (f.candidacies ?? []).length);
    if (c) out.push(deliveryOf("ballot.candidate-filings", c.path, c.rows, "candidacies", ballot.asOf));
  }
  for (const [capabilityId, instrument] of [["ballot.statewide-propositions", measures.statewide], ["ballot.local-measures", measures.local]] as const) {
    if (!instrument || instrument.acquired <= 0) continue;
    const m = ballotRows((f) => (f.measures ?? []).length);
    // The row count is the questions held AT THIS SCOPE, not every measure in
    // the file: a statewide row may never count a county's questions as its own.
    if (m) out.push(deliveryOf(capabilityId, m.path, instrument.acquired, "measure questions", instrument.asOf));
  }

  /* Federal finance — the committed FEC corpus the funding route, the ballot
   * cards, the map and grounded Ask all read through lib/funding/snapshot.ts. */
  const fecRows = (FEC?.candidates ?? []).filter((c) => String(c.state ?? "").toUpperCase() === code.toUpperCase()).length;
  out.push(deliveryOf("finance.federal-fec", "data/fec/fec-2026.json", fecRows, "candidate finance records", dateOf(FEC?.fetchedAt)));

  /* State finance — the normalized state-money snapshot the cards render. */
  const moneyRel = `data/states/${code}/funding/state-money-${code}-2026.json`;
  const money = readJsonIf<StateMoneyFile>(moneyRel);
  out.push(deliveryOf("finance.state-disclosure", moneyRel, (money?.records ?? []).length, "state finance records", dateOf(money?.collectedAt)));

  /* Meetings — one holding, three capability rows; each names the level's own
   * share so a row never claims the state's whole meeting corpus. */
  const agendas = heldAgendasFor(code);
  for (const [capabilityId, stat] of [
    ["meetings.county-boards", agendas.county],
    ["meetings.city-councils", agendas.place],
    ["meetings.school-boards", agendas.school],
  ] as const) {
    out.push(deliveryOf(capabilityId, "data/meetings-snapshot.json", stat.meetings, "meetings", stat.asOf));
  }

  return out.filter((d): d is ReaderDelivery => d !== null);
}

/* ------------------------------------------------------------- zips (real committed data) */

/**
 * **THE PLACE BESIDE A ZIP, AND WHAT IT IS NOT.** (ADM-41, 9.6.26.)
 *
 * The owner read *"Arivaca — 32 people"* on ZIP 85633 as a fact about a town.
 * The number was the ZIP's Census tabulation area; the NAME was a different
 * geography entirely — `place:arivaca_ccd`, a Census County Division covering a
 * large rural area that contains the ZIP. 85633 is Sasabe. The name was wrong
 * because this function STRIPPED the " CCD" suffix, which turned a machine label
 * for a statistical area into what read as the town's name.
 *
 * An incorporated place is still preferred and still rendered plainly. A Census
 * County Division now says what it is, so the operator can see that the name and
 * the population are two different geographies rather than one fact. This does
 * not invent a place name we do not hold: naming the right town for 85633 needs
 * a ZIP → place source this repository has not acquired, and inventing one here
 * would be the same class of error rendered the other way round.
 */
function placeFor(zip: string): string {
  const ocdIds = ZIP_DIVISION_IDS.zips?.[zip] ?? [];
  const divs = ocdIds.map((id) => DIV_BY_OCD.get(id)).filter((d): d is Division => d !== undefined) as {
    divisionType: string;
    label?: string;
  }[];
  const places = divs.filter((d) => d.divisionType === "place");
  const incorporated = places.find((d) => !/\bCCD\b/i.test(String(d.label)));
  if (incorporated) return String(incorporated.label);
  if (places[0]) {
    const label = String(places[0].label).replace(/\s*\bCCD\b$/i, "").trim();
    return `${label} census county division`;
  }
  const county = divs.find((d) => d.divisionType === "county");
  if (county) return `${(county as { label?: string }).label} County`;
  return zip;
}

/** Map a registry body's coverageStatus to a readiness cell state. */
function bodyCellState(coverageStatus: string | undefined) {
  switch (coverageStatus) {
    case "LIVE":
      return "CURRENT" as const;
    case "MANUAL":
      return "PARTIAL_OR_STALE" as const;
    case "KNOWN_UNCOVERED":
    case "NO_SOURCE_FOUND":
      return "BLOCKED" as const;
    default:
      return "NOT_WALKED" as const;
  }
}

/**
 * **THE ZIP'S RESIDENT POPULATION, AND HOW IT MAY BE READ.** (ADM-23; ADM-41.)
 *
 * The number is the American Community Survey 5-Year 2024 estimate for the
 * ZIP's Census tabulation area, measured against the Bureau's own state total.
 * What changed on 2026-09-06 is the second value: the panel now also carries
 * the BASIS on which that estimate may be read, because printing `0 people` and
 * `32 people` as bare facts was the owner's exact objection and both were
 * saying more than the Bureau does.
 *
 * A ZIP with no tabulation area is still a named gap — a post-office box or
 * single-site ZIP, which is not "nobody lives here".
 */
function zipPopulationCell(zip: string): { population: ZipInput["population"]; basis: ZipInput["populationBasis"]; margin: number | null } {
  const reading = zipPopulationReading(zip);
  if (reading.basis === "NO_TABULATION_AREA" || reading.population === null) {
    return {
      population: gap(
        "OURS",
        "this ZIP has no Census tabulation area, so the Census publishes no resident population for it — a post-office box or single-site ZIP, which is a different fact from nobody living here",
      ),
      basis: "NO_TABULATION_AREA",
      margin: null,
    };
  }
  const ocdIds = ZIP_DIVISION_IDS.zips?.[zip] ?? [];
  const stateCode = ocdIds.map((id) => /state:([a-z]{2})/.exec(id)?.[1] ?? null).find((c) => c !== null) ?? null;
  const stateTotal = stateCode === null ? null : statePopulation(stateCode);
  return {
    population: heldValue(
      measured(
        reading.population,
        stateTotal === null ? Math.max(reading.population, 1) : Math.max(stateTotal, reading.population),
        `residents of this ZIP's ${ACS_ZCTA_GEOGRAPHY_LABEL}, of the state's total, as estimated by the ${ACS_SOURCE_LABEL}`,
        `${ACS_SOURCE_LABEL}, ${ACS_VINTAGE_LABEL} (table B01003)`,
      ),
    ),
    basis: reading.basis,
    margin: reading.marginOfError,
  };
}

/** A zip row derived from REAL committed data: its overlapping registry bodies. */
function realZip(zip: string): ZipInput {
  const ocdIds = ZIP_DIVISION_IDS.zips?.[zip] ?? [];
  const idSet = new Set<string>(ocdIds);
  const bodies = REGISTRY.bodies.filter(
    (b) => (b.ocdId ? idSet.has(b.ocdId) : false) || (b.alsoServesOcdIds ?? []).some((x) => idSet.has(x)),
  );
  const bodyInputs = bodies.map((b) => ({
    state: bodyCellState(b.coverageStatus),
    gap: b.name ?? `${b.bodyClass ?? "body"} (${b.coverageStatus})`,
  }));
  if (bodyInputs.length === 0) {
    bodyInputs.push({ state: "NOT_WALKED" as const, gap: "no governing body enumerated for this zip" });
  }
  const tier = coverageTierForZip(zip);
  const population = zipPopulationCell(zip);
  return {
    zip,
    place: held(placeFor(zip)),
    population: population.population,
    populationBasis: population.basis,
    populationMargin: population.margin,
    bodies: bodyInputs,
    tierLabel: tier === "UNKNOWN" ? null : tier,
  };
}

/** Every zip researched for a state — auto-captured from the committed index. */
function stateZips(code: string): string[] {
  const zips = ZIP_DIVISION_IDS.zips ?? {};
  return Object.keys(zips)
    .filter((zip) => (zips[zip] ?? []).some((id) => id.includes(`state:${code}`)))
    .sort();
}

/* ------------------------------------------------------------- assemble authorities */

interface StateSpec {
  readonly code: string;
  readonly name: string;
  readonly jurisdictionsRel: string;
}

const STATES: readonly StateSpec[] = [
  { code: "az", name: "Arizona", jurisdictionsRel: "data/states/az/jurisdictions/az.json" },
  { code: "nh", name: "New Hampshire", jurisdictionsRel: "data/states/nh/jurisdictions/nh.json" },
  { code: "nj", name: "New Jersey", jurisdictionsRel: "data/states/nj/jurisdictions/nj.json" },
];

function authoritiesFor(spec: StateSpec): StateAuthorities {
  const counts = readJsonIf<Jurisdictions>(spec.jurisdictionsRel)?.counts ?? {};
  const { byType, asOf } = heldDivisions(spec.code);
  const ballot = ballotFor(spec.code);
  const measures = measuresFor(spec.code);
  return {
    code: spec.code,
    name: spec.name,
    counts,
    heldDivisions: byType,
    divisionsAsOf: asOf,
    cdUniverse: cdUniverse(spec.code),
    bodies: bodyStats(spec.code),
    heldAgendas: heldAgendasFor(spec.code),
    // CC-F5 corrected: a deterministic per-state slice DOES exist. See fecFor().
    fec: fecFor(spec.code),
    ballotFilings: ballot,
    // Only AZ has an EXTERNAL reconciliation of its filings today.
    ballotVerification: spec.code === "az" ? azBallotVerification() : null,
    statewideMeasures: measures.statewide,
    localMeasures: measures.local,
    stateDisclosure: stateDisclosureFor(spec.code),
    stateDisclosureVerification: spec.code === "az" ? azStateDisclosureVerification() : null,
    // No correctly-scoped, unexpired officials-seat closed walk exists (CC-F1).
    officialsClosedWalk: null,
    sourcedAbsences: sourcedAbsencesFor(spec.code),
    delivery: deliveryFor(spec, ballot, measures),
    // ADM-23: the external denominator for population-weighted completeness.
    statePopulation: statePopulation(spec.code),
  };
}

function inputsFor(spec: StateSpec): ReadinessInputs {
  const authorities = authoritiesFor(spec);
  const zips = stateZips(spec.code).map((z) => realZip(z));
  return deriveStateInputs(
    authorities,
    { nowIso: NOW, sha: process.env.GITHUB_SHA ?? null, publisher: "the readiness publisher" },
    zips,
  );
}

/* ----------------------------------------------------------------- main */

async function openStore(): Promise<{ repos: ControlPlaneRepositories; where: string }> {
  // Production is written ONLY on the explicit `--target=control-plane` route
  // (the `readiness:publish` command). A generic `readiness:refresh` — no target,
  // or `--target=file` — is ALWAYS the local file store, even when .env.local
  // carries WTP_CONTROL_PLANE_DATABASE_URL: the production URL's mere presence
  // never selects production (CC-F3). We do not even read the URL off-target, so
  // no production client is constructed on the default path.
  if (chooseReadinessStoreTarget(args.get("target")) === "control-plane") {
    const url = controlPlaneUrlFromEnv();
    if (url === null) {
      throw new Error(
        "readiness:publish (--target=control-plane) requires WTP_CONTROL_PLANE_DATABASE_URL; refusing to publish without it.",
      );
    }
    return { repos: await createPgRepositories(url), where: "control plane (Postgres)" };
  }
  const dir = args.get("out") ?? "data/control-plane";
  return { repos: await createFileRepositories(dir), where: `local file store (${dir})` };
}

async function main() {
  await refreshPopulationFromPromoted();
  const { repos, where } = await openStore();
  const only = args.get("state") as string | undefined;
  const chosen = only ? STATES.filter((s) => s.code === only) : STATES;

  for (const spec of chosen) {
    const inputs = inputsFor(spec);
    const snapshot = computeReadinessSnapshot(inputs, NOW);
    // RULING 159: a zero must be earned. The taxonomy is always non-empty, so a
    // snapshot with zero capabilities is a defect — refuse it rather than publish
    // a hollow record that would render as an honest-looking empty state.
    if (snapshot.capabilities.length === 0) {
      throw new Error(
        `readiness-refresh: ${spec.code} produced zero capabilities; a hollow snapshot is refused, not published.`,
      );
    }
    const existing = await repos.readinessSnapshots.read(spec.code);
    if (existing) await repos.readinessSnapshots.compareAndSet(spec.code, existing.revision, snapshot, NOW);
    else await repos.readinessSnapshots.put(spec.code, snapshot, NOW);
    const walked = snapshot.capabilities.filter((r) => r.gates.some((g) => g.state !== "NOT_WALKED")).length;
    console.log(
      `published ${spec.code} (${spec.name}) → ${where}: ${snapshot.capabilities.length} capabilities ` +
        `(${walked} with a walked gate), ${snapshot.delivery.length} reader-delivery declaration(s), ` +
        `${snapshot.zips.length} zips, ` +
        `${snapshot.monotonicityViolations.length} monotonicity violations, ${snapshot.evidenceWalks.length} walk(s).`,
    );
  }
  console.log(`readiness snapshots written to ${where}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
