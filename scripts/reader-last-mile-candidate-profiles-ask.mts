import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { candidateProfileAskProof } from "./lib/reader-ask-candidate-profile-proof.ts";
import { allCandidateCards } from "../lib/ballot/candidate-cards.ts";
import { allCandidateLinks } from "../lib/ballot/candidate-sites.ts";
import { floored } from "../lib/ops/denominator-floor.ts";

const result = await candidateProfileAskProof();
const outputPath = process.env.READER_PROOF_OUTPUT ?? "docs/evidence/reader-last-mile-candidate-profiles-ask.json";
const nativeFields = Object.values(allCandidateCards().cards).flatMap(card => [card.bio, card.email, card.phone, card.filedAddress]).filter(Boolean).length
  + Object.values(allCandidateLinks().links).flatMap(links => [links.official, links.campaign]).filter(Boolean).length;
floored("candidate profile fields", "all native curated biography, contact, and verified-link fields", nativeFields, result.eligibleFields);
assert.equal(result.eligibleFields, nativeFields, "The actual route proof must include every native eligible profile field.");
writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ eligibleFields: result.eligibleFields, profiles: result.proofs.length, failed: result.failed }));
assert.equal(result.failed, 0, "Every eligible candidate-profile field must survive the actual Ask route.");
