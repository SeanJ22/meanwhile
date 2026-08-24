/**
 * **EVERY CLASS STAMP, CHECKED AGAINST A SECOND AUTHORITY.**
 * (`NH106` session, 2026-08-23, item 3. RULING 114.)
 *
 * ## What the LSAD swap taught, and why it outlives itself
 *
 * `classKeyFor` had Census LSAD **43** and **44** reversed — 43 is `town`, 44
 * is `township` — so New Jersey's township definition rendered on Morristown,
 * Kearny, Dover, Newton, Boonton, Westfield, Clinton, Hackettstown,
 * Phillipsburg, Harrison and Belvidere. Not one of those is a township.
 *
 * The swap is fixed. The lesson is not about the swap:
 *
 * **Closing the class layer to 1,253 of 1,253 removed the empty state that
 * used to be honest.** Before it was complete, a body with no definition
 * rendered nothing, and nothing is never wrong. A layer that ALWAYS renders
 * converts every misclassification into a false claim about how a reader is
 * governed — and it does it silently, because a wrong definition looks exactly
 * as healthy as a right one. Coverage went from a number that could only
 * embarrass us to a number that can lie.
 *
 * ## Why a second authority rather than a better test
 *
 * Re-deriving the stamp from the same field it was stamped from proves only
 * that the code is deterministic. It would have agreed with the swap on all
 * 1,253 rows, every day, for as long as the swap lived.
 *
 * So the check is against a **different publication**:
 *
 * | | |
 * | --- | --- |
 * | What we stamp from | TIGER/Line **LSAD** — a cartographic attribute of a polygon |
 * | What we check against | the **2022 Census of Governments** — `unit_name` and `gov_type`, a roster of governments |
 *
 * Both are the Census Bureau, and they are not the same statement. TIGER
 * describes a shape; the Census of Governments describes a GOVERNMENT, names
 * it in full (`TOWNSHIP OF ROCKAWAY`, `TOWN OF MORRISTOWN`), and types it. The
 * 43/44 swap disagrees with the name on every row it touched, which is exactly
 * what a check like this is for.
 *
 * They are joined on the FIPS code — `geoid` is `<state:2><place:5>` and the
 * roster carries the two halves in separate columns — never on a name string,
 * per the data-model rule.
 *
 * ## What it does NOT claim
 *
 * A row with no counterpart in the roster is reported as **no source to check
 * against**, and that is a distinct, named, counted outcome. It is never
 * folded into the verified total. Most of them are school districts and CDPs,
 * which the municipal roster does not enumerate as municipalities, and a sweep
 * that quietly counted them as agreeing would be reporting confidence it never
 * measured — RULING 100's partial, one layer up.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FORMS = join(ROOT, "data/derived/body-forms.json");
const REGISTRY = join(ROOT, "lib/registry/registry.json");
const COG = join(ROOT, "data/reference/census_govt_units_2022.csv");
const OUT = join(ROOT, "data/derived/class-stamp-sweep.json");

/**
 * **THIS ARTIFACT CARRIES NO DATE, AND THAT IS THE CORRECT ANSWER RATHER THAN
 * AN OMISSION.**
 *
 * RULING 107: a freshness date is written only by the code path that performed
 * the read. Nothing here reads anything live — every input is a committed file
 * (the stamp file, the registry, the 2022 roster), so the output is a pure
 * function of the tree. There is nothing for a date to be fresh ABOUT, and
 * stamping one would claim a currency the sweep never measured.
 *
 * The freshness that matters belongs to the INPUTS and is already recorded on
 * them: the roster carries its own collection provenance, and RULING 102's
 * digest register fails the build if this generator moves without its artifact
 * being regenerated. A date here would be a third, weaker claim about the same
 * thing — and it would break purity, since a pure generator that writes today
 * into its output is not byte-identical tomorrow.
 */

/**
 * The form word the Census of Governments puts at the front of a unit name,
 * mapped to the form key this product stamps.
 *
 * Read off the roster rather than assumed: every NJ and NH municipal row in
 * `census_govt_units_2022.csv` opens with one of these five words.
 */
const NAME_FORM: [RegExp, string][] = [
  [/^TOWNSHIP OF /, "township"],
  [/^BOROUGH OF /, "borough"],
  [/^TOWN OF /, "town"],
  [/^CITY OF /, "city"],
  [/^VILLAGE OF /, "village"],
  [/^COUNTY OF /, "county"],
];

/**
 * A CSV reader that survives a quoted comma.
 *
 * `census_govt_units_2022.csv` holds `"http://www.co.cape-may,nj.us"` in a web
 * address, so a `split(",")` shifts every column after it on that row — which
 * would silently attribute one government's type to another. That is the
 * quiet-partial shape, and it is cheaper to parse properly than to explain a
 * wrong row later.
 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out;
}

interface FormRow {
  bodyId: string;
  ocdId: string;
  formKey: string | null;
  basis: string;
  basisDetail: string;
}

interface Division {
  ocdId: string;
  divisionType: string;
  state: string | null;
  label: string;
  geoid: string | null;
  lsad: string | null;
}

type Verdict = "VERIFIED" | "MISMATCH" | "ADJUDICATED" | "NO-SOURCE";

/**
 * Disagreements between the two authorities that have been RESOLVED against a
 * third, with the evidence attached.
 *
 * **This is not a suppression list and the difference matters.** A row here
 * still reports as a disagreement; what it carries is the branch that settled
 * it. RULING 57: two official enumerations that disagree is a FINDING, not an
 * error — and a finding is closed by going and looking, not by muting it.
 *
 * A row may only be added after the ladder was walked and the resolving read
 * is named. Nothing is added because it is inconvenient.
 */
const ADJUDICATED = new Map<string, string>([
  [
    "ocd-division/country:us/state:az/place:buckeye#governing",
    "RESOLVED IN FAVOUR OF THE STAMP, 2026-08-23. Buckeye's own site was walled at rung 3 " +
      "(HTTP 403 to a browser header set), so the tree was taken rather than the ladder: " +
      "rung 11, the Internet Archive's 2026-08-16 capture of buckeyeaz.gov, carries " +
      '"City of Buckeye" three times on the body\'s own homepage; Wikipedia (Tier A discovery, ' +
      'RULING 87) opens "Buckeye is a city in Maricopa County". Both agree with TIGER LSAD 25. ' +
      "The 2022 Census of Governments name is STALE — Buckeye was a town and became a city, and " +
      "a roster keyed to 2022 kept the older name. The stamp is correct and nothing is changed.",
  ],
]);

function main(): void {
  const forms = JSON.parse(readFileSync(FORMS, "utf8")) as {
    counts: { bodiesWithADivision: number };
    rows: FormRow[];
  };
  const registry = JSON.parse(readFileSync(REGISTRY, "utf8")) as { divisions: Division[] };
  const byOcd = new Map(registry.divisions.map((d) => [d.ocdId, d]));

  /*
   * The roster, keyed BOTH ways the registry's geoid can be built.
   *
   * **This is where the sweep first lied to itself, and the shape is RULING
   * 111's.** The first version keyed only on `state+place` (7 characters) and
   * duly reported **467 rows with "no source to check against"** — all 353 New
   * Hampshire towns and all 114 New Jersey townships, every one of which the
   * roster holds. They are **county subdivisions**, not incorporated places,
   * so their geoid is 10 characters — `state(2) + county(3) + cousub(5)` —
   * and `3301744820` was being looked up as if it were a place code.
   *
   * A failed join reported as an absent source is the exact failure RULING 111
   * names: the fact lived on both sides and the lookup was written for one of
   * them. It read as a modest, honest "we could not check these", which is why
   * it would have survived indefinitely.
   *
   * Counties are keyed separately again: a county's geoid is `state+county`
   * and `fips_place` is the sentinel `99001` on those rows.
   */
  const cogByPlace = new Map<string, { name: string; govType: string }>();
  const cogBySubdivision = new Map<string, { name: string; govType: string }>();
  const cogByCounty = new Map<string, { name: string; govType: string }>();
  const lines = readFileSync(COG, "utf8").split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const col = (n: string): number => header.indexOf(n);
  const iName = col("unit_name");
  const iType = col("gov_type");
  const iState = col("fips_state");
  const iCounty = col("fips_county");
  const iPlace = col("fips_place");
  let rosterRows = 0;
  for (const line of lines.slice(1)) {
    if (line.trim() === "") continue;
    const c = parseCsvLine(line);
    if (c.length < header.length) continue;
    rosterRows += 1;
    const entry = { name: c[iName].toUpperCase(), govType: c[iType].toUpperCase() };
    if (entry.govType === "COUNTY") {
      cogByCounty.set(`${c[iState]}${c[iCounty]}`, entry);
      continue;
    }
    if (c[iPlace] === "99001") continue;
    /* Both keys, because the roster does not say which kind of code this is
     * and the registry's geoid length does. Writing both and letting the
     * lookup choose is cheaper than inferring, and it cannot silently miss. */
    cogByPlace.set(`${c[iState]}${c[iPlace]}`, entry);
    cogBySubdivision.set(`${c[iState]}${c[iCounty]}${c[iPlace]}`, entry);
  }
  /* The denominator, stated: a join reporting no mismatches against an empty
   * roster is the empty success this repo has a rule about. */
  if (rosterRows < 80_000) {
    throw new Error(
      `the Census of Governments roster parsed ${rosterRows} rows, which is far short of the ~90,000 ` +
        "governments it holds — the reader, not the roster, is what failed.",
    );
  }

  const results: {
    bodyId: string;
    label: string;
    state: string | null;
    stamped: string | null;
    rosterName: string | null;
    rosterForm: string | null;
    verdict: Verdict;
    why: string;
  }[] = [];

  for (const row of forms.rows) {
    const div = byOcd.get(row.ocdId);
    const stampedForm = row.formKey === null ? null : (row.formKey.split(":")[1] ?? null);
    const label = div?.label ?? row.ocdId;

    if (div?.geoid == null || div.geoid === "") {
      results.push({
        bodyId: row.bodyId,
        label,
        state: div?.state ?? null,
        stamped: stampedForm,
        rosterName: null,
        rosterForm: null,
        verdict: "NO-SOURCE",
        why: "the division carries no FIPS geoid, so there is nothing to join the roster on",
      });
      continue;
    }

    /*
     * **THE LOOKUP IS GATED ON THE DIVISION TYPE, AND THE FIRST VERSION WAS
     * NOT — which joined six school districts to the wrong governments.**
     *
     * A school district's GEOID is `state(2) + district(5)`, which occupies
     * exactly the same 7-character key space as a place code. So
     * `Maricopa Unified School District` looked up `0404720` and got
     * **CITY OF AVONDALE**; `Merrimack School District` got **TOWN OF
     * BELMONT**; four more New Hampshire districts got four unrelated towns.
     *
     * Nothing downstream would have shipped those — a school-district stamp is
     * not a municipal form, so every one of them fell through to NO-SOURCE
     * anyway — but they fell through carrying a REASON that named the wrong
     * entity, and a wrong reason in a ledger is a wrong fact in a ledger. It is
     * also the distinctness rule from `CLAUDE.md`: identical payloads across
     * distinct keys are presumed broken, and here two different KINDS of
     * government share a key space with nothing saying so.
     *
     * Length disambiguates place from county subdivision; only the TYPE
     * disambiguates either from a school district.
     *
     * 5 = state+county (a county) · 7 = state+place · 10 = state+county+cousub.
     */
    const entry =
      div.divisionType === "county"
        ? cogByCounty.get(div.geoid)
        : div.divisionType !== "place"
          ? undefined
          : div.geoid.length === 10
            ? cogBySubdivision.get(div.geoid)
            : cogByPlace.get(div.geoid);
    if (entry === undefined) {
      results.push({
        bodyId: row.bodyId,
        label,
        state: div.state,
        stamped: stampedForm,
        rosterName: null,
        rosterForm: null,
        verdict: "NO-SOURCE",
        why:
          div.divisionType !== "place" && div.divisionType !== "county"
            ? `the MUNICIPAL roster does not classify a ${div.divisionType}; this stamp rests on the ` +
              "Census school-dependency classification, a different Census source, and is NOT unsourced"
            : `no ${div.divisionType} in the 2022 Census of Governments carries FIPS ${div.geoid}`,
      });
      continue;
    }

    const rosterForm = NAME_FORM.find(([re]) => re.test(entry.name))?.[1] ?? null;
    if (rosterForm === null) {
      results.push({
        bodyId: row.bodyId,
        label,
        state: div.state,
        stamped: stampedForm,
        rosterName: entry.name,
        rosterForm: null,
        verdict: "NO-SOURCE",
        why: `the roster names it "${entry.name}", which states no municipal form`,
      });
      continue;
    }

    /* `school_district_*` and the like are stamped from a different source and
     * are not municipal forms; the roster cannot speak to them. */
    if (stampedForm === null || !["township", "borough", "town", "city", "village", "county"].includes(stampedForm)) {
      results.push({
        bodyId: row.bodyId,
        label,
        state: div.state,
        stamped: stampedForm,
        rosterName: entry.name,
        rosterForm,
        verdict: "NO-SOURCE",
        why: `stamped "${stampedForm ?? "(none)"}", which is not a municipal form the roster classifies`,
      });
      continue;
    }

    const agree = stampedForm === rosterForm;
    const ruling = ADJUDICATED.get(row.bodyId);
    results.push({
      bodyId: row.bodyId,
      label,
      state: div.state,
      stamped: stampedForm,
      rosterName: entry.name,
      rosterForm,
      verdict: agree ? "VERIFIED" : ruling !== undefined ? "ADJUDICATED" : "MISMATCH",
      why: agree
        ? `TIGER ${row.basisDetail} and the roster's "${entry.name}" both say ${rosterForm}`
        : `TIGER ${row.basisDetail} stamped "${stampedForm}" but the roster names it "${entry.name}" — ` +
          `a ${rosterForm}. Two Census publications disagree, and that is a FINDING.` +
          (ruling === undefined ? "" : ` ${ruling}`),
    });
  }

  const count = (v: Verdict): number => results.filter((r) => r.verdict === v).length;
  const mismatches = results.filter((r) => r.verdict === "MISMATCH");
  const noSource = results.filter((r) => r.verdict === "NO-SOURCE");

  /* RULING 100: the source states its count. */
  if (results.length !== forms.counts.bodiesWithADivision) {
    throw new Error(
      `count assertion FAILED: body-forms states ${forms.counts.bodiesWithADivision} bodies, ` +
        `the sweep produced ${results.length} rows (RULING 100).`,
    );
  }

  console.log(`\nclass-stamp sweep — ${results.length} of ${forms.counts.bodiesWithADivision} stamps\n`);
  console.log(`  VERIFIED against the Census of Governments   ${count("VERIFIED")}`);
  console.log(`  MISMATCHED                                   ${count("MISMATCH")}`);
  console.log(`  ADJUDICATED against a third authority        ${count("ADJUDICATED")}`);
  console.log(`  NO SOURCE to check against                   ${count("NO-SOURCE")}`);

  if (mismatches.length > 0) {
    console.log("\n  MISMATCHES — each is two Census publications disagreeing:\n");
    for (const m of mismatches) console.log(`    ${m.label} (${m.state}) — ${m.why}`);
  }

  /* The no-source group, grouped by REASON rather than listed raw: 1,253 rows
   * is too many to name individually and a bare number says nothing about
   * whether the gap matters. The reasons are what a reader needs. */
  const reasons = new Map<string, number>();
  for (const r of noSource) {
    const key = r.why.replace(/FIPS \d+/, "FIPS <code>").replace(/"[^"]*"/g, '"…"');
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  console.log("\n  the NO-SOURCE group, by reason:\n");
  for (const [why, n] of [...reasons].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${why}`);
  }

  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        note:
          "Every class stamp checked against a SECOND authority — the 2022 Census of Governments — " +
          "rather than re-derived from the field it was stamped from. TIGER describes a polygon; the " +
          "Census of Governments describes a government and names it in full. The 43/44 LSAD swap " +
          "disagreed with the roster name on every row it touched. NO-SOURCE is a named outcome and " +
          "is never counted as agreement.",
        sources: {
          stampedFrom: "TIGER/Line LSAD, via lib/registry/registry.json",
          checkedAgainst: "data/reference/census_govt_units_2022.csv (2022 Census of Governments)",
          joinedOn: "FIPS state+place, or state+county for counties — never a name string",
        },
        counts: {
          swept: results.length,
          verified: count("VERIFIED"),
          mismatched: count("MISMATCH"),
          adjudicated: count("ADJUDICATED"),
          noSource: count("NO-SOURCE"),
        },
        mismatches,
        noSourceByReason: Object.fromEntries(reasons),
        rows: results,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`\nwrote ${OUT}`);

  if (mismatches.length > 0) {
    console.log(
      `\n  ${mismatches.length} mismatch(es) — a stamp that disagrees with a second authority is a ` +
        "finding to resolve, not a rounding error.",
    );
    process.exitCode = 1;
  }
}

main();
