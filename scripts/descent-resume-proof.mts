/**
 * `pnpm descent:resume-proof` — prove the frontier resumes from canonical state.
 *
 * Stage 1 criterion 13: NJ/AZ/NH can continue from the exact migrated frontier
 * **without rediscovering outstanding edges from `descent-seeds.ts`**.
 *
 * The proof is structural rather than asserted. `lib/workstate/frontier.ts` does
 * not import the seeds module and cannot reach the network, so what it returns
 * is by construction what the canonical store holds. This script runs it against
 * the three live states and prints the numbers, and it makes NO network call —
 * a resume proof that needed the internet would be proving something else.
 *
 * ## What it does NOT claim
 *
 * The 3,900 edges the legacy `descent.json` queued and never wrote down are not
 * recovered here, and nothing below pretends otherwise. They are carried as a
 * named `REQUIRES_NEW_ADAPTER` blocker on each workstream, with their exact
 * count. **That gap is the finding that justified the whole change**, and a
 * proof that quietly counted them as resumable would be the partial-that-
 * reconciles this repository names most often.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { proveResume } from "../lib/workstate/frontier.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATES = ["nj", "az", "nh"] as const;

// The seeds module is never imported by the resume path. This asserts that
// rather than trusting it: a resume that reached for seeds would be rebuilding
// the frontier, which is the defect (RULING 181).
// Comments are STRIPPED first. `frontier.ts` explains at length that it exists
// because the frontier used to be rebuilt from `descent-seeds.ts`, so a raw
// text search finds the explanation and calls it the defect. A guard that fires
// on its own documentation is a guard somebody weakens.
const frontierSrc = readFileSync(join(ROOT, "lib/workstate/frontier.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");
const touchesSeeds = /descent-seeds/.test(frontierSrc);
const touchesNetwork = /\bfetch\(|node:https?|axios/.test(frontierSrc);

console.log("DESCENT RESUME PROOF");
console.log("");
console.log(`resume path imports descent-seeds : ${touchesSeeds ? "YES — DEFECT" : "no"}`);
console.log(`resume path makes network calls   : ${touchesNetwork ? "YES — DEFECT" : "no"}`);
console.log("");

let totalEdges = 0;
let totalOutstanding = 0;
let ok = !touchesSeeds && !touchesNetwork;

for (const state of STATES) {
  const p = proveResume(ROOT, state);
  if (!p) {
    console.log(`${state}: NO CANONICAL STATE — cannot resume`);
    ok = false;
    continue;
  }
  totalEdges += p.edgesPersisted;
  totalOutstanding += p.outstandingEligible;

  console.log(`${state.toUpperCase()}`);
  console.log(`  loaded from canonical state : ${p.loadedFromCanonicalState}`);
  console.log(`  seeds consulted             : ${p.seedsConsulted}`);
  console.log(`  edges persisted             : ${p.edgesPersisted}`);
  console.log(`  outstanding eligible        : ${p.outstandingEligible}`);
  console.log(`  urls already accounted for  : ${p.visitedUrls}`);
  console.log(`  tiers with outstanding work : ${p.tiersWithWork.length}`);
  console.log(`  cursor                      : ${p.cursor}`);
  console.log("");

  if (p.edgesPersisted === 0) ok = false;
}

// RULING 159 — the floor before the verdict. Zero states resumed is a broken
// read, never a clean board.
console.log(
  floorLine(floored("resume proof states", "nj, az, nh", STATES.length, STATES.length)),
);
console.log(`edges persisted total   ${totalEdges}`);
console.log(`outstanding eligible    ${totalOutstanding}`);
console.log("");
console.log(
  ok
    ? "RESUME PROOF PASSED — outstanding work is read from canonical state, with no seed crawl."
    : "RESUME PROOF FAILED",
);

if (!ok) process.exit(1);
