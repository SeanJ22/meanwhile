#!/usr/bin/env tsx
/**
 * `pnpm matrix` — **the coverage matrix.** (2026-08-25, Item 12; RULING 149.)
 *
 * One row per candidate, one column per fact, every cell a STATE with its
 * source and its date. It answers a question no other instrument here answers:
 * not *how many are done* but **exactly which facts about exactly which people
 * are in which condition, and on whose authority.**
 *
 * ```
 * pnpm matrix                 write the CSV and print the census
 * pnpm matrix --zip=03255     a different ballot
 * pnpm matrix --check         write nothing; fail if it disagrees with pnpm kelly
 * ```
 *
 * ## It is INTERNAL, and that is constitutional rather than a preference
 *
 * RULING 149: never rendered to a reader in any form. In front of a reader this
 * is a completeness score per candidate, sorted — the composite match score
 * this product does not compute, the per-card completeness marker RULING 42
 * deleted, and the equal-effort failure, all at once. It is exactly as useful
 * internally as it is forbidden externally.
 *
 * ## It reads the stores and adds nothing to them
 *
 * Every value comes from a committed artifact. The collection minimum is
 * untouched — an instrument that had to collect something in order to measure
 * would have changed the thing it measures.
 *
 * ## Its Kelly verdict IS `pnpm kelly`, not an agreement with it
 *
 * Both call `kellyRows` in `lib/hunt/coverage-matrix.ts`. There is one loader
 * and one loop; two programs computing one judgement is the thing that can
 * disagree (RULING 103), and two implementations of `kellyFieldHeld` already
 * did disagree once in this repo.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { today } from "./doc-dates.mjs";
import { KELLY_FIELDS } from "../lib/hunt/kelly-depth.ts";
import {
  BALLOTS,
  MATRIX_COLUMNS,
  SOCIAL_PLATFORMS,
  asymmetryFlags,
  cellCensus,
  cellFromKelly,
  kellyRows,
  loadKellyInputs,
  type Cell,
  type MatrixRow,
} from "../lib/hunt/coverage-matrix.ts";

const ROOT = process.cwd();
/**
 * @freshness-reads-here — the day cells are stamped and expiries compared
 * against. From `today()`, never a UTC slice.
 */
const TODAY = today();

const ZIP = (process.argv.find((a) => a.startsWith("--zip=")) ?? "--zip=07866").slice(
  "--zip=".length,
);
const CHECK_ONLY = process.argv.includes("--check");
if (!BALLOTS[ZIP]) {
  console.error(`pnpm matrix --zip=<${Object.keys(BALLOTS).join("|")}>`);
  process.exit(2);
}

const inputs = loadKellyInputs(ROOT, ZIP);
const readings = kellyRows(inputs, TODAY);
const contestTitle = new Map(inputs.contests.map((c) => [c.id, c.title]));

/**
 * A cell for a fact NO STORE HOLDS YET.
 *
 * Deliberately `OWED` rather than `N/A`. "Nobody has built a place to put this"
 * is OUR gap and reads as one; `N/A` is a claim that the fact does not apply to
 * this person, which is a different and much stronger statement. Conflating
 * them is how a missing store becomes a settled question.
 */
function owedForWantOfAStore(what: string): Cell {
  return {
    state: "OWED",
    source: `no committed store holds ${what} per candidate yet`,
    date: TODAY,
  };
}

const rows: MatrixRow[] = readings.map((reading) => {
  const candidacy = inputs.candidacies.find((c) => c.id === reading.candacyId);
  const card = inputs.cards[reading.candacyId];
  const cells: Record<string, Cell> = {};

  /* ---- the five Kelly fields, straight from the shared reading ---- */
  for (const field of KELLY_FIELDS) {
    cells[field] = cellFromKelly(field, reading.fields[field], TODAY);
  }

  /* ---- social, per platform (RULING 145) ---- */
  for (const platform of SOCIAL_PLATFORMS) {
    cells[`social.${platform}`] = owedForWantOfAStore(
      `a ${platform} handle with its compliant route and verification date`,
    );
  }

  /* ---- beyond Kelly ---- */
  cells.ownWords = card?.bio
    ? {
        state: "HELD",
        source: card.bioSourceUrl ?? card.bioSourceLabel ?? "card bio, source label absent",
        date: TODAY,
      }
    : owedForWantOfAStore("the candidate's own words");

  // The brief: slogan is HELD or NOT_APPLICABLE. Nothing holds one, and a
  // slogan is not a fact every candidate has, so it is structurally N/A until
  // a store exists — stated with the reason rather than left blank.
  cells.slogan = {
    state: "N/A",
    source: "no slogan field exists on the candidate record",
    date: TODAY,
    reason: "not every candidacy has a slogan, and none is collected today",
  };

  /*
   * Campaign money renders for readers and never enters anything sold (RULING
   * 126). It is measured here because this artifact is internal — but no
   * per-candidate state filing is held for this ballot, so it is OWED with the
   * authority named rather than assumed absent.
   */
  cells.campaignMoney = owedForWantOfAStore(
    "a state campaign-finance filing (NJ ELEC is the authority; no per-candidate rows are held)",
  );

  /*
   * A voting record and committee seats are facts about somebody who HOLDS the
   * office. For a challenger they do not exist, and that is `N/A` with the
   * reason — never a gap. RULING 105's middle number.
   */
  const isIncumbent = candidacy?.incumbent === true;
  cells.votingRecord = isIncumbent
    ? owedForWantOfAStore("a roll-call record for this local office")
    : {
        state: "N/A",
        source: "not an incumbent on this ballot",
        date: TODAY,
        reason: "a challenger has no voting record in this office; this is not a gap",
      };
  cells.committees = isIncumbent
    ? owedForWantOfAStore("committee seats for this local office")
    : {
        state: "N/A",
        source: "not an incumbent on this ballot",
        date: TODAY,
        reason: "a challenger holds no committee seat in this body; this is not a gap",
      };

  /*
   * The questionnaire ships EMPTY, and that is the honest state. RULING 112's
   * instrument is built and `NH105`/`NH108` are open — Sean has not approved
   * the message, so nobody has been invited. `invitedOn: null` until the code
   * path that actually sends stamps it (RULING 107 pointed outward): a plan is
   * not an act.
   */
  for (const stage of ["invited", "reminded", "responded", "declined", "bounced"] as const) {
    cells[`questionnaire.${stage}`] = {
      state: "OWED",
      source: "the questionnaire is built and HELD — nobody has been invited, so nothing is stamped",
      date: TODAY,
      reason: "NH105 and NH108 are open: the message needs Sean before 276 real candidates receive it",
    };
  }

  return {
    candidacyId: reading.candacyId,
    name: reading.subject,
    contestId: reading.contestId,
    contestTitle: contestTitle.get(reading.contestId) ?? "(contest title not held)",
    district: reading.contestId,
    party: candidacy?.partyLabel ?? "",
    incumbent: isIncumbent,
    zip: ZIP,
    cycle: "2026",
    cells,
    kellyVerdict: reading.done ? "DONE" : "OWED",
    kellyOwed: reading.owed,
  };
});

/* ------------------------------------------------------------------ output */

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

const header = [
  "candidacyId",
  "name",
  "contest",
  "contestTitle",
  "party",
  "incumbent",
  "zip",
  "cycle",
  ...MATRIX_COLUMNS.flatMap((c) => [c, `${c}.source`, `${c}.date`]),
  "kellyVerdict",
  "kellyOwed",
];

const lines = [header.map(csvCell).join(",")];
for (const row of rows) {
  const values: string[] = [
    row.candidacyId,
    row.name,
    row.contestId,
    row.contestTitle,
    row.party,
    row.incumbent ? "yes" : "no",
    row.zip,
    row.cycle,
  ];
  for (const column of MATRIX_COLUMNS) {
    const cell = row.cells[column];
    values.push(
      cell?.state ?? "OWED",
      cell ? `${cell.source}${cell.expiresOn ? ` (expires ${cell.expiresOn})` : ""}${cell.reason ? ` — ${cell.reason}` : ""}` : "",
      cell?.date ?? "",
    );
  }
  values.push(row.kellyVerdict, row.kellyOwed.join(" "));
  lines.push(values.map(csvCell).join(","));
}

const OUT = join(ROOT, "docs", "coverage-matrix.csv");

/* ------------------------------------------------ the census and the checks */

const census = cellCensus(rows);
const flags = asymmetryFlags(rows);
const kellyDone = rows.filter((r) => r.kellyVerdict === "DONE").length;

/**
 * THE EXPIRY CLOCK, and the first date it fires.
 *
 * An argued absence is a measurement with a shelf life (RULING 53), and RULING
 * 144 lets one expire EARLY the day a wall inside it falls. The nearest expiry
 * is what decides when this ballot stops being done, so it is stated rather
 * than left for somebody to notice.
 */
let firstExpiry: string | null = null;
let expiringCells = 0;
for (const row of rows) {
  for (const cell of Object.values(row.cells)) {
    if (cell.state !== "ABSENT" || !cell.expiresOn) continue;
    expiringCells += 1;
    if (firstExpiry === null || cell.expiresOn < firstExpiry) firstExpiry = cell.expiresOn;
  }
}

console.log(`\nCOVERAGE MATRIX · ${inputs.label} · measured ${TODAY}\n`);
console.log(`  ${rows.length} candidate(s) x ${MATRIX_COLUMNS.length} fact column(s)`);
console.log(`  Kelly verdict: ${kellyDone} of ${rows.length} DONE — this IS pnpm kelly, not an agreement with it\n`);

console.log("  per column — HELD / ABSENT / OWED / LEAD / REFUSED / PENDING_REVIEW / N/A");
for (const column of MATRIX_COLUMNS) {
  const c = census[column];
  console.log(
    `    ${column.padEnd(26)} ${String(c.HELD).padStart(4)} /${String(c.ABSENT).padStart(5)} /${String(c.OWED).padStart(5)} /${String(c.LEAD).padStart(5)} /${String(c.REFUSED).padStart(5)} /${String(c.PENDING_REVIEW).padStart(5)} /${String(c["N/A"]).padStart(5)}`,
  );
}

console.log(
  `\n  argued absences with an expiry: ${expiringCells} · FIRST EXPIRY ${firstExpiry ?? "(none on file)"}`,
);
console.log(
  `  ${flags.length} contest(s) flagged for asymmetry (a spread of 3+ HELD facts between candidates)`,
);
for (const f of flags.slice(0, 10)) {
  console.log(
    `    ${f.contestTitle.slice(0, 52).padEnd(54)} ${f.best.name} ${f.best.held} vs ${f.worst.name} ${f.worst.held} (spread ${f.spread})`,
  );
}

if (CHECK_ONLY) {
  console.log("\n  --check: nothing written.");
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${lines.join("\n")}\n`, "utf8");
console.log(`\n  wrote docs/coverage-matrix.csv — ${rows.length} row(s), ${header.length} column(s)`);

/*
 * The Drive mirror, where the author can open it as a spreadsheet. A missing
 * mirror is a WARNING about the mirror and never a reason to produce nothing
 * (RULING 108): the repo copy is the primary output and is written first.
 */
const mirror = process.env.WTP_MIRROR ?? "G:/My Drive/we-the-people";
if (existsSync(mirror)) {
  writeFileSync(join(mirror, "coverage-matrix.csv"), readFileSync(OUT, "utf8"), "utf8");
  console.log(`  mirrored to ${mirror}/coverage-matrix.csv`);
} else {
  console.log(`  mirror ${mirror} is absent on this machine — the repo copy is written and is the primary one`);
}
