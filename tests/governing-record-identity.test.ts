import assert from "node:assert/strict";
import { test } from "node:test";
import { governingRecordHolderFor } from "../lib/ballot/governing-record.ts";
import { committedIncumbentHolderFor } from "../lib/ballot/incumbency-resolve.ts";
import { readerPersonKeys } from "../lib/identity/reader-person.ts";
import { candidacyOfficialIdentityStatus, currentOfficialIdentity, currentOfficialIdentityStatus, resolvedCandidacyForOfficial } from "../lib/funding/campaign-money.ts";
import { seatHolderById } from "../lib/registry/server.ts";
import bridge from "../lib/funding/official-candidacies.json" with { type: "json" };

const alma = bridge.rows.find(row => row.holder.name === "Alma Hernández")!;
const gail = bridge.rows.find(row => row.holder.name === "Gail Griffin")!;
const sources: NonNullable<Parameters<typeof governingRecordHolderFor>[1]> = {
  personKeys: readerPersonKeys,
  officialIdentity: currentOfficialIdentity,
  officialStatus: currentOfficialIdentityStatus,
  candidacyStatus: candidacyOfficialIdentityStatus,
  candidacyForOfficial: resolvedCandidacyForOfficial,
  federalPersonHolder: async () => null,
  holderById: seatHolderById,
};

test("record identity follows the committed person across chambers without conferring incumbency", async () => {
  assert.ok(alma.candidacy);
  const target = alma.candidacy.candidacyId;
  assert.equal((await governingRecordHolderFor(target))?.id, alma.holder.id);
  assert.equal(await committedIncumbentHolderFor({ title: alma.candidacy.contestTitle, ocdId: alma.candidacy.divisionId }, target), null);
  assert.equal((await committedIncumbentHolderFor({ title: alma.holder.officeTitle, ocdId: alma.holder.divisions[0] }, target))?.id, alma.holder.id);
});

test("similar and identical display names without committed keys cannot borrow a record", async () => {
  for (const target of ["unresolved:Alma Hernandez", "unresolved:Sally Ann Gonzales", "ballot:unknown:Gail Griffin", "ballot:unknown:David Gowan"]) {
    assert.equal(await governingRecordHolderFor(target), null, target);
  }
});

test("two distinct canonical officials are an ambiguous identity, independent of link order", async () => {
  for (const keys of [[alma.holder.id, gail.holder.id], [gail.holder.id, alma.holder.id]]) {
    assert.equal(await governingRecordHolderFor("fixture:collision", {
      ...sources, personKeys: () => ({ status: "RESOLVED", keys }),
    }), null);
  }
});

test("unresolved and stale person relationships cannot fall through to a federal or other valid link", async () => {
  const holder = await seatHolderById(gail.holder.id);
  assert.ok(holder);
  const fallback = { ...sources, federalPersonHolder: async () => holder };
  assert.equal(await governingRecordHolderFor("fixture:unresolved", {
    ...fallback, personKeys: () => ({ status: "IDENTITY_UNRESOLVED", keys: [] }),
  }), null);
  for (const statusSource of ["officialStatus", "candidacyStatus"] as const) {
    assert.equal(await governingRecordHolderFor(alma.candidacy!.candidacyId, {
      ...fallback, [statusSource]: () => "IDENTITY_UNRESOLVED",
    }), null, statusSource);
  }
});

test("conflicting canonical and federal person bridges stay a gap; repeated identical identity is safe", async () => {
  const other = await seatHolderById(gail.holder.id);
  const same = await seatHolderById(alma.holder.id);
  assert.ok(other && same);
  assert.equal(await governingRecordHolderFor(alma.candidacy!.candidacyId, {
    ...sources, federalPersonHolder: async () => other,
  }), null);
  assert.equal((await governingRecordHolderFor(alma.candidacy!.candidacyId, {
    ...sources, federalPersonHolder: async () => same,
  }))?.id, alma.holder.id);
});

test("a vanished holder record cannot be replaced by a similar name", async () => {
  assert.equal(await governingRecordHolderFor(alma.candidacy!.candidacyId, {
    ...sources, holderById: async () => null,
  }), null);
});

test("a canonical person's delegation role does not hide the legislative record", async () => {
  const candidacy = "ballot-nh-merrimack:state-house-merrimack-7:ebel-karen-elizabeth";
  assert.equal(readerPersonKeys(candidacy).keys.length, 3);
  assert.equal((await governingRecordHolderFor(candidacy))?.id, "plural:947e2e2b-04eb-4f92-9f83-aef8760517e0");
});

test("multiple legislative records still require reconciliation even if a candidacy key agrees", async () => {
  assert.equal(await governingRecordHolderFor("fixture:collision", {
    ...sources,
    personKeys: () => ({ status: "RESOLVED", keys: [alma.holder.id, gail.holder.id] }),
    candidacyForOfficial: () => ({ candidacyId: "fixture:same-candidacy", contestId: "fixture:contest" }),
  }), null);
});
