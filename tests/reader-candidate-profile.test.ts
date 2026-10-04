import assert from "node:assert/strict";
import { test } from "node:test";
import { allCandidateCards } from "../lib/ballot/candidate-cards.ts";
import { allCandidateLinks } from "../lib/ballot/candidate-sites.ts";
import { candidateProfileEvidenceFor, projectCandidateProfile } from "../lib/ask/candidate-profile.ts";
import { readerPersonKeys } from "../lib/identity/reader-person.ts";
import {
  installCandidateCorpusFirstSeed,
  installNjMorrisFilingFirstSeed,
  installRegistryRuntimeFirstSeeds,
} from "./helpers/registry-runtime-first-seed.ts";

await Promise.all([
  installCandidateCorpusFirstSeed(),
  installNjMorrisFilingFirstSeed(),
  installRegistryRuntimeFirstSeeds(),
]);

test("every current native candidate bio and verified link reaches grounded profile records with exact provenance", () => {
  const cards = allCandidateCards().cards;
  const links = allCandidateLinks().links;
  assert.deepEqual([...new Set(Object.values(cards).flatMap(Object.keys))].sort(), [
    "bio", "bioSourceLabel", "bioSourceUrl", "email", "filedAddress", "filedAddressSource", "phone", "phoneLabel", "phoneSource", "photoSource", "photoUrl",
  ].sort(), "Every newly held card field needs an explicit reader classification; photographs keep their separate image-review contract.");
  let bios = 0;
  let sites = 0;
  let contacts = 0;
  for (const key of new Set([...Object.keys(cards), ...Object.keys(links)])) {
    const answer = candidateProfileEvidenceFor({ kind: "PERSON", id: key, name: "Display name is deliberately not a join key" });
    assert.equal(answer.gaps.length, 0, key);
    if (cards[key]?.bio) {
      const record = answer.records.find(row => row.id === `candidate-bio:${key}`);
      assert.ok(record, key);
      assert.equal(record.candidateProfile?.value, cards[key].bio);
      assert.equal(record.candidateProfile?.label, cards[key].bioSourceLabel);
      assert.equal(record.sourceUrl, cards[key].bioSourceUrl);
      assert.equal(record.retrievedAt, cards[key].bioSourceLabel?.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]);
      bios++;
    }
    assert.ok(answer.records.every(row => !row.id.endsWith(":filedAddress")));
    for (const field of ["email", "phone"] as const) {
      if (!cards[key]?.[field]) continue;
      const record = answer.records.find(row => row.id === `candidate-contact-field:${key}:${field}`);
      assert.ok(record, `${key}/${field}`);
      assert.equal(record.candidateProfile?.value, cards[key][field]);
      if (field === "phone" && cards[key].phoneLabel) assert.equal(record.candidateProfile?.label, cards[key].phoneLabel);
      assert.ok(record.sourceUrl && record.retrievedAt || record.candidateProfile?.provenanceLimitation);
      contacts++;
    }
    for (const field of ["official", "campaign"] as const) {
      const link = links[key]?.[field];
      if (!link) continue;
      const record = answer.records.find(row => row.id === `candidate-link:${key}:${field}`);
      assert.ok(record, `${key}/${field}`);
      assert.equal(record.sourceUrl, link.url);
      assert.equal(record.retrievedAt, link.attemptedAt);
      assert.equal(record.candidateProfile?.verification, link.verification);
      assert.equal(record.candidateProfile?.label, link.label ?? (field === "official" ? "Official page" : "Campaign site"));
      sites++;
    }
  }
  assert.equal(bios, Object.values(cards).filter(row => row.bio).length);
  assert.equal(sites, Object.values(links).flatMap(row => [row.official, row.campaign]).filter(Boolean).length);
  assert.equal(contacts, Object.values(cards).flatMap(card => [card.email, card.phone]).filter(Boolean).length);
});

test("official and candidacy profile answers share exact holdings without attaching a namesake's biography", () => {
  const official = candidateProfileEvidenceFor({ kind: "PERSON", id: "statewide:az/governor", name: "Katie Hobbs" });
  const candidate = candidateProfileEvidenceFor({ kind: "PERSON", id: "ballot-az-pima:governor:hobbs-katie", name: "Unrelated display text" });
  assert.ok(official.records.length > 0);
  assert.deepEqual(official.records.map(({ subjectId: _id, ...row }) => row), candidate.records.map(({ subjectId: _id, ...row }) => row));
  const other = candidateProfileEvidenceFor({ kind: "PERSON", id: "ballot-az-pima:governor|Andy Biggs", name: "Katie Hobbs" });
  assert.ok(other.records.every(row => !row.candidateProfile?.holdingKey.includes("Katie Hobbs")));
  assert.deepEqual(candidateProfileEvidenceFor({ kind: "PERSON", id: "unknown:candidate", name: "Katie Hobbs" }).records, []);
  const conflict = "ballot-az-pima:governor|Teri Ann Hourihan";
  assert.deepEqual(readerPersonKeys(conflict).keys, [conflict], "A certified-card party conflict must not acquire a filed-candidacy identity");
  assert.ok(candidateProfileEvidenceFor({ kind: "PERSON", id: conflict, name: "Teri Ann Hourihan" }).records.every(row => row.canonicalSubjectId === conflict));
});

test("profile fields without their verification/source remain withheld instead of becoming claims or publisher absence", () => {
  const key = Object.keys(allCandidateCards().cards).find(key => allCandidateCards().cards[key].bio)!;
  const card = structuredClone(allCandidateCards().cards[key]);
  card.bioSourceUrl = null;
  card.phone = null;
  card.email = null;
  card.filedAddress = null;
  const answer = projectCandidateProfile({ kind: "PERSON", id: key, name: key }, [key], { [key]: card }, {
    [key]: { official: { url: "https://example.test/acquired", attemptedAt: "2026-09-04", verification: "" }, campaign: null },
  });
  assert.deepEqual(answer.records, []);
  assert.equal(answer.denominators.candidateProfileFieldsWithheld, 2);
  assert.ok(answer.gaps.every(gap => gap.whose === "OURS"));
});

test("contact source metadata is never borrowed from a biography or an unrelated link", () => {
  const key = "planted:contact";
  const card = { ...structuredClone(Object.values(allCandidateCards().cards)[0]), bio: null, email: "held@example.test", phone: null, filedAddress: null };
  const answer = projectCandidateProfile({ kind: "PERSON", id: key, name: "Planted candidate" }, [key], { [key]: card }, {});
  assert.equal(answer.records.length, 1);
  assert.equal(answer.records[0].sourceUrl, null);
  assert.equal(answer.records[0].retrievedAt, null);
  assert.ok(answer.records[0].candidateProfile?.provenanceLimitation);
  const officeKey = Object.keys(allCandidateCards().cards).find(id => allCandidateCards().cards[id].phoneLabel)!;
  const actual = candidateProfileEvidenceFor({ kind: "PERSON", id: officeKey, name: "Unrelated display text" }).records.find(row => row.candidateProfile?.field === "phone")!;
  assert.match(actual.text, /Merrimack County Attorney/);
  assert.equal(actual.candidateProfile?.label, allCandidateCards().cards[officeKey].phoneLabel);
});
