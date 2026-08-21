/**
 * One-shot correction of the 87 B14 official-page MISS notes (NH Hunt 3,
 * 2026-08-21, item 4).
 *
 * The notes asserted "so there is no official page for us to link" on the
 * strength of a failed exact-name join against our own sitting-officeholder
 * registry. Re-walked 2026-08-21: 10 of 10 sampled were wrong, including the
 * sitting Governor of Arizona.
 *
 * This rewrites the CLAIM and keeps everything else — the key, the name, the
 * `attemptedAt`. The record of the attempt is evidence and is not touched; what
 * changes is what the attempt was said to prove.
 *
 * Committed rather than run inline so the edit is reviewable and so the count
 * it changed is a printed number rather than an assurance. Run once:
 *   node scripts/fix-b14-notes.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILE = join(process.cwd(), "data", "ballot", "candidate-links-2026.json");

const OLD =
  "no sitting officeholder in this state's registry matches this name exactly, " +
  "so there is no official page for us to link.";

const NEW =
  "OUR GAP, not theirs. No sitting officeholder in this state's registry matches " +
  "this name exactly, so this rung could not resolve a page. That is a fact about " +
  "our registry and is NOT evidence that no official page exists — CORRECTED " +
  "2026-08-21 under RULING 52, after 10 of 10 records sampled from this class " +
  "were re-walked and found wrong at rung 2, among them the sitting Governor of " +
  "Arizona, three other sitting Arizona statewide officers, three sitting members " +
  "of Congress and two sitting members of the New Hampshire General Court.";

const file = JSON.parse(readFileSync(FILE, "utf8"));

let changed = 0;
let alreadyCorrect = 0;
for (const hunt of file.hunts) {
  if (typeof hunt.note !== "string") continue;
  if (hunt.note.includes(NEW.slice(0, 40))) {
    alreadyCorrect += 1;
    continue;
  }
  if (!hunt.note.includes(OLD)) continue;
  hunt.note = hunt.note.replace(OLD, NEW);
  changed += 1;
}

// An operation that can return nothing must be asked what it returned. A
// scripted edit that edited nothing and exited 0 is one of the five sightings
// CLAUDE.md names by hand.
console.log(`b14 note correction:`);
console.log(`  hunts records read      ${file.hunts.length}`);
console.log(`  already corrected       ${alreadyCorrect}`);
console.log(`  notes rewritten         ${changed}`);

if (changed === 0 && alreadyCorrect === 0) {
  console.error("REFUSED: matched nothing. The sentence this targets is not present.");
  process.exit(1);
}

if (changed > 0) {
  // Two-space indent, matching what the file already uses. Re-serializing at a
  // different width would show 2,904 changed lines for an 87-note edit and bury
  // the change in its own diff.
  writeFileSync(FILE, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  const back = JSON.parse(readFileSync(FILE, "utf8"));
  const still = back.hunts.filter((h) => String(h.note ?? "").includes(OLD)).length;
  console.log(`  re-read, still carrying the old claim: ${still}`);
  if (still > 0) {
    console.error("REFUSED: the file did not read back clean.");
    process.exit(1);
  }
}
