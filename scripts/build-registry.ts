import { geometryPath } from "../lib/holdings/files.ts";
/**
 * Generate a deterministic registry fixture from committed version inputs.
 *
 *   pnpm registry:fixture -- --fixture-output=<temporary path>
 *
 * It is deliberately unable to write the production bootstrap holding. Live
 * runtime bindings promote through the permanent data plane.
 *
 * The registry is derived, never hand-written: the polygons say which divisions
 * exist, lib/registry/derive.ts says which bodies each division implies, and
 * every generated row is labelled as structural rather than sourced.
 */

import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { today } from "./doc-dates.mjs";

import { TIER_SEGMENTS, type Tier } from "../lib/ocd/tiers.ts";
import { indexAudits } from "../lib/registry/audit.ts";
import { COVERAGE_AUDIT_FILE } from "../lib/registry/coverage-audit.ts";
import { CURATED_BODIES } from "../lib/registry/curated-bodies.ts";
import { CURATED_DIVISIONS } from "../lib/registry/curated-divisions.ts";
import { bodiesFor, slotsFor, type SkipReason } from "../lib/registry/derive.ts";
import {
  loadPromotedBodies,
  validatePromotedBodies,
} from "../lib/registry/promoted-bodies.ts";
import type {
  Body,
  CanonicalGap,
  CanonicalMatch,
  CoverageStatus,
  Division,
  DivisionType,
  Registry,
} from "../lib/registry/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const HOLDINGS_ROOT = join(here, "..");
const fixtureOutput = process.argv.find((value) => value.startsWith("--fixture-output="))?.slice("--fixture-output=".length);
if (!fixtureOutput) throw new Error("FIXTURE_OUTPUT_REQUIRED: this retired generator cannot write tracked runtime truth.");
const OUT = resolve(fixtureOutput);
const repositoryRoot = resolve(here, "..");
const retiredCanonical = resolve(repositoryRoot, "lib", "registry", "registry.json");
if (OUT === retiredCanonical) throw new Error("TRACKED_REGISTRY_WRITE_FORBIDDEN: registry.json is first-seed evidence, not a mutable runtime store.");
const outputWithinRepository = relative(repositoryRoot, OUT);
if (outputWithinRepository && !outputWithinRepository.startsWith("..") && !isAbsolute(outputWithinRepository)
  && !/^\.scratch(?:[\\/]|$)/.test(outputWithinRepository)) {
  throw new Error("TRACKED_REGISTRY_WRITE_FORBIDDEN: fixture output must be outside the repository or under its ignored .scratch directory.");
}

const CANONICAL_URL =
  "https://raw.githubusercontent.com/opencivicdata/ocd-division-ids/master/identifiers/country-us.csv";

/** Which committed file feeds which division type. */
const SOURCES: { file: string; divisionType: DivisionType }[] = [
  { file: "county-us.geojson", divisionType: "county" },
  { file: "place-04.geojson", divisionType: "place" },
  { file: "place-33.geojson", divisionType: "place" },
  { file: "place-34.geojson", divisionType: "place" },
  { file: "cousub-04.geojson", divisionType: "place" },
  { file: "cousub-33.geojson", divisionType: "place" },
  { file: "cousub-34.geojson", divisionType: "place" },
  { file: "unsd-04.geojson", divisionType: "school_district" },
  { file: "unsd-33.geojson", divisionType: "school_district" },
  { file: "unsd-34.geojson", divisionType: "school_district" },
  { file: "elsd-04.geojson", divisionType: "school_district" },
  { file: "elsd-33.geojson", divisionType: "school_district" },
  { file: "elsd-34.geojson", divisionType: "school_district" },
  { file: "scsd-04.geojson", divisionType: "school_district" },
  { file: "scsd-33.geojson", divisionType: "school_district" },
  { file: "scsd-34.geojson", divisionType: "school_district" },
  { file: "sldu-04.geojson", divisionType: "sldu" },
  { file: "sldu-33.geojson", divisionType: "sldu" },
  { file: "sldu-34.geojson", divisionType: "sldu" },
  { file: "sldl-04.geojson", divisionType: "sldl" },
  { file: "sldl-33.geojson", divisionType: "sldl" },
  { file: "sldl-34.geojson", divisionType: "sldl" },
  { file: "cd119.geojson", divisionType: "cd" },
];

interface GeoFeature {
  properties: {
    ocdId: string;
    state: string;
    district: string;
    label: string;
    lsad?: string;
    funcstat?: string;
    classfp?: string;
    /** Census GEOID — the exact key the canonical join uses (D24). */
    geoid?: string;
  };
}

/** Tier from the deepest recognised segment, matching lib/ocd/tiers.ts. */
function tierOf(ocdId: string): Tier | null {
  const segments = ocdId.split("/").slice(1);
  for (let i = segments.length - 1; i >= 0; i--) {
    const key = segments[i].split(":")[0];
    for (const tier of ["local", "state", "national"] as Tier[]) {
      if (TIER_SEGMENTS[tier].includes(key)) return tier;
    }
  }
  return null;
}

/** The containing division: everything but the last segment. */
function parentOf(ocdId: string): string | null {
  const parts = ocdId.split("/");
  if (parts.length <= 2) return null;
  return parts.slice(0, -1).join("/");
}

async function loadDivisions(now: string): Promise<Division[]> {
  const byId = new Map<string, Division>();
  let dropped = 0;

  for (const { file, divisionType } of SOURCES) {
    let raw: string;
    try {
      raw = await readFile(join(HOLDINGS_ROOT, geometryPath(file)), "utf8");
    } catch {
      console.log(`  skip ${file} (absent)`);
      continue;
    }

    const collection = JSON.parse(raw) as { features: GeoFeature[] };
    for (const feature of collection.features) {
      const p = feature.properties;
      const tier = tierOf(p.ocdId);
      if (!tier) {
        // An unknown segment must not inherit a parent's tier — that is a
        // silent misfiling, and lib/ocd/tiers.ts refuses it for the same reason.
        dropped++;
        continue;
      }

      // A municipality present in both the place and county-subdivision files
      // is one government. First writer wins; they carry the same identifier.
      if (byId.has(p.ocdId)) continue;

      byId.set(p.ocdId, {
        ocdId: p.ocdId,
        divisionType,
        tier,
        state: p.state,
        label: p.label,
        parentOcdId: parentOf(p.ocdId),
        lsad: p.lsad ?? null,
        funcstat: p.funcstat ?? null,
        classfp: p.classfp ?? null,
        geoid: p.geoid ?? null,
        canonicalOcdId: null,
        canonicalMatch: "none",
        sourceDataset: "TIGER_GENZ2025",
        provenance: {
          sourceUrl: `https://www2.census.gov/geo/tiger/GENZ2025/shp/`,
          sourceOrg: "U.S. Census Bureau",
          collectedAt: now,
          verifiedAt: null,
        },
      });
    }
  }

  if (dropped > 0) console.log(`  dropped ${dropped} feature(s) with an unrecognised segment`);
  return [...byId.values()];
}

/**
 * Match each internal identifier to the canonical vocabulary.
 *
 * The internal key stays authoritative — adopting the canonical shape wholesale
 * would make Rockaway Township unrepresentable, since the canonical list
 * appears not to carry New Jersey's townships. This records how well the two
 * agree so a low-confidence match is a review item rather than a silent join.
 */
/** The Census layer an OCD identifier names — the scope a GEOID is unique within. */
const LAYER_SEGMENTS = ["school_district", "place", "county", "cd", "sldu", "sldl"] as const;

/**
 * The LAST recognised segment type in an identifier — the layer whose numbering
 * space its GEOID belongs to.
 *
 * The last, not the first, and the difference is total: the canonical identifier
 * for Rockaway Township is
 * `.../state:nj/county:morris/place:rockaway_township`, and reading the FIRST
 * match called it a county, which threw away every one of the 513 GEOID matches
 * in one edit. Caught because the build prints its counts — the operation-count
 * rule, doing exactly its job.
 */
function layerOf(ocdId: string): string {
  const segments = ocdId.split("/").slice(1);
  for (let i = segments.length - 1; i >= 0; i--) {
    const key = segments[i].split(":")[0];
    if ((LAYER_SEGMENTS as readonly string[]).includes(key)) return key;
  }
  return "other";
}

async function reconcile(divisions: Division[]): Promise<void> {
  let text: string;
  try {
    text = await (await fetch(CANONICAL_URL)).text();
  } catch {
    console.log("  canonical list unreachable — leaving every match as 'none'");
    return;
  }

  const canonical = new Set<string>();
  /*
   * D24: the canonical CSV publishes a `census_geoid` column, and every
   * boundary feature here carries the same GEOID. That is an EXACT key on
   * both sides — the Census Bureau's own primary key for the entity — so it
   * is the join, and the slug comparisons below are only what is left when it
   * finds nothing. Reading it is what closed 348 unmatched divisions into a
   * real number plus a stated reason apiece.
   *
   * The header is read rather than assumed: a column's POSITION is not a
   * contract, and a hardcoded index that silently pointed at the wrong column
   * would produce confident wrong matches — the failure mode this whole row
   * is about.
   */
  const lines = text.split(/\r?\n/);
  const header = (lines[0] ?? "").split(",").map((h) => h.trim());
  const geoidColumn = header.indexOf("census_geoid");
  if (geoidColumn < 0) {
    console.log(
      "  canonical CSV has no census_geoid column — the GEOID join cannot run, " +
        "falling back to slug comparison alone",
    );
  }
  const byGeoid = new Map<string, string[]>();
  for (const line of lines) {
    const columns = line.split(",");
    const id = columns[0]?.trim();
    if (!id?.startsWith("ocd-division/")) continue;
    canonical.add(id);
    if (geoidColumn < 0) continue;
    const geoid = columns[geoidColumn]?.trim();
    if (!geoid) continue;
    /*
     * **THE GEOID IS SCOPED BY LAYER, AND THE FIRST VERSION WAS NOT.**
     * (RULING 80's widened clip, NJ Hunt 4, 2026-08-22.)
     *
     * A Census place GEOID is state(2) + place(5) and a school-district GEOID is
     * state(2) + district(5). They are drawn from different numbering spaces and
     * they collide: `0404190` is both Buckshot CDP in Arizona and St. David
     * Unified District. Indexed on the bare GEOID, both claimed the same
     * canonical identifier — a join that collapses, which is precisely the
     * failure the distinctness rule in `CLAUDE.md` was written for, and it went
     * unseen only because the clipped universe held neither of them.
     *
     * The layer is read off the canonical identifier's own segment, so the key
     * is (layer, geoid) and a place can never match a school district.
     */
    const layer = layerOf(id);
    const key = `${layer}:${geoid}`;
    const list = byGeoid.get(key) ?? [];
    list.push(id);
    byGeoid.set(key, list);
  }
  console.log(
    `  canonical identifiers: ${canonical.size}, of which ${byGeoid.size} carry a census_geoid`,
  );

  // Index by the last segment so a differently-nested identifier can still be
  // found: canonical nests NJ places under county and AZ school districts under
  // county, where this repo does not.
  const byTail = new Map<string, string[]>();
  for (const id of canonical) {
    const tail = id.split("/").pop()!;
    const list = byTail.get(tail) ?? [];
    list.push(id);
    byTail.set(tail, list);
  }

  for (const division of divisions) {
    if (canonical.has(division.ocdId)) {
      division.canonicalOcdId = division.ocdId;
      division.canonicalMatch = "exact";
      continue;
    }

    /*
     * The GEOID join, before any slug comparison (D24). Both sides carry the
     * Census Bureau's key for the entity, so a hit here is an identifier
     * match and not a name match — which is the distinction CLAUDE.md draws
     * between a join and a review item.
     *
     * More than one canonical id on one GEOID means the canonical list holds
     * the same entity twice; that is ambiguous and takes the same `low`
     * treatment a multi-candidate slug match takes, never a first-wins pick
     * dressed as certainty.
     */
    const divisionLayer = layerOf(division.ocdId);
    const geoidHits = division.geoid
      ? (byGeoid.get(`${divisionLayer}:${division.geoid}`) ?? [])
      : [];
    if (geoidHits.length === 1) {
      division.canonicalOcdId = geoidHits[0];
      division.canonicalMatch = "geoid";
      continue;
    }
    if (geoidHits.length > 1) {
      division.canonicalOcdId = geoidHits[0];
      division.canonicalMatch = "low";
      division.canonicalGap = gapReason(division);
      continue;
    }

    /*
     * The Census-name join, third and narrowest (D24).
     *
     * The canonical list carries NO census_geoid for legislative districts —
     * it keys them on `openstates_district` — and New Hampshire is the one
     * state whose House districts it slugs by COUNTY and number
     * (`sldl:merrimack_8`) where this repo carries the Census SLDLST code
     * (`sldl:608`). All 43 of New Hampshire's unmatched lower-house
     * districts are exactly that, and no other state or chamber is affected:
     * Arizona, New Jersey and every senate district already match by number.
     *
     * **This is not a fuzzy join, and the difference is the whole point.**
     * The Census publishes the county and the number in its own name field
     * ("State House District Merrimack 08"); this reads them, builds the
     * canonical identifier they imply, and accepts it ONLY if that exact
     * identifier is in the canonical set. There is no similarity, no nearest
     * match and no scoring — a constructed id that is not present is a miss,
     * and stays a miss.
     */
    const named = canonicalIdFromCensusName(division);
    if (named && canonical.has(named)) {
      division.canonicalOcdId = named;
      division.canonicalMatch = "census_name";
      continue;
    }

    const tail = division.ocdId.split("/").pop()!;
    const stateSegment = division.ocdId.split("/")[2];
    const candidates = (byTail.get(tail) ?? []).filter((id) =>
      id.includes(`/${stateSegment}/`),
    );

    if (candidates.length >= 1) {
      /*
       * **A SLUG SIMILARITY IS A REVIEW ITEM AND NEVER A JOIN, AND THIS IS
       * WHERE THAT RULE IS MADE TRUE RATHER THAN CHECKED.**
       * (RULING 80's widened clip, NJ Hunt 4, 2026-08-22.)
       *
       * D24 left this branch matching on "same terminal segment, same state"
       * and rated it `high` for one candidate and `low` for several.
       * `tests/canonical-reconciliation.test.ts` forbids BOTH outright — a name
       * comparison is exactly what `CLAUDE.md` refuses to join geographic
       * entities on — and the guard passed for weeks only because the clipped
       * universe happened to contain no such case.
       *
       * The widened clip produced fifteen of them at once, and two show why the
       * guard is right rather than strict. `state:nj/place:springfield` is a
       * Census designated place; the canonical id it "matched" was
       * `state:nj/county:burlington/place:springfield`, a different
       * municipality in a different county sixty miles away. And Princeton
       * appears twice — once as the real consolidated municipality and once as
       * the FICTITIOUS county-subdivision row Census draws over the same ground
       * — and both claimed the same canonical identifier, which is the
       * collapsing join the distinctness rule exists to catch.
       *
       * So the near-match is not recorded as a match at all. The division keeps
       * its own identifier, states its gap, and appears in the reconciliation
       * report as unmatched — which is true, and which is what gets it looked
       * at.
       */
      division.canonicalOcdId = null;
      division.canonicalMatch = "none";
      division.canonicalGap = gapReason(division);
    } else {
      division.canonicalOcdId = null;
      division.canonicalMatch = "none";
      division.canonicalGap = gapReason(division);
    }
  }
}

/**
 * Build the canonical identifier a division's CENSUS NAME implies (D24).
 *
 * Returns null unless the name matches the one published shape this handles,
 * and the caller still has to find the result in the canonical set — so a
 * wrong guess cannot become a match. Deliberately one narrow rule rather
 * than a general name parser: a general one would start matching things that
 * merely look alike, which is what `CLAUDE.md` forbids joining on.
 */
function canonicalIdFromCensusName(division: Division): string | null {
  if (division.divisionType !== "sldl") return null;
  // "State House District Merrimack 08" — county, then a zero-padded number.
  const match = /^State House District ([A-Za-z .'-]+?)\s+0*(\d+)$/.exec(
    division.label.trim(),
  );
  if (!match) return null;
  const county = match[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const state = division.ocdId.split("/")[2];
  return `ocd-division/country:us/${state}/sldl:${county}_${Number(match[2])}`;
}

/**
 * Why this division has no canonical counterpart (D24).
 *
 * Read entirely off Census FUNCSTAT, which this repo already carries per
 * division. Nothing here inspects a name, and nothing guesses: a value that
 * cannot be established says so.
 *
 * FUNCSTAT, from the Census Bureau's own definitions:
 *   A  active government, primary general-purpose functions
 *   B  active, partially consolidated with another government
 *   C  active, consolidated with another government
 *   G  active, subordinate to another unit of government
 *   F  fictitious entity, created only to fill the geographic hierarchy
 *   N  nonfunctioning legal entity
 *   S  statistical entity — a CDP and its kind
 *
 * S and F are correctly absent from a list of governments. A, B, C and G are
 * governments the canonical list does not enumerate, which is a gap in that
 * list and is stated as one.
 */
function gapReason(division: Division): CanonicalGap {
  switch (division.funcstat) {
    case "S":
      return "NOT_A_GOVERNMENT";
    /*
     * **I — INACTIVE.** (RULING 80's widened clip, NJ Hunt 4, 2026-08-22.)
     *
     * Census FUNCSTAT `I` is an entity that EXISTED and has no active
     * government now. Livermore town, Grafton County, New Hampshire is the case
     * that surfaced it: a town the legislature dissolved in 1951, still carried
     * as a county subdivision because the territory still has to belong to
     * something, `CLASSFP T9`, population nil, no board and no meeting.
     *
     * It is NOT_A_GOVERNMENT for the same reason a CDP is: the canonical list is
     * a list of governments, and a body that no longer governs is correctly
     * absent from it. Leaving it UNDETERMINED would have said "a layer was added
     * whose reason nobody worked out", which is exactly what this switch exists
     * to prevent, and it would have put a dissolved town in the denominator this
     * product measures its own coverage against.
     */
    case "I":
      return "NOT_A_GOVERNMENT";
    case "F":
      return "FICTITIOUS";
    case "A":
    case "B":
    case "C":
    case "G":
      return "GOVERNMENT_NOT_LISTED";
    default:
      /*
       * FUNCSTAT is null here — the legislative and school layers do not
       * publish it — but that is not the end of what can be established.
       *
       * A GEOID whose last five digits are 99997/99998/99999 is a Census
       * PSEUDO-ENTITY: "school district not defined", drawn so the school
       * layer tiles the state completely. Nobody is elected to it and no
       * canonical list should carry it.
       *
       * Every other school district has an elected board by construction, so
       * its absence from the canonical list is a gap in that list.
       */
      if (division.divisionType === "school_district") {
        return /9999[789]$/.test(division.geoid ?? "")
          ? "NOT_A_GOVERNMENT"
          : "GOVERNMENT_NOT_LISTED";
      }
      return "UNDETERMINED";
  }
}

/**
 * Overlay the hand-walked source hunts onto the derived bodies.
 *
 * The derivation stays pure — it knows a division type implies a body and
 * nothing else. Everything a person learned by opening pages arrives here, and
 * arrives *only* for bodies that have an audit row. A body with no row keeps
 * `NOT_ATTEMPTED`, which is the whole point: the absence is the signal.
 *
 * Throws on an audit row whose `bodyId` matches nothing. A hunt recorded
 * against an identifier the registry does not have is either a typo or a stale
 * identifier, and both silently produce a body that looks unlooked-at forever.
 */
function applyAudits(bodies: Body[]): void {
  const audits = indexAudits(COVERAGE_AUDIT_FILE);
  const byId = new Map(bodies.map((b) => [b.id, b]));

  const orphans = [...audits.keys()].filter((id) => !byId.has(id));
  if (orphans.length > 0) {
    throw new Error(
      `audit rows matching no body:\n  ${orphans.join("\n  ")}\n` +
        "Every audit bodyId must be an existing <ocdId>#<slot>.",
    );
  }

  for (const [bodyId, audit] of audits) {
    const body = byId.get(bodyId)!;
    // Only the coverage fields. `bodyOrigin`, `sourceDataset`, `name` and
    // `provenance` are deliberately untouched, and the first attempt to set
    // them was wrong: finding a body's website does not make the body's
    // EXISTENCE a sourced claim. That is still structural — this division is a
    // town, towns have select boards — and its name is still null, because
    // nothing here read a name off anything. tests/registry-oracle.test.ts
    // asserts that invariant across all 265 rows and caught this.
    //
    // The audit file is itself the committed, citable provenance for the four
    // fields below; every rung in it carries the URL it was read from.
    body.coverageStatus = audit.coverageStatus;
    body.agendaSourceType = audit.agendaSourceType;
    body.agendaSourceRef = audit.agendaSourceRef;
    body.homepageUrl = audit.homepageUrl;
  }

  const counts = new Map<CoverageStatus, number>();
  for (const b of bodies) {
    counts.set(b.coverageStatus, (counts.get(b.coverageStatus) ?? 0) + 1);
  }
  console.log(`\n  coverage status (audited ${audits.size} of ${bodies.length})`);
  for (const [status, n] of [...counts.entries()].sort()) {
    console.log(`  ${status.padEnd(18)} ${String(n).padStart(5)}`);
  }
  console.log(
    `  with a homepage    ${String(bodies.filter((b) => b.homepageUrl).length).padStart(5)}`,
  );
}

/**
 * **The stamp a rebuild must NOT move** (NH232 follow-on, 2026-08-27).
 *
 * `collectedAt` on a derived row and on a TIGER division used to be
 * `new Date().toISOString()` — the millisecond the deriver ran. Two
 * consequences, and the second is worse than the first:
 *
 * 1. **The generator was not idempotent.** Two rebuilds against byte-identical
 *    inputs differed on 1,008 bodies and all 2,267 divisions, so "did anything
 *    actually change?" could not be answered from the diff, and the 731-row
 *    deletion this session repaired was invisible inside exactly that noise.
 *
 * 2. **It was a false provenance claim.** `collectedAt` says when the SOURCE
 *    was collected. The source is a committed boundary file fetched on some
 *    earlier day; the deriver running today collected nothing. Restamping every
 *    row on every build asserted a retrieval that did not happen.
 *
 * So the prior stamp is carried forward per row, and only a row the registry
 * has never held is stamped today. **The true retrieval date of the boundary
 * files is still not recorded anywhere in this repository** — that gap is real,
 * it is owed to the corpus/provenance contract, and carrying the existing value
 * forward keeps the already-committed claim rather than minting a fresh false
 * one every run. It does not invent the missing fact.
 */
function priorStamps(): Map<string, string> {
  const stamps = new Map<string, string>();
  try {
    const prior = JSON.parse(readFileSync(OUT, "utf8")) as Registry;
    for (const d of prior.divisions) {
      if (d.provenance?.collectedAt) stamps.set(`division:${d.ocdId}`, d.provenance.collectedAt);
    }
    for (const b of prior.bodies) {
      if (b.provenance?.collectedAt) stamps.set(`body:${b.id}`, b.provenance.collectedAt);
    }
  } catch {
    /* No prior registry — every row is new, and every row gets today. */
  }
  return stamps;
}

function applyPriorStamps(registry: Registry, prior: Map<string, string>): void {
  for (const d of registry.divisions) {
    const was = prior.get(`division:${d.ocdId}`);
    if (was) d.provenance.collectedAt = was;
  }
  for (const b of registry.bodies) {
    const was = prior.get(`body:${b.id}`);
    if (was) b.provenance.collectedAt = was;
  }
}

async function main() {
  /*
   * Day precision, not milliseconds. A row that IS new gets the day it entered
   * the registry; a sub-second stamp on a derivation over committed files is
   * precision the fact does not have.
   */
  const now = `${today()}T00:00:00.000Z`;
  const prior = priorStamps();

  console.log("divisions");
  const divisions = await loadDivisions(now);
  console.log(`  ${divisions.length} from committed geometry`);

  /*
   * THE CURATED DIVISION OVERLAY (NH Hunt 5, 2026-08-21; RULING 57).
   *
   * The committed TIGER geometry is clipped to one county per state, so six
   * whole towns inside 03255's first-rung circle - Acworth, Croydon, Lempster,
   * Newport, Grantham and Windsor - had no division here, and the curated-body
   * check below therefore refused every board this session enumerated for
   * them. RULING 57 says a body is NAMED FIRST and hunted second; a body that
   * cannot be named because a map file was clipped is the opposite of that.
   *
   * A registry division carries no geometry - canonical state geometry lives in data/states/<st>/geo and is
   * served separately - so these rows are identifier, label, tier and parent,
   * taken from the Census of Governments and NCES. See
   * lib/registry/curated-divisions.ts for what may and may not go in there.
   *
   * Derived rows WIN. A curated row whose identifier the geometry already
   * carries is a mistake, and it is refused rather than merged: silently
   * shadowing a real TIGER division with a geometry-less stand-in would take a
   * polygon off the map and say nothing.
   */
  const derivedDivisionIds = new Set(divisions.map((d) => d.ocdId));
  for (const curated of CURATED_DIVISIONS) {
    if (derivedDivisionIds.has(curated.ocdId)) {
      throw new Error(
        `curated division ${curated.ocdId} already exists in the committed ` +
          "geometry - remove it from lib/registry/curated-divisions.ts rather " +
          "than shadowing a row that has a polygon",
      );
    }
    divisions.push(curated);
  }
  console.log(
    `  ${CURATED_DIVISIONS.length} curated (enumerated by Census/NCES, outside the geometry clip)`,
  );
  console.log(`  ${divisions.length} divisions`);

  console.log("reconciliation");
  if (!process.argv.includes("--offline")) await reconcile(divisions);

  console.log("bodies");
  const bodies = divisions.flatMap((d) => bodiesFor(d, now));

  // The curated overlay — bodies the derivation structurally cannot produce
  // (D28/D29). Checked before merging: a curated id colliding with a derived
  // one is a mistake either way, and a curated division reference must exist.
  const divisionIds = new Set(divisions.map((d) => d.ocdId));
  const derivedIds = new Set(bodies.map((b) => b.id));
  for (const curated of CURATED_BODIES) {
    if (derivedIds.has(curated.id)) {
      throw new Error(`curated body ${curated.id} collides with a derived row`);
    }
    if (curated.ocdId !== null && !divisionIds.has(curated.ocdId)) {
      throw new Error(
        `curated body ${curated.id} references unknown division ${curated.ocdId}`,
      );
    }
    if (curated.bodyOrigin !== "CURATED") {
      throw new Error(`curated body ${curated.id} must carry bodyOrigin CURATED`);
    }
    if (!curated.name || !curated.provenance.sourceUrl) {
      // The curated bargain: a name may appear exactly because the page it
      // was read from is cited. One without the other is a minted claim.
      throw new Error(`curated body ${curated.id} needs both a name and a citation`);
    }
  }
  const curatedIds = new Set(CURATED_BODIES.map((b) => b.id));
  if (curatedIds.size !== CURATED_BODIES.length) {
    throw new Error("duplicate ids inside CURATED_BODIES");
  }
  bodies.push(...CURATED_BODIES);

  /*
   * ------------------------------------------------------- promoted overlay
   *
   * **NH232.** These rows used to be appended to `registry.json` directly by
   * `pnpm leads:adjudicate-descent` and `pnpm bodies:census-gap`, which made a
   * generated artifact somebody else's canonical store and meant that running
   * THIS script deleted 731 verified bodies without a single check going red.
   * They now live in `lib/registry/promoted-bodies.json`, which is an INPUT,
   * and the generator merges them the way it merges the curated overlay.
   *
   * The derivation structurally cannot produce them: a promoted body exists
   * because a session fetched a page and the page named it, and no polygon
   * implies that. So merging them is not optional decoration — without it the
   * generator's output is not the canonical body set.
   */
  const promotedStore = loadPromotedBodies();
  const heldIds = new Set(bodies.map((b) => b.id));
  const promotedProblems = validatePromotedBodies(promotedStore.bodies, {
    heldIds,
    divisionIds,
  });
  if (promotedProblems.length > 0) {
    throw new Error(
      `lib/registry/promoted-bodies.json is not sound:\n  ${promotedProblems.join("\n  ")}`,
    );
  }
  bodies.push(...promotedStore.bodies);

  console.log(
    `  promoted overlay: ${promotedStore.bodies.length} bodies (` +
      `${promotedStore.bodies.filter((b) => b.bodyOrigin === "PROMOTED_FROM_DESCENT_CANDIDATE").length} descent, ` +
      `${promotedStore.bodies.filter((b) => b.bodyOrigin === "PROMOTED_FROM_CENSUS_OF_GOVERNMENTS").length} census gap)`,
  );

  // Audits run AFTER the overlay (moved 2026-08-15, the truth session): a
  // curated body has hunts too, and Newbury's three land-use boards are the
  // first with a full ladder recorded. Running this before the merge made a
  // curated body's audit row an "orphan" and refused the build — which is the
  // guard working, pointed at the wrong moment in the sequence. Derived rows
  // are overlaid exactly as before.
  applyAudits(bodies);

  console.log(
    `  curated overlay: ${CURATED_BODIES.length} bodies (` +
      `${CURATED_BODIES.filter((b) => b.ocdId === null).length} division-less, ` +
      `${CURATED_BODIES.filter((b) => b.coverageStatus === "LIVE").length} live)`,
  );

  // Report what the rule did, including what it deliberately refused to do.
  const perType = new Map<string, { divisions: number; bodies: number }>();
  const skips = new Map<SkipReason, number>();
  for (const division of divisions) {
    const entry = perType.get(division.divisionType) ?? { divisions: 0, bodies: 0 };
    entry.divisions++;
    const { slots, skipped } = slotsFor(division);
    entry.bodies += slots.length;
    if (skipped) skips.set(skipped, (skips.get(skipped) ?? 0) + 1);
    perType.set(division.divisionType, entry);
  }

  console.log("\n  division type      divisions   bodies");
  for (const [type, n] of [...perType.entries()].sort()) {
    console.log(`  ${type.padEnd(18)} ${String(n.divisions).padStart(8)} ${String(n.bodies).padStart(8)}`);
  }

  console.log("\n  skipped, and why");
  for (const [reason, n] of [...skips.entries()].sort()) {
    console.log(`  ${reason.padEnd(38)} ${String(n).padStart(5)}`);
  }

  const matches = new Map<CanonicalMatch, number>();
  for (const d of divisions) matches.set(d.canonicalMatch, (matches.get(d.canonicalMatch) ?? 0) + 1);
  console.log("\n  canonical match");
  for (const [m, n] of [...matches.entries()].sort()) {
    console.log(`  ${m.padEnd(10)} ${String(n).padStart(5)}`);
  }

  /*
   * D24: an unmatched division is not a failure until you know what it is,
   * and this is the denominator that says so. Printed here rather than left
   * in the file, because a number nobody prints is a number nobody chases —
   * the same reason the attribution summary prints its unresolved segments.
   */
  const gaps = new Map<CanonicalGap | "(unset)", number>();
  for (const d of divisions.filter((x) => x.canonicalMatch === "none")) {
    const key = d.canonicalGap ?? "(unset)";
    gaps.set(key, (gaps.get(key) ?? 0) + 1);
  }
  const unmatched = [...gaps.values()].reduce((a, b) => a + b, 0);
  console.log(`\n  canonical gap, for the ${unmatched} of ${divisions.length} with no match`);
  for (const [g, n] of [...gaps.entries()].sort()) {
    console.log(`  ${g.padEnd(22)} ${String(n).padStart(5)}`);
  }

  const registry: Registry = { generatedAt: now, divisions, bodies };
  applyPriorStamps(registry, prior);
  await writeFile(OUT, JSON.stringify(registry, null, 1) + "\n", "utf8");
  console.log(`\nwrote ${OUT}`);
  console.log(`  ${divisions.length} divisions, ${bodies.length} bodies`);
}

void main();
