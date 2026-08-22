import type { Division } from "./types.ts";
import type { OcdId } from "../sources/types.ts";
import { tierForOcdId } from "../ocd/tiers.ts";

/**
 * **GOVERNMENTS THIS REGISTRY MUST NAME AND THE COMMITTED GEOMETRY CANNOT
 * SUPPLY.** (NH Hunt 5, 2026-08-21, item 5; RULING 57.)
 *
 * ## The blocker this removes
 *
 * `pnpm twig:pair` names twenty Census units inside 03255's first-rung circle
 * that this registry holds no body for. Six of them are whole TOWNS — Acworth,
 * Croydon, Lempster, Newport, Grantham and Windsor — and six more are school
 * districts. Every one was hunted successfully: their boards indexes were
 * read, their bodies enumerated, their sources recorded.
 *
 * None of them could be entered, because `scripts/build-registry.ts` refuses a
 * curated body whose DIVISION does not exist, and the division did not exist
 * for a reason that has nothing to do with those towns: **the committed TIGER
 * geometry is clipped to one county per state.** `public/geo/cousub-33.geojson`
 * says so on its own face — `clippedTo: ["04019","34027","33013"]`. Sullivan
 * and Hillsborough county subdivisions are absent, and the four Sullivan towns
 * that ARE present are present only because their polygons touch Merrimack's.
 *
 * So the product's own reach and its geometry's reach had drifted apart. The
 * first-rung circle at 03255 crosses three counties — `scripts/twig-pair.mts`
 * has always said so, in its own `COUNTY_OF` map — while the geometry stops at
 * one. RULING 57 says a body is NAMED FIRST and hunted second, and a body that
 * cannot be named because a map file was clipped is the opposite of that.
 *
 * ## Why a curated division rather than a wider clip
 *
 * Widening the clip is the other honest answer and it is a bigger decision
 * than this file: `countyFips` is singular per state in the coverage manifest,
 * it names the ballot files as well as the geometry, and re-fetching TIGER for
 * two more counties changes every served polygon on the map. That is a
 * structural change the author should make deliberately, and it is a tracker
 * row rather than a side effect of a hunt.
 *
 * What this file does instead is narrower and true: **a registry division
 * carries no geometry.** Geometry lives in `public/geo` and is served
 * separately. A division row is an identifier, a label, a tier and a parent —
 * all of which the Census of Governments and the Census place/county-
 * subdivision numbering already establish, without a polygon.
 *
 * ## What the reader gets, and what they do not
 *
 * They get the government NAMED, its bodies listed, and everything hunted
 * about it — which is the whole of RULING 57's demand and is more than nothing,
 * which is what they have today.
 *
 * They do NOT get its outline drawn on the map, because we hold no polygon for
 * it. That is a stated limit rather than a hidden one: the row carries
 * `sourceDataset: "COG_2022"` and a provenance pointing at the Census of
 * Governments, so nothing downstream can mistake it for a TIGER row that
 * should have geometry and is missing it.
 *
 * ## The rule for adding one
 *
 * A row belongs here only when the government is REAL and EXTERNALLY
 * ENUMERATED — present in the Census of Governments or NCES — and the
 * committed geometry does not carry it. It is never a place to invent a
 * jurisdiction, and never a way to route around a division that TIGER does
 * carry. `tests/curated-division-overlay.test.ts` holds both of those shut.
 */

const NH = "ocd-division/country:us/state:nh";

/**
 * The 2022 Census of Governments, which is the denominator this product
 * measures coverage against everywhere else, and NCES for school districts.
 * Both are the OUTSIDE denominator the coverage rule requires — a registry
 * that defines its own cannot be caught missing anything.
 */
const COG =
  "https://www.census.gov/programs-surveys/cog/technical-documentation/methodology.html";
const COG_ORG = "U.S. Census Bureau, 2022 Census of Governments";
const NCES_ORG = "NCES Common Core of Data, LEA directory 2025-26";
const COLLECTED = "2026-08-21";

interface CuratedDivisionRow {
  ocdId: string;
  divisionType: Division["divisionType"];
  label: string;
  parentOcdId: string | null;
  /**
   * The Census Bureau's own primary key, and it is REQUIRED here rather than
   * optional.
   *
   * A division with no GEOID cannot be reconciled against the canonical OCD
   * list on an identifier, and `tests/canonical-reconciliation.test.ts`
   * refuses one — correctly. The first version of this file left it null on
   * the grounds that these rows carry no geometry; the suite caught it, and
   * the suite was right. A GEOID is not a property of a polygon, it is the
   * Bureau's key for the ENTITY, and every one of these entities has one:
   * county subdivisions from `census_govt_units_2022.csv` as
   * state+county+cousub, school districts from the NCES LEA directory.
   */
  geoid: string;
  /**
   * Why the committed geometry does not carry it. Recorded per row, because
   * "the clip" is the answer for every row TODAY and will not be the answer
   * for every row a year from now.
   */
  whyNoGeometry: string;
  org: string;
}

const CLIP =
  "the committed TIGER geometry is clipped to one county per state " +
  "(public/geo/*.geojson, clippedTo 04019/34027/33013) and this government is " +
  "outside that clip";

const ROWS: CuratedDivisionRow[] = [
  /* ------------------------------------------------------- Sullivan County -- */
  {
    ocdId: `${NH}/county:sullivan`,
    divisionType: "county",
    label: "Sullivan County",
    parentOcdId: `${NH}`,
    geoid: "33019",
    whyNoGeometry:
      "county-us.geojson carries only the three clip counties; Sullivan is a " +
      "neighbour that 03255's first-rung circle reaches",
    org: COG_ORG,
  },

  /* ------------------------------------------------------- Sullivan towns --- */
  /*
   * GEOIDs are state(2) + county(3) + cousub(5), read straight off
   * `data/reference/census_govt_units_2022.csv` — the `fips_state`,
   * `fips_county` and `fips_place` columns of each town's own row. Not
   * derived, not guessed: the file is committed and every one of these is in
   * it, marked `is_active: Y`.
   */
  ...(
    [
      ["acworth_town", "Acworth town", "3301900260"],
      ["croydon_town", "Croydon town", "3301916340"],
      ["lempster_town", "Lempster town", "3301941700"],
      ["newport_town", "Newport town", "3301952580"],
      ["grantham_town", "Grantham town", "3301931220"],
    ] as const
  ).map(([slug, label, geoid]) => ({
    ocdId: `${NH}/county:sullivan/place:${slug}`,
    divisionType: "place" as const,
    label,
    parentOcdId: `${NH}/county:sullivan`,
    geoid,
    whyNoGeometry: CLIP,
    org: COG_ORG,
  })),

  /* -------------------------------------------------- Hillsborough town ----- */
  {
    ocdId: `${NH}/county:hillsborough/place:windsor_town`,
    divisionType: "place",
    label: "Windsor town",
    parentOcdId: `${NH}/county:hillsborough`,
    geoid: "3301185940",
    whyNoGeometry: CLIP,
    org: COG_ORG,
  },

  /* ------------------------------------------------------ school districts -- */
  /*
   * NCES LEA IDs, read off the committed
   * `data/reference/nces_ccd_lea_directory_2025_26.csv`.
   *
   * A CORRECTION THIS SESSION MADE TO ITSELF, recorded because the mistake is
   * an easy one to repeat: LEMPSTER was first entered as
   * `goshen_lempster_school_district`, on the reasonable-looking grounds that
   * the schools are run as the Goshen-Lempster Cooperative and SAU 71 answers
   * to that name. NCES lists them as TWO districts — Lempster School District
   * (3303303) and Goshen School District (3303304) — and the Census of
   * Governments counts LEMPSTER SCHOOL DISTRICT as its own unit. The
   * cooperative is how the two districts jointly run their schools; it is not
   * a third government that replaces them. Filing one district under the
   * other's invented joint name would have been a fact about our filing rather
   * than about New Hampshire, and it would have quietly dropped a government
   * from the denominator.
   */
  ...(
    [
      ["windsor_school_district", "Windsor School District", "3307200"],
      ["newport_school_district", "Newport School District", "3305310"],
      ["lempster_school_district", "Lempster School District", "3303303"],
      ["grantham_school_district", "Grantham School District", "3303360"],
      ["croydon_school_district", "Croydon School District", "3302550"],
      ["nashua_school_district", "Nashua School District", "3304980"],
    ] as const
  ).map(([slug, label, geoid]) => ({
    ocdId: `${NH}/school_district:${slug}`,
    divisionType: "school_district" as const,
    label,
    parentOcdId: `${NH}`,
    geoid,
    whyNoGeometry:
      "unsd-33.geojson and elsd-33.geojson are clipped to Merrimack County; " +
      "this district is enumerated by NCES and lies outside that clip",
    org: NCES_ORG,
  })),
];

/**
 * The curated divisions, shaped exactly like a derived one so nothing
 * downstream needs to know the difference — except `sourceDataset`, which says
 * where it came from, and which is how a reader of the data can tell that no
 * polygon is expected.
 */
export const CURATED_DIVISIONS: readonly Division[] = ROWS.map((row) => {
  const tier = tierForOcdId(row.ocdId as OcdId);
  if (!tier) {
    // The same refusal the derived path makes. An identifier whose tier cannot
    // be read is a misfiling, and inheriting a parent's tier would hide it.
    throw new Error(
      `curated division ${row.ocdId} has no readable tier — lib/ocd/tiers.ts ` +
        "refuses it, and so does this",
    );
  }
  /*
   * THE CENSUS CLASSIFICATION, AND THE LINE BETWEEN READING IT AND GUESSING IT.
   *
   * These three fields were null in the first version of this file, on the
   * reasoning that a row with no polygon has no cartographic attributes and
   * that guessing an LSAD from a name would be a fact about our guess. That
   * reasoning was right about GUESSING and wrong about these rows, and
   * `tests/canonical-reconciliation.test.ts` caught the consequence: with
   * FUNCSTAT null, `gapReason()` has nothing to reason from and files every
   * town as UNDETERMINED — a gap nobody worked out, which is the one value
   * that test refuses.
   *
   * FUNCSTAT is not a property of a polygon. It is the Census Bureau's
   * statement about whether the ENTITY is an active government, and the
   * committed reference file answers it directly: all six of these towns are
   * `is_active: Y`, `gov_type: TOWNSHIP` in `census_govt_units_2022.csv`.
   *
   * LSAD 43 / CLASSFP T1 is likewise read rather than invented. Of the 53 New
   * Hampshire `_town` rows the committed geometry carries, 47 are `43/A/T1`
   * and the other six are these — so the classification is not a per-town
   * judgement, it is what the Census assigns every New Hampshire town.
   *
   * A SCHOOL DISTRICT KEEPS ITS NULLS, deliberately: the Census school layer
   * does not publish FUNCSTAT at all, and `gapReason()` already has a
   * dedicated branch for that, resolving on the GEOID instead. Filling these
   * in there WOULD be inventing.
   */
  const isMunicipal =
    row.divisionType === "place" || row.divisionType === "county";
  return {
    ocdId: row.ocdId as OcdId,
    divisionType: row.divisionType,
    tier,
    state: "NH",
    label: row.label,
    parentOcdId: row.parentOcdId as OcdId | null,
    lsad: row.divisionType === "place" ? "43" : null,
    funcstat: isMunicipal ? "A" : null,
    classfp: row.divisionType === "place" ? "T1" : null,
    geoid: row.geoid,
    canonicalOcdId: null,
    canonicalMatch: "none" as const,
    sourceDataset: "COG_2022" as const,
    provenance: {
      sourceUrl: COG,
      sourceOrg: `${row.org} — no committed geometry: ${row.whyNoGeometry}`,
      collectedAt: COLLECTED,
      verifiedAt: COLLECTED,
    },
  };
});
