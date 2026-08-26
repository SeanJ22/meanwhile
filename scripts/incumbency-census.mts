/**
 * WHAT INCUMBENCY NOW SAYS, ACROSS EVERY CONTEST IN EVERY PILOT ZIP.
 * (2026-08-26, the sources-and-incumbency session. The denominator Items 10-15
 * owe.)
 *
 * **A bare "fixed" is rejected.** RULING 136: feedback names examples and a fix
 * closes the class, and an ending carries its denominator. RULING 105: never a
 * bare count — what RENDERS, what is OUT OF SCOPE with the reason, and what is
 * IN SCOPE AND STILL DARK.
 *
 * It also answers the headline the brief asks for: **how many candidates have
 * voting records available UPSTREAM and suppressed DOWNSTREAM** — a sitting
 * officeholder whose roll calls sit in a committed snapshot while the ballot
 * card had no door to them.
 *
 * Usage:  pnpm incumbency:census [--json]
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { contestIncumbency } from "../lib/ballot/incumbency-resolve.ts";
import { incumbentHolderFor } from "../lib/ballot/incumbent-record.ts";
import { anchorAgainstGencourt } from "../lib/ballot/incumbency-resolve.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import { seatHoldersForDivision } from "../lib/registry/server.ts";

const ROOT = process.cwd();

interface BallotFile {
  contests: { id: string; title: string; ocdId: string; type: string }[];
  candidacies: { id: string; contestId: string; familyName: string; givenName: string }[];
}

const FILES = readdirSync(join(ROOT, "data/ballot")).filter(
  (f) => f.endsWith(".json") && /^(nh|nj|az)-/.test(f) && !f.includes("analyses") && !f.includes("lineup"),
);

const FEDERAL = /^(United States Senator|Representative in Congress|President)/i;

let contests = 0;
let candidates = 0;
const standing: Record<string, number> = { INCUMBENT: 0, CHALLENGER: 0, UNKNOWN: 0 };
let notElected = 0;
let recordDoors = 0;
const anchors: Record<string, number> = { AGREES: 0, DISAGREES: 0, COULD_NOT_ANCHOR: 0 };
const disagreements: string[] = [];
const incumbentsFound: string[] = [];

for (const file of FILES) {
  const data = JSON.parse(readFileSync(join(ROOT, "data/ballot", file), "utf8")) as BallotFile;
  if (!Array.isArray(data.contests)) continue;

  for (const contest of data.contests) {
    if (contest.type !== "CANDIDACY") continue;
    const cands = (data.candidacies ?? []).filter((c) => c.contestId === contest.id);
    if (cands.length === 0) continue;
    contests += 1;
    candidates += cands.length;

    const result = await contestIncumbency(
      {
        id: contest.id,
        title: contest.title,
        ocdId: contest.ocdId,
        federal: FEDERAL.test(contest.title),
        candidates: cands.map((c) => ({
          key: c.id,
          display: `${c.givenName} ${c.familyName}`,
          targetKey: c.id,
        })),
      },
      incumbentHolderFor,
    );

    for (const [key, d] of result.decisions) {
      standing[d.standing] += 1;
      if (/not filled by election/.test(d.basis)) notElected += 1;
      if (d.standing === "INCUMBENT") {
        const c = cands.find((x) => x.id === key);
        incumbentsFound.push(`${c?.givenName} ${c?.familyName} — ${contest.title}`);
      }
    }
    recordDoors += result.holderFor.size;

    // RULING 147's external anchor: the body's own roster against the registry.
    const registryNames = (await seatHoldersForDivision(contest.ocdId)).map((h) => h.name);
    const anchor = anchorAgainstGencourt(contest.title, registryNames, contest.ocdId);
    anchors[anchor.anchor] += 1;
    if (anchor.anchor === "DISAGREES") disagreements.push(`${contest.title} — ${anchor.detail}`);
  }
}

// RULING 159 — the floor is asserted before the split is reported. Zero
// candidates across four pilot ballots is a broken read, not an empty ballot.
const floor = floored("incumbency:census", "candidates across the pilot ballot files", candidates, standing.INCUMBENT + standing.CHALLENGER + standing.UNKNOWN);
void floor;

const report = { files: FILES, contests, candidates, standing, notElected, recordDoors, anchors, disagreements, incumbentsFound };

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`incumbency:census · ${FILES.length} ballot file(s) · ${contests} contest(s) · ${candidates} candidate(s)`);
  console.log("");
  console.log("  THE THREE-WAY SPLIT (RULING 105):");
  console.log(`    INCUMBENT   ${standing.INCUMBENT}`);
  console.log(`    CHALLENGER  ${standing.CHALLENGER}`);
  console.log(`    UNKNOWN     ${standing.UNKNOWN}   of which ${notElected} are offices not filled by election`);
  console.log("");
  console.log(`  voting-record doors now open  ${recordDoors}`);
  console.log("");
  console.log("  THE EXTERNAL ANCHOR (RULING 147) — the General Court's own roster vs the registry:");
  console.log(`    AGREES            ${anchors.AGREES}`);
  console.log(`    DISAGREES         ${anchors.DISAGREES}`);
  console.log(`    COULD_NOT_ANCHOR  ${anchors.COULD_NOT_ANCHOR}   (not an NH legislative seat, or the title did not parse)`);
  for (const d of disagreements) console.log(`      ! ${d}`);
  console.log("");
  console.log(`  INCUMBENTS NAMED (${incumbentsFound.length}):`);
  for (const i of incumbentsFound) console.log(`    ${i}`);
}
