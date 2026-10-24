import assert from "node:assert/strict";
import test from "node:test";
import { verifiedCandidateProfilePerson, type HeldCandidatePerson } from "../lib/ballot/held-person.ts";
import type { Candidacy } from "../lib/ballot/types.ts";

const candidate = (name: string): Candidacy => ({ id: `candidate:${name}`, contestId: "new-office", givenName: "", familyName: name,
  partyLabel: null, slogan: null, incumbent: null, websiteUrl: null,
  provenance: { sourceUrl: "https://elections.example.gov/candidates", sourceOrg: "Election authority",
    collectedAt: "2026-10-24T12:00:00Z", verifiedAt: null } });
const official = (url: string) => ({ url, attemptedAt: "2026-10-24", verification: "The official member roster names this person beside this exact member link." });
const holder = (name: string, native: string): HeldCandidatePerson => ({ id: `az-legislature:${native}`, personId: `az-legislature:${native}`,
  name, nativeIds: { "az-legislature": [native] },
  provenance: { sourceUrl: `https://www.azleg.gov/House/House-member/?legislature=57&session=130&legislator=${native}` } });

test("a verified native official profile connects a candidate changing offices to their held person", () => {
  for (const [name, native, chamber] of [["Alma Hernandez", "2312", "House"], ["Sally Ann Gonzales", "2381", "Senate"]]) {
    const found = verifiedCandidateProfilePerson(candidate(name), official(`https://www.azleg.gov/${chamber}/${chamber}-member/?legislature=57&session=130&legislator=${native}`),
      [holder(name, native)]);
    assert.deepEqual(found?.keys, [`az-legislature:${native}`]);
    assert.equal(found?.sourceUrls.length, 2);
  }
});

test("a missing middle name and an exact linked page preserve both publishers' person keys", () => {
  const page = "https://www.azleg.gov/House/House-member/?legislature=57&session=130&legislator=2346";
  const found = verifiedCandidateProfilePerson(candidate("Betty Villegas"), official(page), [holder("Betty J Villegas", "2346"),
    { id: "plural:az:betty", personId: "plural:betty", name: "Betty Villegas", nativeIds: { "plural": ["betty"] }, profileUrls: [page] }]);
  assert.ok(found?.keys.includes("az-legislature:2346"));
  assert.ok(found?.keys.includes("plural:az:betty"));
  assert.ok(found?.keys.includes("plural:betty"));
});

test("name agreement alone, an unverified profile and an obsolete holder name cannot attach records", () => {
  const person = holder("Alma Hernandez", "2312");
  const page = "https://www.azleg.gov/House/House-member/?legislature=57&session=130&legislator=2312";
  assert.equal(verifiedCandidateProfilePerson(candidate("Alma Hernandez"), official(page.replace("2312", "9999")), [person]), null);
  assert.equal(verifiedCandidateProfilePerson(candidate("Alma Hernandez"), { ...official(page), verification: "" }, [person]), null);
  assert.equal(verifiedCandidateProfilePerson(candidate("Alma Hernandez"), { ...official(page), attemptedAt: "" }, [person]), null);
  assert.equal(verifiedCandidateProfilePerson(candidate("Alma Hernandez"), official(page), [{ ...person, name: "A Different Person" }]), null);
  assert.equal(verifiedCandidateProfilePerson(candidate("Alma Hernandez"), null, [person]), null);
  const rosterPage = "https://state.example.gov/legislature/members";
  assert.equal(verifiedCandidateProfilePerson(candidate("Alma Hernandez"), official(rosterPage), [
    { ...person, websiteUrl: rosterPage }, { ...holder("A Different Person", "9999"), websiteUrl: rosterPage },
  ]), null, "a shared roster URL cannot identify a person across offices");
});
