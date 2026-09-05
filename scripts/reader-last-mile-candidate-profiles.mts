import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { allCandidateCards } from "../lib/ballot/candidate-cards.ts";
import { allCandidateLinks } from "../lib/ballot/candidate-sites.ts";
import { candidateProfileEvidenceFor } from "../lib/ask/candidate-profile.ts";

const cards = allCandidateCards().cards;
const links = allCandidateLinks().links;
const records = [];
for (const key of [...new Set([...Object.keys(cards), ...Object.keys(links)])].sort()) {
  const answer = candidateProfileEvidenceFor({ kind: "PERSON", id: key, name: key });
  assert.equal(answer.gaps.length, 0, key);
  for (const field of ["bio", "official", "campaign", "email", "phone", "filedAddress"] as const) {
    const expected = field === "official" || field === "campaign" ? links[key]?.[field]?.url : cards[key]?.[field];
    if (!expected) continue;
    const record = answer.records.find(record => record.candidateProfile?.holdingKey === key && record.candidateProfile.field === field);
    assert.ok(record, `${key}/${field}`);
    assert.equal(record.candidateProfile?.value, expected);
    assert.ok(record.sourceUrl && record.retrievedAt || record.candidateProfile?.provenanceLimitation);
    records.push({ nativeHoldingKey: key, field, record });
  }
}
const hashFile = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const output = {
  proofKind: "Exact native candidate-card fields through the shared grounding adapter; actual Ask route readback is separate.",
  sourceHashes: Object.fromEntries(["data/ballot/candidate-cards-2026.json", "data/ballot/candidate-links-2026.json", "lib/ask/candidate-profile.ts", "lib/identity/reader-person.ts"].map(path => [path, hashFile(path)])),
  cardProfiles: Object.keys(cards).length, linkProfiles: Object.keys(links).length,
  eligibleBios: Object.values(cards).filter(card => card.bio).length,
  eligibleLinks: Object.values(links).flatMap(row => [row.official, row.campaign]).filter(Boolean).length,
  eligibleContacts: Object.values(cards).flatMap(row => [row.email, row.phone, row.filedAddress]).filter(Boolean).length,
  projectedFields: records.length, falseNegatives: 0, records,
};
assert.equal(output.projectedFields, output.eligibleBios + output.eligibleLinks + output.eligibleContacts);
writeFileSync("docs/evidence/reader-last-mile-candidate-profiles.json", JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ bios: output.eligibleBios, links: output.eligibleLinks, contacts: output.eligibleContacts, projected: output.projectedFields, falseNegatives: output.falseNegatives }));
