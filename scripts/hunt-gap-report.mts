/**
 * THE WITHHELD-CONTEST WORK LIST (RULING 18, Prompt C item 2.8, 2026-08-20).
 *
 * Run:  corepack pnpm hunt:gaps            # print
 *       corepack pnpm hunt:gaps --rows     # print as tracker rows
 *
 * The equal-depth gate withholds a contest when any candidate in it carries a
 * NOT_HUNTED field. That is the correct behaviour and it is not a plan: a
 * reader looking at a withheld contest is waiting on named work, and until
 * that work is written down as rows nobody owns it.
 *
 * So this enumerates, per contest, exactly which candidates carry which
 * unhunted fields — the list a depth session works. It reads the same two
 * inputs the page reads (the ballot sources and the hunt-state file) rather
 * than scraping rendered HTML, because a second derivation of the rule would
 * be a second thing to get wrong.
 *
 * COUNTS, ALWAYS. Contests enumerated, contests withheld, candidates with
 * unfinished hunts, and fields owed — printed whether or not anything is
 * found, and a zero-contest run refuses rather than reporting a clean board.
 */

import { cardForCandidacy, cardForNominee } from "../lib/ballot/candidate-cards.ts";
import { linksForCandidacy, linksForNominee } from "../lib/ballot/candidate-sites.ts";
import { derivedBlurbFor } from "../lib/candidates/blurbs.ts";
import { getGeneralLineup, lineupForContest } from "../lib/ballot/general-lineup.ts";
import { BALLOT_SOURCES } from "../lib/ballot/registry.ts";
import { KELLY_FIELD_LABEL, KELLY_FIELDS } from "../lib/ballot/hunt-state.ts";
import { huntStatesFor } from "../lib/ballot/hunt-state-server.ts";
import { equalDepthGate } from "../lib/coverage/tier.ts";
import type { CandidateDepth } from "../lib/coverage/tier.ts";
import type { FieldPresence } from "../lib/ballot/hunt-state.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { today } from "./doc-dates.mjs";

const asRows = process.argv.includes("--rows");
const toTracker = process.argv.includes("--tracker");

function depth(
  key: string,
  name: string,
  card: ReturnType<typeof cardForCandidacy>,
  links: ReturnType<typeof linksForCandidacy>,
  blurb: ReturnType<typeof derivedBlurbFor>,
): CandidateDepth {
  const presence: FieldPresence = {
    photo: Boolean(card?.photoUrl),
    blurb: Boolean(card?.bio) || Boolean(blurb?.text),
    contact: Boolean(card?.email) || Boolean(card?.phone),
    campaignSite: Boolean(links?.campaign?.url),
  };
  return { candidateId: key, candidateName: name, fields: huntStatesFor(key, presence) };
}

interface ContestGap {
  contestId: string;
  title: string;
  source: string;
  candidates: { name: string; fields: string[] }[];
  fieldsOwed: number;
}

/* Contest titles, keyed by id, so a lineup contest is named rather than
   identified. Filled from the sources below as they are read. */
const azTitles = new Map<string, string>();

const gaps: ContestGap[] = [];
let contestsSeen = 0;
let contestsRendering = 0;

/* ---- the filed candidacies ------------------------------------------------ */

for (const { state, source } of BALLOT_SOURCES) {
  const set = source.normalize(await source.fetch());
  for (const contest of set.contests) {
    /*
     * THE PAGE'S OWN PRECEDENCE, mirrored rather than re-invented. Where a
     * certified lineup exists for a contest, app/ballot/page.tsx renders the
     * NOMINEES and the filing list is retired ("the certified lineup retires
     * the filing-list fallback", item 6a). A report that counted both would
     * count one contest twice and open two rows for one piece of reader-facing
     * work — the duplicate class the tracker cannot survive.
     */
    if (lineupForContest(contest.id)) continue;
    const candidacies = set.candidacies.filter((c) => c.contestId === contest.id);
    if (candidacies.length === 0) continue;
    contestsSeen += 1;
    azTitles.set(contest.id, contest.title);
    const decision = equalDepthGate(
      candidacies.map((c) =>
        depth(
          c.id,
          `${c.givenName} ${c.familyName}`,
          cardForCandidacy(c.id),
          linksForCandidacy(c.id),
          derivedBlurbFor(c.id),
        ),
      ),
    );
    if (decision.render) {
      contestsRendering += 1;
      continue;
    }
    gaps.push({
      contestId: contest.id,
      title: contest.title,
      source: `${state} filings`,
      candidates: decision.unhunted.map((u) => ({
        name: u.candidateName,
        fields: u.fields.map((f) => KELLY_FIELD_LABEL[f]),
      })),
      fieldsOwed: decision.unhuntedFields,
    });
  }
}

/* ---- the certified general lineup ----------------------------------------- */

for (const contest of getGeneralLineup()?.contests ?? []) {
  if (contest.nominees.length === 0) continue;
  contestsSeen += 1;
  const decision = equalDepthGate(
    contest.nominees.map((n) => {
      const key = `${contest.contestId}|${n.name}`;
      return depth(
        key,
        n.name,
        cardForNominee(contest.contestId, n.name),
        linksForNominee(contest.contestId, n.name),
        derivedBlurbFor(key),
      );
    }),
  );
  if (decision.render) {
    contestsRendering += 1;
    continue;
  }
  gaps.push({
    contestId: contest.contestId,
    // The lineup carries no title, and an identifier is not a name — this is a
    // work list a person reads. The AZ source has the title under the same id.
    title: azTitles.get(contest.contestId) ?? contest.contestId,
    source: "az certified lineup",
    candidates: decision.unhunted.map((u) => ({
      name: u.candidateName,
      fields: u.fields.map((f) => KELLY_FIELD_LABEL[f]),
    })),
    fieldsOwed: decision.unhuntedFields,
  });
}

if (contestsSeen === 0) {
  console.error(
    "REFUSED: zero contests enumerated. A zero-contest report is a failed read, " +
      "never a clean board.",
  );
  process.exit(1);
}

/* ---- output --------------------------------------------------------------- */

gaps.sort((a, b) => b.fieldsOwed - a.fieldsOwed || a.contestId.localeCompare(b.contestId));

if (asRows) {
  for (const g of gaps) {
    const who = g.candidates
      .map((c) => `${c.name}: ${c.fields.join(", ")}`)
      .join(" | ");
    console.log(
      [
        g.contestId,
        g.fieldsOwed,
        `${g.candidates.length} candidate(s) with an unfinished hunt`,
        who,
      ].join("\t"),
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
const byField = new Map<string, number>();
for (const g of gaps) {
  for (const c of g.candidates) {
    for (const f of c.fields) byField.set(f, (byField.get(f) ?? 0) + 1);
  }
}

console.log(`\nCONTESTS ENUMERATED: ${contestsSeen}`);
console.log(`  rendering:          ${contestsRendering}`);
console.log(`  withheld:           ${gaps.length}`);
console.log(`CANDIDATES WITH AN UNFINISHED HUNT: ${candidatesOwed}`);
console.log(`FIELDS OWED: ${fieldsOwed}`);
for (const f of KELLY_FIELDS) {
  console.log(`  ${KELLY_FIELD_LABEL[f].padEnd(20)} ${byField.get(KELLY_FIELD_LABEL[f]) ?? 0}`);
}

/* -------------------------------------------------------------------------- */
/* --tracker: one row per withheld contest, appended, never duplicated         */
/*                                                                            */
/* Item 2.8. A withheld contest is named work, and until it is a row nobody    */
/* owns it. Rows are matched by their CONTEST ID rather than by number, so     */
/* re-running as hunts close adds only what is new and renumbers nothing — a   */
/* tracker with two rows per ID cannot be read by anything, including the      */
/* xlsx view generator, and it silently breaks every lookup by ID.            */
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

  // A contest already carrying a row is matched on its id inside the Detail,
  // never on the row number — so a re-run after a hunt closes adds only what
  // is new.
  const claimed = new Set<string>();
  const already = (contestId: string) =>
    claimed.has(contestId) ||
    lines.some((l) => l.startsWith("HD") && l.includes(`[${contestId}]`));

  const cell = (v: string) =>
    /["',\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;

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
    const who = g.candidates
      .map((c) => `${c.name} — ${c.fields.join(", ")}`)
      .join(" ; ");
    const row: Record<string, string> = {
      ID: id,
      Area: "Ballot",
      Item: `Finish the hunt for ${g.title} so the contest can render`,
      Detail:
        `[${g.contestId}] RULING 18: the equal-depth gate withholds this contest ` +
        `because ${g.candidates.length} candidate(s) carry ${g.fieldsOwed} field(s) ` +
        `with no completed hunt. OWED: ${who}. A field closes as FOUND or as ` +
        `VERIFIED_ABSENT — the second is a finding, carries the rungs walked and ` +
        `the date checked, and is earned by a hunt session, never by a backfill.`,
      Priority: g.fieldsOwed >= 6 ? "P1" : "P2",
      Status: "Not started",
      "Depends on": "PB14",
      Target: "",
      Notes:
        `${today()} (Prompt C item 2.8). Opened from corepack pnpm hunt:gaps, which ` +
        `re-derives this list from the ballot sources and ` +
        `data/ballot/candidate-hunt-state.json — never from rendered HTML. Equal ` +
        `effort per candidate applies: every candidate in this contest is hunted to ` +
        `the same rung depth, and a hunt that stops when the well-covered ones are ` +
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
