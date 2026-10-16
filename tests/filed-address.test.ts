import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { readerCandidateProfiles } from "../lib/ballot/candidate-reader-privacy.ts";
import type { CandidateProfilesProjection } from "../lib/civic-data/manual-projections.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { candidateContactCensus } from "../lib/ballot/candidate-contacts.ts";
import { contactForCandidate } from "../lib/ask/candidate-contact.ts";
import { contactRecord } from "../lib/ask/contacts.ts";
import { readNjMorrisFiling } from "../lib/sources/ballot-nj-morris/index.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";

const MORRIS = requiredRoutineContract("nj-morris-filing");
const SOURCE = { sourceUrl: "https://filing.example.gov/list", sourceOrg: "Election office", collectedAt: "2026-10-01" };
await readNjMorrisFiling({ now: "2026-10-01T12:00:00.000Z", edge: provenEdgeEntry({
  recordClass: MORRIS.recordClass, scope: MORRIS.scope, sourceId: MORRIS.sourceId, versionId: "cv-filed-address", retrievedAt: "2026-10-01T12:00:00.000Z",
  value: {
    ballot: {
      formatVersion: 1,
      election: { id: "example-2026-general", date: "2026-11-03" },
      contests: [{ id: "example-contest", type: "CANDIDACY", ocdId: "ocd-division/country:us/state:nj/county:example", divisionVintage: "2020", voteFor: 1, provenance: { sourceUrl: SOURCE.sourceUrl } }],
      candidacies: [
        { id: "ballot-nj-morris:example-a", contestId: "example-contest", provenance: { sourceUrl: SOURCE.sourceUrl } },
        { id: "ballot-nj-morris:example-b", contestId: "example-contest", provenance: { sourceUrl: SOURCE.sourceUrl } },
      ],
      measures: [],
      absences: [],
    },
    contacts: { generatedAt: "2026-10-01", route: "filing", note: "", contacts: [
      { candidacyId: "ballot-nj-morris:example-a", email: "campaign@example.test", filedAddress: "123 Private Lane, Example City", ...SOURCE },
      { candidacyId: "ballot-nj-morris:example-b", email: null, filedAddress: "456 Private Road, Example City", ...SOURCE },
    ] },
  },
}) });

test("filing email and its source survive while the filed address cannot reach Ask", () => {
  const contacts = candidateContactCensus().contacts;
  assert.equal(contacts.length, 2);
  for (const row of contacts) {
    assert.equal(Object.hasOwn(row, "filedAddress"), false, "the reader contact contract carries no address field at all");
    const contact = contactForCandidate(row.candidacyId, "Candidate", "Office")!;
    assert.ok(!("filedAddress" in contact) || contact.filedAddress === null);
    assert.equal(contact.email, row.email);
    assert.equal(contactRecord(contact).sourceUrl, row.sourceUrl);
    assert.ok(!contactRecord(contact).text.includes("filed mailing address"));
    assert.ok(!JSON.stringify(contact).includes("Private"));
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
    console.log(JSON.stringify({card:renderToStaticMarkup(createElement(CandidateContact,{card,filing,links:null})), ask:renderToStaticMarkup(createElement(AskAnswerContacts,{contacts:[contact]})), sourceOnly:renderToStaticMarkup(createElement(CandidateContactSources,{filing,links:null})), contributedSources:CandidateContactSources({filing,links:null}).props.sources}));
  `], { encoding: "utf8", timeout: 120_000 }));
  for (const markup of [result.card, result.ask, result.sourceOnly]) {
    assert.ok(!markup.includes("123 Private Lane"));
  }
  assert.equal(result.sourceOnly, "", "a contact section leaves Sources to its card frame");
  assert.equal(result.contributedSources[0].provenance.sourceUrl, "https://filing.example.gov/list", "filing provenance reaches the card even with no public contact");
  assert.ok(!JSON.stringify(result.contributedSources).includes("123 Private Lane"));
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
