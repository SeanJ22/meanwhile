import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { allCandidateCards, cardForCandidacy, cardForNominee } from "../lib/ballot/candidate-cards.ts";
import { readerCandidateProfiles } from "../lib/ballot/candidate-reader-privacy.ts";
import type { CandidateProfilesProjection } from "../lib/civic-data/manual-projections.ts";
import { candidateContactCensus } from "../lib/ballot/candidate-contacts.ts";
import { candidateProfileEvidenceFor } from "../lib/ask/candidate-profile.ts";
import { contactForCandidate } from "../lib/ask/candidate-contact.ts";
import { contactRecord } from "../lib/ask/contacts.ts";
import { installCandidateCorpusFirstSeed, installNjMorrisFilingFirstSeed, installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

await Promise.all([installCandidateCorpusFirstSeed(), installNjMorrisFilingFirstSeed(), installRegistryRuntimeFirstSeeds()]);

test("filed addresses stay in preserved evidence and never reach candidate card or Ask projections", () => {
  const sourcePath = "data/ballot/candidate-cards-2026.json";
  const before = readFileSync(sourcePath, "utf8");
  const evidence = JSON.parse(before) as { cards: Record<string, { filedAddress?: string }> };
  const cards = allCandidateCards();
  const filed = Object.entries(evidence.cards).filter(([, card]) => card.filedAddress);
  assert.ok(filed.length > 0, "exercise the actual legacy projection, not only empty fields");
  assert.deepEqual(cards.hunts, [], "acquisition notes remain evidence only");
  for (const [key, held] of filed) {
    const split = key.indexOf("|");
    const card = split < 0 ? cardForCandidacy(key) : cardForNominee(key.slice(0, split), key.slice(split + 1));
    assert.ok(card);
    assert.equal(card.filedAddress, null);
    assert.equal(card.filedAddressSource, null);
    assert.ok(!JSON.stringify(cards).includes(held.filedAddress!));
    const answer = candidateProfileEvidenceFor({ kind: "PERSON", id: key, name: "Candidate" });
    assert.ok(!JSON.stringify(answer).includes(held.filedAddress!));
  }
  assert.equal(readFileSync(sourcePath, "utf8"), before, "saved source evidence is unchanged");
});

test("filing email and its source survive while the filed address cannot reach Ask", () => {
  for (const row of candidateContactCensus().contacts) {
    assert.equal(Object.hasOwn(row, "filedAddress"), false, "the reader contact contract carries no address field at all");
    const contact = contactForCandidate(row.candidacyId, "Candidate", "Office")!;
    assert.ok(!("filedAddress" in contact) || contact.filedAddress === null);
    assert.equal(contact.email, row.email);
    assert.equal(contactRecord(contact).sourceUrl, row.sourceUrl);
    assert.ok(!contactRecord(contact).text.includes("filed mailing address"));
  }
});

test("both renderers reject legacy address props and retain a filing source even with no public contact", () => {
  const result = JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--input-type=module", "-e", `
    import { createElement } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { CandidateContact, CandidateContactSources } from './components/ballot/candidate-contact.tsx';
    import { AskAnswerContacts } from './components/ask/answer-contacts.tsx';
    const address = '123 Private Lane, Example City';
    const filing = { candidacyId:'example', email:null, filedAddress:address, sourceUrl:'https://filing.example.gov/list', sourceOrg:'Election office', collectedAt:'2026-10-01' };
    const card = { filedAddress:address, filedAddressSource:'Source', email:'campaign@example.test' };
    const contact = { id:'example', name:'Candidate', relationship:'Candidate for office', basis:'SUBJECT_OFFICE', filedAddress:address, email:card.email, sourceUrl:filing.sourceUrl };
    console.log(JSON.stringify({card:renderToStaticMarkup(createElement(CandidateContact,{card,filing,links:null})), ask:renderToStaticMarkup(createElement(AskAnswerContacts,{contacts:[contact]})), sourceOnly:renderToStaticMarkup(createElement(CandidateContactSources,{filing,links:null}))}));
  `], { encoding: "utf8", timeout: 120_000 }));
  for (const markup of [result.card, result.ask, result.sourceOnly]) {
    assert.ok(!markup.includes("123 Private Lane"));
  }
  assert.ok(result.sourceOnly.includes("https://filing.example.gov/list"), "filing provenance remains in Sources with no public contact");
  assert.ok(result.ask.includes("https://filing.example.gov/list"));
  assert.ok(!result.card.includes("https://filing.example.gov/list"), "citation is absent from the card face");
  assert.ok(result.card.includes("mailto:campaign@example.test"));
  assert.ok(result.ask.includes("mailto:campaign@example.test"));
});


test("reader publication redacts fields and acquisition notes without changing the retained source", () => {
  const address = "123 Private Lane, Example City";
  const held = { cards: { curatedAt: "2026-10-01", note: address,
    hunts: [{ key: "example", name: "Candidate", note: address, attemptedAt: "2026-10-01" }],
    cards: { example: { filedAddress: address, filedAddressSource: "Filing", email: "campaign@example.test" } } },
    links: { curatedAt: "2026-10-01", note: "", hunts: [], links: {} } } as unknown as CandidateProfilesProjection;
  const before = JSON.stringify(held);
  const projected = readerCandidateProfiles(held);
  assert.ok(!JSON.stringify(projected).includes(address));
  assert.equal(projected.cards.cards.example.email, "campaign@example.test");
  assert.equal(JSON.stringify(held), before);
});
