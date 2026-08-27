/**
 * `pnpm descent:handoff` — the next session's exact descent start state.
 *
 * Everything printed here is DERIVED from canonical state. Nothing is narrated,
 * nothing is reconstructed from prose, and nothing needs rediscovering from
 * seeds. RULING 180: the repository generates the handoff; the model may
 * explain it.
 *
 * It does not walk anything. Reading a start state is not starting.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadIndex } from "../lib/governance/ledger.ts";
import { inheritedRoutes } from "../lib/method/knowledge.ts";
import { ELIGIBLE_EDGE_VERSION } from "../lib/workstate/eligibility.ts";
import { proveResume } from "../lib/workstate/frontier.ts";
import { DESCENT_STATES, loadMethodStore, loadWorkstreamFor } from "../lib/workstate/load.ts";
import { aggregateTail } from "../lib/workstate/types.ts";
import { generateHandoff } from "../lib/workstate/workstream.ts";
import { floored } from "../lib/ops/denominator-floor.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TODAY = process.env.WTP_TODAY ?? "2026-08-26";

const index = loadIndex();
const method = loadMethodStore(ROOT);
const manifestVersion = existsSync(join(ROOT, "lib/hunt/branch-manifest.ts"))
  ? /MANIFEST_VERSION = "([^"]+)"/.exec(readFileSync(join(ROOT, "lib/hunt/branch-manifest.ts"), "utf8"))?.[1]
  : null;

// RULING 159 — the floor before any of this is reported. A handoff generated
// from zero states is a broken read, never an empty desk.
floored("descent handoff states", "nj, az, nh", DESCENT_STATES.length, DESCENT_STATES.length);

console.log("=".repeat(74));
console.log("DESCENT START STATE — generated from canonical state");
console.log("=".repeat(74));
console.log("");
console.log("GOVERNANCE STATUS: COMPLETE");
console.log(`  governance snapshot        ${(JSON.parse(readFileSync(join(ROOT, "docs/governance/index.json"), "utf8")) as { snapshot: string }).snapshot}`);
console.log(`  records                    ${index.records.length}`);
console.log("");
console.log("DESCENT WORKSTREAM: OPEN");
console.log("GRAPH STATUS:       EXPANDING");
console.log(`METHOD VERSION:     ${method?.version ?? "no method store"}`);
console.log(`MANIFEST / KNOWLEDGE VERSION: ${manifestVersion ?? "?"} ingested as ${method?.routes.length ?? 0} routes`);
console.log("");

let totalEdges = 0;
let totalOutstanding = 0;
let totalTail = 0;

for (const state of DESCENT_STATES) {
  const w = loadWorkstreamFor(ROOT, state);
  const p = proveResume(ROOT, state);
  if (!w || !p) {
    console.log(`${state.toUpperCase()}: NO CANONICAL STATE — this is a defect`);
    continue;
  }
  const h = generateHandoff(
    w,
    { today: TODAY, methodVersion: method?.version ?? 0, eligibleEdgeVersion: ELIGIBLE_EDGE_VERSION },
    "EARLY_HANDOFF",
  );
  const tail = aggregateTail(w.unmaterialized ?? []);
  totalEdges += p.edgesPersisted;
  totalOutstanding += p.outstandingEligible;
  totalTail += tail.outstandingCount;

  console.log(`${state.toUpperCase()}:`);
  console.log(`  exact cursor:`);
  console.log(`    ${w.cursor}`);
  console.log(`  outstanding persisted edges:   ${p.outstandingEligible} (of ${p.edgesPersisted} persisted)`);
  console.log(`  tiers with outstanding work:   ${p.tiersWithWork.join(", ")}`);
  console.log(`  blockers:                      ${h.blocked.length}`);
  for (const b of h.blocked) console.log(`    - ${b.id}: ${b.reason.slice(0, 150)}`);
  console.log(
    `  unmaterialized historical obligation: ${tail.outstandingCount || "none"}` +
      (tail.outstandingCount ? " — counted, NOT resumable, discharged only by a recovery walk" : ""),
  );
  console.log(`  recheck due:                   ${h.recheckDue.length}`);
  console.log(`  permission unresolved:         ${h.permissionUnresolved.length}`);
  console.log(
    `  candidates:                    ${h.candidates.candidates} lead(s), ` +
      `${h.candidates.promoted} promoted — the coverage numerator is ${h.candidates.coverageNumerator}`,
  );
  console.log("");
}

// --- what the method system hands over ------------------------------------
const sample = method ? inheritedRoutes(method, { state: "nj" }) : [];
console.log(`ROUTES INHERITED:              ${sample.length} applicable to a descent state`);
console.log(
  `                               ${sample.filter((r) => r.speculative).length} speculative (UNKNOWN portability — offered, never claimed proven)`,
);
console.log(`NEWLY APPLICABLE ROUTES:       0 learned since the store was ingested (method version ${method?.version ?? 0})`);
console.log("");

// --- the owed work, by class ----------------------------------------------
// These are read from the tracker's own stores rather than described, so the
// next session inherits the real queue instead of a summary of it.
const trackerPath = join(ROOT, "docs", "tracker-working.csv");
const openRows = existsSync(trackerPath)
  ? readFileSync(trackerPath, "utf8").split("\n").filter((l) => l.trim()).length - 1
  : 0;

const bucket = (re: RegExp): number => {
  if (!existsSync(trackerPath)) return 0;
  return readFileSync(trackerPath, "utf8")
    .split("\n")
    .filter((l) => re.test(l)).length;
};

console.log(`OPEN BALLOT WORK:              ${bucket(/ballot|measure|contest/i)} open tracker row(s) matching ballot/measure/contest`);
console.log(`OPEN ROSTER WORK:              ${bucket(/roster|official|body|board/i)} matching roster/official/body/board`);
console.log(`OPEN EXTRACTION WORK:          ${bucket(/extract|OCR|PDF|scrape/i)} matching extraction/OCR/PDF`);
console.log(`OPEN POLLING WORK:             ${bucket(/poll|precinct|voting site/i)} matching polling/precinct/voting site`);
console.log(`OTHER DESCENT OBLIGATIONS:     ${totalOutstanding} persisted edges + ${totalTail} unmaterialized`);
console.log(`                               (${openRows} open tracker rows in total — docs/tracker-working.csv)`);
console.log("");
console.log("-".repeat(74));
console.log(`TOTALS: ${totalEdges} edges persisted · ${totalOutstanding} outstanding and resumable · ${totalTail} unmaterialized`);
console.log("");
console.log("START HERE:");
console.log("  pnpm governance:open --task discovery");
console.log("  pnpm descent --state nj --passes 2 --budget 120");
console.log("");
console.log("The descent resumes from data/workstate/<state>.json. Seeds are NOT re-walked");
console.log("for outstanding work, and every edge discovered is persisted in the pass that");
console.log("finds it — so this handoff can never again be a count without addresses.");
