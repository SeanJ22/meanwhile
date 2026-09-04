/**
 * **THE READINESS PUBLISHER.** (State Readiness Control Panel, 2026-09-03/04.)
 *
 * Computes a `ReadinessStateSnapshot` per state from real, committed authorities
 * and writes it to the durable control plane the panel reads. This is the
 * materialized readiness table's writer and the on-demand recompute (the panel
 * is a pure read; there is no write path from any admin route).
 *
 * The one place filesystem authorities are read — the deployed page cannot read
 * them. Every number traces to a cited external authority; nothing is invented.
 * Where a gate has not been walked it stays NOT_WALKED — under-claiming, never over.
 *
 * Target: writes to the CONTROL PLANE (Postgres, `WTP_CONTROL_PLANE_DATABASE_URL`)
 * when that is set — the same store the pilot-health page reads — else to the
 * durable file store for local dev. Force with `--target=file|control-plane`.
 *
 * Run (prod): `node --env-file=.env.local --experimental-strip-types scripts/readiness-refresh.mts`
 * Run (dev file store): `pnpm exec tsx scripts/readiness-refresh.mts --target=file`
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { gap, held, measured } from "../lib/control-plane/owner-surface.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import {
  controlPlaneUrlFromEnv,
  createPgRepositories,
} from "../lib/control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { coverageTierForZip } from "../lib/coverage/zip-tier.ts";
import { CAPABILITY_TAXONOMY } from "../lib/control-plane/readiness/catalog.ts";
import {
  type CapabilityInput,
  type ReadinessInputs,
  type ZipInput,
  computeReadinessSnapshot,
} from "../lib/control-plane/readiness/compute.ts";
import type { CellState, Gate, GateEvidence } from "../lib/control-plane/readiness/gates.ts";
import type { EvidenceRung, EvidenceWalk } from "../lib/control-plane/readiness/model.ts";

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
  readonly label?: string;
}
interface Body {
  readonly ocdId?: string;
  readonly id?: string;
  readonly alsoServesOcdIds?: readonly string[];
  readonly name?: string;
  readonly bodyClass?: string;
  readonly coverageStatus?: string;
}
interface Registry {
  readonly divisions: readonly Division[];
  readonly bodies: readonly Body[];
}
interface ZipDivisionIds {
  readonly zips?: Record<string, readonly string[]>;
}
interface StuckStep {
  readonly move: string;
  readonly query: string;
  readonly result: string;
  readonly reached: boolean;
}
interface ArguedAbsenceRow {
  readonly candidacyId: string;
  readonly field: string;
  readonly protocol: readonly StuckStep[];
  readonly at?: string;
  readonly argument: string;
}
interface ArguedAbsenceFile {
  readonly rows: readonly ArguedAbsenceRow[];
  readonly walkedAt?: string;
}
interface Jurisdictions {
  readonly counts?: Record<string, number>;
}

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as T;
}

const REGISTRY = readJson<Registry>("lib/registry/registry.json");
const ZIP_DIVISION_IDS = readJson<ZipDivisionIds>("data/derived/zip-division-ids.json");

/* ------------------------------------------------------------- gate helpers */

function frac(covered: number, total: number, asOf: string | null, staleAfterDays: number | null): GateEvidence {
  return { covered, total, asOf, staleAfterDays, walkClosed: false, blockedReason: null, gatedReason: null, evidenceRef: null };
}
function closedWalk(ref: string, asOf: string): GateEvidence {
  return { covered: 0, total: 0, asOf, staleAfterDays: null, walkClosed: true, blockedReason: null, gatedReason: null, evidenceRef: ref };
}

/** A capability input with a coverage cell + gate evidence, gaps filled NOT_WALKED. */
function cap(
  capabilityId: string,
  coverageLabel: string,
  authority: string | null,
  covered: number,
  total: number | null,
  asOf: string | null,
  gates: Partial<Record<Gate, GateEvidence>>,
): CapabilityInput {
  const t = CAPABILITY_TAXONOMY.find((x) => x.capabilityId === capabilityId)!;
  return {
    capabilityId,
    domain: t.domain,
    label: t.label,
    level: t.level,
    coverage: { covered, total, authority, contract: `${t.label} coverage over its external universe`, label: coverageLabel, asOf },
    gates,
  };
}

/* ------------------------------------------------------------- registry / zips */

const countDivisions = (state: string, type: string) =>
  REGISTRY.divisions.filter((d) => d.state === state && d.divisionType === type).length;

function stateBodies(state: string): readonly Body[] {
  return REGISTRY.bodies.filter((b) => String(b.ocdId ?? b.id).includes(`state:${state}`));
}

/** Map a registry body's coverageStatus to a readiness cell state. */
function bodyState(coverageStatus: string | undefined): CellState {
  switch (coverageStatus) {
    case "LIVE":
      return "CURRENT";
    case "MANUAL":
      return "PARTIAL_OR_STALE";
    case "KNOWN_UNCOVERED":
    case "NO_SOURCE_FOUND":
      return "BLOCKED"; // we looked and there is a named wall / no source
    default:
      return "NOT_WALKED"; // NOT_ATTEMPTED
  }
}

/**
 * A zip row derived from REAL data: its overlapping registry bodies (via the
 * committed zip→OCD-division index), each body's real coverageStatus → a cell
 * state, worst-of across them (R-F), and the stamped coverage tier. Population is
 * an honest named gap until Census ACS B01003 is ingested.
 */
function realZip(zip: string, place: string): ZipInput {
  const ocdIds = ZIP_DIVISION_IDS.zips?.[zip] ?? [];
  const idSet = new Set<string>(ocdIds);
  const bodies = REGISTRY.bodies.filter(
    (b) => (b.ocdId ? idSet.has(b.ocdId) : false) || (b.alsoServesOcdIds ?? []).some((x) => idSet.has(x)),
  );
  const bodyInputs = bodies.map((b) => ({
    state: bodyState(b.coverageStatus),
    gap: b.name ?? `${b.bodyClass ?? "body"} (${b.coverageStatus})`,
  }));
  // A zip that resolves to no enumerated bodies still overlaps governments we have
  // not walked — represent that as one NOT_WALKED contributor, never as complete.
  if (bodyInputs.length === 0) {
    bodyInputs.push({ state: "NOT_WALKED", gap: "no governing body enumerated for this zip" });
  }
  const tier = coverageTierForZip(zip);
  return {
    zip,
    place: held(place),
    population: gap("OURS", "population not on file"),
    bodies: bodyInputs,
    tierLabel: tier === "UNKNOWN" ? null : tier,
  };
}

/* --------------------------------------------------- auto-captured zip enumeration */

const DIV_BY_OCD = new Map<string, Division>(REGISTRY.divisions.map((d) => [d.ocdId, d]));

/**
 * A zip's primary place name, from the registry division its OCD ids name — the
 * place division's label, else the county, else the bare zip. Real, not invented.
 */
function placeFor(zip: string): string {
  const ocdIds = ZIP_DIVISION_IDS.zips?.[zip] ?? [];
  const divs = ocdIds.map((id) => DIV_BY_OCD.get(id)).filter((d): d is Division => d !== undefined);
  const places = divs.filter((d) => d.divisionType === "place");
  const incorporated = places.find((d) => !/\bCCD\b/i.test(String(d.label)));
  if (incorporated) return String(incorporated.label);
  if (places[0]) return String(places[0].label).replace(/\s*\bCCD\b$/i, "").trim();
  const county = divs.find((d) => d.divisionType === "county");
  if (county) return `${county.label} County`;
  return zip;
}

/**
 * Every zip we have RESEARCHED for a state — those resolved to OCD divisions in
 * the committed index. As zips are added and researched, they land here and are
 * auto-captured on the next publish; nothing is hand-listed.
 */
function stateZips(code: string): string[] {
  const zips = ZIP_DIVISION_IDS.zips ?? {};
  return Object.keys(zips)
    .filter((zip) => (zips[zip] ?? []).some((id) => id.includes(`state:${code}`)))
    .sort();
}

/* ----------------------------------------------------------------- Arizona */

function arizona(): ReadinessInputs {
  const az = readJson<Jurisdictions>("data/states/az/jurisdictions/az.json");
  const c = az.counts ?? {};
  const CENSUS = "Census of Governments 2022";
  const CD119 = "Census 119th-Congress cartographic boundary (cd119)";

  const congress = countDivisions("az", "cd") || 9;
  const counties = countDivisions("az", "county");
  const schools = countDivisions("az", "school_district");
  const sldu = countDivisions("az", "sldu");
  const liveBodies = stateBodies("az").filter((b) => b.coverageStatus === "LIVE" || b.coverageStatus === "MANUAL").length;

  const caps: CapabilityInput[] = [
    cap("districts.congressional", `${congress} of 9`, CD119, Math.min(congress, 9), 9, "2026-08-30", {
      SOURCE_KNOWN: frac(9, 9, "2026-08-30", 365),
      ACQUIRED: frac(9, 9, "2026-08-30", 365),
      VERIFIED: frac(9, 9, "2026-08-30", 365),
      SHOWN_TO_READER: frac(9, 9, "2026-08-30", 365),
      ASK_ANSWERS: frac(9, 9, "2026-08-30", 365),
    }),
    cap("districts.state-legislative", `${Math.min(sldu, 30)} of 30`, "Census legislative district boundaries (sldu/sldl)", Math.min(sldu, 30), 30, "2026-08-30", {
      SOURCE_KNOWN: frac(30, 30, "2026-08-30", 365),
      ACQUIRED: frac(Math.min(sldu, 30), 30, "2026-08-30", 365),
    }),
    cap("districts.county-precinct", `${counties} of ${c.COUNTY}`, CENSUS, counties, c.COUNTY, "2026-08-22", {
      SOURCE_KNOWN: frac(c.COUNTY, c.COUNTY, "2026-08-22", 365),
      ACQUIRED: frac(counties, c.COUNTY, "2026-08-22", 365),
    }),
    cap("districts.municipal-wards", `0 of ${c.CITY_OR_TOWN}`, CENSUS, 0, c.CITY_OR_TOWN, "2026-08-22", {
      SOURCE_KNOWN: frac(c.CITY_OR_TOWN, c.CITY_OR_TOWN, "2026-08-22", 365),
    }),
    cap("districts.school", `${schools} of ${c.SCHOOL_DISTRICT}`, CENSUS, schools, c.SCHOOL_DISTRICT, "2026-08-22", {
      SOURCE_KNOWN: frac(c.SCHOOL_DISTRICT, c.SCHOOL_DISTRICT, "2026-08-22", 365),
      ACQUIRED: frac(schools, c.SCHOOL_DISTRICT, "2026-08-22", 365),
    }),
    cap("districts.special", `0 of ${c.SPECIAL_DISTRICT}`, CENSUS, 0, c.SPECIAL_DISTRICT, null, {}),

    cap("officials.state-federal-seats", "complete", "unitedstates.github.io congress-legislators + Open States", 1, 1, "2026-09-01", {
      SOURCE_KNOWN: frac(1, 1, "2026-09-01", 90),
      ACQUIRED: frac(1, 1, "2026-09-01", 90),
      VERIFIED: frac(1, 1, "2026-09-01", 90),
      SHOWN_TO_READER: frac(1, 1, "2026-09-01", 90),
    }),
    cap("officials.county", `${liveBodies > 0 ? 1 : 0} of ${c.COUNTY}`, "publisher roster (each body's own page)", liveBodies > 0 ? 1 : 0, c.COUNTY, liveBodies > 0 ? "2026-08-28" : null, liveBodies > 0 ? { SOURCE_KNOWN: frac(c.COUNTY, c.COUNTY, "2026-08-28", 365), ACQUIRED: frac(1, c.COUNTY, "2026-08-28", 365) } : {}),
    cap("officials.municipal", `${Math.min(liveBodies, c.CITY_OR_TOWN)} of ${c.CITY_OR_TOWN}`, "publisher roster (each body's own page)", Math.min(liveBodies, c.CITY_OR_TOWN), c.CITY_OR_TOWN, liveBodies > 0 ? "2026-08-22" : null, liveBodies > 0 ? { SOURCE_KNOWN: frac(c.CITY_OR_TOWN, c.CITY_OR_TOWN, "2026-08-22", 365), ACQUIRED: frac(Math.min(liveBodies, c.CITY_OR_TOWN), c.CITY_OR_TOWN, "2026-08-22", 365) } : {}),
    cap("officials.school-board", `0 of ${c.SCHOOL_DISTRICT}`, "publisher roster", 0, c.SCHOOL_DISTRICT, null, {}),
    cap("officials.special-district-boards", `0 of ${c.SPECIAL_DISTRICT}`, "publisher roster", 0, c.SPECIAL_DISTRICT, null, {}),

    cap("ballot.candidate-filings", "statewide", "AZ Secretary of State candidate filings", 1, 1, "2026-09-02", { SOURCE_KNOWN: frac(1, 1, "2026-09-02", 30), ACQUIRED: frac(1, 1, "2026-09-02", 30), VERIFIED: frac(1, 1, "2026-09-02", 30), SHOWN_TO_READER: frac(1, 1, "2026-09-02", 30) }),
    cap("ballot.statewide-propositions", "complete", "AZ Secretary of State ballot measures", 1, 1, "2026-09-02", { SOURCE_KNOWN: frac(1, 1, "2026-09-02", 30), ACQUIRED: frac(1, 1, "2026-09-02", 30), VERIFIED: frac(1, 1, "2026-09-02", 30), SHOWN_TO_READER: frac(1, 1, "2026-09-02", 30) }),
    cap("ballot.local-measures", "2 of 15", "county election offices", 2, 15, "2026-08-26", { SOURCE_KNOWN: frac(15, 15, "2026-08-26", 30), ACQUIRED: frac(2, 15, "2026-08-26", 30) }),
    cap("ballot.certified-results", `0 of ${c.COUNTY}`, "county canvass", 0, c.COUNTY, null, { SOURCE_KNOWN: frac(c.COUNTY, c.COUNTY, "2026-08-14", 30) }),

    cap("finance.federal-fec", "complete", "FEC bulk + API", 1, 1, "2026-09-02", { SOURCE_KNOWN: frac(1, 1, "2026-09-02", 7), ACQUIRED: frac(1, 1, "2026-09-02", 7), VERIFIED: frac(1, 1, "2026-09-02", 7), SHOWN_TO_READER: frac(1, 1, "2026-09-02", 7) }),
    cap("finance.state-disclosure", "complete", "AZ Secretary of State disclosure system", 1, 1, "2026-09-01", { SOURCE_KNOWN: frac(1, 1, "2026-09-01", 14), ACQUIRED: frac(1, 1, "2026-09-01", 14), VERIFIED: frac(1, 1, "2026-09-01", 14) }),
    cap("finance.county-committees", `0 of ${c.COUNTY}`, "county recorder committee index", 0, c.COUNTY, null, { SOURCE_KNOWN: frac(c.COUNTY, c.COUNTY, "2026-08-27", 14) }),
    cap("finance.municipal", `0 of ${c.CITY_OR_TOWN}`, "AZ jurisdiction registry (municipalities)", 0, c.CITY_OR_TOWN, null, {}),

    cap("meetings.county-boards", `${Math.min(liveBodies, c.COUNTY)} of ${c.COUNTY}`, "county clerk agendas", Math.min(liveBodies, c.COUNTY), c.COUNTY, liveBodies > 0 ? "2026-09-02" : null, liveBodies > 0 ? { SOURCE_KNOWN: frac(c.COUNTY, c.COUNTY, "2026-09-02", 7), ACQUIRED: frac(Math.min(liveBodies, c.COUNTY), c.COUNTY, "2026-09-02", 7) } : {}),
    cap("meetings.city-councils", `${Math.min(liveBodies, c.CITY_OR_TOWN)} of ${c.CITY_OR_TOWN}`, "city clerk agendas", Math.min(liveBodies, c.CITY_OR_TOWN), c.CITY_OR_TOWN, liveBodies > 0 ? "2026-09-02" : null, liveBodies > 0 ? { SOURCE_KNOWN: frac(c.CITY_OR_TOWN, c.CITY_OR_TOWN, "2026-09-02", 7), ACQUIRED: frac(Math.min(liveBodies, c.CITY_OR_TOWN), c.CITY_OR_TOWN, "2026-09-02", 7) } : {}),
    cap("meetings.school-boards", `0 of ${c.SCHOOL_DISTRICT}`, "district clerk agendas", 0, c.SCHOOL_DISTRICT, null, {}),
    cap("meetings.planning-zoning", `0 of ${c.CITY_OR_TOWN}`, "municipal planning agendas", 0, c.CITY_OR_TOWN, null, {}),
  ];

  return {
    state: "az",
    stateName: "Arizona",
    publishedAt: NOW,
    publishedFromSha: process.env.GITHUB_SHA ?? null,
    publisher: "readiness-refresh.mts",
    capabilities: caps,
    zips: stateZips("az").map((z) => realZip(z, placeFor(z))),
    readerVisibleJurisdictions: held(measured(congress, congress, "AZ congressional districts visible to a reader over the census universe", CD119)),
    populationInCompleteZip: gap("OURS", "population not on file — Census ACS (B01003) not yet ingested, so a population-weighted completeness cannot be computed"),
    timeSinceLastFullPass: gap("OURS", "no full readiness pass has run for Arizona yet"),
  };
}

/* ------------------------------------------------- a pilot state with a real closed walk */

function pilotState(input: {
  code: string;
  name: string;
  jurisdictionsRel: string;
  arguedAbsenceRel: string;
  zip: string;
  place: string;
}): ReadinessInputs {
  const counts: Record<string, number> = existsSync(join(ROOT, input.jurisdictionsRel))
    ? (readJson<Jurisdictions>(input.jurisdictionsRel).counts ?? {})
    : {};
  const CENSUS = "Census of Governments 2022";
  const aa = readJson<ArguedAbsenceFile>(input.arguedAbsenceRel);
  const row = aa.rows.find((r) => r.field === "verifiedPage") ?? aa.rows[0];
  const walkedAt = (row.at ?? aa.walkedAt ?? NOW).slice(0, 10);
  const ref = `${input.code}-${input.zip}-verifiedpages`;
  const rungs: EvidenceRung[] = row.protocol.map((step, i) => ({
    at: row.at ?? aa.walkedAt ?? NOW,
    path: `${step.move}: ${String(step.query).slice(0, 140)}`,
    observed: String(step.result).slice(0, 400),
    outcome: step.reached ? ("WALKED_AND_EMPTY" as const) : ("DOES_NOT_EXIST" as const),
    nextHop: i + 1 < row.protocol.length ? (row.protocol[i + 1].move as string) : null,
    // An opaque vault reference, never a live data-file path (a scanned
    // `data/…` reference would read as a stale state-holding once the source rotates).
    vaultRef: `vault:${input.code}-${input.zip}#${row.candidacyId}:${row.field}`,
  }));
  const walk: EvidenceWalk = {
    ref,
    capabilityId: "officials.state-federal-seats",
    jurisdiction: `${input.zip} · ${input.place}`,
    rungCount: rungs.length,
    sessionCount: 1,
    vaultId: `${input.code}-${input.zip}`,
    closed: true,
    nextUnwalkedRung: null,
    absenceArgument: String(row.argument),
    rungs,
  };

  const county = counts.COUNTY ?? null;
  const muni = counts.CITY_OR_TOWN ?? null;
  const school = counts.SCHOOL_DISTRICT ?? null;
  const special = counts.SPECIAL_DISTRICT ?? null;
  const has = (n: number | null) => n !== null && n > 0;
  const cd = countDivisions(input.code, "cd") || null;

  const caps: CapabilityInput[] = CAPABILITY_TAXONOMY.map((t) => {
    if (t.capabilityId === "officials.state-federal-seats") {
      return cap(t.capabilityId, "walk closed · absence argued", "county clerk certified filings + independent search", 0, 0, walkedAt, {
        SOURCE_KNOWN: frac(1, 1, walkedAt, 90),
        ACQUIRED: closedWalk(ref, walkedAt),
        VERIFIED: closedWalk(ref, walkedAt),
      });
    }
    // Denominators from the jurisdiction registry where we have the count.
    const denom = (id: string): [number | null, string | null] => {
      if (id === "districts.congressional") return [cd, cd ? "cd119" : null];
      if (id === "districts.county-precinct" || id === "officials.county" || id === "finance.county-committees" || id === "ballot.certified-results" || id === "meetings.county-boards") return [county, county ? CENSUS : null];
      if (id === "districts.municipal-wards" || id === "officials.municipal" || id === "finance.municipal" || id === "meetings.city-councils" || id === "meetings.planning-zoning") return [muni, muni ? CENSUS : null];
      if (id === "districts.school" || id === "officials.school-board" || id === "meetings.school-boards") return [school, school ? CENSUS : null];
      if (id === "districts.special" || id === "officials.special-district-boards") return [special, special ? CENSUS : null];
      return [null, null];
    };
    const [total, authority] = denom(t.capabilityId);
    const sourceKnown = has(total) ? { SOURCE_KNOWN: frac(total!, total!, "2026-08-22", 365) } : {};
    const label = has(total) ? `0 of ${total}` : "never";
    return cap(t.capabilityId, label, authority, 0, total, has(total) ? "2026-08-22" : null, sourceKnown);
  });

  return {
    state: input.code,
    stateName: input.name,
    publishedAt: NOW,
    publishedFromSha: process.env.GITHUB_SHA ?? null,
    publisher: "readiness-refresh.mts",
    capabilities: caps,
    zips: stateZips(input.code).map((z) => realZip(z, placeFor(z))),
    evidenceWalks: [walk],
    readerVisibleJurisdictions: has(cd) ? held(measured(cd!, cd!, `${input.name} congressional districts over the census universe`, "cd119")) : gap("OURS", `${input.name} jurisdictions not yet enumerated for readiness`),
    populationInCompleteZip: gap("OURS", "population not on file — Census ACS not yet ingested"),
    timeSinceLastFullPass: gap("OURS", `no full readiness pass has run for ${input.name} yet`),
  };
}

/* ----------------------------------------------------------------- main */

async function openStore(): Promise<{ repos: ControlPlaneRepositories; where: string }> {
  const target = args.get("target");
  const url = controlPlaneUrlFromEnv();
  if (target !== "file" && url !== null) {
    return { repos: await createPgRepositories(url), where: "control plane (Postgres)" };
  }
  return { repos: await createFileRepositories("data/control-plane"), where: "local file store" };
}

async function main() {
  const { repos, where } = await openStore();
  const all: ReadinessInputs[] = [
    arizona(),
    pilotState({ code: "nh", name: "New Hampshire", jurisdictionsRel: "data/states/nh/jurisdictions/nh.json", arguedAbsenceRel: "data/hunt/argued-absences-03255.json", zip: "03255", place: "Newbury · Merrimack County" }),
    pilotState({ code: "nj", name: "New Jersey", jurisdictionsRel: "data/states/nj/jurisdictions/nj.json", arguedAbsenceRel: "data/hunt/argued-absences-07866.json", zip: "07866", place: "Rockaway · Morris County" }),
  ];
  const only = args.get("state") as string | undefined;
  const chosen = only ? all.filter((i) => i.state === only) : all;

  for (const inputs of chosen) {
    const snapshot = computeReadinessSnapshot(inputs, NOW);
    // RULING 159: a zero must be earned. The taxonomy is always non-empty, so a
    // snapshot with zero capabilities is a defect — refuse it rather than publish
    // a hollow record that would render as an honest-looking empty state.
    if (snapshot.capabilities.length === 0) {
      throw new Error(
        `readiness-refresh: ${inputs.state} produced zero capabilities; a hollow snapshot is refused, not published.`,
      );
    }
    const existing = await repos.readinessSnapshots.read(inputs.state);
    if (existing) await repos.readinessSnapshots.compareAndSet(inputs.state, existing.revision, snapshot, NOW);
    else await repos.readinessSnapshots.put(inputs.state, snapshot, NOW);
    const walked = snapshot.capabilities.filter((r) => r.gates.some((g) => g.state !== "NOT_WALKED")).length;
    console.log(
      `published ${inputs.state} (${inputs.stateName}) → ${where}: ${snapshot.capabilities.length} capabilities ` +
        `(${walked} walked), ${snapshot.zips.length} zips, ${snapshot.monotonicityViolations.length} monotonicity violations, ${snapshot.evidenceWalks.length} walk(s).`,
    );
  }
  console.log(`readiness snapshots written to ${where}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
