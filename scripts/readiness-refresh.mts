/**
 * **THE READINESS PUBLISHER — a thin IO shell over a pure derivation.**
 * (State Readiness Control Panel, 2026-09-03/04. Rewritten 2026-09-04 to stop
 * hand-authoring readiness facts, R-H.)
 *
 * This script's ONLY job is IO: read the committed authorities off disk, tally
 * them into the typed `StateAuthorities` shape, and write the computed snapshot
 * to the control plane the panel reads. Every readiness FACT — which gate is
 * current, at what count, as of when — is DERIVED in `lib/control-plane/
 * readiness/extract.ts`, a pure module a test can pin. The publisher may
 * materialize derived truth; it may not author it. Where an instrument does not
 * exist on current main, the gate is NOT_WALKED — never a typed-in success.
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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { gap, held } from "../lib/control-plane/owner-surface.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import {
  controlPlaneUrlFromEnv,
  createPgRepositories,
} from "../lib/control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { coverageTierForZip } from "../lib/coverage/zip-tier.ts";
import {
  type BodyLevelStat,
  type ReconInstrument,
  type StateAuthorities,
  chooseReadinessStoreTarget,
  deriveStateInputs,
} from "../lib/control-plane/readiness/extract.ts";
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

/** Classify a body by its OCD level segment (bodies use lowercase `state:xx`). */
function bodyLevel(b: Body): "county" | "place" | "school" | "other" {
  const s = String(b.ocdId ?? b.id ?? "");
  if (/school_district:/.test(s)) return "school";
  if (/\bplace:/.test(s)) return "place";
  if (/county:/.test(s)) return "county";
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
    const level = bodyLevel(b);
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
 * The INDEPENDENT external count of congressional districts: the cd119
 * cartographic FeatureCollection's feature count (CC-F2), never the held count.
 * AZ=9, NH=2, NJ=12. Null when the committed geojson is absent → named gap.
 */
const STATE_FIPS: Record<string, string> = { az: "04", nh: "33", nj: "34" };
function cdUniverse(code: string): number | null {
  const fips = STATE_FIPS[code];
  if (!fips) return null;
  const geo = readJsonIf<GeoJson>(`data/states/${code}/geo/cd119-${fips}.geojson`);
  const n = Array.isArray(geo?.features) ? geo.features.length : 0;
  return n > 0 ? n : null;
}

/** AZ candidate-filings reconciliation against the SoS certified canvass. */
function azBallotFilings(): ReconInstrument | null {
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
function azStateDisclosure(): ReconInstrument | null {
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

/* ------------------------------------------------------------- zips (real committed data) */

function placeFor(zip: string): string {
  const ocdIds = ZIP_DIVISION_IDS.zips?.[zip] ?? [];
  const divs = ocdIds.map((id) => DIV_BY_OCD.get(id)).filter((d): d is Division => d !== undefined) as {
    divisionType: string;
    label?: string;
  }[];
  const places = divs.filter((d) => d.divisionType === "place");
  const incorporated = places.find((d) => !/\bCCD\b/i.test(String(d.label)));
  if (incorporated) return String(incorporated.label);
  if (places[0]) return String(places[0].label).replace(/\s*\bCCD\b$/i, "").trim();
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
  return {
    zip,
    place: held(placeFor(zip)),
    population: gap("OURS", "population not on file"),
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
  return {
    code: spec.code,
    name: spec.name,
    counts,
    heldDivisions: byType,
    divisionsAsOf: asOf,
    cdUniverse: cdUniverse(spec.code),
    bodies: bodyStats(spec.code),
    // The committed FEC reconciliation is NATIONAL and its absences carry no
    // state, so no deterministic state slice exists (CC-F5) — pass none and let
    // finance.federal-fec render a named state gap, never the national number.
    fec: null,
    ballotFilings: spec.code === "az" ? azBallotFilings() : null,
    stateDisclosure: spec.code === "az" ? azStateDisclosure() : null,
    // No correctly-scoped, unexpired officials-seat closed walk exists (CC-F1).
    officialsClosedWalk: null,
  };
}

function inputsFor(spec: StateSpec): ReadinessInputs {
  const authorities = authoritiesFor(spec);
  const zips = stateZips(spec.code).map((z) => realZip(z));
  return deriveStateInputs(
    authorities,
    { nowIso: NOW, sha: process.env.GITHUB_SHA ?? null, publisher: "readiness-refresh.mts" },
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
        `(${walked} with a walked gate), ${snapshot.zips.length} zips, ` +
        `${snapshot.monotonicityViolations.length} monotonicity violations, ${snapshot.evidenceWalks.length} walk(s).`,
    );
  }
  console.log(`readiness snapshots written to ${where}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
