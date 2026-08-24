/**
 * The two universes for a zip, enumerated against an OUTSIDE denominator.
 *
 *   pnpm zip:universe 03255
 *
 * ## What this is for
 *
 * CLAUDE.md: coverage claims are made against the official universe, never
 * against our own records. `scripts/census-who-governs.mts` answers "of the
 * bodies we KNOW govern this point, how many do we read?" — its denominator
 * is the registry, so it can never catch a body nobody has heard of. This
 * script answers the question one layer out: **what exists**, per the Census
 * of Governments, and which of those things actually touch this zip.
 *
 * ## Two universes, kept mechanically apart
 *
 * A body can be in either, both, or neither, and conflating them is the trap
 * this file exists to prevent:
 *
 * - `governsZip` — its jurisdiction contains the zip. This is the who-governs
 *   card's denominator.
 * - `meetingsNearZip` — it sits and a reader at this zip would see the pin.
 *   This is the map's denominator.
 *
 * A neighbouring town's Selectboard is the standing example: New London's
 * board meets 12 km from Newbury, so a reader sees it — but it does not
 * govern one inch of Newbury, and sharing a regional school district does not
 * change that. The regional district governs; the neighbour's own boards do
 * not. Proximity is never allowed to imply jurisdiction here.
 *
 * ## How each flag is decided, and why the method is recorded per row
 *
 * `governsZip` is decided by GEOMETRY where the Census publishes a boundary —
 * the zip's ZCTA centroid tested against the committed TIGER layers. Special
 * districts have no Census boundary at ANY vintage, so geometry cannot answer
 * for them: they resolve to `UNRESOLVED` until a hunt reads the district's own
 * published territory. `UNRESOLVED` is a work item, never a `false`. Recording
 * a district as "does not govern" because we could not find its boundary is
 * exactly the manufactured claim the render-default rule forbids, one layer
 * upstream.
 *
 * `meetingsNearZip` is decided against the product's own serving rule — the
 * first rung of `RADIUS_LADDER_KM`, 25 km — measured from the zip's ZCTA
 * centroid. Where the body's actual meeting venue is known it is measured
 * from that; otherwise from the administrative address the Census itself
 * publishes for the unit, which is a PROXY and is labelled one on the row. A
 * proxy that is not labelled is a claim.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { haversineKm } from "../lib/geo/distance.ts";
import { RADIUS_LADDER_KM } from "../lib/meetings/constants.ts";
import { lookupZcta, resolveZip } from "../lib/geo/zcta.ts";
import { assertEnumerationGeography, geographyLine } from "../lib/geo/zip-geography.ts";
import { parseCsv } from "../lib/reference/index.ts";
import { containsPoint, ringsOf } from "../lib/geo/polygon.ts";

const GUS = "data/audit/gus-2022-merrimack-sullivan-hillsborough.json";
const GEO = (layer: string) => `public/geo/${layer}.geojson`;

type GusRow = {
  kind: string;
  censusId: string;
  name: string;
  unitType?: string;
  web: string;
  city: string;
  active: string;
  countyFips: string;
  zip?: string;
};


/** NH79: the repo's one even-odd implementation, holes included. */
const contains = (
  point: [number, number],
  geom: { type: string; coordinates: unknown },
): boolean => containsPoint(point, geom);

/** Shortest great-circle distance from a point to any vertex of a shape. */
function nearestVertexKm(lat: number, lng: number, geom: { type: string; coordinates: unknown }): number {
  let best = Infinity;
  for (const ring of ringsOf(geom)) {
    for (const [x, y] of ring) {
      const d = haversineKm(lat, lng, y, x);
      if (d < best) best = d;
    }
  }
  return best;
}

function loadLayer(name: string) {
  return JSON.parse(readFileSync(GEO(name), "utf8")) as {
    features: { properties: Record<string, string>; geometry: { type: string; coordinates: unknown } }[];
  };
}

/**
 * **THE COUNTY'S SLICE OF THE 2022 CENSUS OF GOVERNMENTS, FOR ANY COUNTY.**
 *
 * The NH-only extract (`gus-2022-merrimack-sullivan-hillsborough.json`) is kept
 * and still read for New Hampshire, because it carries a hand-checked
 * replication note this cannot reproduce. Everywhere else the slice is cut from
 * the full national file that is already committed — 90,838 rows, every state.
 *
 * **The whole containing STATE is not the right denominator and neither is the
 * county alone.** A zip's 25 km circle crosses county lines constantly, and
 * Rockaway Township's crosses into Passaic, Essex and Sussex. So the slice is
 * the containing county plus every county whose units could fall in the circle;
 * the distance filter downstream does the actual cutting, and taking too many
 * here is safe while taking too few silently shrinks the denominator — which is
 * the failure the coverage rule exists to prevent.
 */
function gusForCounty(stateFips: string, countyFips: string): Record<string, GusRow[] | string> {
  if (stateFips === "33") {
    return JSON.parse(readFileSync(GUS, "utf8")) as Record<string, GusRow[] | string>;
  }
  const text = readFileSync("data/reference/census_govt_units_2022.csv", "utf8");
  const rows = parseCsv(text);
  const header = rows[0]!;
  const col = (name: string) => header.indexOf(name);
  const iState = col("fips_state");
  const iCounty = col("fips_county");
  const iName = col("unit_name");
  const iType = col("unit_type_raw");
  const iGov = col("gov_type");
  const iWeb = col("web_address");
  const iCity = col("city");
  const iZip = col("zip");
  const iAddr = col("address1");
  const iActive = col("is_active");
  const iPid = col("census_id_pid6");

  const out: Record<string, GusRow[]> = {};
  let kept = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    if (r[iState] !== stateFips) continue;
    const fips = `${stateFips}${String(r[iCounty] ?? "").padStart(3, "0")}`;
    /*
     * Every county in the state is kept. The circle-distance filter downstream
     * is what decides membership; this only decides what is even considered,
     * and a state has few enough counties that considering all of them costs
     * nothing and cannot under-count.
     */
    const gov = String(r[iGov] ?? "").toUpperCase();
    const kind = /COUNTY|MUNICIPAL|TOWNSHIP/.test(gov)
      ? "GENERAL_PURPOSE"
      : /INDEPENDENT SCHOOL|SCHOOL/.test(gov)
        ? "SCHOOL_DISTRICT"
        : /DEPENDENT/.test(gov)
          ? "DEPENDENT_SCHOOL_DISTRICT"
          : "SPECIAL_DISTRICT";
    (out[fips] ??= []).push({
      kind,
      censusId: String(r[iPid] ?? ""),
      name: String(r[iName] ?? "").toUpperCase(),
      unitType: String(r[iType] ?? ""),
      web: String(r[iWeb] ?? ""),
      city: String(r[iCity] ?? "").toUpperCase(),
      active: String(r[iActive] ?? ""),
      zip: String(r[iZip] ?? ""),
      address1: String(r[iAddr] ?? "").toUpperCase(),
      countyFips: fips,
    } as GusRow);
    kept++;
  }
  if (kept === 0) {
    throw new Error(
      `the 2022 Census of Governments file holds NO units for state FIPS ${stateFips}. ` +
        "That is a failed read of the file, not a state with no governments.",
    );
  }
  return {
    ...out,
    _note: `Sliced from data/reference/census_govt_units_2022.csv for state FIPS ${stateFips} (containing county ${countyFips}) — ${kept} units.`,
    _vintage: "2022 Census of Governments (January 2022 release)",
  } as Record<string, GusRow[] | string>;
}

/** Normalises a Census unit name to a comparable town/district token. */
/*
 * **THE ABBREVIATIONS ARE NEW JERSEY'S, AND LEAVING THEM OUT DROPPED A
 * GOVERNING DISTRICT** (NJ Hunt, 2026-08-22).
 *
 * This list was built against New Hampshire, which spells its unit types out.
 * The Census abbreviates and TIGER does not, so on the first New Jersey run:
 *
 *   Census  "ROCKAWAY TWP SCH DIST"           → "ROCKAWAY TWP"
 *   TIGER   "Rockaway Township School District" → "ROCKAWAY"
 *
 * — no match, and the Rockaway Township School District was written out as
 * `governsZip: false` while the TIGER geometry had the zip's centroid INSIDE
 * it. A district that governs a reader's children reading as one that does not,
 * because of four letters. `TWP`, `BORO`, `BOR`, `VLG`, `CO` and `MUN` are the
 * Census's own forms and are now stripped alongside the words they abbreviate.
 *
 * The `OF` prefix strip needs the same treatment for a different reason: New
 * Jersey's general-purpose units are `TOWNSHIP OF ROCKAWAY` and `BOROUGH OF
 * ROCKAWAY`, and `BOROUGH` was not in the prefix list at all.
 */
/**
 * **THE UNIT TYPE IS THE DISCRIMINATOR AND MUST NOT BE STRIPPED.**
 *
 * The first fix here deleted `TOWNSHIP` and `BOROUGH` along with their Census
 * abbreviations, and immediately collapsed two different governments into one:
 * `BOROUGH OF ROCKAWAY` and `TOWNSHIP OF ROCKAWAY` are separate municipalities
 * with separate councils, separate school districts and separate ballots, and
 * both normalised to `ROCKAWAY`. The Borough's school district then resolved to
 * the Township's OCD id — a join collapsing distinct keys onto one row, which
 * `CLAUDE.md` presumes broken until proven otherwise, and which here would have
 * shown a reader in the Borough the Township's board.
 *
 * So the type is EXPANDED, never removed, and moved to the end so the Census's
 * `TYPE OF NAME` and TIGER's `Name type` meet:
 *
 *   Census  "ROCKAWAY TWP SCH DIST"             → "ROCKAWAY TOWNSHIP"
 *   TIGER   "Rockaway Township School District" → "ROCKAWAY TOWNSHIP"   ✓ match
 *   Census  "ROCKAWAY BORO SCH DIST"            → "ROCKAWAY BOROUGH"    ✓ distinct
 *
 * Only the words that are never a discriminator come out: `SCHOOL`, `DISTRICT`,
 * `REGIONAL` and their abbreviations. A district's type is what it is FOR, not
 * which one it is.
 */
const TYPE_WORDS = "TOWN|CITY|TOWNSHIP|TWP|BOROUGH|BORO|BOR|VILLAGE|VLG|MUNICIPALITY|MUN|COUNTY|CO";

const EXPAND: Record<string, string> = {
  TWP: "TOWNSHIP",
  BORO: "BOROUGH",
  BOR: "BOROUGH",
  VLG: "VILLAGE",
  MUN: "MUNICIPALITY",
  CO: "COUNTY",
};

function normalize(s: string): string {
  return (
    s
      .toUpperCase()
      /* `TOWNSHIP OF ROCKAWAY` → `ROCKAWAY TOWNSHIP`, so both conventions agree. */
      .replace(new RegExp(`^(${TYPE_WORDS}) OF (.+)$`), "$2 $1")
      /* Words that describe PURPOSE rather than identity. */
      .replace(/\b(SCH|SCHOOL|DIST|DISTRICT|REG|REGIONAL|INDEPENDENT|PUBLIC)\b/g, " ")
      .replace(/[^A-Z0-9]+/g, " ")
      .split(/\s+/)
      .map((w) => EXPAND[w] ?? w)
      .join(" ")
      .trim()
  );
}

/**
 * A COUNTY is compared with its type removed, because TIGER's national county
 * layer labels them bare (`Morris`) while the Census writes `COUNTY OF MORRIS`.
 * Nothing is lost: a county name is unique within a state, so the type carries
 * no discriminating information at this level — unlike a municipality, where a
 * borough and a township can share a name and routinely do.
 */
function normalizeCounty(s: string): string {
  return normalize(s).replace(/\s*\bCOUNTY\b\s*/g, " ").replace(/\s+/g, " ").trim();
}

async function main() {
  const zip = (process.argv[2] ?? "03255").trim();
  const resolved = resolveZip(zip);
  if (!resolved.ok) throw new Error(`${zip} did not resolve: ${resolved.reason}`);
  const { lat, lng } = resolved.centroid;
  const point: [number, number] = [lng, lat];
  const nearKm = RADIUS_LADDER_KM[0];

  /*
   * ── THE STATE COMES FROM THE POINT, NOT FROM A CONSTANT (NJ Hunt, 2026-08-22)
   * ────────────────────────────────────────────────────────────────────────
   *
   * **This tool was hardcoded to New Hampshire and gave a confident wrong
   * answer for anywhere else.** `pnpm zip:universe 07866` resolved Rockaway
   * Township's centroid correctly to 40.955, -74.488 and then enumerated
   * `cousub-33`, `unsd-33`, `elsd-33`, `scsd-33` and a three-county New
   * Hampshire governments file — so `pnpm twig:pair 07866` reported the
   * official universe of a New Jersey township as ONE unit, the *Nashua City
   * School District*, 350 km away, and reconciled cleanly while doing it.
   *
   * That is the exact shape RULING 60 predicts: a branch built against one
   * jurisdiction, proven there, and silently wrong in the next. It is not
   * discarded — it grows a limb. The national county layer already committed
   * here names the state, the per-state TIGER layers are already committed for
   * 33, 34 and 04, and the FULL national Census of Governments file is already
   * committed at `data/reference/census_govt_units_2022.csv`. Nothing had to be
   * fetched; the tool simply had to ask the point which state it was in.
   *
   * A state whose layers are NOT committed fails loudly and names what is
   * missing, rather than falling back to a default — a silent default here is
   * how a session measures the wrong place and reports it as coverage.
   */
  const county = loadLayer("county-us");
  const govCountyEarly = county.features.filter((f) => contains(point, f.geometry));
  const containingCounty = govCountyEarly[0];
  if (!containingCounty) {
    throw new Error(
      `${zip} (${lat}, ${lng}) is inside no county in county-us.geojson. That is a coverage gap in the layer, not an empty universe.`,
    );
  }
  const countyFips = String(
    containingCounty.properties.fips ??
      containingCounty.properties.GEOID ??
      containingCounty.properties.geoid ??
      "",
  );
  const stateFips = countyFips.slice(0, 2);
  if (!/^\d{2}$/.test(stateFips)) {
    throw new Error(
      `could not read a state FIPS from the containing county (${containingCounty.properties.label}); its properties are ${Object.keys(containingCounty.properties).join(", ")}`,
    );
  }

  /*
   * ── RULING 67: THE ENUMERATION STATES ITS GEOGRAPHY AND IS CHECKED AGAINST
   * THE ZIP'S OWN, EXTERNALLY (NJ Hunt 2, 2026-08-22) ──────────────────────
   *
   * The state above is read from `county-us.geojson`, which is the SAME file
   * this enumeration then uses to decide what to read. That is a check against
   * itself, and the previous version of this tool proved what that is worth: it
   * enumerated New Hampshire for a New Jersey zip and every downstream number
   * agreed with every other number about the wrong state.
   *
   * `assertEnumerationGeography` compares what this run resolved against files
   * this run does not consult — TIGER's state outlines, and the Department of
   * Education's LEA directory, which reaches the answer through mailing
   * addresses rather than through geometry. A disagreement STOPS the run.
   */
  const truth = assertEnumerationGeography(zip, {
    stateFips,
    countyFips,
    by: "pnpm zip:universe",
  });
  console.log(geographyLine(truth));

  for (const layer of [`cousub-${stateFips}`, `unsd-${stateFips}`, `elsd-${stateFips}`, `scsd-${stateFips}`]) {
    if (!existsSync(GEO(layer))) {
      throw new Error(
        `${zip} is in state FIPS ${stateFips} and ${GEO(layer)} is not committed. ` +
          "Commit that state's TIGER layers before enumerating its universe — this run is stopping rather than " +
          "falling back to another state's geography, which is what it used to do.",
      );
    }
  }

  const gus = gusForCounty(stateFips, countyFips);
  const counties = Object.keys(gus).filter((k) => !k.startsWith("_"));

  const cousub = loadLayer(`cousub-${stateFips}`);
  /*
   * ── THE PLACE LAYER, BECAUSE THE REGISTRY'S IDS COME FROM IT (NJ Hunt 2,
   * 2026-08-22) ────────────────────────────────────────────────────────────
   *
   * Census writes a government into whichever of the place and
   * county-subdivision layers it belongs in, and writes a FICTITIOUS row into
   * the other one to fill the geographic hierarchy. `FUNCSTAT` says which is
   * which: the real one is `A`/`B`/`C`/`G` and the filler is `F`. That is
   * exactly the rule `lib/registry/derive.ts` already applies when it decides
   * what bodies exist, which is why Rockaway Borough's body in this registry is
   * `state:nj/place:rockaway` and not the county-subdivision layer's
   * `state:nj/county:morris/place:rockaway_borough`.
   *
   * This tool read cousub only. So even once identity stopped depending on
   * containment, the id it produced for the Borough would have been the
   * fictitious one — a different key from the registry's, matching nothing, and
   * reporting a held unit as a gap for a second reason after the first was
   * fixed.
   *
   * The redirect is by GEOID, not by name: for a coextensive place the last
   * five digits of the county-subdivision GEOID are the place code. Checked
   * across the whole committed layer before it was relied on — all 29
   * fictitious New Jersey subdivisions map to exactly one active place each,
   * none unmatched, which is the per-key distinctness `CLAUDE.md` requires
   * before a join may be trusted.
   */
  const place = existsSync(GEO(`place-${stateFips}`)) ? loadLayer(`place-${stateFips}`) : { features: [] };
  const GOVERNING_FUNCSTAT = new Set(["A", "B", "C", "G"]);
  const placeByGeoidTail = new Map<string, (typeof place.features)[number]>();
  for (const f of place.features) {
    const geoid = String(f.properties.geoid ?? "");
    if (geoid.length > 2) placeByGeoidTail.set(geoid.slice(2), f);
  }
  let redirected = 0;

  /**
   * The feature that IS this municipality, preferring the layer Census marked
   * functional. Name matching stays type-preserving, because `BOROUGH OF
   * ROCKAWAY` and `TOWNSHIP OF ROCKAWAY` are two governments and collapsing
   * them once already pointed the Borough's school district at the Township's
   * board.
   */
  /*
   * ── THE COUNTY IS PART OF THE KEY, AND LEAVING IT OUT COLLAPSED FIVE
   * GOVERNMENTS INTO ONE (NJ Hunt 2, 2026-08-22) ───────────────────────────
   *
   * The first version of this matched on NAME alone across the whole state, and
   * New Jersey has **five** Washington Townships — Bergen, Burlington,
   * Gloucester, Mercer, Morris and Warren — four Washington Township school
   * districts, two Mansfields and two Fairfields. All five Census units named
   * `TOWNSHIP OF WASHINGTON` matched the one Washington township polygon in the
   * committed clip and were handed the SAME OCD id.
   *
   * That is precisely the defect `CLAUDE.md` presumes broken until proven
   * otherwise: identical payloads across distinct keys. Left in, a reader in
   * Washington Township, Gloucester County would have been shown Morris
   * County's township, and the coverage pair would have counted four
   * governments as held on the strength of one.
   *
   * So the county FIPS is part of the key. TIGER's county-subdivision GEOID is
   * `SSCCCNNNNN` and its first five digits are the county — an exact
   * discriminator that needs no name cleverness at all.
   */
  function municipalFeature(nameToken: string, unitCountyFips: string) {
    const sub = cousub.features.find(
      (f) =>
        String(f.properties.geoid ?? "").slice(0, 5) === unitCountyFips &&
        normalize(f.properties.label) === nameToken,
    );
    if (!sub) return undefined;
    if (String(sub.properties.funcstat ?? "") === "F") {
      const tail = String(sub.properties.geoid ?? "").slice(5);
      const twin = placeByGeoidTail.get(tail);
      if (twin && GOVERNING_FUNCSTAT.has(String(twin.properties.funcstat ?? ""))) {
        redirected++;
        return twin;
      }
    }
    return sub;
  }

  /**
   * The school district feature that IS this unit.
   *
   * TIGER's school-district GEOID carries no county, so the county cannot fence
   * this the way it fences a municipality. The unit's own administrative
   * address does: a name match is accepted only when the matched district's
   * polygon actually CONTAINS the Census-published administrative point for the
   * unit. Washington Township School District in Morris County and Washington
   * Township School District in Gloucester County have the same name and are
   * eighty miles apart, and only one of them contains Long Valley.
   *
   * Where the unit publishes no administrative zip, the match is accepted only
   * if the name is unique in the committed layers — and the distinctness
   * assertion after the loop is what catches anything this reasoning missed,
   * rather than trusting that it did not.
   */
  function schoolFeature(_nameToken: string, censusId: string) {
    return schoolAssignment.get(censusId);
  }


  const school = [
    ...loadLayer(`unsd-${stateFips}`).features,
    ...loadLayer(`elsd-${stateFips}`).features,
    ...loadLayer(`scsd-${stateFips}`).features,
  ];

  /**
   * WHICH SCHOOL DISTRICT UNIT OWNS WHICH POLYGON, DECIDED ACROSS THE WHOLE
   * ENUMERATION RATHER THAN ONE UNIT AT A TIME.
   *
   * A per-unit test cannot answer this, and the first two attempts here proved
   * it in opposite directions.
   *
   * Accepting any name match handed ONE Washington Township School District
   * polygon to FOUR Census units in four different counties — a collapsed join,
   * four governments wearing one identifier.
   *
   * Requiring the unit's administrative point to fall inside the polygon fixed
   * that and broke something else: Rockaway Borough School District's office is
   * at a 07866 address, and the 07866 ZCTA's internal point sits in Rockaway
   * TOWNSHIP. A correct, unambiguous match was refused because a mailing
   * address's ZCTA centroid is not inside the district it serves — which is
   * true of any district whose office is near its own edge, and is exactly the
   * sort of near-miss that would have been written down as an absence.
   *
   * So containment BREAKS TIES and never gates a match. One claimant takes the
   * polygon. Several claimants are separated by their administrative points,
   * and where that fails to leave exactly one, NOBODY takes it and the reason is
   * printed — an unresolved identity is a work item, and it is far better than
   * four governments sharing a key.
   */
  const schoolAssignment = new Map<string, (typeof school)[number]>();
  const schoolContest: string[] = [];
  {
    /*
     * ── THE CENSUS DROPS THE MUNICIPAL TYPE WORD AND TIGER KEEPS IT ────────
     * (NJ Hunt 2, 2026-08-22.)
     *
     *   Census  "DOVER PUBLIC SCH DIST"        → "DOVER"
     *   TIGER   "Dover Town School District"   → "DOVER TOWN"
     *
     * Fourteen Morris-area districts this registry already holds — Dover,
     * Butler, Hopatcong, Morris Plains, Parsippany-Troy Hills, Bloomingdale and
     * more — read as units with no division at all because of that one word.
     *
     * The word cannot simply be stripped: `ROCKAWAY BORO SCH DIST` and
     * `ROCKAWAY TWP SCH DIST` are two districts serving two municipalities, and
     * stripping the type collapsed them onto one another once already, pointing
     * the Borough's children at the Township's board.
     *
     * So the exact type-preserving match is tried FIRST and always wins. The
     * relaxed match runs only when the exact one found nothing, and it is
     * accepted ONLY IF EXACTLY ONE feature answers to the relaxed name — which
     * is the whole safety property. Rockaway relaxes to two candidates and is
     * therefore refused; Dover relaxes to one and is taken.
     */
    const stripType = (t: string) =>
      t.replace(/\s+(TOWNSHIP|BOROUGH|VILLAGE|TOWN|CITY|MUNICIPALITY|COUNTY)$/, "");
    let relaxed = 0;
    const claimants = new Map<number, GusRow[]>();
    for (const fipsKey of Object.keys(gus).filter((k) => !k.startsWith("_"))) {
      for (const unit of gus[fipsKey] as GusRow[]) {
        if (unit.kind !== "SCHOOL_DISTRICT" && unit.kind !== "DEPENDENT_SCHOOL_DISTRICT") continue;
        const token = normalize(unit.name);
        let idx = school.findIndex((f) => normalize(f.properties.label) === token);
        if (idx < 0) {
          const bare = stripType(token);
          const loose = school
            .map((f, i) => ({ i, bare: stripType(normalize(f.properties.label)) }))
            .filter((c) => c.bare === bare);
          if (loose.length === 1) {
            idx = loose[0]!.i;
            relaxed++;
          }
        }
        if (idx < 0) continue;
        claimants.set(idx, [...(claimants.get(idx) ?? []), unit]);
      }
    }
    if (relaxed > 0) {
      schoolContest.push(
        `${relaxed} district(s) matched only after the municipal TYPE word was relaxed, and every one of those ` +
          "relaxed names answered to exactly one polygon — an ambiguous relaxation is refused, never guessed",
      );
    }
    for (const [idx, units] of claimants) {
      const feature = school[idx]!;
      if (units.length === 1) {
        schoolAssignment.set(units[0]!.censusId, feature);
        continue;
      }
      const inside = units.filter((u) => {
        const p = u.zip ? lookupZcta(u.zip) : null;
        return p ? contains([p.lng, p.lat], feature.geometry) : false;
      });
      if (inside.length === 1) {
        schoolAssignment.set(inside[0]!.censusId, feature);
        schoolContest.push(
          `${feature.properties.label}: ${units.length} units named it, resolved to ${inside[0]!.name} ` +
            `(${inside[0]!.countyFips}) by its administrative point`,
        );
      } else {
        schoolContest.push(
          `${feature.properties.label}: ${units.length} units named it and ${inside.length} contain its ` +
            `administrative point — UNASSIGNED, because a shared identifier is worse than a missing one ` +
            `(${units.map((u) => `${u.name} ${u.countyFips}`).join("; ")})`,
        );
      }
    }
  }
  console.log(
    `\nstate FIPS ${stateFips} · containing county ${containingCounty.properties.label} (${countyFips}) · ` +
      `${counties.length} county slice(s) of the 2022 Census of Governments, ${counties.reduce((n, k) => n + (gus[k] as GusRow[]).length, 0)} units\n`,
  );

  // Which named geometries actually contain the point. These are the ground
  // truth the name-matching below is checked against.
  const govCousub = cousub.features.filter((f) => contains(point, f.geometry));
  const govCounty = county.features.filter((f) => contains(point, f.geometry));
  const govSchool = school.filter((f) => contains(point, f.geometry));

  console.log(`## ${zip} — centroid ${lat}, ${lng}`);
  console.log(`meetings-near rule: RADIUS_LADDER_KM[0] = ${nearKm} km from the ZCTA centroid\n`);
  console.log("geometry says the point is inside:");
  for (const f of [...govCounty, ...govCousub, ...govSchool]) {
    console.log(`  ${f.properties.label}  (${f.properties.ocdId})`);
  }

  const rows: Record<string, unknown>[] = [];

  for (const fips of counties) {
    for (const unit of gus[fips] as GusRow[]) {
      const token = normalize(unit.name);
      let governs: boolean | "UNRESOLVED" = false;
      let governsMethod = "";
      let geographyServed = "";
      let ocdId: string | null = null;

      /*
       * ── WHICH GOVERNMENT THIS IS, AND WHETHER IT GOVERNS THIS ZIP, ARE TWO
       * QUESTIONS (NJ Hunt 2, 2026-08-22) ──────────────────────────────────
       *
       * Until today they were one. `ocdId` was read off the polygon that
       * CONTAINS THE ZCTA CENTROID, so a unit could only ever acquire an
       * identifier by governing the zip — and every nearby unit that does not
       * came out with `ocdId: null`.
       *
       * `pnpm twig:pair` then printed those units as **"no division of its
       * own"**, which is what it prints for a village district the Census
       * publishes no boundary for. Rockaway BOROUGH — a separate municipality
       * from Rockaway Township, 0 km away, running its own council and its own
       * school district, and holding a body in this registry already — read as
       * a unit with no division at all. So did Boonton, Dover, Butler,
       * Kinnelon, Mountain Lakes and every other neighbour whose bodies this
       * registry has held all along. The pair reported 5 of 178 with them
       * counted as gaps, and reconciled.
       *
       * Identity is a NAME MATCH OVER THE WHOLE LAYER. Jurisdiction is the
       * containment test, applied to the matched feature afterwards.
       */
      let shape: { properties: Record<string, string>; geometry: { type: string; coordinates: unknown } } | undefined;

      if (unit.kind === "GENERAL_PURPOSE" && /COUNTY/.test(unit.unitType ?? "")) {
        shape = county.features.find(
          (f) => normalizeCounty(f.properties.label) === normalizeCounty(unit.name),
        );
        governs = shape ? contains(point, shape.geometry) : false;
        ocdId = shape?.properties.ocdId ?? null;
        governsMethod = "TIGER county polygon contains the ZCTA centroid";
        geographyServed = "the whole county";
      } else if (unit.kind === "GENERAL_PURPOSE") {
        shape = municipalFeature(token, fips);
        governs = shape ? contains(point, shape.geometry) : false;
        ocdId = shape?.properties.ocdId ?? null;
        governsMethod = "TIGER county-subdivision polygon contains the ZCTA centroid";
        geographyServed = "the municipality";
      } else if (unit.kind === "SCHOOL_DISTRICT" || unit.kind === "DEPENDENT_SCHOOL_DISTRICT") {
        shape = schoolFeature(token, unit.censusId);
        governs = shape ? contains(point, shape.geometry) : false;
        ocdId = shape?.properties.ocdId ?? null;
        governsMethod = "TIGER school-district polygon contains the ZCTA centroid";
        geographyServed = "the school district";
      } else {
        governs = "UNRESOLVED";
        governsMethod =
          "the Census publishes NO boundary for special districts at any vintage — " +
          "resolvable only by reading the district's own published territory";
        geographyServed = "unresolved";
      }

      // TWO distances, because they answer different questions and a single
      // number would smuggle one answer in under the other's name.
      //
      // `boundaryKm` — nearest point of the unit's own territory. GENEROUS:
      // a town whose far corner reaches inside the circle counts, even if it
      // sits forty kilometres away. It is the upper bound on what could
      // possibly show, and over-counting a denominator can only ever make our
      // coverage look worse, never better, which is the safe direction.
      //
      // `adminKm` — the ZCTA centroid of the administrative address the
      // Census itself publishes for the unit. TIGHTER, and closer to the
      // thing a reader actually experiences, because the map pins a meeting
      // at its VENUE. It is a PROXY: a town's mailing address is usually its
      // town hall, and usually is not always.
      //
      // `meetingsNearZip` is decided on the venue proxy where one exists,
      // because that is what puts a pin on screen. Both numbers are carried
      // so the scorecard can state the bound as well as the estimate.
      const adminZip = (unit as { zip?: string }).zip ?? "";
      const adminCentroid = adminZip ? lookupZcta(adminZip) : null;
      const adminKm = adminCentroid ? haversineKm(lat, lng, adminCentroid.lat, adminCentroid.lng) : null;
      let km: number | null = null;
      let nearMethod = "";
      /*
       * The distance is measured on the SAME feature the identity was read
       * from, which is what makes the two agree by construction rather than by
       * two lookups happening to pick the same row.
       *
       * The old version re-derived the shape with a second, DIFFERENT lookup —
       * `normalize` over a hand-picked layer where the governs test had used
       * `normalizeCounty` over the county layer. So `COUNTY OF MERCER`
       * normalised to `MERCER COUNTY`, TIGER's county label normalised to
       * `MERCER`, no county ever matched, and every one of them came out with
       * no distance at all. That null then became `meetingsNearZip:
       * "UNRESOLVED"` and rode a truthiness bug in `twig:pair` all the way into
       * the coverage denominator — Ocean, Union and Mercer counties counted as
       * inside a 25 km circle around Rockaway.
       *
       * The lesson the earlier comment recorded still holds and is why the
       * layer choice above is explicit: "TOWN OF MERRIMACK" must not be allowed
       * to match the MERRIMACK COUNTY polygon.
       */
      if (shape) {
        km = nearestVertexKm(lat, lng, shape.geometry);
        nearMethod = "nearest point of the unit's own TIGER boundary";
      }
      const boundaryKm = km;
      const venueKm = adminKm ?? boundaryKm;
      const venueMethod = adminKm !== null
        ? `PROXY — ZCTA centroid of the unit's Census administrative address (${adminZip})`
        : nearMethod;

      rows.push({
        authoritativeSource: "2022 Census of Governments, Government Units Listing",
        sourceVintage: "2022 (January 2022 release), fetched 2026-08-16",
        censusId: unit.censusId,
        name: unit.name,
        governmentType: unit.unitType ?? unit.kind,
        kind: unit.kind,
        countyFips: fips,
        ocdId,
        geographyServed,
        governsZip: governs,
        governsMethod,
        boundaryKm: boundaryKm === null ? null : Number(boundaryKm.toFixed(2)),
        boundaryMethod: nearMethod || "no TIGER boundary published for this unit type",
        venueKm: venueKm === null ? null : Number(venueKm.toFixed(2)),
        venueMethod: venueMethod || "no boundary and no administrative ZIP — undecidable from committed data",
        meetingsNearZip: venueKm === null ? "UNRESOLVED" : venueKm <= nearKm,
        withinBoundaryBound: boundaryKm === null ? "UNRESOLVED" : boundaryKm <= nearKm,
        active: unit.active,
        web: unit.web || null,
      });
    }
  }

  /*
   * ── DISTINCT UNITS MUST GET DISTINCT IDENTIFIERS ─────────────────────────
   *
   * `CLAUDE.md`: a join that can collapse must be ASKED for distinctness, and
   * identical payloads across distinct keys are presumed broken. The name match
   * above is exactly such a join, and on its first run it handed one OCD id to
   * five different Washington Townships without complaint.
   *
   * A match rate is not evidence here — the collapsed version resolved MORE
   * units than the fenced one does. Only per-key uniqueness is evidence, so it
   * is asserted rather than hoped for, and a collision stops the run.
   */
  const byOcd = new Map<string, string[]>();
  for (const r of rows) {
    const id = r.ocdId as string | null;
    if (!id) continue;
    const list = byOcd.get(id) ?? [];
    list.push(`${r.name as string} (${r.countyFips as string})`);
    byOcd.set(id, list);
  }
  const collisions = [...byOcd.entries()].filter(([, units]) => units.length > 1);
  if (collisions.length > 0) {
    throw new Error(
      `${collisions.length} OCD id(s) were assigned to more than one Census unit, which is a collapsed join and ` +
        "never a coverage result:\n" +
        collisions.map(([id, units]) => `  ${id}  <-  ${units.join(" | ")}`).join("\n"),
    );
  }
  console.log(
    `\nidentity: ${byOcd.size} distinct OCD id(s) across ${rows.filter((r) => r.ocdId).length} unit(s) that resolved one — ` +
      `no collisions · ${redirected} redirected from a fictitious county-subdivision row to its active place row`,
  );
  if (schoolContest.length > 0) {
    console.log(
      `  ${schoolContest.length} school-district polygon(s) were claimed by more than one Census unit — every one stated, ` +
        "because a contested identity settled silently is a coverage number nobody can check:",
    );
    for (const line of schoolContest) console.log(`    ${line}`);
  }

  const governing = rows.filter((r) => r.governsZip === true);
  const unresolvedGov = rows.filter((r) => r.governsZip === "UNRESOLVED");
  const near = rows.filter((r) => r.meetingsNearZip === true);
  const unresolvedNear = rows.filter((r) => r.meetingsNearZip === "UNRESOLVED");
  const withinBound = rows.filter((r) => r.withinBoundaryBound === true);

  console.log(`\n## Step B — jurisdiction mapping over ${rows.length} enumerated units`);
  console.log(`governs ${zip}:        ${governing.length} resolved true, ${unresolvedGov.length} UNRESOLVED`);
  console.log(
    `meets within ${nearKm} km:  ${near.length} by venue proxy, ` +
      `${withinBound.length} by the generous territory bound, ${unresolvedNear.length} UNRESOLVED\n`,
  );

  console.log("GOVERNS THIS ZIP:");
  for (const r of governing) console.log(`  ${r.name}  [${r.kind}]  ${r.ocdId ?? ""}`);
  console.log("\nMEETS WITHIN THE DEFAULT RADIUS BY VENUE PROXY (units, not yet bodies):");
  for (const r of [...near].sort((a, b) => (a.venueKm as number) - (b.venueKm as number))) {
    console.log(
      `  ${String(r.venueKm).padStart(6)} km venue / ${String(r.boundaryKm ?? "—").padStart(6)} km territory  ` +
        `${r.name}  [${r.kind}]`,
    );
  }
  console.log("\nGOVERNS UNRESOLVED (special districts — no Census boundary exists at any vintage):");
  for (const r of unresolvedGov) {
    console.log(`  ${String(r.venueKm ?? "—").padStart(6)} km  ${r.name}  (${r.countyFips})`);
  }

  const out = {
    zip,
    frozenAt: new Date().toISOString(),
    centroid: { lat, lng },
    meetingsNearRule: {
      value: nearKm,
      unit: "km",
      source: "lib/meetings/constants.ts RADIUS_LADDER_KM[0]",
      note: "standing product law; the ladder widens to 60 then 150 km only when nothing upcoming is in view",
    },
    stepA: {
      source: "2022 Census of Governments, Government Units Listing",
      file: GUS,
      counties,
      unitsEnumerated: rows.length,
    },
    stepB: {
      governsZipTrue: governing.length,
      governsZipUnresolved: unresolvedGov.length,
      meetingsNearTrueByVenueProxy: near.length,
      meetingsNearTrueByTerritoryBound: withinBound.length,
      meetingsNearUnresolved: unresolvedNear.length,
    },
    units: rows,
  };
  const dest = process.env.UNIVERSE_OUT ?? `data/audit/universe-${zip}.json`;
  writeFileSync(dest, `${JSON.stringify(out, null, 1)}\n`, "utf8");
  console.log(`\nwrote ${dest}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
