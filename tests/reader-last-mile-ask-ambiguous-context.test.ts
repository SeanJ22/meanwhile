import assert from "node:assert/strict";
import test from "./helpers/playbooks.ts";
import { resolveInterpretation } from "../lib/ask/resolve.ts";
import { unavailableInterpretation } from "../lib/ask/intent.ts";
import { readerPersonKeys } from "../lib/identity/reader-person.ts";
import { lineupRowForCard } from "../lib/identity/az-2026.ts";
import { askResponseText, type AskAnswerPayload } from "../lib/ask/answer.ts";
import { bindNamedEntity } from "../lib/routing/named-entity.ts";
import { createHash } from "node:crypto";
import { installOfficeholderStatements, installRegistryAuthority, syntheticCandidateCorpus } from "./helpers/promoted-fixtures.ts";
import { syntheticCandidateCard, candidateProfilesFor } from "./helpers/reader-fixtures.ts";
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
import type { CandidateCorpus } from "../lib/candidates/corpus.ts";
import { readStateAuthorityProjection } from "../lib/civic-data/state-reader.ts";
import type { CandidateProfilesProjection } from "../lib/civic-data/manual-projections.ts";

async function installCandidateProfiles(value: CandidateProfilesProjection, state = "AZ"): Promise<CandidateProfilesProjection> {
  installManualValue(stateBallotContractId("candidate-profiles", state), value, `test:candidate-profiles:${state}`);
  const read = (await readStateAuthorityProjection("candidate-profiles", state)).result;
  if (read.kind !== "PROMOTED") throw new Error(`Candidate profiles fixture did not install: ${read.kind}`);
  return value;
}

async function installCandidateCorpus(value: CandidateCorpus = syntheticCandidateCorpus(), state = "AZ"): Promise<CandidateCorpus> {
  installManualValue(stateBallotContractId("candidate-corpus", state), value, `test:candidate-corpus:${state}`);
  served((await readStateAuthorityProjection("candidate-publications", state)).result, "Candidate publications");
  return value;
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


const HOBBS_CARD = "ballot-az-pima:governor|Katie Hobbs";
const HOURIHAN_CARD = "ballot-az-pima:governor|Teri Ann Hourihan";
await installRegistryAuthority();
// A governor contest whose certified lineup reconciles one card and records one party conflict.
await installBallots(syntheticAzBallot([{
  id: "ballot-az-pima:governor",
  title: "Governor",
  candidacies: [
    { id: "ballot-az-pima:governor:hobbs-katie", givenName: "Katie", familyName: "Hobbs" },
    { id: "ballot-az-pima:governor:hourihan-teri-ann", givenName: "Teri Ann", familyName: "Hourihan" },
  ],
  lineup: [
    { name: "Katie Hobbs", partyLabel: "Democratic", outcome: "RECONCILED", candidacyId: "ballot-az-pima:governor:hobbs-katie" },
    { name: "Teri Ann Hourihan", partyLabel: "Independent", outcome: "PARTY_CONFLICT", candidacyId: "ballot-az-pima:governor:hourihan-teri-ann", filingParty: "Democratic" },
  ],
}]));
await installOfficeholderStatements();
// A synthetic held profile for the reconciled card.
await installCandidateProfiles(candidateProfilesFor({
  [HOBBS_CARD]: syntheticCandidateCard({
    bio: "Synthetic test biography for this card.", bioSourceUrl: "https://example.test/card/about", bioSourceLabel: "Campaign site, read 2026-09-20",
    email: "card@example.test", phone: "555-0100", phoneSource: "https://example.test/card/contact",
  }),
}, {
  [HOBBS_CARD]: { official: null, campaign: { url: "https://example.test/card", verification: "Page names the candidate (test).", attemptedAt: "2026-09-20" } },
}));
// The synthetic publication corpus plus one campaign page held for the party-conflict card itself.
const corpus = syntheticCandidateCorpus();
const hourihanText = "Arizona deserves leaders who listen. As your governor I will protect Arizona's water, fund Arizona's public schools, and answer every family's questions plainly. This is a synthetic test page written for this check; it describes no real campaign, and it is long enough to be read as a held publication by the reader.";
const hourihanHash = createHash("sha256").update(hourihanText).digest("hex");
await installCandidateCorpus({ ...corpus, attempted: corpus.attempted + 1, documents: [...corpus.documents, {
  ...corpus.documents[0]!, id: `${HOURIHAN_CARD}@${hourihanHash}`, candidateKey: HOURIHAN_CARD, documentUrl: "https://example.test/conflict-card/",
  contentHash: hourihanHash, text: hourihanText, metaDescription: null,
}] });

test("generic contact words cannot masquerade as a named person or government", () => {
  const entities = [
    { id: "navigation-one", name: "Contact Us", nameClass: "person" as const, divisionType: "person" },
    { id: "navigation-two", name: "Contact Information", nameClass: "body" as const, divisionType: "place" },
    { id: "person", name: "Jane Contact", nameClass: "person" as const, divisionType: "person" },
  ];
  assert.equal(bindNamedEntity("How can I contact her?", entities).kind, "NONE");
  assert.equal(bindNamedEntity("What contact information do we hold for this person?", entities).kind, "NONE");
  const explicitlyNamed = bindNamedEntity("How can I contact Jane Contact?", entities);
  assert.equal(explicitlyNamed.kind, "BOUND");
  if (explicitlyNamed.kind === "BOUND") assert.equal(explicitlyNamed.entity.id, "person");
});

test("focused candidate contact questions retrieve the same held profile and reject a wrong supplied ID", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { POST } = await import("../app/api/ask/grounded/route.ts");
  const { resetGroundedState } = await import("../lib/ask/grounded-state.ts");
  const questions = ["How can I contact her?", "What biography, published contact information, and verified campaign and official pages do we hold for this person?"];
  for (const question of questions) for (const id of ["ballot-az-pima:governor|Katie Hobbs", "ballot-az-pima:governor|wrong-id"]) {
    resetGroundedState();
    const response = await POST(new Request("https://wtp.test/api/ask/grounded", { method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test" }, body: JSON.stringify({ question, surface: "BALLOT", ocdIds: ["ocd-division/country:us/state:az"], activeSubjects: [{ id, name: "Katie Hobbs", kind: "PERSON", focused: true }] }) }));
    const payload = await response.json() as AskAnswerPayload;
    assert.equal(response.status, 200);
    if (id.endsWith("wrong-id")) {
      assert.equal(payload.mode, "UNRESOLVED");
      assert.equal(payload.denominators.identityUnresolved, 1);
      assert.equal(payload.answer, askResponseText(payload));
      assert.match(payload.answer!, /could not resolve the supplied identity/);
      assert.equal(payload.records.length, 0);
    } else {
      assert.equal(payload.answer, null);
      assert.equal(payload.subject?.id, id);
      assert.ok(payload.records.some((record) => record.candidateProfile?.holdingKey === id));
      assert.equal(payload.trace.retrieval.recordCount, payload.records.length);
    }
  }
});

test("focused canonical context narrows a tied name only within that exact candidate set", () => {
  const inventory = ["one", "two", "other"].map((id) => ({ id, name: id === "other" ? "Other Person" : "Chris King", nameClass: "person" as const, divisionType: "person" }));
  const ask = (ids: string[]) => resolveInterpretation(unavailableInterpretation(), "What does Chris King say?", inventory, { activeSubjects: ids.map((id) => ({ id, name: "Chris King", kind: "PERSON", focused: true })) });
  const exact = ask(["one"]);
  assert.equal(exact.binding.kind, "BOUND");
  if (exact.binding.kind === "BOUND") assert.equal(exact.binding.entity.id, "one");
  for (const ids of [["wrong"], ["other"], ["one", "two"], []]) assert.equal(ask(ids).binding.kind, "AMBIGUOUS");
});

test("Hourihan's exact card corpus answers while the unresolved party/candidacy bridge stays withheld", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const cardKey = "ballot-az-pima:governor|Teri Ann Hourihan";
  assert.equal(lineupRowForCard(cardKey)?.outcome, "PARTY_CONFLICT");
  assert.deepEqual(readerPersonKeys(cardKey).keys, [cardKey]);
  const { POST } = await import("../app/api/ask/grounded/route.ts");
  const { resetGroundedState } = await import("../lib/ask/grounded-state.ts");
  resetGroundedState();
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", { method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test" }, body: JSON.stringify({ question: "What does Teri Ann Hourihan say about Arizona?", surface: "BALLOT", ocdIds: ["ocd-division/country:us/state:az"], activeSubjects: [{ id: cardKey, name: "Teri Ann Hourihan", kind: "PERSON", focused: true }] }) }));
  const payload = await response.json() as AskAnswerPayload;
  assert.equal(payload.subject?.id, cardKey);
  assert.ok(payload.records.some((record) => record.kind === "SOURCE_PASSAGE" && record.canonicalSubjectId === cardKey));
  assert.ok(payload.records.every((record) => record.canonicalSubjectId !== "ballot-az-pima:governor:hourihan-teri-ann"));
  assert.equal(payload.answer, null);
});
