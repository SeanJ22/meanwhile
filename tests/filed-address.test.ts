import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { readerCandidateProfiles } from "../lib/ballot/candidate-reader-privacy.ts";
import type { CandidateProfilesProjection } from "../lib/civic-data/manual-projections.ts";
import { candidateContactForCandidacy } from "../lib/ballot/candidate-contacts.ts";
import { contactForCandidate } from "../lib/ask/candidate-contact.ts";
import { contactRecord } from "../lib/ask/contacts.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import type { GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import type { Contest } from "../lib/ballot/types.ts";
import type { LineupOutcome } from "../lib/identity/types.ts";
import { readFileSync } from "node:fs";
import { requireBallotState } from "../lib/civic-data/state-scopes.ts";
import { currentReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";

import { stateBallotScope } from "../lib/civic-data/state-scopes.ts";
import { ballotElectionKey } from "../lib/ballot/generic-projection.ts";
import { installManualValue } from "./helpers/promoted-fixtures.ts";
import { stateBallotContractId } from "../lib/civic-data/state-scopes.ts";
import type { CivicDataReadResult } from "../lib/civic-data/read-model.ts";
import { readGenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import type { CandidacyRemoval } from "../lib/ballot/types.ts";

const TEST_BALLOT_PROVENANCE = { sourceUrl: "https://example.test/ballot", sourceOrg: "Synthetic test ballot", collectedAt: "2026-09-25", verifiedAt: null };

function rawBallot(state: string, races: readonly TestRace[]): BallotSet {
  const electionId = `${state.toLowerCase()}-2026-general-test`;
  return {
    election: { id: electionId, date: "2026-11-03", name: "2026 General Election (test)", state },
    contests: races.map((race) => ({
      id: race.id, electionId, ocdId: race.ocdId, divisionVintage: "2026", title: race.title, type: race.type ?? (race.measure ? "MEASURE" : "CANDIDACY"),
      voteFor: 1, termYears: race.measure ? null : 4, scopeNote: null, provenance: TEST_BALLOT_PROVENANCE,
    })),
    candidacies: races.flatMap((race) => (race.candidacies ?? []).map((row) => ({
      id: row.id, contestId: race.id, givenName: row.givenName, familyName: row.familyName, partyLabel: row.partyLabel ?? null,
      slogan: null, incumbent: null, websiteUrl: null, provenance: TEST_BALLOT_PROVENANCE,
    }))),
    measures: races.flatMap((race) => race.measure ? [{
      id: `${race.id}#measure`, contestId: race.id, ...(race.measure.officialNumber ? { officialNumber: race.measure.officialNumber } : {}),
      questionText: race.measure.questionText, officialStatement: null, provenance: TEST_BALLOT_PROVENANCE,
    }] : []),
    absences: [],
  };
}

interface TestRace {
  readonly id: string;
  readonly title: string;
  readonly ocdId: string;
  readonly type?: Contest["type"];
  readonly candidacies?: readonly { readonly id: string; readonly givenName: string; readonly familyName: string; readonly partyLabel?: string | null }[];
  readonly measure?: { readonly questionText: string; readonly officialNumber?: string };
}

function njMorrisFiling(races: readonly TestRace[], extra: {
  readonly removals?: readonly CandidacyRemoval[];
  readonly contacts?: readonly (NonNullable<BallotSet["contacts"]>[number] & { readonly filedAddress?: string })[];
} = {}): BallotSet {
  return {
    ...rawBallot("NJ", races), removals: [...(extra.removals ?? [])],
    contacts: extra.contacts ?? [],
  };
}

function served<T>(read: CivicDataReadResult<T>, what: string): T {
  if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") throw new Error(`${what} fixture did not install: ${read.kind} ${"detail" in read ? read.detail : ""}`);
  return read.value as T;
}



interface SyntheticLineupNominee {
  readonly name: string;
  readonly partyLabel: string;
  readonly outcome: LineupOutcome;
  readonly candidacyId?: string;
  readonly filingParty?: string;
}

interface SyntheticContest {
  readonly id: string;
  readonly title: string;
  readonly ocdId?: string;
  readonly type?: Contest["type"];
  readonly candidacies?: readonly { readonly id: string; readonly givenName: string; readonly familyName: string; readonly partyLabel?: string | null }[];
  readonly lineup?: readonly SyntheticLineupNominee[];
}

function syntheticAzBallot(contests?: readonly SyntheticContest[]): BallotSet {
  const fixtures = JSON.parse(readFileSync(new URL("./fixtures/synthetic-az-ballots.json", import.meta.url), "utf8")) as Record<string, BallotSet>;
  const ballot = fixtures[JSON.stringify(contests ?? null)];
  if (!ballot) throw new Error("The synthetic Arizona ballot input has no recorded fixture");
  return ballot;
}

async function installBallots(...ballots: BallotSet[]): Promise<GenericBallotProjection> {
  const installed: GenericBallotProjection = { kind: "ballot-contests", ballots: {} };
  for (const ballot of ballots.length ? ballots : [syntheticAzBallot()]) {
    const state = requireBallotState(ballot.election.state);
    const previous = currentReaderAuthorityEdge()?.promoted?.get(`BALLOT_CANDIDACY:${stateBallotScope("ballot-contests", state)}`);
    const current = previous?.kind === "PROMOTED" ? previous.projection.payload as GenericBallotProjection : null;
    const value: GenericBallotProjection = { kind: "ballot-contests", ballots: {
      ...(current?.ballots ?? {}), [ballotElectionKey(ballot)]: ballot,
    } };
    installManualValue(stateBallotContractId("ballot-contests", state), value, `test:ballot-contests:${state}`);
    served(await readGenericBallotProjection(state), `${state} ballot`);
    Object.assign(installed.ballots, value.ballots);
  }
  return installed;
}




const SOURCE = { sourceUrl: "https://filing.example.gov/list", sourceOrg: "Election office", collectedAt: "2026-10-01" };
await installBallots(njMorrisFiling([{
  id: "example-contest", title: "Example Office", ocdId: "ocd-division/country:us/state:nj/county:example",
  candidacies: [
    { id: "ballot-nj-morris:example-a", givenName: "Alex", familyName: "Example" },
    { id: "ballot-nj-morris:example-b", givenName: "Blair", familyName: "Example" },
  ],
}], { contacts: [
  { candidacyId: "ballot-nj-morris:example-a", email: "campaign@example.test", filedAddress: "123 Private Lane, Example City", ...SOURCE },
  { candidacyId: "ballot-nj-morris:example-b", email: null, filedAddress: "456 Private Road, Example City", ...SOURCE },
] }));

test("filing email and its source survive while the filed address cannot reach Ask", () => {
  const contacts = ["ballot-nj-morris:example-a", "ballot-nj-morris:example-b"].map(id => candidateContactForCandidacy("NJ", id)!);
  assert.equal(contacts.length, 2);
  for (const row of contacts) {
    assert.equal(Object.hasOwn(row, "filedAddress"), false, "the reader contact contract carries no address field at all");
    const contact = contactForCandidate("NJ", row.candidacyId, "Candidate", "Office")!;
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
