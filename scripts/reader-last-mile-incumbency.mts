import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { readerIncumbencyProof } from "./lib/reader-incumbency-proof.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import bridge from "../lib/funding/official-candidacies.json" with { type: "json" };

const proof = await readerIncumbencyProof();
floored("committed ballot officeholder relations", "held resolved person/candidacy bridges reached by the current ballot", bridge.rows.filter(row => row.status === "RESOLVED").length, proof.committedRelations);
writeFileSync("docs/evidence/reader-last-mile-incumbency.json", JSON.stringify({ exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), ...proof }, null, 2) + "\n");
console.log(JSON.stringify({ currentContests: proof.currentContests, currentCandidates: proof.currentCandidates, recoveredCandidates: proof.recovered.length, recoveredHolders: proof.recoveredHolders, committedRelations: proof.committedRelations, sameOfficeDivision: proof.sameOfficeDivision, personOnly: proof.personOnly, failed: proof.failed }));
assert.equal(proof.failed, 0);
