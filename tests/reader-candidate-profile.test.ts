import assert from "node:assert/strict";
import { test } from "node:test";
import { allCandidateCards } from "../lib/ballot/candidate-cards.ts";
import { allCandidateLinks } from "../lib/ballot/candidate-sites.ts";
import { candidateProfileEvidenceFor } from "../lib/ask/candidate-profile.ts";
import { withReaderSelection } from "../lib/db/reader-route.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { readGenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import type { CandidateProfilesProjection } from "../lib/civic-data/manual-projections.ts";
import { readerPersonKeys } from "../lib/identity/reader-person.ts";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";
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
import { readStateAuthorityProjection } from "../lib/civic-data/state-reader.ts";

async function installCandidateProfiles(value: CandidateProfilesProjection, state = "AZ"): Promise<CandidateProfilesProjection> {
  installManualValue(stateBallotContractId("candidate-profiles", state), value, `test:candidate-profiles:${state}`);
  const read = (await readStateAuthorityProjection("candidate-profiles", state)).result;
  if (read.kind !== "PROMOTED") throw new Error(`Candidate profiles fixture did not install: ${read.kind}`);
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


await installRegistryAuthority();
await installBallots(syntheticAzBallot([{
  id: "ballot-az-pima:governor",
  title: "Governor",
  candidacies: [
    { id: "ballot-az-pima:governor:hobbs-katie", givenName: "Katie", familyName: "Hobbs" },
    { id: "ballot-az-pima:governor:biggs-andy", givenName: "Andy", familyName: "Biggs" },
    { id: "ballot-az-pima:governor:hourihan-teri-ann", givenName: "Teri Ann", familyName: "Hourihan" },
  ],
  lineup: [
    { name: "Andy Biggs", partyLabel: "Republican", outcome: "RECONCILED", candidacyId: "ballot-az-pima:governor:biggs-andy" },
    { name: "Teri Ann Hourihan", partyLabel: "Independent", outcome: "PARTY_CONFLICT", candidacyId: "ballot-az-pima:governor:hourihan-teri-ann", filingParty: "Democratic" },
  ],
}]));
await installCandidateProfiles(candidateProfilesFor({
  "ballot-az-pima:governor:hobbs-katie": syntheticCandidateCard({
    bio: "Synthetic test biography for the governor's candidacy.", bioSourceUrl: "https://example.test/hobbs/about",
    bioSourceLabel: "Campaign site, read 2026-09-20", email: "candidate@example.test", phone: "555-0100",
    phoneSource: "https://example.test/hobbs/contact", photoUrl: null, photoSource: null,
  }),
  "ballot-az-pima:governor|Andy Biggs": syntheticCandidateCard({
    bio: "Synthetic test biography for a different candidate.", bioSourceUrl: "https://example.test/biggs/about",
    bioSourceLabel: "Campaign site, read 2026-09-21",
  }),
  "ballot-nh-merrimack:county-attorney:test-candidate": syntheticCandidateCard({
    phone: "555-0101", phoneLabel: "Merrimack County Attorney (test office line)", phoneSource: "https://example.test/county-attorney",
    filedAddress: "1 Filed Address Way (test)", filedAddressSource: "https://example.test/filing",
  }),
}, {
  "ballot-az-pima:governor:hobbs-katie": {
    official: { url: "https://example.test/governor", verification: "Page names the officeholder (test).", attemptedAt: "2026-09-20" },
    campaign: { url: "https://example.test/hobbs", verification: "Page names the candidate (test).", attemptedAt: "2026-09-20", label: "Campaign site" },
  },
  "ballot-nh-merrimack:county-attorney:test-candidate": {
    official: null,
    campaign: { url: "https://example.test/county-attorney-campaign", verification: "Page names the candidate (test).", attemptedAt: "2026-09-22" },
  },
}));

test("every current native candidate bio and verified link reaches grounded profile records with exact provenance", () => {
  const cards = allCandidateCards("AZ").cards;
  const links = allCandidateLinks("AZ").links;
  assert.deepEqual([...new Set(Object.values(cards).flatMap(Object.keys))].sort(), [
    "bio", "bioSourceLabel", "bioSourceUrl", "email", "filedAddress", "filedAddressSource", "phone", "phoneLabel", "phoneSource", "photoSource", "photoUrl",
  ].sort(), "Every newly held card field needs an explicit reader classification; photographs keep their separate image-review contract.");
  let bios = 0;
  let sites = 0;
  let contacts = 0;
  for (const key of new Set([...Object.keys(cards), ...Object.keys(links)])) {
    const answer = candidateProfileEvidenceFor("AZ", { kind: "PERSON", id: key, name: "Display name is deliberately not a join key" });
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
  const official = candidateProfileEvidenceFor("AZ", { kind: "PERSON", id: "statewide:az/governor", name: "Katie Hobbs" });
  const candidate = candidateProfileEvidenceFor("AZ", { kind: "PERSON", id: "ballot-az-pima:governor:hobbs-katie", name: "Unrelated display text" });
  assert.ok(official.records.length > 0);
  assert.deepEqual(official.records.map(({ subjectId: _id, ...row }) => row), candidate.records.map(({ subjectId: _id, ...row }) => row));
  const other = candidateProfileEvidenceFor("AZ", { kind: "PERSON", id: "ballot-az-pima:governor|Andy Biggs", name: "Katie Hobbs" });
  assert.ok(other.records.every(row => !row.candidateProfile?.holdingKey.includes("Katie Hobbs")));
  assert.deepEqual(candidateProfileEvidenceFor("AZ", { kind: "PERSON", id: "unknown:candidate", name: "Katie Hobbs" }).records, []);
  const conflict = "ballot-az-pima:governor|Teri Ann Hourihan";
  const conflictKeys = [conflict, "ballot-az-pima:governor:hourihan-teri-ann"].sort();
  assert.deepEqual(readerPersonKeys(conflict).keys, conflictKeys, "Party labels do not split a person in the same sourced race");
  assert.ok(candidateProfileEvidenceFor("AZ", { kind: "PERSON", id: conflict, name: "Teri Ann Hourihan" }).records.every(row => conflictKeys.includes(row.canonicalSubjectId!)));
});

test("profile fields without their verification/source remain withheld instead of becoming claims or publisher absence", async () => {
  const key = Object.keys(allCandidateCards("AZ").cards).find(key => allCandidateCards("AZ").cards[key].bio)!;
  const card = structuredClone(allCandidateCards("AZ").cards[key]);
  card.bioSourceUrl = null;
  card.phone = null;
  card.email = null;
  card.filedAddress = null;
  const answer = await withProfile(candidateProfilesFor({ [key]: card }, {
    [key]: { official: { url: "https://example.test/acquired", attemptedAt: "2026-09-04", verification: "" }, campaign: null },
  }), () => candidateProfileEvidenceFor("AZ", { kind: "PERSON", id: key, name: key }));
  assert.deepEqual(answer.records, []);
  assert.equal(answer.denominators.candidateProfileFieldsWithheld, 2);
  assert.ok(answer.gaps.every(gap => gap.whose === "OURS"));
});

test("contact source metadata is never borrowed from a biography or an unrelated link", async () => {
  const key = "planted:contact";
  const card = { ...structuredClone(Object.values(allCandidateCards("AZ").cards)[0]), bio: null, email: "held@example.test", phone: null, filedAddress: null };
  const officeKey = Object.keys(allCandidateCards("AZ").cards).find(id => allCandidateCards("AZ").cards[id].phoneLabel)!;
  const officeCard = allCandidateCards("AZ").cards[officeKey];
  const actual = candidateProfileEvidenceFor("AZ", { kind: "PERSON", id: officeKey, name: "Unrelated display text" }).records.find(row => row.candidateProfile?.field === "phone")!;
  const answer = await withProfile(candidateProfilesFor({ [key]: card }), () =>
    candidateProfileEvidenceFor("AZ", { kind: "PERSON", id: key, name: "Planted candidate" }));
  assert.equal(answer.records.length, 1);
  assert.equal(answer.records[0].sourceUrl, null);
  assert.equal(answer.records[0].retrievedAt, null);
  assert.ok(answer.records[0].candidateProfile?.provenanceLimitation);
  assert.ok(actual.text.includes(officeCard.phoneLabel!), "the phone carries its own office label");
  assert.equal(actual.candidateProfile?.label, officeCard.phoneLabel);
});

function withProfile<T>(value: CandidateProfilesProjection, read: () => T): Promise<T> {
  return withReaderSelection({ states: ["AZ"], keys: new Set(["state:AZ"]) }, async () => {
    await readRegistryRuntimeProjection(["AZ"]);
    await readGenericBallotProjection("AZ");
    await installCandidateProfiles(value);
    return read();
  });
}
