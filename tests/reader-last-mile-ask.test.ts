import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "./helpers/playbooks.ts";
import type { CandidateDocument } from "../lib/candidates/corpus.ts";
import {
  installAzBallot,
  installCandidateCorpus,
  installFederalVotes,
  installOfficeholderStatements,
  installRegistryAuthority,
  installStateMoney,
  stateMoneyFixture,
  syntheticCandidateCorpus,
  syntheticFiledStateMoneyRecord,
} from "./helpers/promoted-fixtures.ts";
import {
  installMeetings,
  installNhBallot,
  installNjMorrisFiling,
  nhBallot,
  njMorrisFiling,
  recordedMeetings85701,
  servableAzBallot,
  withAzMeasures,
} from "./helpers/reader-fixtures.ts";

await installRegistryAuthority();

import { campaignMoneyForTarget } from "../lib/funding/campaign-money.ts";
import { canonicalOfficialAliases } from "../lib/ask/official-identity.ts";
import { BALLOT_SOURCES } from "../lib/ballot/registry.ts";
import { loadBallotForDivisions } from "../lib/ask/server-sources.ts";
import { ballotAskInventory, ballotRecordsFor } from "../lib/ask/ballot-inventory.ts";
import { campaignMoneyEvidenceFor } from "../lib/ask/campaign-money.ts";
import { statementEvidenceFor } from "../lib/ask/statements.ts";
import { unifiedCorpus } from "../lib/corpus/unified.ts";
import { positionsFor } from "../lib/corpus/positions.ts";
import { voteEvidenceFor } from "../lib/ask/votes.ts";
import { bodyIdentityIndex } from "../lib/ask/body-identity.ts";
import { contactsForBody, contactRecord } from "../lib/ask/contacts.ts";
import { contactForCandidate } from "../lib/ask/candidate-contact.ts";
import { candidateContactCensus, candidateContactForCandidacy } from "../lib/ballot/candidate-contacts.ts";
import { membersOfBody, BODY_COMPOSITIONS } from "../lib/registry/body-membership.ts";
import type { AskAnswerPayload } from "../lib/ask/answer.ts";
import type { StateMoneyRecord } from "../lib/funding/state-money.ts";
import { resolveSubjectRef } from "../lib/ask/subject.ts";
import { readerPersonKeys } from "../lib/identity/reader-person.ts";

/*
 * Synthetic ballots for the three pilot counties, each race named by the canonical contest key the reader
 * uses; synthetic finance holdings for one candidacy per state; the federal votes, statement and publication
 * holdings; and the recorded 85701 meetings. Names on the ballots are the registry's own officeholders or
 * labelled test candidates; every total, address and passage is synthetic.
 */
const FINANCE = {
  AZ: { key: "ballot-az-pima:governor:hobbs-katie", receipts: 2_000_000, expenditures: 1_000_000 },
  NJ: { key: "ballot-nj-morris:county-commissioner:selen", receipts: 30_000, expenditures: 15_000 },
  NH: { key: "ballot-nh-merrimack:governor:ayotte-kelly", receipts: 400_000, expenditures: 200_000 },
} as const;
const PROP_425_NO = "A NO vote shall keep the current law unchanged (synthetic test measure).";
const azBallot = withAzMeasures(servableAzBallot([
  {
    id: "ballot-az-pima:governor",
    title: "Governor",
    candidacies: [
      { id: "ballot-az-pima:governor:hobbs-katie", givenName: "Katie", familyName: "Hobbs" },
      { id: "ballot-az-pima:governor:biggs-andy", givenName: "Andy", familyName: "Biggs" },
    ],
    lineup: [
      { name: "Katie Hobbs", partyLabel: "Democratic", outcome: "RECONCILED", candidacyId: "ballot-az-pima:governor:hobbs-katie" },
      { name: "Andy Biggs", partyLabel: "Republican", outcome: "RECONCILED", candidacyId: "ballot-az-pima:governor:biggs-andy" },
    ],
  },
  {
    id: "ballot-az-pima:us-house-7",
    title: "U.S. Representative",
    ocdId: "ocd-division/country:us/state:az/cd:7",
    candidacies: [{ id: "ballot-az-pima:us-house-7:grijalva-adelita", givenName: "Adelita", familyName: "Grijalva" }],
    lineup: [{ name: "Adelita Grijalva", partyLabel: "Democratic", outcome: "RECONCILED", candidacyId: "ballot-az-pima:us-house-7:grijalva-adelita" }],
  },
]), [
  { id: "ballot-az-pima:prop-425", title: "Proposition 425", ocdId: "ocd-division/country:us/state:az", measure: { questionText: "Shall the synthetic test measure 425 be adopted?", officialNumber: "425" } },
  { id: "ballot-az-pima:prop-141", title: "Proposition 141", ocdId: "ocd-division/country:us/state:az", measure: { questionText: "Shall the synthetic test measure 141 be adopted?", officialNumber: "141" } },
], [
  { contestId: "ballot-az-pima:prop-425", whatItDoes: "Synthetic test measure 425.", yesMeans: "A YES vote shall adopt the synthetic test measure.", noMeans: PROP_425_NO,
    parts: [], sourceUrl: "https://example.test/prop-425", sourceHash: "4".repeat(64), writtenAt: "2026-09-20T00:00:00.000Z" },
  { contestId: "ballot-az-pima:prop-141", whatItDoes: "Synthetic test measure 141.", yesMeans: null, noMeans: null,
    parts: [], sourceUrl: "https://example.test/prop-141", sourceHash: "1".repeat(64), writtenAt: "2026-09-20T00:00:00.000Z" },
]);
await installAzBallot(azBallot);
const MEJIA = "ballot-nj-morris:us-house-11:mejia";
const SELEN = "ballot-nj-morris:county-commissioner:selen";
const morris = njMorrisFiling([
  { id: "ballot-nj-morris:county-commissioner", title: "Member of the Board of County Commissioners", ocdId: "ocd-division/country:us/state:nj/county:morris",
    candidacies: [
      { id: "ballot-nj-morris:county-commissioner:selen", givenName: "Tayfun", familyName: "Selen" },
      { id: "ballot-nj-morris:county-commissioner:example", givenName: "Jordan", familyName: "Example" },
    ] },
  { id: "ballot-nj-morris:us-house-11", title: "Member of the House of Representatives", ocdId: "ocd-division/country:us/state:nj/cd:11",
    candidacies: [{ id: MEJIA, givenName: "Analilia", familyName: "Mejia" }] },
  { id: "ballot-nj-morris:us-house-7", title: "Member of the House of Representatives", ocdId: "ocd-division/country:us/state:nj/cd:7",
    candidacies: [{ id: "ballot-nj-morris:us-house-7:current", givenName: "Riley", familyName: "Current" }] },
  { id: "ballot-nj-morris:rockaway-township-council", title: "Township Council", ocdId: "ocd-division/country:us/state:nj/county:morris/place:rockaway_township",
    candidacies: [
      { id: "ballot-nj-morris:rockaway-township-council:alpha", givenName: "Avery", familyName: "Alpha" },
      { id: "ballot-nj-morris:rockaway-township-council:beta", givenName: "Blair", familyName: "Beta" },
    ] },
], {
  removals: [{
    id: "ballot-nj-morris:us-house-7:withdrawn", contestId: "ballot-nj-morris:us-house-7", givenName: "Quinn", familyName: "Withdrawn",
    partyLabel: null, slogan: null, status: "REMOVED_FROM_FILING",
    lastListed: { sourceUrl: "https://example.test/morris-filing-august.pdf", sourceOrg: "Synthetic test clerk", collectedAt: "2026-08-20", verifiedAt: null },
    absentFrom: { sourceUrl: "https://example.test/morris-filing-september.pdf", sourceOrg: "Synthetic test clerk", collectedAt: "2026-09-10", verifiedAt: null },
    firstAbsentOn: "2026-09-10",
    statement: "Quinn Withdrawn was listed on the August filing and is absent from the September filing (synthetic test).",
  }],
  contacts: [
    { candidacyId: MEJIA, email: null, filedAddress: "1 Filed Address Way (test)",
      sourceUrl: "https://example.test/morris-filing-september.pdf", sourceOrg: "Synthetic test clerk", collectedAt: "2026-09-10" },
    { candidacyId: SELEN, email: "candidate@example.test", filedAddress: "2 Filed Address Way (test)",
      sourceUrl: "https://example.test/morris-filing-september.pdf", sourceOrg: "Synthetic test clerk", collectedAt: "2026-09-10" },
  ],
});
await installNjMorrisFiling(morris);
await installNhBallot(nhBallot([
  { id: "ballot-nh-merrimack:governor", title: "Governor", ocdId: "ocd-division/country:us/state:nh",
    candidacies: [{ id: "ballot-nh-merrimack:governor:ayotte-kelly", givenName: "Kelly", familyName: "Ayotte" }] },
  { id: "ballot-nh-merrimack:us-house-2", title: "Representative in Congress", ocdId: "ocd-division/country:us/state:nh/cd:2",
    candidacies: [{ id: "ballot-nh-merrimack:us-house-2:goodlander-maggie", givenName: "Maggie", familyName: "Goodlander" }] },
]));
for (const state of ["AZ", "NJ", "NH"] as const) {
  const record = syntheticFiledStateMoneyRecord(state, FINANCE[state].key, FINANCE[state].receipts);
  const fixture = stateMoneyFixture(state);
  const others = fixture.records.filter((row) => !row.targetKeys.includes(FINANCE[state].key));
  await installStateMoney(state, { ...fixture, records: [...others,
    { ...record, totals: { ...record.totals, expenditures: FINANCE[state].expenditures } }] });
}
await installFederalVotes();
await installOfficeholderStatements();
// The synthetic publication corpus plus one synthetic campaign page per positions control.
const page = (candidateKey: string, url: string, text: string): CandidateDocument => {
  const contentHash = createHash("sha256").update(text).digest("hex");
  return { id: `${candidateKey}@${contentHash}`, candidateKey, sourceClass: "CAMPAIGN_SITE", basis: "HUNTED_AND_VERIFIED", metaDescription: null,
    documentUrl: url, contentHash, retrievedAt: "2026-09-20T00:00:00.000Z", contentType: "text/html", text, extraction: "html", extractionNote: null };
};
const corpus = syntheticCandidateCorpus();
const POSITION_CONTROLS = [
  { state: "AZ" as const, name: "Katie Hobbs", key: "ballot-az-pima:governor|Katie Hobbs", topic: "families" },
  { state: "NJ" as const, name: "Tayfun Selen", key: SELEN, topic: "minimum wage" },
  { state: "NH" as const, name: "Kelly Ayotte", key: "ballot-nh-merrimack:governor:ayotte-kelly", topic: "democracy" },
];
const controlPages = [
  page(POSITION_CONTROLS[0].key, "https://example.test/az-governor/",
    "Working families deserve a fair shot. I will fight for families in every neighborhood of this state, so that families can afford housing, health care and child care. This is a synthetic test page."),
  page(POSITION_CONTROLS[1].key, "https://example.test/nj-commissioner/",
    "Raise the minimum wage. Every worker should earn a living wage, and I will vote to raise the minimum wage to keep pace with costs. This is a synthetic test page written for a check."),
  page(POSITION_CONTROLS[2].key, "https://example.test/nh-governor/",
    "Protect our democracy. I will defend democracy, protect the right to vote, and keep our elections free and fair for every citizen. This is a synthetic test page written for a check."),
];
await installCandidateCorpus({ ...corpus, attempted: corpus.attempted + controlPages.length, documents: [...corpus.documents, ...controlPages] });
installMeetings(recordedMeetings85701());

delete process.env.ANTHROPIC_API_KEY;
const { POST } = await import("../app/api/ask/grounded/route.ts");
const { resetGroundedState } = await import("../lib/ask/grounded-state.ts");
const { settleGroundedSourcePreloads } = await import("../lib/ask/grounded-preloads.ts");
const AZ = "ocd-division/country:us/state:az";
const NJ = "ocd-division/country:us/state:nj";
const NH = "ocd-division/country:us/state:nh";
const divisions = {
  AZ: [AZ, `${AZ}/county:pima`, `${AZ}/place:tucson`, `${AZ}/cd:7`, `${AZ}/sldu:20`, `${AZ}/sldl:20`],
  NJ: [NJ, `${NJ}/county:morris`, `${NJ}/county:morris/place:rockaway_township`, `${NJ}/cd:11`],
  NH: [NH, `${NH}/county:merrimack`, `${NH}/county:merrimack/place:newbury_town`, `${NH}/cd:2`, `${NH}/sldu:7`],
};

const KAREN_RETIRED_ID = "plural:947e2e2b-04eb-4f92-9f83-aef8760517e0";
const KAREN_ROLE_ID = "roster:merrimack-delegation#5";

test("an unresolved supplied canonical ID never becomes a same-name candidate through surface or prior context", async () => {
  const canonical = { id: "ballot-az-pima:governor:hobbs-katie", name: "Katie Hobbs", nameClass: "person" as const };
  const unresolved = { id: "unresolved:former-candidate", name: "Katie Hobbs", kind: "PERSON" as const, focused: true };
  assert.equal(resolveSubjectRef(unresolved, [canonical]), null);
  assert.equal(resolveSubjectRef({ ...unresolved, id: canonical.id }, [canonical]), canonical);
  assert.equal(resolveSubjectRef({ name: canonical.name, kind: "PERSON" }, [canonical]), canonical, "a surface that genuinely holds only a name retains the normal name binder");
  for (const extra of [{ activeSubjects: [unresolved] }, { priorSubjects: [unresolved] }]) {
    const answer = await ask("How much campaign money has this person raised and spent?", "AZ", extra);
    assert.notEqual(answer.subject?.id, canonical.id);
    assert.ok(answer.records.every((record) => record.canonicalSubjectId !== canonical.id && !record.id.includes(canonical.id)));
    assert.equal(answer.mode, "UNRESOLVED");
    assert.equal(answer.denominators.identityUnresolved, 1);
    assert.equal(answer.records.length, 0);
  }
});

test("a sourced removed filing reaches only its contest or former candidacy, with both documents and no current-candidate claim", async () => {
  const ocdIds = [NJ, `${NJ}/cd:7`];
  const ballot = await loadBallotForDivisions(ocdIds);
  const set = ballot.set!;
  const removal = set.removals![0];
  const inventory = ballotAskInventory(set, ballot.contests, ballot.nominees);
  const former = inventory.subjects.get(removal.id)!;
  assert.equal(former.removedFromFiling, true);
  const evidence = ballotRecordsFor(former, { set, contests: ballot.contests, absences: ballot.absences });
  assert.equal(evidence.records.length, 2);
  assert.ok(evidence.records.every((record) => record.kind === "BALLOT_ABSENCE"));
  assert.deepEqual(evidence.records.map((record) => record.sourceUrl).sort(), [removal.lastListed.sourceUrl, removal.absentFrom.sourceUrl].sort());
  const answer = await ask("What happened to this filing?", "NJ", { ocdIds, activeSubjects: [{ kind: "PERSON", id: removal.id, name: former.name, focused: true }] });
  assert.equal(answer.subject?.id, removal.id);
  assert.ok(answer.records.some((record) => record.id === removal.id && record.text === removal.statement));
  assert.ok(answer.records.every((record) => record.kind !== "CANDIDACY"));
  const contest = await ask("Who is running for U.S. House District 7?", "NJ", { ocdIds });
  assert.ok(contest.records.some((record) => record.id === removal.id));
  const current = set.candidacies.find((candidacy) => candidacy.contestId === removal.contestId)!;
  const currentAnswer = await ask("Who is this candidate?", "NJ", { ocdIds, activeSubjects: [{ kind: "PERSON", id: current.id, name: `${current.givenName} ${current.familyName}`, focused: true }] });
  assert.ok(currentAnswer.records.every((record) => record.id !== removal.id && !record.text.includes(removal.statement)));
});
async function ask(question: string, state: keyof typeof divisions = "AZ", extra: Record<string, unknown> = {}): Promise<AskAnswerPayload> {
  resetGroundedState();
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "reader-last-mile-ask" },
    body: JSON.stringify({ question, surface: "BALLOT", ocdIds: divisions[state], today: "2026-09-04", ...extra }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as AskAnswerPayload;
  /* A named person's campaign-money question is composed in code from the held filings, never by a model. */
  if (body.answer !== null) {
    assert.equal(body.mode, "GROUNDED_COMPOSED", "no general-model knowledge can supply the factual answer");
    assert.equal(body.trace.synthesis.ran, false, "a composed answer, never a model's");
  }
  if (body.records) assert.equal(body.trace.retrieval.recordCount, body.records.length);
  return body;
}

test("returned county-board question names the same held candidates as the ballot", async () => {
  const ballot = await loadBallotForDivisions(divisions.NJ);
  const contest = ballot.contests.find(row => /Board of County Commissioners/i.test(row.title))!;
  const candidates = ballot.set!.candidacies.filter(row => row.contestId === contest.id);
  assert.ok(candidates.length > 0);
  const answer = await ask("Who is running for Morris County Board of County Commissioners?", "NJ");
  for (const candidate of candidates) assert.ok(answer.answer?.includes(`${candidate.givenName} ${candidate.familyName}`), answer.answer ?? "no answer");
  assert.equal(answer.trace.synthesis.ran, false);
});

test("returned NO-vote question quotes its own official ballot sentence with no model reconstruction", async () => {
  const ballot = await loadBallotForDivisions(divisions.AZ);
  const meaning = ballot.measureSummary("ballot-az-pima:prop-425")!.noMeans!;
  assert.ok(meaning);
  const answer = await ask("What does a NO vote on Proposition 425 mean?");
  assert.equal(answer.answer, `NO: ${meaning}`);
  assert.equal(answer.trace.synthesis.ran, false);
});

test("a held measure without a NO meaning reports the blank instead of asking a model to invent it", async () => {
  resetGroundedState();
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "reader-last-mile-ask" },
    body: JSON.stringify({ question: "What does a NO vote on Proposition 141 mean?", surface: "BALLOT", ocdIds: divisions.AZ }),
  }));
  assert.equal(response.status, 200);
  const answer = await response.json() as AskAnswerPayload;
  assert.equal(answer.answer, "We're working on getting this info");
  assert.equal(answer.trace.synthesis.ran, false);
  assert.equal(answer.trace.synthesis.why, "measure-vote-meaning-not-held");
});

for (const row of [
  { state: "AZ" as const, name: "Katie Hobbs", key: FINANCE.AZ.key, contest: "ballot-az-pima:governor", receipts: FINANCE.AZ.receipts, expenditures: FINANCE.AZ.expenditures },
  { state: "NJ" as const, name: "Tayfun Selen", key: FINANCE.NJ.key, contest: "ballot-nj-morris:county-commissioner", receipts: FINANCE.NJ.receipts, expenditures: FINANCE.NJ.expenditures },
  { state: "NH" as const, name: "Kelly Ayotte", key: FINANCE.NH.key, contest: "ballot-nh-merrimack:governor", receipts: FINANCE.NH.receipts, expenditures: FINANCE.NH.expenditures },
]) {
  test(`${row.state}: Ask returns exact canonical campaign totals and provenance from the visual selector`, async () => {
    const body = await ask(`How much campaign money has ${row.name} raised and spent?`, row.state);
    const selected = campaignMoneyForTarget(row.key, row.contest).state.records.find((record) => record.filingState === "FILED")!;
    assert.ok(selected);
    assert.equal(selected.totals.receipts, row.receipts, "the installed holding is the known answer");
    assert.equal(selected.totals.expenditures, row.expenditures);
    const record = body.records.find((record) => record.canonicalSubjectId === row.key && record.finance);
    assert.ok(record, "canonical identity survives into the real route payload");
    assert.deepEqual(record.finance!.totals, selected.totals);
    assert.equal(record.sourceUrl, selected.filingsUrl ?? selected.provenance.sourceUrl);
    assert.equal(record.retrievedAt, selected.checkedAt);
    assert.equal(body.denominators.stateFinanceRecordsReturned, body.records.filter((r) => r.finance).length);
    assert.ok(body.records.filter((record) => record.finance).every((record) => record.finance!.filingState === "FILED"), "a held filing cannot be contradicted by the fallback agency-absence row");
    // The composed answer states exactly the selector's figures.
    const dollars = (amount: number) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    assert.ok((body.answer ?? "").includes(`raising ${dollars(row.receipts)} and spending ${dollars(row.expenditures)}`), body.answer ?? "no answer");
    if (row.state !== "AZ") {
      assert.doesNotMatch(body.gaps.map((gap) => gap.statement).join(" "), /Pima County|Arizona legislature|bills she signed|her letters|executive orders/i,
        "an unrelated state's action and county-finance diagnostics cannot contaminate the answer");
    }
  });
}

test("Hobbs ballot and map Ask answers share canonical candidacy and values; Biggs never inherits Hobbs money", async () => {
  const ballot = await ask("How much campaign money has Katie Hobbs raised?");
  const map = await ask("How much campaign money has Katie Hobbs raised?", "AZ", { surface: "MAP" });
  assert.deepEqual(ballot.records.filter((r) => r.finance), map.records.filter((r) => r.finance));
  const biggs = await ask("How much campaign money has Andy Biggs raised?");
  assert.ok(biggs.records.every((r) => r.canonicalSubjectId !== "ballot-az-pima:governor:hobbs-katie"));
  assert.ok(!JSON.stringify(biggs.records.filter((r) => r.finance)).includes(String(FINANCE.AZ.receipts)));
});

test("a direct held federal official remains answerable without a ballot candidacy", async () => {
  const body = await ask("How much campaign money has Mark Kelly raised?");
  assert.equal(body.subject?.id, "congress:K000377");
  const record = body.records.find((record) => record.id.startsWith("fec:"));
  assert.ok(record?.sourceUrl, JSON.stringify({ gaps: body.gaps, denominators: body.denominators, preloads: body.trace.preloadSources }));
  assert.equal(body.denominators.federalFinanceRecordsReturned, 1);
  assert.equal(body.denominators.governorLettersIndexedAtCollection, undefined);
  assert.ok(body.gaps.every((gap) => !/letters about individual bills|bills she signed|executive orders we indexed/.test(gap.statement)), "another office's collection gaps must not attach to this person");
});

test("Ask retains Positions' exact page passages in AZ, NJ, and NH without inventing speaker attribution", async () => {
  for (const control of POSITION_CONTROLS) {
    const expected = positionsFor(control.key, control.topic, unifiedCorpus());
    assert.equal(expected.kind, "MATCHED", `${control.name}'s independent Positions surface knows the answer`);
    const body = await ask(`What does ${control.name} say about ${control.topic}?`, control.state);
    const quoted = body.records.filter((r) => r.kind === "SOURCE_PASSAGE" && r.canonicalSubjectId === control.key);
    assert.ok(quoted.length, control.name);
    assert.ok(quoted.every(record => record.verifiedStatement === undefined), "the fixtures establish captured pages, not verified speakers");
    assert.equal(body.trace.synthesis?.why, "no-key", "the stance question goes to the writer with its held passages, like any other");
    assert.ok(body.gaps.every((gap) => !/personal stance/.test(gap.statement)), JSON.stringify(body.gaps));
    for (const passage of expected.passages) {
      assert.ok(quoted.some((r) => r.text.includes(passage.quote) && r.sourceUrl === passage.url), passage.snapshotId);
    }
  }
});

test("each readable canonical statement subject can be searched without a general-knowledge answer", () => {
  const corpus = unifiedCorpus();
  const bySubject = new Map(corpus.snapshots.filter((s) => s.extraction === "ok" && s.text).map((s) => [s.subjectId, s]));
  let tested = 0;
  for (const [key, snapshot] of bySubject) {
    const words = [...new Set(snapshot.text!.match(/\b[A-Za-z]{5,}\b/g) ?? [])];
    const topic = words.find((word) => positionsFor(key, word, corpus).kind === "MATCHED");
    if (!topic) continue; // Held navigation-only text is not a quotable position.
    const result = statementEvidenceFor({ kind: "PERSON", id: key, name: "This person" }, `What is the position on ${topic}?`, [key]);
    assert.ok(result.records.length, key);
    assert.ok(result.records.every((r) => readerPersonKeys(key).keys.includes(r.canonicalSubjectId!) && r.sourceUrl));
    assert.ok(result.records.every((r) => /Searching a held (campaign|official) page linked to/.test(r.text) &&
      /captured version|Source version status unknown/.test(r.text) &&
      /does not establish a personal stance/.test(r.text)), key);
    tested += 1;
  }
  assert.ok(tested >= 40, `real current corpus: ${tested} subjects with quotable passages`);
});

test("direct official vote IDs never fall through to another same-name person", () => {
  const missing = voteEvidenceFor("Andy Biggs", { officeholderId: "congress:DOES_NOT_EXIST" });
  assert.equal(missing.identity.kind, "NO_ROSTER_ROW");
  assert.equal(missing.records.length, 0);
  const known = voteEvidenceFor("the card's display name", { officeholderId: "congress:B001302" });
  assert.equal(known.identity.kind, "JOINED");
  assert.ok(known.records.length > 0);
});

test("multiple verified roles share an Ask subject only through the committed person bridge", async () => {
  const aliases = canonicalOfficialAliases([KAREN_RETIRED_ID, KAREN_ROLE_ID, "unresolved:Karen Ebel"], [KAREN_ROLE_ID]);
  assert.equal(aliases.get(KAREN_ROLE_ID), KAREN_ROLE_ID);
  assert.equal(aliases.has(KAREN_RETIRED_ID), false, "the retired intermediary identity cannot win the Reader subject");
  assert.equal(aliases.has("unresolved:Karen Ebel"), false);
  const body = await ask("What does Karen Ebel say about Hampshire?", "AZ", {
    surface: "MAP",
    activeSubjects: [{ id: KAREN_ROLE_ID, name: "Karen Ebel", kind: "PERSON", focused: true }],
  });
  assert.equal(body.subject?.id, KAREN_ROLE_ID);
  assert.ok(body.records.every((record) =>
    record.canonicalSubjectId !== KAREN_RETIRED_ID && !record.id.includes(KAREN_RETIRED_ID)
  ));
  assert.ok(body.gaps.every((gap) => !/bills she signed|letters about individual bills/.test(gap.statement)));
});

test("raw acquisition, extraction PASS, and unresolved finance never become a state-money answer", () => {
  const held = campaignMoneyForTarget("ballot-az-pima:governor:hobbs-katie", "ballot-az-pima:governor");
  const filed = held.state.records[0];
  for (const filingState of ["LEAD", "ROUTE_UNREAD", "ACQUIRED", "VALIDATOR_PASS_AUDITOR_INCONCLUSIVE", "IDENTITY_UNRESOLVED"]) {
    const result = campaignMoneyEvidenceFor({ kind: "PERSON", id: "unverified", name: "Unverified candidate" }, "unverified", undefined, () => ({
      ...held, federal: { kind: "none" }, state: { ...held.state, records: [{ ...filed, filingState } as StateMoneyRecord] },
    }));
    assert.equal(result.records.length, 0, filingState);
  }
  const unresolved = campaignMoneyEvidenceFor({ kind: "PERSON", id: "unknown", name: "Unknown person" }, "unknown", undefined, () => ({ ...held, federal: { kind: "none" }, state: { ...held.state, records: [] }, officialIdentity: "IDENTITY_UNRESOLVED" }));
  assert.equal(unresolved.records.length, 0);
  assert.equal(unresolved.denominators.financeIdentityUnresolved, 1);
  assert.ok(unresolved.gaps.some((g) => /not established/.test(g.statement)));
});

test("a failed corpus read has its own state, distinct from no held statement", () => {
  const result = statementEvidenceFor({ kind: "PERSON", id: "held", name: "Held person" }, "What is their position on housing?", ["held"], () => { throw new Error("missing deployed file"); });
  assert.equal(result.records.length, 0);
  assert.equal(result.denominators.statementLoaderFailures, 1);
  assert.match(result.gaps[0].statement, /could not be read/);
});

test("one canonical Reader preload failure cannot reject or suppress an unrelated preload", async () => {
  let unaffectedRan = false;
  const outcomes = await settleGroundedSourcePreloads([
    async () => { throw new Error("planted statement authority failure"); },
    async () => { unaffectedRan = true; return "unrelated ballot authority remains readable"; },
  ]);
  assert.equal(unaffectedRan, true);
  assert.deepEqual(outcomes.map(({ status }) => status), ["rejected", "fulfilled"]);
  assert.equal(outcomes[1]?.status === "fulfilled" ? outcomes[1].value : null, "unrelated ballot authority remains readable");
});

test("an unreadable applicable ballot is a failed holding, never an empty civic population", async () => {
  const source = BALLOT_SOURCES.find((source) => source.state === "nj")!.source;
  const fetch = source.fetch;
  try {
    source.fetch = async () => { throw new Error("Planted canonical holding unavailable"); };
    const ballot = await loadBallotForDivisions(divisions.NJ);
    assert.equal(ballot.set, null);
    assert.deepEqual(ballot.loaderFailures, ["nj"]);
    const body = await ask("Who is running for U.S. House in the 11th District?", "NJ");
    assert.equal(body.denominators.ballotLoaderFailures, 1);
    assert.ok(body.gaps.some((gap) => gap.whose === "OURS" && /couldn't load the ballot for your area/.test(gap.statement)));
    const unaffected = await loadBallotForDivisions(divisions.AZ);
    assert.ok(unaffected.set);
    assert.deepEqual(unaffected.loaderFailures, []);
  } finally { source.fetch = fetch; }
});

test("the canonical body inventory remains available where no meeting has been acquired", async () => {
  const withMeetings = new Set(recordedMeetings85701().map((meeting) => meeting.bodyId));
  const body = [...bodyIdentityIndex().values()].find((body) => body.ocdId?.startsWith(AZ) && body.nameIsBodysOwn && body.sourceUrl && !withMeetings.has(body.bodyId));
  assert.ok(body);
  const result = await ask("When does it meet?", "AZ", { ocdIds: [body.ocdId], activeSubjects: [{ id: body.bodyId, name: body.name, kind: "BODY", focused: true }] });
  assert.equal(result.subject?.id, body.bodyId);
  assert.ok(result.records.some((r) => r.kind === "BODY" && r.id === body.bodyId));
  assert.equal(result.denominators.meetingsHeldForThisBody, 0);
});

test("Ask has no import path to the unpromoted autonomous evidence store", () => {
  for (const path of ["lib/ask/campaign-money.ts", "lib/ask/statements.ts", "lib/ask/server-sources.ts", "app/api/ask/grounded/route.ts"]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /(?:from|import\()[^\n]*(?:autonomous-agent-fleet|health\/autonomous|control-plane\/workers|vault)/);
  }
});

test("Ask body contacts use every explicit legal composition while unrelated advisory bodies inherit nobody", () => {
  for (const composition of BODY_COMPOSITIONS) {
    const body = bodyIdentityIndex().get(composition.bodyId);
    assert.ok(body, composition.bodyId);
    const expected = membersOfBody(composition.bodyId);
    const actual = contactsForBody(body, body.name);
    assert.deepEqual(actual.map((contact) => contact.id).sort(), expected.members.map((member) => member.id).sort(), composition.bodyId);
    if (expected.authority && actual.length) assert.ok(actual.every((contact) => contact.sourceUrl === expected.authority!.sourceUrl));
  }
  const cawcd = bodyIdentityIndex().get(`${AZ}/county:pima#central-arizona-water-conservation-district`)!;
  assert.equal(contactsForBody(cawcd, cawcd.name).length, 15);
  const advisory = [...bodyIdentityIndex().values()].find((body) => body.name === "Design Review Board" && body.ocdId === `${AZ}/place:tucson`)!;
  assert.ok(advisory);
  assert.equal(contactsForBody(advisory, advisory.name).length, 0);
});

test("a congressional office's everyday name reaches the same canonical contest in every pilot state", async () => {
  for (const control of [
    { state: "AZ" as const, district: "7th", id: "ballot-az-pima:us-house-7" },
    { state: "NJ" as const, district: "11th", id: "ballot-nj-morris:us-house-11" },
    { state: "NH" as const, district: "2nd", id: "ballot-nh-merrimack:us-house-2" },
  ]) {
    const body = await ask(`Who is running for U.S. House in the ${control.district} District?`, control.state);
    assert.equal(body.subject?.id, control.id);
    assert.ok(body.records.some((r) => r.kind === "CANDIDACY"));
  }
});

test("filed candidate email and source survive Ask projection while mailing addresses stay out", () => {
  const census = candidateContactCensus();
  assert.equal(census.contacts.length, morris.contacts.contacts.length);
  assert.equal(census.withheld.length, 0);
  for (const row of census.contacts) {
    const contact = contactForCandidate(row.candidacyId, "Filed candidate", "Filed office");
    assert.ok(contact, row.candidacyId);
    assert.equal(contact.email, row.email);
    assert.equal(Object.hasOwn(contact, "filedAddress"), false);
    const record = contactRecord(contact);
    assert.equal(record.sourceUrl, row.sourceUrl);
    assert.equal(record.retrievedAt, row.collectedAt);
    if (row.email) assert.ok(record.text.includes(row.email));
    assert.equal(Object.hasOwn(row, "filedAddress"), false, "the reader contact census carries no filed address");
  }
  assert.equal(candidateContactForCandidacy("ballot-nj-morris:unknown:mejia"), null);
  assert.equal(candidateContactForCandidacy("ballot-az-pima:governor:hobbs-katie"), null);
});

test("the real Ask route carries a candidate's published filing contact with its own provenance", async () => {
  const filed = morris.contacts.contacts.find((row) => row.candidacyId === SELEN)!;
  const body = await ask("How can I contact Tayfun Selen?", "NJ");
  const record = body.records.find((record) => record.id === `candidate-contact:${SELEN}`);
  assert.ok(record);
  assert.ok(record.text.includes(filed.email!));
  assert.ok(!record.text.includes(filed.filedAddress!));
  assert.ok(!JSON.stringify(body).includes(filed.filedAddress!), "filed mailing addresses stay out of the whole Ask answer");
  assert.equal(record.sourceOrg, filed.sourceOrg);
  assert.equal(record.sourceUrl, filed.sourceUrl);
});

test("Ask's local council answer lists the same held candidates as the reader ballot", async () => {
  const source = BALLOT_SOURCES.find(source => source.state === "nj")!.source;
  const all = source.normalize(await source.fetch());
  const local = all.contests.find(contest => contest.type === "CANDIDACY" && /council/i.test(contest.title))!;
  const ocdIds = [NJ, local.ocdId];
  const ballot = await loadBallotForDivisions(ocdIds);
  const contests = ballot.contests.filter(c => c.type === "CANDIDACY" && /council/i.test(c.title));
  assert.ok(contests.length > 0);
  const expected = ballot.set!.candidacies.filter(c => contests.some(contest => contest.id === c.contestId));
  const answer = await ask("Who is running for council?", "NJ", { ocdIds });
  assert.ok(answer.answer);
  const actual = answer.records.filter(record => record.kind === "CANDIDACY");
  assert.equal(actual.length, expected.length);
  for (const candidate of expected) {
    assert.ok(actual.some(record => record.id.startsWith(`${candidate.contestId}|`) &&
      record.text.toLowerCase().includes(candidate.familyName.toLowerCase())));
  }
  assert.equal(answer.trace?.composition?.kind, "BALLOT");
});
