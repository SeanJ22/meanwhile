import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { readerIncumbencyProof } from "./lib/reader-incumbency-proof.ts";
import { prepareReaderProofRuntime } from "./lib/reader-proof-runtime.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import { getRegistryRuntimeReadModel } from "../lib/registry/runtime-read-model.ts";

await prepareReaderProofRuntime();
const bridge = getRegistryRuntimeReadModel().officialCandidacies;
const proof = await readerIncumbencyProof();
floored("committed ballot officeholder relations", "held resolved person/candidacy bridges reached by the current ballot", bridge.rows.filter(row => row.status === "RESOLVED").length, proof.committedRelations);
writeFileSync("docs/evidence/reader-last-mile-incumbency.json", JSON.stringify({ exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), ...proof }, null, 2) + "\n");
console.log(JSON.stringify({ currentContests: proof.currentContests, currentCandidates: proof.currentCandidates, recoveredCandidates: proof.recovered.length, recoveredHolders: proof.recoveredHolders, committedRelations: proof.committedRelations, sameOfficeDivision: proof.sameOfficeDivision, personOnly: proof.personOnly, failed: proof.failed }));
assert.equal(proof.failed, 0);
