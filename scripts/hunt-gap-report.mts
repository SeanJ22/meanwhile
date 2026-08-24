/**
 * **THE HUNT WORK QUEUE** (RULING 23 and RULING 26, Prompt D item 2,
 * 2026-08-20).
 *
 * Run:  corepack pnpm hunt:gaps            # print
 *       corepack pnpm hunt:gaps --rows     # print as tracker rows
 *
 * ## What changed, and it is the whole point of the rewrite
 *
 * This script used to ask a GATE which contests were withheld and report those.
 * There is no gate any more: RULING 26 killed it, everything the product holds
 * about a candidate renders, and collection state never governs display. So
 * this reports the only thing left to report — **which candidate carries which
 * field with no completed hunt**, which is the list a depth session works.
 *
 * The queue is now purely about the HUNT. It has no bearing on what a reader
 * sees, and a contest with 40 owed fields renders exactly as fully as one with
 * none: whatever we hold for each candidate in it.
 *
 * ## The four states
 *
 * A field is owed while it is `NOT_HUNTED`. It leaves the queue as `FOUND`, as
 * `VERIFIED_ABSENT` (a completed hunt, with its rungs and its date — earned by
 * a session, never by a backfill), or as `NOT_APPLICABLE` (structurally
 * impossible, with its reason and its date). `NOT_APPLICABLE` is reported
 * separately from `VERIFIED_ABSENT` because they are different facts: one says
 * the thing does not exist, the other says it could not.
 *
 * COUNTS, ALWAYS. Contests enumerated, candidates seen, fields owed against
 * fields possible — printed whether or not anything is found, and a
 * zero-contest run refuses rather than reporting a clean board.
 */

import { cardForCandidacy, cardForNominee } from "../lib/ballot/candidate-cards.ts";
import { linksForCandidacy, linksForNominee } from "../lib/ballot/candidate-sites.ts";
import { derivedBlurbFor } from "../lib/candidates/blurbs.ts";
import { getGeneralLineup, lineupForContest } from "../lib/ballot/general-lineup.ts";
import { BALLOT_SOURCES } from "../lib/ballot/registry.ts";
import { KELLY_FIELDS } from "../lib/ballot/hunt-state.ts";
import { huntStatesFor } from "../lib/ballot/hunt-state-server.ts";
import type { FieldPresence, HuntState, KellyField } from "../lib/ballot/hunt-state.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { today } from "./doc-dates.mjs";
import { allCandidateCards } from "../lib/ballot/candidate-cards.ts";

/** The photo this repo HOLDS for a key, before RULING 55's render gate. */
function rawPhotoUrl(key: string): string | null {
  return allCandidateCards().cards[key]?.photoUrl ?? null;
}


const asRows = process.argv.includes("--rows");
const toTracker = process.argv.includes("--tracker");

/**
 * **`--zip=<zip>` SCOPES THE REPORT TO ONE BALLOT.** (Added 2026-08-24.)
 *
 * Without it this reports across every zip the product covers, which is the
 * right default — and it is why THREE different numbers have been quoted for
 * 03255 in three different reports: 182 of 368, 249 of 368, and 85. A
 * denominator that moves with whichever contests a session happened to look at
 * is not a denominator.
 *
 * Scoping is a FILTER on the same computation rather than a second
 * implementation of it (RULING 103), so the per-zip figure and the whole-product
 * figure can never disagree about what a field is or when one is owed.
 */
const ZIP_PREFIX: Record<string, string> = {
  "03255": "ballot-nh-",
  "07866": "ballot-nj-",
  "85641": "ballot-az-",
  "85701": "ballot-az-",
};
const zipArg = process.argv.find((a) => a.startsWith("--zip="))?.split("=")[1];
const zipPrefix = zipArg ? ZIP_PREFIX[zipArg] : undefined;
if (zipArg && !zipPrefix) {
  console.error(
    `CANNOT RUN: no ballot-source prefix is recorded for ${zipArg}. ` +
      `Known: ${Object.keys(ZIP_PREFIX).join(", ")}. Guessing one would report a ` +
      "denominator about the wrong ballot.",
  );
  process.exit(1);
}

/** Plain names for a report a person reads. Internal, never reader-facing. */
const FIELD_NAME: Record<KellyField, string> = {
  photo: "Photo",
  blurb: "In their own words",
  contact: "Contact",
  campaignSite: "Campaign site",
};

function statesOf(
  key: string,
  card: ReturnType<typeof cardForCandidacy>,
  links: ReturnType<typeof linksForCandidacy>,
  blurb: ReturnType<typeof derivedBlurbFor>,
): Record<KellyField, HuntState> {
  /*
   * **THE HUNT QUEUE ASKS WHETHER WE FOUND IT, NEVER WHETHER IT RENDERS**
   * (NH Hunt 4, 2026-08-21).
   *
   * `cardForCandidacy` applies RULING 55's review gate, so a portrait that has
   * been hunted, read as an image and shipped reads back as `photoUrl: null`
   * until the author approves it. That is correct for the RENDER — an
   * unreviewed image may not be a photograph of that person — and it was wrong
   * here: three portraits were found, judged and committed and this queue went
   * on listing all three as owed, which would send the next session out to hunt
   * a photo already sitting in `public/candidates`.
   *
   * RULING 23 settles which reading belongs where: the four-state field is DATA
   * about the HUNT and nothing reads it to decide what renders. So the queue
   * reads the raw store, and the gate stays where it belongs.
   */
  const presence: FieldPresence = {
    photo: Boolean(rawPhotoUrl(key)) || Boolean(card?.photoUrl),
    blurb: Boolean(card?.bio) || Boolean(blurb?.text),
    contact: Boolean(card?.email) || Boolean(card?.phone),
    campaignSite: Boolean(links?.campaign?.url),
  };
  return huntStatesFor(key, presence);
}

interface ContestGap {
  contestId: string;
  title: string;
  source: string;
  candidates: { name: string; fields: string[] }[];
  fieldsOwed: number;
}

const azTitles = new Map<string, string>();

const gaps: ContestGap[] = [];
let contestsSeen = 0;
let contestsClear = 0;
let candidatesSeen = 0;
const stateCensus: Record<HuntState, number> = {
  NOT_HUNTED: 0,
  FOUND: 0,
  VERIFIED_ABSENT: 0,
  NOT_APPLICABLE: 0,
};

/** One contest's owed work, folded into the report. */
function record(
  contestId: string,
  title: string,
  source: string,
  people: { name: string; states: Record<KellyField, HuntState> }[],
): void {
  // Scoped to one ballot when asked. Filtered HERE so every count below — seen,
  // clear, owed, and the state census — is about the same population.
  if (zipPrefix && !contestId.startsWith(zipPrefix)) return;
  contestsSeen += 1;
  candidatesSeen += people.length;
  const owed: { name: string; fields: string[] }[] = [];
  for (const p of people) {
    const fields: string[] = [];
    for (const f of KELLY_FIELDS) {
      stateCensus[p.states[f]] += 1;
      if (p.states[f] === "NOT_HUNTED") fields.push(FIELD_NAME[f]);
    }
    if (fields.length > 0) owed.push({ name: p.name, fields });
  }
  if (owed.length === 0) {
    contestsClear += 1;
    return;
  }
  gaps.push({
    contestId,
    title,
    source,
    candidates: owed,
    fieldsOwed: owed.reduce((n, c) => n + c.fields.length, 0),
  });
}

/* ---- the filed candidacies ------------------------------------------------ */

for (const { state, source } of BALLOT_SOURCES) {
  const set = source.normalize(await source.fetch());
  for (const contest of set.contests) {
    /*
     * THE PAGE'S OWN PRECEDENCE, mirrored rather than re-invented. Where a
     * certified lineup exists for a contest, app/ballot/page.tsx renders the
     * NOMINEES and the filing list is retired. A report that counted both would
     * count one contest twice and open two rows for one piece of work — the
     * duplicate class the tracker cannot survive.
     */
    if (lineupForContest(contest.id)) continue;
    const candidacies = set.candidacies.filter((c) => c.contestId === contest.id);
    if (candidacies.length === 0) continue;
    azTitles.set(contest.id, contest.title);
    record(
      contest.id,
      contest.title,
      `${state} filings`,
      candidacies.map((c) => ({
        name: `${c.givenName} ${c.familyName}`,
        states: statesOf(
          c.id,
          cardForCandidacy(c.id),
          linksForCandidacy(c.id),
          derivedBlurbFor(c.id),
        ),
      })),
    );
  }
}

/* ---- the certified general lineup ----------------------------------------- */

for (const contest of getGeneralLineup()?.contests ?? []) {
  if (contest.nominees.length === 0) continue;
  record(
    contest.contestId,
    azTitles.get(contest.contestId) ?? contest.contestId,
    "az certified lineup",
    contest.nominees.map((n) => {
      const key = `${contest.contestId}|${n.name}`;
      return {
        name: n.name,
        states: statesOf(
          key,
          cardForNominee(contest.contestId, n.name),
          linksForNominee(contest.contestId, n.name),
          derivedBlurbFor(key),
        ),
      };
    }),
  );
}

if (contestsSeen === 0) {
  console.error(
    `REFUSED: zero contests enumerated${zipArg ? ` for ${zipArg}` : ""}. A zero-contest ` +
      "report is a failed read, never a clean board.",
  );
  process.exit(1);
}

if (zipArg) {
  console.log(`SCOPED TO ${zipArg} — contests matching ${zipPrefix}`);
}

/* ---- output --------------------------------------------------------------- */

gaps.sort((a, b) => b.fieldsOwed - a.fieldsOwed || a.contestId.localeCompare(b.contestId));

if (asRows) {
  for (const g of gaps) {
    const who = g.candidates.map((c) => `${c.name}: ${c.fields.join(", ")}`).join(" | ");
    console.log(
      [g.contestId, g.fieldsOwed, `${g.candidates.length} candidate(s) owed`, who].join("\t"),
    );
  }
} else {
  for (const g of gaps) {
    console.log(`\n${g.contestId}  (${g.source}) — ${g.fieldsOwed} field(s) owed`);
    for (const c of g.candidates) {
      console.log(`    ${c.name.padEnd(32)} ${c.fields.join(", ")}`);
    }
  }
}

const candidatesOwed = gaps.reduce((n, g) => n + g.candidates.length, 0);
const fieldsOwed = gaps.reduce((n, g) => n + g.fieldsOwed, 0);
const fieldsPossible = candidatesSeen * KELLY_FIELDS.length;
const byField = new Map<string, number>();
for (const g of gaps) {
  for (const c of g.candidates) {
    for (const f of c.fields) byField.set(f, (byField.get(f) ?? 0) + 1);
  }
}

console.log(`\nCONTESTS ENUMERATED: ${contestsSeen}`);
console.log(`  with nothing owed:  ${contestsClear}`);
console.log(`  with work owed:     ${gaps.length}`);
console.log(`CANDIDATES SEEN: ${candidatesSeen}`);
console.log(`  with work owed:  ${candidatesOwed}`);
// The pair rule: what is owed, against what could be owed at all.
console.log(`FIELDS OWED: ${fieldsOwed} of ${fieldsPossible} possible`);
for (const f of KELLY_FIELDS) {
  console.log(`  ${FIELD_NAME[f].padEnd(20)} ${byField.get(FIELD_NAME[f]) ?? 0}`);
}
console.log("STATE CENSUS (every field of every candidate seen):");
for (const [state, n] of Object.entries(stateCensus)) {
  console.log(`  ${state.padEnd(20)} ${n}`);
}
const censusTotal = Object.values(stateCensus).reduce((a, x) => a + x, 0);
if (censusTotal !== fieldsPossible) {
  console.error(
    `CENSUS ${censusTotal} DOES NOT RECONCILE WITH ${fieldsPossible} POSSIBLE FIELDS`,
  );
  process.exit(1);
}
console.log(
  "\nNOTE: this queue governs HUNTING ONLY. Nothing here decides what renders —\n" +
    "RULING 26: everything the product holds about a candidate is shown.",
);

/* -------------------------------------------------------------------------- */
/* --tracker: one row per contest with owed work, appended, never duplicated   */
/*                                                                            */
/* Rows are matched by their CONTEST ID rather than by number, so re-running   */
/* as hunts close adds only what is new and renumbers nothing — a tracker with */
/* two rows per ID cannot be read by anything, including the xlsx view         */
/* generator, and it silently breaks every lookup by ID.                       */
/* -------------------------------------------------------------------------- */

if (toTracker) {
  const FILE = "docs/tracker.csv";
  const raw = readFileSync(FILE, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim() !== "");
  const header = lines[0]!.split(",");

  const existingIds = new Set<string>();
  let maxHd = 0;
  for (const line of lines.slice(1)) {
    const id = /^"?([A-Z]+[0-9]+)"?,/.exec(line)?.[1];
    if (!id) continue;
    existingIds.add(id);
    const m = /^HD([0-9]+)$/.exec(id);
    if (m) maxHd = Math.max(maxHd, Number(m[1]));
  }

  const claimed = new Set<string>();
  const already = (contestId: string) =>
    claimed.has(contestId) ||
    lines.some((l) => l.startsWith("HD") && l.includes(`[${contestId}]`));

  const cell = (v: string) => (/["',\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

  const added: string[] = [];
  const out: string[] = [];
  let next = maxHd;
  for (const g of gaps) {
    if (already(g.contestId)) continue;
    claimed.add(g.contestId);
    next += 1;
    const id = `HD${String(next).padStart(2, "0")}`;
    if (existingIds.has(id)) {
      console.error(`REFUSED: ${id} already exists — a duplicate ID breaks every lookup`);
      process.exit(1);
    }
    const who = g.candidates.map((c) => `${c.name} — ${c.fields.join(", ")}`).join(" ; ");
    const row: Record<string, string> = {
      ID: id,
      Area: "Ballot",
      Item: `Hunt the owed fields for ${g.title}`,
      Detail:
        `[${g.contestId}] ${g.candidates.length} candidate(s) carry ${g.fieldsOwed} ` +
        `field(s) with no completed hunt. OWED: ${who}. A field closes as FOUND, as ` +
        `VERIFIED_ABSENT (a completed hunt, carrying the rungs walked and the date ` +
        `checked, earned by a hunt session and never by a backfill), or as ` +
        `NOT_APPLICABLE (structurally impossible, with its reason and date). This ` +
        `queue governs hunting only — RULING 26: the contest renders whatever we ` +
        `hold, today, whether or not this row is closed.`,
      Priority: "P2",
      Status: "Not started",
      "Depends on": "PB14",
      Target: "",
      Notes:
        `${today()} (Prompt D item 2). Opened from corepack pnpm hunt:gaps, which ` +
        `re-derives this list from the ballot sources and ` +
        `data/ballot/candidate-hunt-state.json — never from rendered HTML. Equal ` +
        `effort is a HUNT discipline: work every candidate in this contest before ` +
        `moving to the next, and a hunt that stops when the well-covered ones are ` +
        `done has produced a ranking.`,
    };
    out.push(header.map((h) => cell(row[h] ?? "")).join(","));
    added.push(`${id}  ${g.contestId}  (${g.fieldsOwed} owed)`);
  }

  const before = lines.length;
  if (added.length > 0) {
    writeFileSync(FILE, `${raw.replace(/\n*$/, "\n")}${out.join("\n")}\n`, "utf8");
  }
  const after = readFileSync(FILE, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "").length;

  console.log(`\nTRACKER: ${before} rows -> ${after} rows, ${added.length} added`);
  for (const a of added) console.log(`  ${a}`);
  if (after !== before + added.length) {
    console.error("ROW COUNT DID NOT MOVE BY EXACTLY THE NUMBER ADDED");
    process.exit(1);
  }
}
