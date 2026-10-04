import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

await installRegistryRuntimeFirstSeeds();

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
import { initializeFederalVoteFirstSeed } from "./helpers/federal-vote-first-seed.ts";

await initializeFederalVoteFirstSeed();
import { bodyIdentityIndex } from "../lib/ask/body-identity.ts";
import { contactsForBody, contactRecord } from "../lib/ask/contacts.ts";
import { contactForCandidate } from "../lib/ask/candidate-contact.ts";
import { candidateContactCensus, candidateContactForCandidacy } from "../lib/ballot/candidate-contacts.ts";
import { membersOfBody, BODY_COMPOSITIONS } from "../lib/registry/body-membership.ts";
import { readSnapshot } from "../lib/meetings/snapshot.ts";
import type { AskAnswerPayload } from "../lib/ask/answer.ts";
import type { StateMoneyRecord } from "../lib/funding/state-money.ts";
import { resolveSubjectRef } from "../lib/ask/subject.ts";
import { readerPersonKeys } from "../lib/identity/reader-person.ts";
import type { SourceSnapshot, StatementCorpus } from "../lib/corpus/types.ts";

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
const KAREN_CANDIDACY_ID = "ballot-nh-merrimack:state-house-merrimack-7:ebel-karen-elizabeth";

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
  /* No general-model knowledge can supply the factual answer. Since 2026-09-25 a
     named person's campaign-money question is answered in code from the held
     filings (lib/ask/money-answer.ts), exactly as a sitting is: that prose is
     the records' own figures, composed with no model, and nothing else may write. */
  if (body.answer !== null) {
    assert.equal(body.mode, "GROUNDED_COMPOSED", "no general-model knowledge can supply the factual answer");
    assert.equal(body.trace.synthesis.ran, false, "a composed answer, never a model's");
  }
  if (body.records) assert.equal(body.trace.retrieval.recordCount, body.records.length);
  return body;
}

for (const row of [
  { state: "AZ" as const, name: "Katie Hobbs", key: "ballot-az-pima:governor:hobbs-katie", contest: "ballot-az-pima:governor", receipts: 11109719.95, expenditures: 14355612.69 },
  { state: "NJ" as const, name: "Tayfun Selen", key: "ballot-nj-morris:county-commissioner:selen", contest: "ballot-nj-morris:county-commissioner", receipts: 225025.5, expenditures: 229525.5 },
  { state: "NH" as const, name: "Kelly Ayotte", key: "ballot-nh-merrimack:governor:ayotte-kelly", contest: "ballot-nh-merrimack:governor", receipts: 5995303.26, expenditures: 3276135.21 },
]) {
  test(`${row.state}: Ask returns exact canonical campaign totals and provenance from the visual selector`, async () => {
    const body = await ask(`How much campaign money has ${row.name} raised and spent?`, row.state);
    const selected = campaignMoneyForTarget(row.key, row.contest).state.records.find((record) => record.filingState === "FILED")!;
    assert.ok(selected);
    assert.equal(selected.totals.receipts, row.receipts, "independent frozen known-answer anchor");
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
  assert.ok(!JSON.stringify(biggs.records.filter((r) => r.finance)).includes("11109719.95"));
});

test("a direct held federal official remains answerable without a ballot candidacy", async () => {
  const body = await ask("How much campaign money has Mark Kelly raised?");
  assert.equal(body.subject?.id, "congress:K000377");
  const record = body.records.find((record) => record.id.startsWith("fec:"));
  assert.ok(record?.sourceUrl);
  assert.equal(body.denominators.federalFinanceRecordsReturned, 1);
  assert.equal(body.denominators.governorLettersIndexedAtCollection, undefined);
  assert.ok(body.gaps.every((gap) => !/letters about individual bills|bills she signed|executive orders we indexed/.test(gap.statement)), "another office's collection gaps must not attach to this person");
});

test("Ask retrieves the same verbatim candidate passages as Positions in AZ, NJ, and NH", async () => {
  const controls = [
    { state: "AZ" as const, name: "Adelita Grijalva", key: "ballot-az-pima:us-house-7|Adelita Grijalva", topic: "families" },
    { state: "NJ" as const, name: "Analilia Mejia", key: "ballot-nj-morris:us-house-11:mejia", topic: "minimum wage" },
    { state: "NH" as const, name: "Maggie Goodlander", key: "ballot-nh-merrimack:us-house-2:goodlander-maggie", topic: "democracy" },
  ];
  for (const control of controls) {
    const expected = positionsFor(control.key, control.topic, unifiedCorpus());
    assert.equal(expected.kind, "MATCHED", `${control.name}'s independent Positions surface knows the answer`);
    const body = await ask(`What does ${control.name} say about ${control.topic}?`, control.state);
    const quoted = body.records.filter((r) => r.kind === "SOURCE_PASSAGE" && r.canonicalSubjectId === control.key);
    assert.ok(quoted.length, control.name);
    if (control.state === "AZ") {
      assert.ok(body.answer?.includes("own words, exactly as published"));
      assert.ok(body.gaps.every((gap) => !/have not verified a statement by/.test(gap.statement)));
      assert.match(body.trace.synthesis?.why ?? "", /composed-from-own-words/);
      assert.ok(expected.passages.some((passage) => body.answer!.includes(passage.quote)));
    } else if (body.answer) {
      assert.ok(expected.passages.some((passage) => body.answer!.includes(passage.quote)));
    } else {
      // A pack that also contains a differently structured candidate-page
      // passage keeps the existing path; CA-12 only composes clean own-page packs.
      assert.match(body.trace.synthesis?.why ?? "", /unverified-stance/);
    }
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
  const recorded = JSON.parse(readFileSync("data/corpus/statements.json", "utf8")) as StatementCorpus;
  const frozenKaren = recorded.snapshots.find(({ subjectId }) => subjectId === KAREN_RETIRED_ID);
  assert.ok(frozenKaren);
  const canonicalKaren: SourceSnapshot = {
    ...frozenKaren,
    subjectId: KAREN_CANDIDACY_ID,
    id: `${KAREN_CANDIDACY_ID}|${frozenKaren.url}|${frozenKaren.contentHash}`,
  };
  const statement = statementEvidenceFor(
    { id: KAREN_ROLE_ID, name: "Karen Ebel", kind: "PERSON" },
    "What does Karen Ebel say about Hampshire?",
    [KAREN_ROLE_ID, KAREN_CANDIDACY_ID],
    () => ({ snapshots: [canonicalKaren] }),
  );
  assert.ok(statement.records.some((record) =>
    record.kind === "SOURCE_PASSAGE" && record.canonicalSubjectId === KAREN_CANDIDACY_ID
  ));
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
  const snapshot = readSnapshot()!;
  const withMeetings = new Set(snapshot.meetings.map((meeting) => meeting.bodyId));
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
  assert.equal(census.contacts.length, 275);
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
    if (row.filedAddress) assert.ok(!record.text.includes(row.filedAddress));
  }
  assert.equal(candidateContactForCandidacy("ballot-nj-morris:unknown:mejia"), null);
  assert.equal(candidateContactForCandidacy("ballot-az-pima:governor:hobbs-katie"), null);
});

test("the real Ask route carries Mejia's published filing contact with its own provenance", async () => {
  const body = await ask("How can I contact Analilia Mejia?", "NJ");
  const record = body.records.find((record) => record.id === "candidate-contact:ballot-nj-morris:us-house-11:mejia");
  assert.ok(record);
  assert.match(record.text, /info@analiliafornj\.com/);
  assert.doesNotMatch(record.text, /13 Municipal Plaza/);
  assert.doesNotMatch(JSON.stringify(body), /13 Municipal Plaza/, "CP-01 keeps filed mailing addresses out of the whole Ask answer");
  assert.equal(record.sourceOrg, "Morris County Clerk");
  // The contact's own provenance is the held filing document, whichever edition of the clerk's list the
  // seed mirrors (the clerk republished it on 2026-09-24), never a pinned filename that goes stale.
  const held = (JSON.parse(readFileSync("data/states/nj/ballot/nj-morris-2026-contacts.json", "utf8")) as {
    contacts: { candidacyId: string; sourceUrl: string }[];
  }).contacts.find((contact) => contact.candidacyId === "ballot-nj-morris:us-house-11:mejia");
  assert.ok(held);
  assert.match(held.sourceUrl, /^https:\/\/www\.morriscountyclerk\.org\/.+\.pdf$/);
  assert.equal(record.sourceUrl, held.sourceUrl);
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
