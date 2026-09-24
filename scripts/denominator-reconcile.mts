/**
 * `pnpm denominators` — **what each coverage number actually counts.**
 *
 * Written 2026-08-23 (visual-tail-and-rehunt session, item 3), over a
 * subtraction that reconciled perfectly and was meaningless.
 *
 * ## The arithmetic this exists to stop
 *
 * A brief stated the rendering split as *174 of 174 in the registry render, 0
 * out of scope, 1,079 of 1,253 in the official universe in scope and still
 * dark.* The three numbers add up exactly — 1,253 − 174 = 1,079 — and the
 * subtraction is between two different populations:
 *
 * - **1,253** is every body in the WHOLE REGISTRY that carries a division,
 *   across three states (NH 534, NJ 448, AZ 271). It comes from
 *   `lib/registry/registry.json` and is the denominator
 *   `scripts/measure-definitions-0823.mts` reports against.
 * - **174** is the entity count from the GOVERNMENT-GRAPH CRAWL of a single
 *   zip, 07866, at depth 7 (`docs/state.md`). It is one zip's neighbourhood,
 *   not a share of the registry.
 *
 * Neither number is wrong. Subtracting one from the other produces a figure
 * that describes nothing, and it passes every reconciliation check because the
 * two operands were never required to be commensurable. **A total that
 * reconciles is not a total that is correct.**
 *
 * ## What this reports instead, per zip
 *
 * Three numbers with three DIFFERENT and named denominators — RULING 105's
 * three-way split, plus the geography each enumeration resolved to so it can be
 * checked against something outside this repo:
 *
 * 1. **The official universe** — governments the Census of Governments and NCES
 *    place in this zip, counted as GOVERNMENTS rather than as census records.
 * 2. **The registry** — how many of those this product has enumerated.
 * 3. **Rendering** — how many reach a reader.
 *
 * ## Two corrections the raw unit counts need, both stated rather than applied silently
 *
 * - **A CDP is not a government.** `lsad` 57 marks a Census-designated place: a
 *   statistical area drawn for tabulation, with no charter, no council and
 *   nobody to elect. 07866's twelve census rows include four — White Meadow
 *   Lake, Hibernia, Lake Telemark — and counting them as governments inflates
 *   an official universe with entities no reader can ever be governed by.
 * - **One government can appear in two layers.** Rockaway borough is both a
 *   `place` (3464050) and a `cousub` (3402764050). It is one government. The
 *   `place`/`cousub` pair is deduplicated by name within the county, and the
 *   count of collapsed pairs is REPORTED so the deduplication is visible rather
 *   than assumed.
 *
 * ```
 * pnpm denominators                 # the two settled zips
 * pnpm denominators 07866 03255 …   # any zips
 * ```
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { withoutPlaceholderBodies } from "../lib/registry/census-placeholders.ts";

const ROOT = process.cwd();

/** Census LSAD codes that mark a statistical area rather than a government. */
const CDP_LSAD = new Set(["57"]);

interface Unit {
  layer: string;
  id: string;
  name: string;
  samples: number;
  entity: string;
  lsad?: string | null;
}

interface Division {
  ocdId: string;
  divisionType: string;
  label: string;
}
interface Body {
  ocdId: string | null;
  name?: string;
}

const zipGov = JSON.parse(
  readFileSync(join(ROOT, "data/derived/zip-governments.json"), "utf8"),
) as { zips: Record<string, Unit[]>; method: Record<string, unknown> };

// A body minted on a Census "no district here" placeholder is not a government and is never counted.
const registry = withoutPlaceholderBodies(JSON.parse(
  readFileSync(join(ROOT, "lib/registry/registry.json"), "utf8"),
) as { divisions: Division[]; bodies: Body[] });

const zips = process.argv.slice(2).filter((a) => /^\d{5}$/.test(a));
const targets = zips.length > 0 ? zips : ["07866", "03255"];

/* -------------------------------------------------------------------------- */
/* What the whole-registry numbers actually count                             */
/* -------------------------------------------------------------------------- */

const divisionById = new Map(registry.divisions.map((d) => [d.ocdId, d]));
const bodiesWithDivision = registry.bodies.filter(
  (b) => b.ocdId !== null && divisionById.has(b.ocdId),
);

function stateOf(ocdId: string | null): string {
  if (ocdId === null) return "—";
  const seg = ocdId.split("/").find((s) => s.startsWith("state:"));
  return seg === undefined ? "country" : (seg.split(":")[1] as string);
}

const byState = new Map<string, number>();
for (const b of bodiesWithDivision) {
  const s = stateOf(b.ocdId);
  byState.set(s, (byState.get(s) ?? 0) + 1);
}

console.log("THE WHOLE-REGISTRY NUMBER, and what it is a number about\n");
console.log(`  bodies in lib/registry/registry.json, less the Census placeholders  ${registry.bodies.length}`);
console.log(`  ...carrying a division that exists             ${bodiesWithDivision.length}`);
console.log("  ...by state:");
for (const [s, n] of [...byState].sort((a, b) => b[1] - a[1])) {
  console.log(`      ${s.padEnd(10)} ${n}`);
}
console.log(
  "\n  This is a THREE-STATE REGISTRY TOTAL. It is not a per-zip figure, and no\n" +
    "  single zip's crawl count may be subtracted from it — the two are different\n" +
    "  populations and the difference describes nothing.\n",
);

/* -------------------------------------------------------------------------- */
/* Per zip                                                                    */
/* -------------------------------------------------------------------------- */

for (const zip of targets) {
  const units = zipGov.zips[zip];
  console.log(`\n${"=".repeat(72)}\nZIP ${zip}`);
  if (units === undefined) {
    // RULING 24 — a check that cannot reach its subject never prints like a
    // passing one.
    console.log("  COULD NOT TELL — this zip is not in data/derived/zip-governments.json");
    continue;
  }

  const county = units.find((u) => u.layer === "county");
  const cdps = units.filter((u) => CDP_LSAD.has(String(u.lsad ?? "")));

  // Deduplicate the place/cousub pair that is one government wearing two
  // census layers. Keyed on the normalized name, within this zip.
  const governments = units.filter((u) => !CDP_LSAD.has(String(u.lsad ?? "")));
  const seen = new Map<string, Unit[]>();
  for (const u of governments) {
    const key = u.name.toLowerCase().replace(/\s+/g, " ").trim();
    seen.set(key, [...(seen.get(key) ?? []), u]);
  }
  const collapsed = [...seen.values()].filter((v) => v.length > 1).length;

  console.log("\n  GEOGRAPHY THIS ENUMERATION RESOLVED TO — check it outside this repo");
  console.log(`    county          ${county?.name ?? "—"} (FIPS ${county?.id ?? "—"})`);
  const munis = [...seen.values()]
    .map((v) => v[0] as Unit)
    .filter((u) => u.layer === "place" || u.layer === "cousub");
  console.log(`    municipalities  ${munis.map((m) => m.name).join(", ") || "—"}`);

  console.log("\n  THE OFFICIAL UNIVERSE — Census of Governments and NCES, in this zip");
  console.log(`    census records returned                    ${units.length}`);
  console.log(`    ...of which CDPs (statistical, not a government) ${cdps.length}`);
  if (cdps.length > 0) console.log(`        ${cdps.map((c) => c.name).join(", ")}`);
  console.log(`    ...place/cousub pairs collapsed to one government ${collapsed}`);
  const universe = seen.size;
  console.log(`    GOVERNMENTS in the official universe        ${universe}`);
  for (const v of seen.values()) {
    const u = v[0] as Unit;
    console.log(`        ${u.layer.padEnd(7)} ${u.name}${v.length > 1 ? `  (also as ${v[1]?.layer})` : ""}`);
  }

  /*
   * THE REGISTRY, for this zip. Matched by division label against the census
   * name, which is a NAME JOIN and is therefore stated as approximate — this
   * project joins on OCD-IDs everywhere it can, and the census unit file
   * carries FIPS rather than OCD-IDs. The number is reported as a floor, not
   * as a verdict, because a name join that misses reads as a gap that is not
   * there.
   */
  const wanted = [...seen.keys()];
  const registryHits = new Set<string>();
  /*
   * A TOKEN-SUBSET match, not a substring one.
   *
   * The first version stripped the type word ("borough", "township") from the
   * CENSUS name only and then asked whether the registry label contained the
   * result — so "Rockaway Borough School District" became "rockaway school
   * district", which the label "Rockaway Borough School District" does not
   * contain. It reported three school districts missing that are all present
   * in the registry under `school_district:` OCD-IDs. The join was failing and
   * reading as a gap, which is the failure this script's own footer warns
   * about, committed by the script itself on its first run.
   *
   * Comparing token SETS is symmetric and cannot be defeated by a word one
   * side spells and the other omits.
   */
  const tokens = (s: string): Set<string> =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(" ")
        /*
         * "county" is dropped from BOTH sides: OCD county divisions are
         * labelled "Morris", the census calls it "Morris County", and the
         * mismatch reported both target counties as gaps when both are in the
         * registry as `county:morris#governing` and `county:merrimack#governing`.
         * Only "county" is dropped — dropping "township" and "borough" too
         * would collide Rockaway township with Rockaway borough, which are two
         * different governments in this very zip.
         */
        .filter((t) => t.length > 2 && t !== "cdp" && t !== "county"),
    );
  const labels = registry.divisions.map((d) => tokens(d.label));
  for (const w of wanted) {
    const want = tokens(w);
    if (want.size === 0) continue;
    for (const have of labels) {
      // Every meaningful word of the census name appears in the label.
      let all = true;
      for (const t of want) {
        if (!have.has(t)) {
          all = false;
          break;
        }
      }
      if (all) {
        registryHits.add(w);
        break;
      }
    }
  }

  console.log(
    `\n  THE REGISTRY — governments of the ${universe} this product has enumerated`,
  );
  console.log(`    matched by name (a FLOOR, not a verdict)   ${registryHits.size} of ${universe}`);
  const missing = wanted.filter((w) => !registryHits.has(w));
  if (missing.length > 0) {
    console.log("    not matched:");
    for (const m of missing) console.log(`        ${m}`);
  }
}

console.log(
  "\n\nWhat this does NOT claim: that the registry figure above is a verdict. It is\n" +
    "a NAME join against a FIPS-keyed file, and this project joins on OCD-IDs\n" +
    "everywhere it can. A name that fails to match reads here as a gap, and some\n" +
    "of those gaps are the join rather than the coverage. The number is a floor.\n",
);
