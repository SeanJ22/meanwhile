/**
 * **EVERY TWIG AT A ZIP, AGAINST THE OFFICIAL UNIVERSE** (built 2026-08-21,
 * NH Hunt 4 item 4; RULING 57).
 *
 * ```
 * pnpm twig:pair [--zip 03255]
 * ```
 *
 * ## What it answers, and why it is a PAIR
 *
 * Coverage claims are made against the official universe, never against our
 * own records — a registry that defines its own denominator cannot be caught
 * missing anything. So this puts two numbers beside each other and makes them
 * reconcile:
 *
 * * **the denominator** — every government unit the 2022 Census of Governments
 *   places inside the reader's first-rung circle at this zip, frozen in
 *   `data/audit/universe-03255.json` with its method on every row;
 * * **the numerator** — the units this registry actually holds a BODY for.
 *
 * RULING 9 is why they are not the same kind of thing: the Census counts
 * GOVERNMENTS and this product renders BODIES. One Census row for the Town of
 * Warner is twenty-six bodies here. The report therefore prints units held,
 * units not held, AND bodies per held unit, so neither number can stand in
 * front of the other.
 *
 * ## Every un-held unit is NAMED
 *
 * RULING 57: a body is never skipped for being small, and a count is not a
 * name. "32 units uncovered" tells a reader nothing and lets a village water
 * district disappear into a statistic. Every one prints with its distance, its
 * type and the website the Census recorded for it — which is the first rung of
 * the next hunt.
 *
 * ## Matching is by DIVISION, not by name string
 *
 * Never join on name strings. A unit's division id is derived from its Census
 * name and county FIPS; a unit with no division of its own — which is every
 * village district, precinct and conservation district in this file — is
 * matched against the curated bodies that carry no division either, and a unit
 * whose division this registry does not even ship is reported as THAT rather
 * than as a missing body. The three states are different facts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { bodyAccountingFor } from "../lib/registry/body-name-match.ts";
import { CURATED_BODIES } from "../lib/registry/curated-bodies.ts";

/**
 * **A BARE ZIP IS ACCEPTED, AND AN UNRECOGNISED ARGUMENT IS FATAL.**
 *
 * `pnpm twig:pair 07866` used to run against 03255 and print a full, correct,
 * entirely irrelevant New Hampshire report — the positional was dropped on the
 * floor and the default silently took over. The header did say 03255, which is
 * exactly why it is dangerous: it looks right at a glance, and the only thing
 * distinguishing "the answer for the zip I asked about" from "the answer for
 * some other zip" is five digits nobody re-reads.
 *
 * So both forms work, and anything this cannot interpret stops the run instead
 * of being ignored. A tool that quietly measures something other than what it
 * was asked is the same defect class as an operation that reports success
 * without stating its count.
 */
import { assertEnumerationGeography, geographyLine } from "../lib/geo/zip-geography.ts";

const zipAt = process.argv.indexOf("--zip");
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flagged = zipAt >= 0 ? process.argv[zipAt + 1] : undefined;
const bare = zipAt >= 0 ? positional.filter((a) => a !== flagged) : positional;

if (bare.length > 1 || (bare.length === 1 && !/^\d{5}$/.test(bare[0]!))) {
  console.error(
    `unrecognised argument(s): ${bare.join(" ")}\n` +
      "usage: pnpm twig:pair [<zip> | --zip <zip>]\n" +
      "Refusing to run against the default, because a silent default is how a session measures the wrong place.",
  );
  process.exit(2);
}

const zip = flagged ?? bare[0] ?? "03255";

const universe = JSON.parse(
  readFileSync(join(process.cwd(), "data", "audit", `universe-${zip}.json`), "utf8"),
) as {
  units: {
    name: string | null;
    kind: string;
    governmentType: string;
    countyFips: string;
    ocdId: string | null;
    venueKm: number | null;
    /*
     * ── THIS IS TRI-STATE, AND TYPING IT `boolean` COST 37 UNITS ───────────
     * (NJ Hunt 2, 2026-08-22.)
     *
     * `zip:universe` writes `true`, `false`, or the string `"UNRESOLVED"` for a
     * unit whose distance it could not establish. This declaration said
     * `boolean`, so TypeScript never objected to `filter((u) => u.meetingsNearZip)`
     * — and `"UNRESOLVED"` is a non-empty string, which is truthy.
     *
     * Thirty-seven units at 07866 were therefore counted as sitting inside a
     * 25 km circle around Rockaway. Among them: Ocean County, Union County,
     * Mercer County, the City of Camden and two Cape May townships, none of
     * which are within a hundred kilometres. The denominator read 178, the pair
     * reported 5 held against 173 missing, and 5 + 173 = 178 reconciled
     * perfectly — RULING 67's self-reconciling wrong answer, in the instrument
     * the coverage claim is made with.
     *
     * The type now says what the data says, and the three cases are handled
     * separately below, because an undecidable distance is a failed measurement
     * and must never be folded into either side of a coverage pair.
     */
    meetingsNearZip: boolean | "UNRESOLVED";
    web?: string;
  }[];
  centroid?: { lat: number; lng: number };
};
const registry = JSON.parse(
  readFileSync(join(process.cwd(), "lib", "registry", "registry.json"), "utf8"),
) as {
  divisions: { id: string }[];
  bodies: { id: string; ocdId: string | null; name: string }[];
};

/** The counties this zip's circle crosses, by FIPS. */
const COUNTY_OF = new Map([
  ["33013", "merrimack"],
  ["33019", "sullivan"],
  ["33011", "hillsborough"],
]);

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** The division id a Census unit would carry here, or null if it has none. */
/**
 * **THE DIVISION COMES FROM GEOMETRY FIRST, AND FROM A NAME TEMPLATE ONLY AS A
 * NEW-HAMPSHIRE FALLBACK** (fixed 2026-08-22, NJ Hunt item 3).
 *
 * Every branch of the template below writes `state:nh` into the id and appends
 * New Hampshire's `_town` place suffix. Run against New Jersey it produced
 * `state:nh/...` ids for Morris County units, matched nothing, and reported
 * `TOWNSHIP OF ROCKAWAY` — a township this registry holds four bodies for, two
 * of them LIVE — as **"no division of its own"**. The pair then read 1 of 178,
 * and reconciled while doing it.
 *
 * `zip:universe` already resolves each unit's OCD id by testing the zip's
 * centroid against the committed TIGER polygons, which is ground truth and
 * carries no naming convention at all. Reading it is both more correct and less
 * code. The template is kept ONLY for New Hampshire units that geometry could
 * not resolve — special districts with no Census boundary at any vintage — and
 * is fenced to FIPS 33 so it can never again mint an id for a state whose
 * conventions it does not know.
 */
function divisionFor(unit: {
  name: string | null;
  countyFips: string;
  ocdId?: string | null;
}): string | null {
  if (unit.ocdId) return unit.ocdId;
  if (!unit.countyFips.startsWith("33")) return null;
  const name = unit.name ?? "";
  const county = COUNTY_OF.get(unit.countyFips);
  if (!county) return null;
  const town = /^(?:TOWN|CITY) OF (.+)$/.exec(name);
  if (town) {
    return `ocd-division/country:us/state:nh/county:${county}/place:${slug(town[1])}_town`;
  }
  if (/^COUNTY OF /.test(name)) return `ocd-division/country:us/state:nh/county:${county}`;
  const school = /^(.*?)\s+SCH(?:OOL)?\s+DIST(?:RICT)?$/.exec(name);
  if (school) {
    return `ocd-division/country:us/state:nh/school_district:${schoolSlug(school[1])}_school_district`;
  }
  return null;
}

/*
 * NOTE ON THE DOC BLOCK BELOW: its closing paragraph originally described a
 * LEMPSTER -> goshen_lempster alias as the one per-district fact no rule could
 * derive. That alias was wrong and has been removed — see SCHOOL_ALIASES. The
 * two-mechanism split it describes is unchanged and still the point.
 */
/**
 * THE CENSUS ABBREVIATES SCHOOL DISTRICT NAMES AND THE REGISTRY DOES NOT.
 * (NH Hunt 5, 2026-08-21.)
 *
 * This derivation used to be `slug(name)` and nothing else, and it reported
 * TEN school districts as "division NOT in this registry" on a day when six of
 * them were sitting in `registry.json` under their expanded names. The
 * Census's own file writes `HILLSBORO DEERING COOPERATN SCH DIST`, `JOHN STARK
 * REG SCHOOL DISTRICT` and `HENNIKER TOWN SCH DIST`; NCES and the OCD
 * identifiers write `hillsboro_deering_cooperative_school_district`,
 * `john_stark_regional_school_district` and `henniker_school_district`.
 *
 * The failure mode is the one that matters most in this report: a unit that IS
 * held reads as a gap, which sends the next session to hunt a body that is
 * already in the registry, and — worse — makes the coverage pair understate
 * itself. An understated denominator is not a safe error here; it is a false
 * statement about what this product holds.
 *
 * Two mechanisms, deliberately separate:
 *
 *  - EXPANSIONS are the Census's abbreviation vocabulary, applied to every
 *    name. They are rules, and a rule that is wrong is wrong visibly.
 *  - ALIASES are per-district facts that no rule can derive. There are none
 *    today. When one appears — two federal enumerations genuinely disagreeing
 *    about one government's name — it belongs there rather than in the
 *    expansion rules, where it would look derived and would quietly widen to
 *    districts it was never checked against. RULING 57: two official
 *    enumerations that disagree is a finding, and a finding gets a line.
 */
const SCHOOL_EXPANSIONS: [RegExp, string][] = [
  [/\bCOOPERATN\b/g, "COOPERATIVE"],
  [/\bCOOP\b/g, "COOPERATIVE"],
  [/\bREG\b/g, "REGIONAL"],
  // "X TOWN SCH DIST" is the Census's way of writing a single-town district.
  // The identifier drops the word, because "henniker_town_school_district"
  // and "henniker_school_district" are the same government.
  [/\s+TOWN$/, ""],
  [/\s+CITY$/, ""],
];

const SCHOOL_ALIASES: Record<string, string> = {
  // Empty, and kept as a named mechanism rather than deleted.
  //
  // It briefly held LEMPSTER -> goshen_lempster, which was WRONG: NCES lists
  // Lempster School District and Goshen School District as two districts, and
  // the Goshen-Lempster Cooperative is how they jointly run their schools
  // rather than a third government. See lib/registry/curated-divisions.ts.
  //
  // The mechanism stays because the NEXT genuine naming disagreement between
  // two federal enumerations should land here, visibly, as a per-district fact
  // rather than being smoothed into the expansion rules where it would look
  // derived. RULING 57: two official enumerations that disagree is a finding.
};

function schoolSlug(raw: string): string {
  let name = raw.toUpperCase().trim();
  for (const [pattern, replacement] of SCHOOL_EXPANSIONS) {
    name = name.replace(pattern, replacement).trim();
  }
  return SCHOOL_ALIASES[name] ?? slug(name);
}

const bodiesByDivision = new Map<string, string[]>();
const divisionless: string[] = [];
/** Every body name in the registry, for a unit that has no division of its own. */
const allBodyNames: string[] = [];
for (const body of [...CURATED_BODIES, ...registry.bodies]) {
  allBodyNames.push(body.name ?? "");
  if (!body.ocdId) {
    divisionless.push(body.name ?? "");
    continue;
  }
  const list = bodiesByDivision.get(body.ocdId) ?? [];
  list.push(body.name ?? "");
  bodiesByDivision.set(body.ocdId, list);
}
const shippedDivisions = new Set(registry.divisions.map((d) => d.id));

/**
 * A curated body filed under this unit's own name, for a unit with no division.
 *
 * The matcher moved to lib/registry/body-name-match.ts (NH Hunt 5), because
 * docs/gap-ledger.md was answering the same question with no lookup at all and
 * contradicting this report about Lake Todd Village District on the same day.
 * Two instruments, one implementation.
 */
function divisionlessBodyFor(name: string): string | undefined {
  return bodyAccountingFor(name, allBodyNames);
}

const near = universe.units.filter((u) => u.meetingsNearZip === true);
/**
 * Units whose distance from the zip could not be established at all.
 *
 * These are a FAILED MEASUREMENT, and they are reported beside the pair rather
 * than inside it. Counting them as inside the circle inflates the denominator
 * with governments that are demonstrably elsewhere; counting them as outside
 * asserts they are far away, which nothing here measured. Neither is honest, so
 * they get their own number and their own names.
 */
const undecidable = universe.units.filter((u) => u.meetingsNearZip === "UNRESOLVED");
const held: { unit: string; bodies: number; how: string }[] = [];
const missing: {
  unit: string;
  kind: string;
  km: number | null;
  state: "division shipped, no body" | "division NOT in this registry" | "no division of its own";
  web?: string;
}[] = [];

for (const unit of near) {
  const division = divisionFor(unit);
  let bodies = division ? (bodiesByDivision.get(division) ?? []) : [];
  let how = division ? "by division" : "";
  if (bodies.length === 0 && unit.name) {
    const hit = divisionlessBodyFor(unit.name);
    if (hit) {
      bodies = [hit];
      how = "by curated name (the unit has no Census division)";
    }
  }
  if (bodies.length > 0) {
    held.push({ unit: unit.name ?? "(unnamed)", bodies: bodies.length, how });
    continue;
  }
  missing.push({
    unit: unit.name ?? "(unnamed)",
    kind: unit.kind,
    km: unit.venueKm,
    state: !division
      ? "no division of its own"
      : shippedDivisions.has(division)
        ? "division shipped, no body"
        : "division NOT in this registry",
    web: unit.web,
  });
}

const bodiesHeld = held.reduce((n, h) => n + h.bodies, 0);

/*
 * ── RULING 67: CHECKED AGAINST THE ZIP'S OWN GEOGRAPHY, EXTERNALLY ─────────
 *
 * This pair used to be validated only against the enumeration it was computed
 * from — `held + missing === near`, where all three came out of one file. It
 * reconciled on the day `zip:universe` enumerated New Hampshire for this New
 * Jersey zip, and it would reconcile again tomorrow under the same failure.
 *
 * So the universe file is now required to STATE the state it read, and that
 * statement is checked against TIGER's state outlines and the Department of
 * Education's LEA directory — neither of which this pair or that enumeration
 * consults to decide what to read.
 */
const enumeratedStateFips = [
  ...new Set(universe.units.map((u) => String(u.countyFips ?? "").slice(0, 2)).filter((s) => /^\d{2}$/.test(s))),
];
if (enumeratedStateFips.length !== 1) {
  throw new Error(
    `data/audit/universe-${zip}.json enumerates ${enumeratedStateFips.length} states (${enumeratedStateFips.join(", ") || "none"}). ` +
      "A zip's universe is enumerated from one state's files, so this is a corrupt or hand-edited universe rather than a wide one.",
  );
}
const truth = assertEnumerationGeography(zip, {
  stateFips: enumeratedStateFips[0]!,
  by: `data/audit/universe-${zip}.json, as read by pnpm twig:pair`,
});
console.log(`\n${geographyLine(truth)}`);

console.log(`\nTHE TWIG PAIR AT ${zip} — RULING 57`);
console.log(`  units the Census places within the first-rung circle:  ${near.length}`);
console.log(`  units this registry holds a body for:                  ${held.length}`);
console.log(`  units with NO body here:                               ${missing.length}`);
console.log(
  `  ${held.length} + ${missing.length} = ${held.length + missing.length}` +
    (held.length + missing.length === near.length ? "  (reconciles)" : "  (DOES NOT RECONCILE)"),
);
console.log(`  bodies held across those units:                        ${bodiesHeld}`);
console.log(
  `  units whose distance could NOT be established:         ${undecidable.length}` +
    "   (a failed measurement — outside the pair on purpose, never folded into either side)",
);
if (undecidable.length > 0) {
  /*
   * Being unplaceable says nothing about whether this product holds the body,
   * and the two must not be conflated a second time. Morris County Soil
   * Conservation District has a body here and no resolvable distance; printing
   * it under a bare "undecidable" heading would read as a gap.
   */
  const undecidableHeld = undecidable.filter((u) => {
    const division = divisionFor(u);
    if (division && (bodiesByDivision.get(division) ?? []).length > 0) return true;
    return Boolean(u.name && divisionlessBodyFor(u.name));
  });
  console.log(
    `\nDISTANCE UNDECIDABLE — named, because a failed measurement that is only counted disappears.` +
      `\n  ${undecidableHeld.length} of these ${undecidable.length} DO carry a body here; being unplaceable is not being unheld.`,
  );
  for (const u of undecidable) {
    const isHeld = undecidableHeld.includes(u);
    console.log(
      `  ${isHeld ? "held " : "     "} ${String(u.kind).padEnd(25)}  ${String(u.name ?? "(unnamed)").padEnd(48)}` +
        `county ${String(u.countyFips ?? "?")}${u.web ? `  ${u.web}` : ""}`,
    );
  }
}

console.log(`\nHELD — units, and how many bodies each carries here:`);
for (const h of [...held].sort((a, b) => b.bodies - a.bodies)) {
  console.log(`  ${String(h.bodies).padStart(3)}  ${h.unit.padEnd(42)} ${h.how}`);
}

console.log(`\nNO BODY HERE — every one named, because a count is not a name:`);
for (const m of [...missing].sort((a, b) => (a.km ?? 999) - (b.km ?? 999))) {
  console.log(
    `  ${String(m.km ?? "?").padStart(6)} km  ${m.kind.padEnd(25)}  ${m.unit.padEnd(44)}` +
      `${m.state}${m.web ? `  ${m.web}` : ""}`,
  );
}

if (held.length + missing.length !== near.length) process.exit(1);
