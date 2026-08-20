/**
 * RULING 18's migration — every Kelly field's hunt state, written once
 * (Prompt C item 2.2, 2026-08-20).
 *
 * Run:  corepack pnpm hunt:migrate
 *
 * ## The one rule this script must not break
 *
 * **Nothing is promoted to `VERIFIED_ABSENT` by a backfill.** That state is a
 * claim about a named person — "we did the work; this candidate has no
 * campaign site" — and it carries the transparency mandate's evidence
 * standard: the rungs walked, each with its date and result, and the date the
 * hunt completed. A migration knows none of that. It knows only what the
 * curated files hold, which answers a different question: whether the field is
 * PRESENT, not whether anyone looked.
 *
 * So: present becomes `FOUND`, absent becomes `NOT_HUNTED`, and the counts are
 * printed. `VERIFIED_ABSENT` is earned by a hunt session and by nothing else.
 * This is the whole reason the withheld count barely moves after the change —
 * which is correct and honest, and stated as the expected outcome rather than
 * discovered as a disappointment.
 *
 * ## Which candidates
 *
 * Every candidate the ballot page can put through the gate: each source's
 * candidacies (keyed by candidacy id) and the certified general lineup's
 * nominees (keyed `<contestId>|<name>`). The two key shapes are the ones
 * `cardForCandidacy` / `cardForNominee` already use, so a key here and a
 * lookup there cannot drift.
 *
 * ## Counts, always
 *
 * An operation that can return nothing must be asked what it returned. This
 * prints candidates enumerated, fields written, and the per-state totals, and
 * refuses to write a file with zero candidates in it.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cardForCandidacy, cardForNominee } from "../lib/ballot/candidate-cards.ts";
import { linksForCandidacy, linksForNominee } from "../lib/ballot/candidate-sites.ts";
import { derivedBlurbFor } from "../lib/candidates/blurbs.ts";
import { getGeneralLineup } from "../lib/ballot/general-lineup.ts";
import { BALLOT_SOURCES } from "../lib/ballot/registry.ts";
import { KELLY_FIELDS } from "../lib/ballot/hunt-state.ts";
import type {
  CandidateHuntFile,
  FieldPresence,
  KellyField,
  RecordedCandidateHunt,
} from "../lib/ballot/hunt-state.ts";
import { today } from "./doc-dates.mjs";

const OUT = join(process.cwd(), "data", "ballot", "candidate-hunt-state.json");

/**
 * The four fields, read for one person — the same reads `depthFor` in
 * app/ballot/page.tsx makes, deliberately duplicated nowhere: this calls the
 * same four accessors the page calls.
 */
function presenceFor(key: string, isNominee: boolean, contestId = "", name = ""): FieldPresence {
  const card = isNominee ? cardForNominee(contestId, name) : cardForCandidacy(key);
  const links = isNominee ? linksForNominee(contestId, name) : linksForCandidacy(key);
  const blurb = derivedBlurbFor(key);
  return {
    photo: Boolean(card?.photoUrl),
    // Either kind of self-description counts: a curated bio and a captured
    // blurb are the same rung to a reader.
    blurb: Boolean(card?.bio) || Boolean(blurb?.text),
    contact: Boolean(card?.email) || Boolean(card?.phone),
    campaignSite: Boolean(links?.campaign?.url),
  };
}

const candidates: Record<string, RecordedCandidateHunt> = {};
const names: Record<string, string> = {};

/* ---- the filed candidacies, one source at a time -------------------------- */

let candidacyCount = 0;
for (const { state, source } of BALLOT_SOURCES) {
  const raw = await source.fetch();
  const set = source.normalize(raw);
  for (const c of set.candidacies) {
    candidacyCount += 1;
    candidates[c.id] = record(presenceFor(c.id, false));
    names[c.id] = `${c.givenName} ${c.familyName}`;
  }
  console.log(
    `  ${state}: ${set.candidacies.length} candidacies across ${set.contests.length} contests`,
  );
}

/* ---- the certified general lineup's nominees ------------------------------ */

let nomineeCount = 0;
const lineup = getGeneralLineup();
for (const contest of lineup?.contests ?? []) {
  for (const n of contest.nominees) {
    const key = `${contest.contestId}|${n.name}`;
    nomineeCount += 1;
    candidates[key] = record(presenceFor(key, true, contest.contestId, n.name));
    names[key] = n.name;
  }
}
console.log(`  certified lineup: ${nomineeCount} nominees`);

function record(presence: FieldPresence): RecordedCandidateHunt {
  const out = {} as RecordedCandidateHunt;
  for (const field of KELLY_FIELDS) {
    out[field] = presence[field] ? { state: "FOUND" } : { state: "NOT_HUNTED" };
  }
  return out;
}

/* ---- counts, then the write ---------------------------------------------- */

const keys = Object.keys(candidates);
if (keys.length === 0) {
  console.error(
    "REFUSED: zero candidates enumerated. A zero-row migration is a failed " +
      "migration, never an empty file.",
  );
  process.exit(1);
}

const stateTotals: Record<string, number> = {
  FOUND: 0,
  NOT_HUNTED: 0,
  VERIFIED_ABSENT: 0,
};
const perField: Record<KellyField, { FOUND: number; NOT_HUNTED: number }> = {
  photo: { FOUND: 0, NOT_HUNTED: 0 },
  blurb: { FOUND: 0, NOT_HUNTED: 0 },
  contact: { FOUND: 0, NOT_HUNTED: 0 },
  campaignSite: { FOUND: 0, NOT_HUNTED: 0 },
};
for (const key of keys) {
  for (const field of KELLY_FIELDS) {
    const s = candidates[key]![field].state;
    stateTotals[s] = (stateTotals[s] ?? 0) + 1;
    if (s === "FOUND" || s === "NOT_HUNTED") perField[field][s] += 1;
  }
}

const file: CandidateHuntFile = {
  migratedAt: today(),
  note:
    "RULING 18 (Prompt C item 2). Every Kelly field's hunt state, per candidate. " +
    "FOUND means the field is present with its source recorded. NOT_HUNTED means " +
    "no completed hunt. VERIFIED_ABSENT means a completed hunt walked every " +
    "applicable rung and the thing does not exist, and it carries those rungs and " +
    "the date checked — it is earned by a hunt session and NEVER by a migration, " +
    "which is why this file contains none of it. A contest renders candidate cards " +
    "only when no field anywhere in it is NOT_HUNTED.",
  candidates,
};

writeFileSync(OUT, `${JSON.stringify(file, null, 1)}\n`, "utf8");

// RE-READ, because a scripted write that wrote nothing exits 0.
const back = JSON.parse(readFileSync(OUT, "utf8")) as CandidateHuntFile;
const backKeys = Object.keys(back.candidates);

console.log(`\nMIGRATION: ${candidacyCount} candidacies + ${nomineeCount} nominees`);
console.log(`  candidates written:  ${keys.length}`);
console.log(`  candidates re-read:  ${backKeys.length}`);
console.log(`  fields written:      ${keys.length * KELLY_FIELDS.length}`);
console.log(`\nSTATE COUNTS AFTER MIGRATION`);
console.log(`  FOUND:            ${stateTotals.FOUND}`);
console.log(`  NOT_HUNTED:       ${stateTotals.NOT_HUNTED}`);
console.log(`  VERIFIED_ABSENT:  ${stateTotals.VERIFIED_ABSENT}  (by design — a migration never earns it)`);
console.log(`\nPER FIELD (FOUND / NOT_HUNTED)`);
for (const field of KELLY_FIELDS) {
  console.log(
    `  ${field.padEnd(13)} ${String(perField[field].FOUND).padStart(4)} / ${String(perField[field].NOT_HUNTED).padStart(4)}`,
  );
}
console.log(`\nWROTE: ${OUT}`);

if (backKeys.length !== keys.length) {
  console.error("REFUSED: the file did not read back with the same candidate count.");
  process.exit(1);
}
