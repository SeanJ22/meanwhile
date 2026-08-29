/**
 * `pnpm method:candidates` — what has been offered to project knowledge, and
 * what became of it. (2026-08-29.)
 *
 * A rejected candidate is durable evidence, and evidence nobody can read is
 * evidence nobody has. This is the read surface: counts by lifecycle against the
 * corpus as a denominator, and every refusal printed with its stable code and
 * the exact validator issues that produced it.
 *
 * It writes nothing. There is no flag that makes it write.
 */

import { join } from "node:path";

import {
  CANDIDATE_LIFECYCLE_STATES,
  candidateCounts,
  readCandidateStore,
  rejectedCandidates,
} from "../lib/method/candidate.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { flag } from "./cli-args.mts";

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const STORE = flag(argv, "store") ?? join(ROOT, "data", "method", "candidates.json");

const store = readCandidateStore(STORE);
const counts = candidateCounts(store);
const total = store.candidates.length;

console.log(`candidate corpus         ${STORE}`);
console.log(`last updated             ${store.updatedOn ?? "(never)"}`);
console.log(`candidates recorded      ${total}`);
for (const state of CANDIDATE_LIFECYCLE_STATES) {
  console.log(`  ${state.padEnd(10)}            ${counts[state]}`);
}

console.log(
  `  ${floorLine(
    total > 0
      ? floored("candidates admitted", "the candidates ever offered", total, counts.ADMITTED)
      : floored(
          "candidates admitted",
          "the candidates ever offered",
          0,
          0,
          "no candidate has been offered yet — the corpus is empty, which is a fact about us",
        ),
  )}`,
);

const rejected = rejectedCandidates(store);
if (rejected.length > 0) {
  console.log("");
  console.log("REFUSED, AND RETAINED — a rejection is evidence, never a silence:");
  for (const c of rejected) {
    console.log(`  ${c.id}  ${c.proposal.id}`);
    console.log(`    offered by     ${c.attemptId} on ${c.submittedAt} against method version ${c.observedMethodVersion}`);
    console.log(`    code           ${c.rejection?.code}`);
    console.log(`    reason         ${c.rejection?.reason}`);
    for (const i of c.rejection?.issues ?? []) console.log(`      ${i.id} ${i.rule}: ${i.detail}`);
  }
}
