import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import {
  nhMembersCandidate,
  officialStateLegislatorHorizonRefusalCandidate,
  officialStateLegislatorsCandidate,
  officialStateRollCallHorizonRefusalCandidate,
  officialStateRollCallsCandidate,
} from "../lib/civic-data/candidate-builders.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import {
  getStateVotesSnapshot,
  refreshStateVotesFromPromoted,
} from "../lib/sources/legiscan/snapshot.ts";
import {
  OFFICIAL_STATE_LEGISLATOR_TARGETS,
  OFFICIAL_STATE_ROLL_CALL_TARGETS,
  officialStateLegislatorTargetByScope,
  officialStateOfficeholderId,
  officialStateVoteScopeForOfficeholderId,
  type OfficialStateRollCallSourceId,
  type OfficialStateVoteScope,
} from "../lib/state-rollcalls/authority.ts";
import {
  heldOfficialStateLegislators,
  readOfficialStateLegislatorsProjection,
} from "../lib/state-rollcalls/legislators.ts";
import { registryRuntimeProjectionIssues, type RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { voteEvidenceFor } from "../lib/ask/votes.ts";
import { parseStateRollCallArguments } from "../scripts/state-rollcalls.mts";
import { parseStateLegislatorArguments } from "../scripts/state-legislators.mts";

const T0 = "2026-09-09T12:00:00.000Z";
const T1 = "2026-09-09T12:05:00.000Z";

type Target = (typeof OFFICIAL_STATE_ROLL_CALL_TARGETS)[number];

interface RosterEvidence {
  readonly versionId: string;
  readonly officeholderIds: readonly string[];
}

async function seedOfficialRoster(
  store: MemoryRoutineDataStore,
  rollTarget: Target,
  tag: string,
): Promise<RosterEvidence> {
  const target = officialStateLegislatorTargetByScope(rollTarget.jurisdiction)!;
  if (target.state === "NH") {
    const members = [
      ...Array.from({ length: target.expectedChamberFloor.lower }, (_, index) => ({
        chamber: "H",
        familyName: `House-${tag}-${index}`,
        givenName: "Official",
        middleName: null,
        seatNo: `H-${index + 1}`,
        county: "Merrimack",
        district: String((index % 20) + 1),
        electedStatus: "INCUMBENT" as const,
        party: null,
        title: "Representative",
        phone: null,
        email: null,
        town: null,
        committees: [],
      })),
      ...Array.from({ length: target.expectedChamberFloor.upper }, (_, index) => ({
        chamber: "S",
        familyName: `Senate-${tag}-${index}`,
        givenName: "Official",
        middleName: null,
        seatNo: `S-${index + 1}`,
        county: "",
        district: String(index + 1),
        electedStatus: "INCUMBENT" as const,
        party: null,
        title: "Senator",
        phone: null,
        email: null,
        town: null,
        committees: [],
      })),
    ];
    const identityCrosswalk = {
      matches: members.map((member, index) => ({
        member,
        officialPersonId: String(index + 1),
        officeholderId: `nh-general-court:${index + 1}`,
        matchBasis: "EXACT_OFFICIAL_NAME_BODY" as const,
      })),
      sourceVersion: `deterministic-official-person-id-seed-${tag}`,
      observedIdentityRows: members.length,
      ordinaryMatches: members.length,
      reviewedExceptionMatches: 0,
    };
    const candidate = nhMembersCandidate({
      rawText: `official NH roster ${tag}`,
      rawIdentityText: `official NH identity roster ${tag}`,
      finalUrl: target.probeUrl,
      identityFinalUrl: "https://gc.nh.gov/dynamicdatadump/legislators.txt",
      httpStatus: 200,
      identityHttpStatus: 200,
      retrievedAt: T0,
      extraction: {
        members,
        counts: { logicalInput: members.length, produced: members.length, dropped: 0, statedTotal: null, verdict: "COULD_NOT_ASSERT" },
        byStatus: { INCUMBENT: members.length, NEW: 0, FORMER: 0, UNSTATED: 0 },
        byChamber: { H: target.expectedChamberFloor.lower, S: target.expectedChamberFloor.upper },
      },
      identityCrosswalk,
    });
    const outcome = await processRegisteredRoutineCandidate(store, target.contractId, candidate, T0);
    assert.equal(outcome.candidate.state, "PROMOTED");
    const value = candidate.readModel as { identities: readonly { officeholderId: string }[] };
    return { versionId: candidate.id, officeholderIds: value.identities.map((row) => row.officeholderId) };
  }

  const exactCounts = target.expectedChamberCount;
  const officeholders = [
    ...Array.from({ length: exactCounts.lower }, (_, index) => ({
      id: officialStateOfficeholderId(target.sourceId, `${target.state}-lower-${tag}-${index + 1}`),
      name: `Official ${target.state} Lower ${index + 1}`,
      officeTitle: target.state === "NJ" ? "Assembly Member" : "State Representative",
      level: "STATE" as const,
      termStart: "2025-01-01",
      termEnd: "2026-12-31",
      birthDate: null,
      partyLabel: null,
      websiteUrl: target.probeUrl,
      contactFormUrl: null,
      phone: null,
      email: null,
      campaignUrl: null,
      photo: null,
      state: target.state,
      chamber: "lower",
      provenance: { sourceUrl: target.probeUrl, sourceOrg: target.publisher, collectedAt: T0, verifiedAt: T0 },
    })),
    ...Array.from({ length: exactCounts.upper }, (_, index) => ({
      id: officialStateOfficeholderId(target.sourceId, `${target.state}-upper-${tag}-${index + 1}`),
      name: `Official ${target.state} Upper ${index + 1}`,
      officeTitle: "State Senator",
      level: "STATE" as const,
      termStart: "2025-01-01",
      termEnd: "2026-12-31",
      birthDate: null,
      partyLabel: null,
      websiteUrl: target.probeUrl,
      contactFormUrl: null,
      phone: null,
      email: null,
      campaignUrl: null,
      photo: null,
      state: target.state,
      chamber: "upper",
      provenance: { sourceUrl: target.probeUrl, sourceOrg: target.publisher, collectedAt: T0, verifiedAt: T0 },
    })),
  ];
  const lowerCount = target.state === "AZ" ? 30 : 40;
  const upperCount = target.state === "AZ" ? 30 : 40;
  const candidate = officialStateLegislatorsCandidate({
    sourceId: target.sourceId,
    jurisdiction: target.jurisdiction,
    rawBodies: [`official ${target.state} roster ${tag}`],
    requestedUrl: target.probeUrl,
    finalUrl: target.probeUrl,
    httpStatus: 200,
    retrievedAt: T0,
    term: "2025-2026",
    expectedTerm: "2025-2026",
    declaredTotal: officeholders.length,
    roster: {
      scope: target.state,
      generatedAt: T0,
      officeholders,
      divisions: officeholders.map((row, index) => ({
        officeholderId: row.id,
        ocdId: `ocd-division/country:us/state:${target.state.toLowerCase()}/sld${row.chamber === "lower" ? "l" : "u"}:${(index % (row.chamber === "lower" ? lowerCount : upperCount)) + 1}`,
        bodyId: null,
      })),
      unmatched: [],
    },
  });
  const outcome = await processRegisteredRoutineCandidate(store, target.contractId, candidate, T0);
  assert.equal(outcome.candidate.state, "PROMOTED");
  return { versionId: candidate.id, officeholderIds: officeholders.map((row) => row.id) };
}

function goodCandidate(target: Target, tag: string, roster: RosterEvidence, retrievedAt = T0, officeholderIdOverride?: string) {
  const canonicalOfficeholderId = roster.officeholderIds[0]!;
  const officialPersonId = canonicalOfficeholderId.slice(target.sourceId.length + 1);
  const rosterTarget = officialStateLegislatorTargetByScope(target.jurisdiction)!;
  const rollId = `${target.sourceId}:roll-${tag}`;
  const term = target.state === "NJ" ? "2026-2027" : "2026";
  const session = target.state === "NJ" ? "2026-2027 Session" : "regular";
  const njRolls = target.state === "NJ"
    ? [
        { suffix: "assembly-floor", chamber: "Assembly" as const, positionCount: 80, billNumber: "A 1" },
        { suffix: "senate-floor", chamber: "Senate" as const, positionCount: 40, billNumber: "S 1" },
        { suffix: "assembly-committee", chamber: "Assembly" as const, positionCount: 1, billNumber: "A 2" },
        { suffix: "senate-committee", chamber: "Senate" as const, positionCount: 1, billNumber: "S 2" },
      ]
    : null;
  const rolls = njRolls
    ? njRolls.map(({ suffix, chamber, positionCount, billNumber }) => ({
        id: `${target.sourceId}:roll-${tag}-${suffix}`,
        sourceId: target.sourceId,
        officialRollCallId: `official-roll-${tag}-${suffix}`,
        eventId: `official-event-${tag}-${suffix}`,
        chamber,
        term,
        session,
        actionStage: suffix.endsWith("floor") ? "Third Reading" : "Committee vote",
        expectedActionStage: suffix.endsWith("floor") ? "Third Reading" : "Committee vote",
        officialEventKind: suffix === "assembly-floor"
          ? "ASSEMBLY_FLOOR" as const
          : suffix === "senate-floor"
            ? "SENATE_FLOOR" as const
            : suffix === "assembly-committee"
              ? "ASSEMBLY_COMMITTEE" as const
              : "SENATE_COMMITTEE" as const,
        state: target.state,
        sessionId: 0,
        billNumber,
        billTitle: "Official source-isolation control",
        motion: suffix.endsWith("floor") ? "Third Reading" : "Committee vote",
        date: "2026-09-09",
        yea: positionCount,
        nay: 0,
        absent: 0,
        nv: 0,
        result: `Passed ${positionCount}-0`,
        publisherTally: { Yes: positionCount, No: 0, Abstain: 0, "No Vote": 0, "Not Voting": 0 },
        billUrl: target.probeUrl,
        rollCallUrl: suffix === "assembly-floor"
          ? "https://pub.njleg.gov/votes/A2026.zip"
          : suffix === "senate-floor"
            ? "https://pub.njleg.gov/votes/S2026.zip"
            : suffix === "assembly-committee"
              ? "https://pub.njleg.gov/votes/CA2026-2027.zip"
              : "https://pub.njleg.gov/votes/CS2026-2027.zip",
        retrievedAt,
      }))
    : [{
        id: rollId,
        sourceId: target.sourceId,
        officialRollCallId: `official-roll-${tag}`,
        eventId: `official-event-${tag}`,
        chamber: "House" as const,
        term,
        session,
        actionStage: "Third Reading",
        expectedActionStage: "Third Reading",
        state: target.state,
        sessionId: 0,
        billNumber: "HB 1",
        billTitle: "Official source-isolation control",
        motion: "Third Reading",
        date: "2026-09-09",
        yea: 1,
        nay: 0,
        absent: 0,
        nv: 0,
        result: "Passed 1-0",
        billUrl: target.probeUrl,
        rollCallUrl: target.probeUrl,
        retrievedAt,
      }];
  const positions = njRolls
    ? njRolls.flatMap(({ suffix, chamber, positionCount }) => {
        const start = chamber === "Assembly" ? 0 : 80;
        return roster.officeholderIds.slice(start, start + positionCount).map((officeholderId) => ({
          officeholderId,
          officialPersonId: officeholderId.slice(target.sourceId.length + 1),
          rollCallId: `${target.sourceId}:roll-${tag}-${suffix}`,
          position: "YES" as const,
          publisherPosition: "Yes",
        }));
      })
    : [{
        officeholderId: officeholderIdOverride ?? canonicalOfficeholderId,
        officialPersonId,
        rollCallId: rollId,
        position: "YES" as const,
        publisherPosition: "Yes",
      }];
  const njIndexUrl = "https://www.njleg.state.nj.us/api/votingRecords";
  return officialStateRollCallsCandidate({
    sourceId: target.sourceId,
    jurisdiction: target.jurisdiction,
    rawBodies: target.state === "NJ"
      ? Array.from({ length: 125 }, (_, index) => `${target.publisher} exact document ${index + 1} ${tag}`)
      : [`${target.publisher} official roll bytes ${tag}`],
    requestedUrl: target.state === "NJ" ? njIndexUrl : target.probeUrl,
    finalUrl: target.state === "NJ" ? njIndexUrl : target.probeUrl,
    httpStatus: 200,
    retrievedAt,
    term,
    expectedTerm: term,
    session,
    declaredRollTotal: rolls.length,
    identityAuthority: {
      contractId: rosterTarget.contractId,
      versionId: roster.versionId,
      currentOfficeholderIds: roster.officeholderIds,
      sessionParticipantIds: roster.officeholderIds,
      sessionParticipantSourceVersion: `official-participants-${tag}`,
    },
    rolls,
    positions,
    ...(njRolls ? {
      horizonAudit: {
        authorityMode: "API_ARCHIVE_EXACT_RECONCILIATION" as const,
        sessionIndexUrl: njIndexUrl,
        sessionDisplay: session,
        expectedParticipantRequests: 120,
        completedParticipantRequests: 120,
        apiRollCalls: 4,
        apiPositions: 122,
        reconciledArchivePositions: 122,
        archives: [
          { kind: "ASSEMBLY_FLOOR", url: "https://pub.njleg.gov/votes/A2026.zip", sha256: "a".repeat(64), rollCalls: 1, positions: 80 },
          { kind: "SENATE_FLOOR", url: "https://pub.njleg.gov/votes/S2026.zip", sha256: "b".repeat(64), rollCalls: 1, positions: 40 },
          { kind: "ASSEMBLY_COMMITTEE", url: "https://pub.njleg.gov/votes/CA2026-2027.zip", sha256: "c".repeat(64), rollCalls: 1, positions: 1 },
          { kind: "SENATE_COMMITTEE", url: "https://pub.njleg.gov/votes/CS2026-2027.zip", sha256: "d".repeat(64), rollCalls: 1, positions: 1 },
        ],
      },
    } : {}),
  });
}

test("AZ, NH, and NJ are three independent permanent routine authorities", () => {
  assert.deepEqual(
    OFFICIAL_STATE_ROLL_CALL_TARGETS.map(({ state, sourceId, contractId, jurisdiction }) => ({
      state,
      sourceId,
      contractId,
      jurisdiction,
    })),
    [
      { state: "AZ", sourceId: "az-legislature", contractId: "az-state-rollcalls", jurisdiction: "US-AZ" },
      { state: "NH", sourceId: "nh-general-court", contractId: "nh-state-rollcalls", jurisdiction: "US-NH" },
      { state: "NJ", sourceId: "nj-legislature", contractId: "nj-state-rollcalls", jurisdiction: "US-NJ" },
    ],
  );
  for (const target of OFFICIAL_STATE_ROLL_CALL_TARGETS) {
    const contract = ROUTINE_SOURCE_CONTRACTS.find(({ id }) => id === target.contractId);
    assert.ok(contract);
    assert.equal(contract.sourceId, target.sourceId);
    assert.equal(contract.scope, target.jurisdiction);
    // NH promotes its votes as a per-legislator fan-out; AZ and NJ still promote
    // the whole chamber as one STATE_ROLL_CALL record.
    assert.equal(contract.recordClass, target.state === "NH" ? "STATE_LEGISLATOR_VOTES" : "STATE_ROLL_CALL");
    assert.equal(contract.fanOut === true, target.state === "NH");
    assert.deepEqual(contract.bootstrapFixturePaths, []);
    assert.deepEqual(
      contract.acquisitionAdapter.command,
      ["scripts/state-rollcalls.mts", "--promote", `--state=${target.state}`],
    );
    assert.match(contract.lkgBehavior, /prior GOOD pointer live/);
  }
});

test("AZ/NH/NJ official current-person authorities are exact and never use the retired aggregate", () => {
  assert.deepEqual(
    OFFICIAL_STATE_LEGISLATOR_TARGETS.map(({ state, sourceId, contractId, jurisdiction }) => ({ state, sourceId, contractId, jurisdiction })),
    [
      { state: "AZ", sourceId: "az-legislature", contractId: "az-state-legislators", jurisdiction: "US-AZ" },
      { state: "NH", sourceId: "nh-general-court", contractId: "nh-members", jurisdiction: "US-NH" },
      { state: "NJ", sourceId: "nj-legislature", contractId: "nj-state-legislators", jurisdiction: "US-NJ" },
    ],
  );
  for (const target of OFFICIAL_STATE_LEGISLATOR_TARGETS) {
    const contract = ROUTINE_SOURCE_CONTRACTS.find(({ id }) => id === target.contractId);
    assert.ok(contract);
    assert.equal(contract.sourceId, target.sourceId);
    assert.equal(contract.scope, target.jurisdiction);
    assert.equal(contract.recordClass, "STATE_LEGISLATOR");
    if (target.state !== "NH") {
      assert.deepEqual(contract.bootstrapFixturePaths, []);
      assert.deepEqual(contract.acquisitionAdapter.command, ["scripts/state-legislators.mts", "--promote", `--state=${target.state}`]);
    }
  }
  assert.deepEqual(parseStateLegislatorArguments(["--promote", "--state=AZ"]), { state: "AZ" });
  assert.deepEqual(parseStateLegislatorArguments(["--promote", "--state=NJ"]), { state: "NJ" });
  assert.throws(() => parseStateLegislatorArguments(["--promote", "--state=NH"]), /STATE_UNSUPPORTED/);
  assert.throws(() => parseStateLegislatorArguments(["--promote", "--state=AZ", "--write"]), /EXACT_SCOPE_REQUIRED/);
  const source = readFileSync(new URL("../scripts/state-legislators.mts", import.meta.url), "utf8");
  assert.match(source, /source:\s*target\.contractId/);
  assert.doesNotMatch(source, /sourceLabel/);
  assert.doesNotMatch(source, /(?:from|import)[^\n]*(?:openstates|plural)|officeholders-\*|state-votes-snapshot/i);
  assert.doesNotMatch(source, /\b(?:git|gh|netlify|next)\s+(?:add|commit|push|deploy|build)\b/i);
  assert.doesNotMatch(source, /writeFile|appendFile|createWriteStream/);
});

test("an official roster promotes to its exact typed Reader and horizon refusal preserves LKG", async () => {
  const target = OFFICIAL_STATE_ROLL_CALL_TARGETS[0];
  const rosterTarget = officialStateLegislatorTargetByScope(target.jurisdiction)!;
  const store = new MemoryRoutineDataStore();
  const roster = await seedOfficialRoster(store, target, "reader");
  const read = await readOfficialStateLegislatorsProjection(target.jurisdiction, { store, now: T0, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") {
    assert.equal(read.metadata.versionId, roster.versionId);
    assert.deepEqual(read.value.roster.officeholders.map(({ id }) => id), roster.officeholderIds);
  }
  const held = await heldOfficialStateLegislators(target.jurisdiction, { store, now: T0, bypassCache: true });
  assert.equal(held?.versionId, roster.versionId);
  assert.equal(held?.seats.length, roster.officeholderIds.length);
  const pointer = await store.readPromotion("STATE_LEGISLATOR", target.jurisdiction);

  const refused = await processRegisteredRoutineCandidate(
    store,
    rosterTarget.contractId,
    officialStateLegislatorHorizonRefusalCandidate({
      sourceId: target.sourceId,
      jurisdiction: target.jurisdiction,
      requestedUrl: rosterTarget.probeUrl,
      finalUrl: rosterTarget.probeUrl,
      httpStatus: 200,
      retrievedAt: T1,
      rawBody: "official page without a proved complete current roster horizon",
      detail: "Complete official roster horizon has not been proved.",
    }),
    T1,
  );
  assert.equal(refused.candidate.state, "HORIZON_UNRESOLVED");
  assert.equal(refused.candidate.lastKnownGoodVersion, roster.versionId);
  assert.deepEqual(await store.readPromotion("STATE_LEGISLATOR", target.jurisdiction), pointer);
});

test("a roll promotion is refused unless its exact roster pointer, LKG, and ID-set digest match", async () => {
  const target = OFFICIAL_STATE_ROLL_CALL_TARGETS[2];
  const store = new MemoryRoutineDataStore();
  const roster = await seedOfficialRoster(store, target, "join");
  const wrongVersion = { ...roster, versionId: `${roster.versionId}:not-canonical` };
  const refused = await processRegisteredRoutineCandidate(store, target.contractId, goodCandidate(target, "wrong-roster", wrongVersion), T0);
  assert.equal(refused.candidate.state, "DEPENDENT_CONSUMER_INVALID");
  assert.equal(refused.candidate.failureCode, "DEPENDENT_CONSUMER_REJECTED");
  assert.match(refused.candidate.failureDetail ?? "", /canonical pointer\/LKG/);
  assert.equal(await store.readPromotion("STATE_ROLL_CALL", target.jurisdiction), null);

  const wrongIds = {
    ...roster,
    officeholderIds: roster.officeholderIds.map((id, index) => index === roster.officeholderIds.length - 1
      ? `${target.sourceId}:not-in-the-promoted-roster`
      : id),
  };
  const digestRefused = await processRegisteredRoutineCandidate(
    store,
    target.contractId,
    goodCandidate(target, "wrong-roster-ids", wrongIds),
    T0,
  );
  assert.equal(digestRefused.candidate.state, "DEPENDENT_CONSUMER_INVALID");
  assert.equal(digestRefused.candidate.failureCode, "DEPENDENT_CONSUMER_REJECTED");
  assert.match(digestRefused.candidate.failureDetail ?? "", /roster ID-set digest/);
  assert.equal(await store.readPromotion("STATE_ROLL_CALL", target.jurisdiction), null);

  const accepted = await processRegisteredRoutineCandidate(store, target.contractId, goodCandidate(target, "exact-roster", roster), T1);
  assert.equal(accepted.candidate.state, "PROMOTED");
});

test("the manual registry pointer and official state-roster contracts have no overlapping subject authority", () => {
  const seed = (JSON.parse(gunzipSync(readFileSync("tests/fixtures/registry-transfer-import.json.gz")).toString("utf8")) as {
    projection: { payload: RegistryRuntimeReadModel };
  }).projection.payload;
  const manualSubjectIds = new Set([
    ...seed.bodyRosters.flatMap((roster) => roster.members.map((member) => member.id)),
    ...seed.rosterReaderDispositions.flatMap((row) => [row.sourceId, row.canonicalId ?? ""]),
    ...seed.statewideExecutives.map((row) => row.holder.id),
    ...seed.officialCandidacies.rows.map((row) => row.holder.id),
  ].filter(Boolean));
  for (const target of OFFICIAL_STATE_LEGISLATOR_TARGETS) {
    assert.ok([...manualSubjectIds].every((id) => !id.startsWith(`${target.sourceId}:`)), target.contractId);
  }
  assert.ok(!registryRuntimeProjectionIssues(seed).some((issue) => issue.startsWith("OFFICIAL_STATE_LEGISLATOR_SUBJECT_AUTHORITY_OVERLAP")));

  const firstRoster = seed.bodyRosters[0]!;
  const planted = {
    ...seed,
    bodyRosters: [{
      ...firstRoster,
      members: [{ ...firstRoster.members[0]!, id: "az-legislature:planted-overlap" }, ...firstRoster.members.slice(1)],
    }, ...seed.bodyRosters.slice(1)],
  };
  assert.ok(registryRuntimeProjectionIssues(planted).some((issue) =>
    issue === "OFFICIAL_STATE_LEGISLATOR_SUBJECT_AUTHORITY_OVERLAP:az-legislature:planted-overlap"
  ));
});

test("the standing state-roll door accepts one exact state and no tracked-output mode", () => {
  assert.deepEqual(parseStateRollCallArguments(["--promote", "--state=AZ"]), { state: "AZ" });
  assert.throws(() => parseStateRollCallArguments(["--state=AZ"]), /PROMOTION_REQUIRED/);
  assert.throws(() => parseStateRollCallArguments(["--promote"]), /EXACT_SCOPE_REQUIRED/);
  assert.throws(() => parseStateRollCallArguments(["--promote", "--state=AZ", "--state=NH"]), /EXACT_SCOPE_REQUIRED/);
  assert.throws(() => parseStateRollCallArguments(["--promote", "--state=AZ", "--write"]), /EXACT_SCOPE_REQUIRED/);

  const source = readFileSync(new URL("../scripts/state-rollcalls.mts", import.meta.url), "utf8");
  assert.match(source, /source:\s*target\.contractId/);
  assert.doesNotMatch(source, /sourceLabel/);
  assert.doesNotMatch(source, /state-votes-snapshot\.json|LegiScan API|LEGISCAN_API_KEY/);
  assert.doesNotMatch(source, /\b(?:git|gh|netlify|next)\s+(?:add|commit|push|deploy|build)\b/i);
  assert.doesNotMatch(source, /writeFile|appendFile|createWriteStream/);
});

test("an incomplete official horizon is durable refusal and cannot move or erase that state's LKG", async () => {
  const target = OFFICIAL_STATE_ROLL_CALL_TARGETS[0];
  const store = new MemoryRoutineDataStore();
  const roster = await seedOfficialRoster(store, target, "good");
  const good = await processRegisteredRoutineCandidate(store, target.contractId, goodCandidate(target, "good", roster), T0);
  assert.equal(good.candidate.state, "PROMOTED");
  const prior = await store.readPromotion("STATE_ROLL_CALL", target.jurisdiction);
  assert.equal(prior?.versionId, good.candidate.candidate.id);

  const refusal = officialStateRollCallHorizonRefusalCandidate({
    sourceId: target.sourceId,
    jurisdiction: target.jurisdiction,
    requestedUrl: target.probeUrl,
    finalUrl: target.probeUrl,
    httpStatus: 200,
    retrievedAt: T1,
    rawBody: "official landing page without a proved complete horizon",
    detail: "The complete official House and Senate roll horizon is not established.",
  });
  const refused = await processRegisteredRoutineCandidate(store, target.contractId, refusal, T1);
  assert.equal(refused.candidate.state, "HORIZON_UNRESOLVED");
  assert.equal(refused.candidate.failureCode, "COMPLETE_UNIVERSE_UNBOUNDED");
  assert.equal(refused.promoted, null);
  assert.equal(refused.candidate.lastKnownGoodVersion, prior?.versionId);
  assert.deepEqual(await store.readPromotion("STATE_ROLL_CALL", target.jurisdiction), prior);
});

test("one state's refusal cannot change either sibling disposition", async () => {
  const store = new MemoryRoutineDataStore();
  const pointers = new Map<string, string>();
  // The whole-chamber STATE_ROLL_CALL family is AZ and NJ; NH promotes a
  // per-legislator fan-out and its isolation is proved in the fan-out test.
  const rollCallTargets = OFFICIAL_STATE_ROLL_CALL_TARGETS.filter(({ state }) => state !== "NH");
  for (const target of rollCallTargets) {
    const roster = await seedOfficialRoster(store, target, "baseline");
    const outcome = await processRegisteredRoutineCandidate(store, target.contractId, goodCandidate(target, "baseline", roster), T0);
    assert.equal(outcome.candidate.state, "PROMOTED");
    pointers.set(target.jurisdiction, outcome.candidate.candidate.id);
  }

  const nj = OFFICIAL_STATE_ROLL_CALL_TARGETS[2];
  const refused = await processRegisteredRoutineCandidate(
    store,
    nj.contractId,
    officialStateRollCallHorizonRefusalCandidate({
      sourceId: nj.sourceId,
      jurisdiction: nj.jurisdiction,
      requestedUrl: nj.probeUrl,
      finalUrl: nj.probeUrl,
      httpStatus: 200,
      retrievedAt: T1,
      rawBody: "NJ official index with incomplete enumeration",
      detail: "Exact complete session horizon not established.",
    }),
    T1,
  );
  assert.equal(refused.candidate.state, "HORIZON_UNRESOLVED");
  for (const target of rollCallTargets) {
    const pointer = await store.readPromotion("STATE_ROLL_CALL", target.jurisdiction);
    assert.equal(pointer?.versionId, pointers.get(target.jurisdiction), target.jurisdiction);
    assert.equal(pointer?.lastKnownGoodVersionId, pointers.get(target.jurisdiction), target.jurisdiction);
  }
});

test("one state's absent roster cannot hide an independently promoted sibling roster", async () => {
  const store = new MemoryRoutineDataStore();
  const az = OFFICIAL_STATE_ROLL_CALL_TARGETS[0];
  const nj = OFFICIAL_STATE_ROLL_CALL_TARGETS[2];
  const azRoster = await seedOfficialRoster(store, az, "isolated-roster");

  const azRead = await readOfficialStateLegislatorsProjection(az.jurisdiction, {
    store,
    now: T0,
    bypassCache: true,
  });
  const njRead = await readOfficialStateLegislatorsProjection(nj.jurisdiction, {
    store,
    now: T0,
    bypassCache: true,
  });
  assert.equal(azRead.kind, "PROMOTED");
  if (azRead.kind === "PROMOTED") assert.equal(azRead.metadata.versionId, azRoster.versionId);
  assert.equal(njRead.kind, "NOT_RECORDED");
});

test("official state identities determine one scope before a Reader opens", () => {
  assert.equal(officialStateVoteScopeForOfficeholderId("az-legislature:person-1"), "US-AZ");
  assert.equal(officialStateVoteScopeForOfficeholderId("nh-general-court:person-1"), "US-NH");
  assert.equal(officialStateVoteScopeForOfficeholderId("nj-legislature:person-1"), "US-NJ");
  assert.equal(officialStateVoteScopeForOfficeholderId("plural:person-1"), null);
});

test("grounded Ask reaches an exact official state identity without a Plural roster", { concurrency: false }, async () => {
  // Exercises the whole-chamber STATE_ROLL_CALL reader on AZ; NH promotes a
  // per-legislator fan-out whose Reader join lands in the follow-on pass.
  const target = OFFICIAL_STATE_ROLL_CALL_TARGETS[0];
  const store = new MemoryRoutineDataStore();
  const roster = await seedOfficialRoster(store, target, "ask");
  const candidate = goodCandidate(target, "ask", roster);
  const outcome = await processRegisteredRoutineCandidate(store, target.contractId, candidate, T0);
  assert.equal(outcome.candidate.state, "PROMOTED");
  await refreshStateVotesFromPromoted(target.jurisdiction, { store, now: T0, bypassCache: true });
  const member = roster.officeholderIds[0]!;
  const evidence = voteEvidenceFor("Official AZ Member", { officeholderId: member, withinStates: [target.state] });
  assert.equal(evidence.identity.kind, "JOINED");
  assert.equal(evidence.records.length, 1);
  assert.equal(evidence.records[0]?.sourceOrg, target.publisher);
  assert.equal(evidence.records[0]?.sourceUrl, target.probeUrl);
  assert.equal(getStateVotesSnapshot(target.jurisdiction).positions[0]?.officeholderId, member);
});

test("source-namespaced identity mismatch is refused instead of joining a vendor id", async () => {
  const target = OFFICIAL_STATE_ROLL_CALL_TARGETS[0];
  const store = new MemoryRoutineDataStore();
  const roster = await seedOfficialRoster(store, target, "bad-id");
  const malformed = goodCandidate(
    target,
    "bad-id",
    roster,
    T0,
    "plural:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  const outcome = await processRegisteredRoutineCandidate(store, target.contractId, malformed, T0);
  assert.equal(outcome.candidate.state, "SEMANTIC_INVALID");
  assert.equal(outcome.promoted, null);
});

// Compile-time controls: all three unions stay aligned with the target table.
const _source: OfficialStateRollCallSourceId = "az-legislature";
const _scope: OfficialStateVoteScope = "US-AZ";
void [_source, _scope];
