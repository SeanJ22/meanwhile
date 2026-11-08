import assert from "node:assert/strict";
import test from "node:test";

import { contestIncumbency } from "../lib/ballot/incumbency-resolve.ts";
import {
  nhLegislativeHolders,
  nhLegislativeRosterAppliesTo,
  nhSeatHolderReadState,
  refreshNhSeatHolders,
} from "../lib/ballot/seat-holders.ts";
import type { NhMemberReadModel } from "../lib/civic-data/candidate-builders.ts";
import type { CivicDataReadStore } from "../lib/civic-data/read-model.ts";
import type { PromotedProjection } from "../lib/civic-data/types.ts";
import { routineCandidateFixture, routineReceiptFixture, routineRecordFixture } from "./helpers/routine-candidate-fixture.ts";

const AT = "2026-09-09T12:00:00.000Z";
const CANDIDATE_ID = "nh-members-reader-preload-proof";
const CONTEST = {
  id: "ballot-nh-merrimack:state-house-merrimack-7",
  title: "State Representative, Merrimack County District 7",
  ocdId: "ocd-division/country:us/state:nh/sldl:607",
  federal: false,
  voteFor: 2,
  candidates: [
    { key: "ebel", display: "Karen Elizabeth Ebel", targetKey: "ebel" },
    { key: "sargent", display: "Gregory M. Sargent", targetKey: "sargent" },
    { key: "rusis", display: "Cynthia Rusis", targetKey: "rusis" },
  ],
} as const;

const NH_MEMBERS: NhMemberReadModel = {
  formatVersion: 1,
  jurisdiction: "US-NH",
  term: "2025-2026",
  members: [
    {
      chamber: "H",
      familyName: "Ebel",
      givenName: "Karen",
      middleName: "E",
      seatNo: "4005",
      county: "Merrimack",
      district: "7",
      electedStatus: "INCUMBENT",
      party: "D",
      title: "Representative",
      phone: null,
      email: null,
      town: "New London",
      committees: [],
    },
    {
      chamber: "H",
      familyName: "Sargent",
      givenName: "Gregory",
      middleName: "M",
      seatNo: "4072",
      county: "Merrimack",
      district: "7",
      electedStatus: "NEW",
      party: "D",
      title: "Representative",
      phone: null,
      email: null,
      town: "New London",
      committees: [],
    },
  ],
  identities: [
    {
      officeholderId: "nh-general-court:person-ebel",
      officialPersonId: "person-ebel",
      chamber: "H",
      district: "7",
      seatNo: "4005",
    },
    {
      officeholderId: "nh-general-court:person-sargent",
      officialPersonId: "person-sargent",
      chamber: "H",
      district: "7",
      seatNo: "4072",
    },
  ],
  officialIdentityAuthority: {
    sourceUrl: "https://gc.nh.gov/nhgcrollcalls/legislators.txt",
    sourceVersion: "2025-2026",
    observedIdentityRows: 2,
    ordinaryMatches: 2,
    reviewedExceptionMatches: 0,
  },
};

function promotedNhMembersStore(): CivicDataReadStore {
  const value = routineCandidateFixture({
    id: CANDIDATE_ID,
    sourceId: "nh-general-court",
    recordClass: "STATE_LEGISLATOR",
    scope: "US-NH",
    retrievedAt: AT,
    requestedUrl: "https://gc.nh.gov/downloads/Members.txt",
    parserVersion: "nh-general-court/3",
    schemaVersion: "Members.txt+legislators.txt:2025-2026",
    records: 2,
    identities: [],
    temporal: { version: "2025-2026", expectedVersion: "2025-2026" },
    semantics: { factKind: "current NH legislative membership", violations: [] },
    horizon: {
      kind: "BOUNDED",
      query: "the complete official Members.txt membership",
      declaredTotal: 2,
      claimsComplete: true,
    },
    dependentChecks: [{ consumer: "ballot incumbency", passed: true, detail: "Exact district slice is readable." }],
    normalizedPayload: { source: "Members.txt+legislators.txt", rows: 2 },
    readModel: NH_MEMBERS,
  });
  const receipt = routineReceiptFixture(value, {
    validatedAt: "2026-09-09T12:01:00.000Z",
    detail: check => `${check} was proven for the exact NH member projection.`,
  });
  const candidate = routineRecordFixture(value, { receipt });
  const projection = {
    key: "STATE_LEGISLATOR:US-NH",
    sourceId: "nh-general-court",
    recordClass: "STATE_LEGISLATOR",
    scope: "US-NH",
    versionId: CANDIDATE_ID,
    lastKnownGoodVersionId: CANDIDATE_ID,
    promotedAt: "2026-09-09T12:02:00.000Z",
    payload: NH_MEMBERS,
    receipt,
  } satisfies PromotedProjection<NhMemberReadModel>;
  return {
    readPromotion: async <T>(recordClass: string, scope: string) => {
      assert.equal(`${recordClass}:${scope}`, "STATE_LEGISLATOR:US-NH");
      return projection as unknown as PromotedProjection<T>;
    },
    readCandidate: async (candidateId: string) => candidateId === CANDIDATE_ID ? candidate : null,
  };
}

const unavailableStore: CivicDataReadStore = {
  readPromotion: async () => { throw new Error("PLANTED_NH_MEMBER_STORE_FAILURE"); },
  readCandidate: async () => { throw new Error("PLANTED_NH_MEMBER_STORE_FAILURE"); },
};

const absentStore: CivicDataReadStore = {
  readPromotion: async () => null,
  readCandidate: async () => null,
};

async function resolveMerrimackSeven() {
  return contestIncumbency(CONTEST, async () => null, async () => [], {
    certifiedNominees: () => null,
    committedHolder: async () => null,
  });
}

test("a fresh ballot process preloads the permanent NH roster and fails closed on unavailable or absent authority", async () => {
  const initial = nhSeatHolderReadState();
  assert.equal(initial.kind, "STORE_UNREACHABLE");
  if (initial.kind === "STORE_UNREACHABLE") assert.equal(initial.code, "READ_NOT_INITIALIZED");

  assert.equal(nhLegislativeRosterAppliesTo(CONTEST), true);
  assert.equal(
    nhLegislativeRosterAppliesTo({ ...CONTEST, ocdId: "ocd-division/country:us/state:az/sldl:607" }),
    false,
    "an identical title outside New Hampshire cannot open or consume the NH authority",
  );
  assert.equal(
    nhLegislativeRosterAppliesTo({ ...CONTEST, title: "State Representative" }),
    false,
    "an office without the exact district identity cannot consume the NH authority",
  );

  const promoted = await refreshNhSeatHolders({ store: promotedNhMembersStore(), now: AT });
  assert.equal(promoted.kind, "PROMOTED");
  const complete = await resolveMerrimackSeven();
  assert.equal(complete.eligibility.officeholderUniverse.complete, true);
  assert.match(complete.eligibility.officeholderUniverse.source ?? "", /promoted Members\.txt/);
  assert.equal(complete.states.get("ebel"), "INCUMBENT");
  assert.equal(complete.states.get("sargent"), "INCUMBENT");
  assert.equal(complete.states.get("rusis"), "NOT_INCUMBENT");
  assert.equal(complete.eligibility.eligible, false, "the independent filed-candidate universe still refuses labels");
  assert.equal(complete.decisions.get("rusis")?.standing, "UNKNOWN");

  const unavailable = await refreshNhSeatHolders({ store: unavailableStore, now: AT });
  assert.equal(unavailable.kind, "STORE_UNREACHABLE");
  assert.deepEqual(nhLegislativeHolders(CONTEST.title), []);
  const failedClosed = await resolveMerrimackSeven();
  assert.equal(failedClosed.eligibility.officeholderUniverse.complete, false);
  assert.equal(failedClosed.eligibility.unresolved, CONTEST.candidates.length);
  assert.ok([...failedClosed.decisions.values()].every(({ standing }) => standing === "UNKNOWN"));

  const priorNodeEnv = process.env.NODE_ENV;
  try {
    Reflect.set(process.env, "NODE_ENV", "production");
    const absent = await refreshNhSeatHolders({ store: absentStore, now: AT });
    assert.equal(absent.kind, "NOT_RECORDED", "production must not reopen the tracked first seed");
    assert.deepEqual(nhLegislativeHolders(CONTEST.title), []);
    assert.equal((await resolveMerrimackSeven()).eligibility.officeholderUniverse.complete, false);
  } finally {
    if (priorNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", priorNodeEnv);
  }
});
