/**
 * **THE READINESS PUBLISHER — a thin IO shell over a pure derivation.**
 * (State Readiness Control Panel, 2026-09-03/04. Rewritten 2026-09-04 to stop
 * hand-authoring readiness facts, R-H. PDC narrowed it again: canonical
 * routine-source outcomes now belong only to the permanent data-plane
 * projection consumed directly by Admin.)
 *
 * This script's ONLY job is IO: read explicitly adopted static readiness inputs
 * plus the promoted jurisdiction-reference projection, tally them into the
 * typed `StateAuthorities` shape, and write the computed snapshot to the
 * control plane the panel reads. Every readiness FACT — which gate is
 * current, at what count, as of when — is DERIVED in `lib/control-plane/
 * readiness/extract.ts`, a pure module a test can pin. The publisher may
 * materialize derived truth; it may not author it. Where an instrument does not
 * exist on current main, the gate is NOT_WALKED — never a typed-in success.
 *
 * ## Permanent routine-data boundary
 *
 * All routine and explicit-owner production contracts are accounted for by
 * `READINESS_AUTHORITY_COVERAGE`. Their attempts, freshness, promotions, LKG,
 * Reader version and exact changes come from the canonical
 * candidate/event/promotion projection. Republishing a tracked bootstrap here
 * would create a second Admin authority. The sole canonical input consumed by
 * this older snapshot is the promoted jurisdiction-reference projection; all
 * other omitted production capabilities are answered by canonical Admin.
 *
 * TARGET IS SAFE BY DEFAULT (CC-F3). This script writes to the ignored LOCAL
 * FILE STORE under `.runtime/` unless the caller passes the explicit
 * `--target=control-plane`. The presence of `WTP_CONTROL_PLANE_DATABASE_URL` in
 * the environment does NOT select production — so `pnpm readiness:refresh`,
 * even with `.env.local` loaded, only derives locally and never contacts
 * production or creates tracked operational truth. Production publication is
 * the admitted standing console-publisher child, which passes
 * `--target=control-plane` through the installed runtime.
 * `--out=<dir>` remains an explicit test/dev override.
 *
 * Run (local, safe): `pnpm readiness:refresh`  (→ ignored .runtime file store)
 * Run (dev file store elsewhere): `pnpm exec tsx scripts/readiness-refresh.mts --out=<dir>`
 * Production publication: standing runtime only (`--target=control-plane`).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { gap, held } from "../lib/control-plane/owner-surface.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import {
  controlPlaneUrlFromEnv,
  createPgRepositories,
} from "../lib/control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { coverageTierForZip } from "../lib/coverage/zip-tier.ts";
import { readAllZipDivisions, ZIP_DIVISIONS_DIR } from "../lib/geo/zip-division-index.ts";
import {
  READINESS_AUTHORITY_COVERAGE,
  readinessAuthorityCoverageIssues,
} from "../lib/civic-data/readiness-authority.ts";
import {
  installOperationalReferenceBundle,
  operationalReferenceBundle,
  preloadOperationalReferenceBundle,
  requiredOperationalJurisdictionRegistry,
} from "../lib/civic-data/operational-references.ts";
import type { JurisdictionRegistry } from "../lib/hunt/jurisdiction-universe.ts";
import { datasetFamily } from "../lib/holdings/datasets.ts";
import {
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
import { assertRuntimeAuthority } from "../lib/civic-data/runtime-authority.ts";
import { isCensusPlaceholderDivision } from "../lib/registry/census-placeholders.ts";

const ROOT = process.cwd();
const NOW = new Date().toISOString();
const PRODUCTION_CONTRACT_IDS = READINESS_AUTHORITY_COVERAGE.map(({ contractId }) => contractId);
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"] as const;
  }),
);
const fixtureInputOverlay = args.get("fixture-input-overlay");
if (
  fixtureInputOverlay !== undefined &&
  (process.env.NODE_ENV !== "test" || chooseReadinessStoreTarget(args.get("target")) === "control-plane")
) {
  throw new Error("FIXTURE_INPUT_OVERLAY_TEST_ONLY");
}
const FIXTURE_INPUT_OVERLAY = fixtureInputOverlay === undefined ? null : resolve(ROOT, fixtureInputOverlay);

/* The loose shapes of the adopted static readiness references this reads. */
interface Division {
  readonly ocdId: string;
  readonly divisionType: string;
  readonly geoid?: string | null;
  readonly state?: string;
  readonly provenance?: { readonly collectedAt?: string };
}
/** One governing body as the registry commits it. `coverageStatus` is the same
 *  discovery-time field the live reader coverage reads (lib/registry/coverage.ts):
 *  LIVE = a meeting source is located, KNOWN_UNCOVERED = walked and none found,
 *  NOT_ATTEMPTED = nobody has looked. Not routine held-agenda status — that stays
 *  with canonical Admin. */
interface Body {
  readonly ocdId?: string;
  readonly name?: string;
  readonly bodyClass?: string;
  readonly coverageStatus?: string;
  readonly alsoServesOcdIds?: readonly string[];
}
interface Registry {
  readonly divisions: readonly Division[];
  readonly bodies: readonly Body[];
}
interface GeoJson {
  readonly features?: readonly unknown[];
}
function inputPath(rel: string): string {
  if (FIXTURE_INPUT_OVERLAY !== null) {
    const overlaid = join(FIXTURE_INPUT_OVERLAY, rel);
    if (existsSync(overlaid)) return overlaid;
  }
  return join(ROOT, rel);
}
function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(inputPath(rel), "utf8")) as T;
}
function readJsonIf<T>(rel: string): T | null {
  return existsSync(inputPath(rel)) ? readJson<T>(rel) : null;
}

const REGISTRY = readJson<Registry>("lib/registry/registry.json");
// The national ZIP index (every ZIP code in the country, one shard per ZIP prefix); a test overlay may carry its own.
const ZIP_DIVISIONS = readAllZipDivisions(
  FIXTURE_INPUT_OVERLAY !== null && existsSync(join(FIXTURE_INPUT_OVERLAY, ...ZIP_DIVISIONS_DIR)) ? FIXTURE_INPUT_OVERLAY : ROOT,
);
const DIV_BY_OCD = new Map<string, Division>(REGISTRY.divisions.map((d) => [d.ocdId, d]));

/* ------------------------------------------------------------- instrument tallies */

const dateOf = (iso: string | undefined): string | null =>
  typeof iso === "string" && iso.length >= 10 ? iso.slice(0, 10) : null;
const maxDate = (a: string | null, b: string | null): string | null =>
  a === null ? b : b === null ? a : a >= b ? a : b;

/** Held divisions of a state, counted by type, with the newest collectedAt.
 *  NOTE: `division.state` is UPPERCASE (e.g. "AZ") in the registry.
 *  A Census "no district here" placeholder stays in the registry as geography
 *  but is not a held district boundary: the Census of Governments total it is
 *  read against counts governments (Sean, 2026-09-23). */
function heldDivisions(code: string): { byType: Record<string, number>; asOf: string | null } {
  const upper = code.toUpperCase();
  const byType: Record<string, number> = {};
  let asOf: string | null = null;
  for (const d of REGISTRY.divisions) {
    if (d.state !== upper || isCensusPlaceholderDivision(d)) continue;
    byType[d.divisionType] = (byType[d.divisionType] ?? 0) + 1;
    asOf = maxDate(asOf, dateOf(d.provenance?.collectedAt));
  }
  return { byType, asOf };
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

/* ------------------------------------------------------------- reader delivery */

/**
 * **WHAT THE READER IS DECLARED TO BE SERVED.** (ADM-40, §9A.9.)
 *
 * Never asserted here. It is read out of the static dataset-to-surface
 * declaration the repository already enforces:
 *
 *   `datasetFamily(path).surfaces`  — lib/holdings/datasets.ts; the reader
 *       surfaces a holdings path feeds. `validateDatasetMapping` fails the
 *       build when a declared surface or consumer module does not exist.
 *
 * A path that declaration does not name produces NO delivery instrument, and the
 * capability's last two gates stay NOT_WALKED — the honest state for a holding
 * nothing says the Reader reads.
 */
const ASK_SURFACE = "ask";

/** One delivery row, or null when nothing declares this path a reader input. */
function deliveryOf(capabilityId: string, holding: string, rows: number, unit: string, asOf: string | null): ReaderDelivery | null {
  if (rows <= 0) return null;
  if (!existsSync(join(ROOT, holding))) return null;
  const surfaces = [...(datasetFamily(holding)?.surfaces ?? [])];
  if (surfaces.length === 0) return null;
  return {
    capabilityId,
    holding,
    rows,
    unit,
    surfaces,
    routes: [],
    askAnswers: surfaces.includes(ASK_SURFACE),
    asOf,
  };
}

/**
 * Legacy readiness may describe only adopted static division delivery. Runtime
 * civic-data delivery belongs to canonical promotion/read-model receipts.
 */
function staticDeliveryFor(spec: StateSpec): ReaderDelivery[] {
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
  const ocdIds = ZIP_DIVISIONS.get(zip)?.ids ?? [];
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

/**
 * **THE ZIP POPULATION CELL IS OWNED BY CANONICAL PDC ADMIN.**
 *
 * The old publisher synchronously loaded bundled ACS tables and copied their
 * values into this second snapshot. The permanent ACS contract now owns that
 * pointer, freshness and Reader receipt. Until this unrelated readiness model
 * consumes the canonical observation directly, it renders a named gap rather
 * than reviving the tracked bootstrap as an Admin authority.
 */
function zipPopulationCell(): { population: ZipInput["population"]; basis: ZipInput["populationBasis"]; margin: number | null } {
  return {
    population: gap(
      "OURS",
      "Routine ACS population is shown from the canonical civic-data receipt in Admin; this unrelated readiness snapshot does not duplicate it from tracked files.",
    ),
    basis: "NO_TABULATION_AREA",
    margin: null,
  };
}

/**
 * Map a registry body's `coverageStatus` to a readiness cell state. This is the
 * SAME discovery-time signal the live reader coverage reads (lib/registry/
 * coverage.ts), so a zip row here agrees with the reader's "bodies here" by
 * reading one source, never a second one. It is source-wiring readiness, not the
 * routine held-agenda freshness that belongs to canonical Admin.
 */
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

/** A zip row derived from REAL committed data: its overlapping registry bodies. */
function realZip(zip: string): ZipInput {
  const ocdIds = ZIP_DIVISIONS.get(zip)?.ids ?? [];
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
  const population = zipPopulationCell();
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

/** Every zip in a state — every ZIP the national index gives a division of that state. */
function stateZips(code: string): string[] {
  return [...ZIP_DIVISIONS]
    .filter(([, entry]) => entry.ids.some((id) => id.includes(`state:${code}`)))
    .map(([zip]) => zip)
    .sort();
}

/* ------------------------------------------------------------- assemble authorities */

interface StateSpec {
  readonly code: string;
  readonly name: string;
}

const STATES: readonly StateSpec[] = [
  { code: "az", name: "Arizona" },
  { code: "nh", name: "New Hampshire" },
  { code: "nj", name: "New Jersey" },
];

function authoritiesFor(spec: StateSpec): StateAuthorities {
  const counts = requiredOperationalJurisdictionRegistry(spec.code).counts;
  const { byType, asOf } = heldDivisions(spec.code);
  const noRoutineBodies = {
    county: { sourceLocated: 0, live: 0, asOf: null },
    place: { sourceLocated: 0, live: 0, asOf: null },
    school: { sourceLocated: 0, live: 0, asOf: null },
  };
  const noRoutineAgendas = {
    county: { bodies: 0, meetings: 0, asOf: null },
    place: { bodies: 0, meetings: 0, asOf: null },
    school: { bodies: 0, meetings: 0, asOf: null },
  };
  return {
    code: spec.code,
    name: spec.name,
    counts,
    heldDivisions: byType,
    divisionsAsOf: asOf,
    cdUniverse: cdUniverse(spec.code),
    bodies: noRoutineBodies,
    heldAgendas: noRoutineAgendas,
    fec: null,
    // Ballot, measure, and campaign-finance readiness is projected from the
    // canonical promotion/read models in Admin. Tracked seed holdings cannot
    // publish a second current/acquired/verified or delivery claim here.
    ballotFilings: null,
    ballotVerification: null,
    statewideMeasures: null,
    localMeasures: null,
    stateDisclosure: null,
    stateDisclosureVerification: null,
    // No correctly-scoped, unexpired officials-seat closed walk exists (CC-F1).
    officialsClosedWalk: null,
    sourcedAbsences: [],
    delivery: staticDeliveryFor(spec),
    statePopulation: null,
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
  // (the admitted standing console publisher). A generic `readiness:refresh` — no target,
  // or `--target=file` — is ALWAYS the local file store, even when .env.local
  // carries WTP_CONTROL_PLANE_DATABASE_URL: the production URL's mere presence
  // never selects production (CC-F3). We do not even read the URL off-target, so
  // no production client is constructed on the default path.
  if (chooseReadinessStoreTarget(args.get("target")) === "control-plane") {
    assertRuntimeAuthority({ capabilities: ["CONSOLE_PUBLISHER"] });
    const url = controlPlaneUrlFromEnv();
    if (url === null) {
      throw new Error(
        "standing readiness publication (--target=control-plane) requires WTP_CONTROL_PLANE_DATABASE_URL; refusing to publish without it.",
      );
    }
    return { repos: await createPgRepositories(url), where: "control plane (Postgres)" };
  }
  const dir = args.get("out") ?? join(".runtime", "control-plane", "readiness-proof");
  return { repos: await createFileRepositories(dir), where: `local file store (${dir})` };
}

async function main() {
  const coverageIssues = readinessAuthorityCoverageIssues();
  if (coverageIssues.length > 0) {
    throw new Error(`READINESS_AUTHORITY_COVERAGE_INVALID:${coverageIssues.join(";")}`);
  }
  if (args.has("fixture-operational-reference")) {
    if (process.env.NODE_ENV !== "test" || chooseReadinessStoreTarget(args.get("target")) === "control-plane") {
      throw new Error("FIXTURE_OPERATIONAL_REFERENCE_TEST_ONLY");
    }
    const fixture = (state: "az" | "nh" | "nj") => {
      const value = readJsonIf<JurisdictionRegistry>(`data/states/${state}/jurisdictions/${state}.json`);
      if (!value) throw new Error(`FIXTURE_OPERATIONAL_REFERENCE_MISSING:${state}`);
      return value;
    };
    installOperationalReferenceBundle(operationalReferenceBundle({ az: fixture("az"), nh: fixture("nh"), nj: fixture("nj") }));
  } else {
    await preloadOperationalReferenceBundle({ bypassCache: true });
  }
  const { repos, where } = await openStore();
  console.log(
    `PDC canonical authority coverage accounts for ${PRODUCTION_CONTRACT_IDS.length} production contract(s); ` +
      `tracked runtime-readiness bootstrap is forbidden for ${PRODUCTION_CONTRACT_IDS.join(", ")}`,
  );
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
