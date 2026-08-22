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

const zipAt = process.argv.indexOf("--zip");
const zip = zipAt >= 0 ? process.argv[zipAt + 1] : "03255";

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
    meetingsNearZip: boolean;
    web?: string;
  }[];
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
function divisionFor(unit: { name: string | null; countyFips: string }): string | null {
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

const near = universe.units.filter((u) => u.meetingsNearZip);
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

console.log(`\nTHE TWIG PAIR AT ${zip} — RULING 57`);
console.log(`  units the Census places within the first-rung circle:  ${near.length}`);
console.log(`  units this registry holds a body for:                  ${held.length}`);
console.log(`  units with NO body here:                               ${missing.length}`);
console.log(
  `  ${held.length} + ${missing.length} = ${held.length + missing.length}` +
    (held.length + missing.length === near.length ? "  (reconciles)" : "  (DOES NOT RECONCILE)"),
);
console.log(`  bodies held across those units:                        ${bodiesHeld}`);

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
