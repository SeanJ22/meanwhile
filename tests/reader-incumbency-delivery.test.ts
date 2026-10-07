import assert from "node:assert/strict";

import { test } from "node:test";

import { committedIncumbentHolderFor, contestIncumbency, sameSeatDiscriminators } from "../lib/ballot/incumbency-resolve.ts";

import { getRegistryRuntimeReadModel } from "../lib/registry/runtime-read-model.ts";

import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";

await installRegistryAuthority();

const bridge = getRegistryRuntimeReadModel().officialCandidacies;

const county = { ocdId: "ocd-division/country:us/state:nj/county:morris", title: "Member of the Board of County Commissioners" };

const selen = "ballot-nj-morris:county-commissioner:selen";

test("a committed person link cannot establish incumbency in a different body, office, or unrecognized identity", async () => {
  assert.equal((await committedIncumbentHolderFor(county, selen))?.id, "roster:morris#6");
  assert.equal(await committedIncumbentHolderFor({ ...county, ocdId: "ocd-division/country:us/state:nj/county:atlantic" }, selen), null);
  assert.equal(await committedIncumbentHolderFor({ ...county, title: "Mayor" }, selen), null);
  assert.equal(await committedIncumbentHolderFor(county, "ballot:unknown:Tayfun Selen"), null);
});

test("the missing roster-index seam cannot hide a sourced positive or label unknown peers challengers", async () => {
  const actual = await contestIncumbency({ ...county, id: "ballot-nj-morris:county-commissioner", federal: false, voteFor: 3,
    candidates: [{ key: selen, targetKey: selen, display: "Tayfun Selen" }, { key: "unresolved:selen", targetKey: "unresolved:selen", display: "Tayfun Selen" }] }, async () => null, async () => []);
  assert.equal(actual.decisions.get(selen)?.standing, "INCUMBENT");
  assert.equal(actual.holderFor.get(selen)?.id, "roster:morris#6");
  assert.equal(actual.decisions.get("unresolved:selen")?.standing, "UNKNOWN");
  assert.equal(actual.holderFor.has("unresolved:selen"), false);
});

test("two displayed candidates claiming the same committed identity stay unresolved", async () => {
  const actual = await contestIncumbency({ ...county, id: "fixture:duplicate-candidate", federal: false, voteFor: 1,
    candidates: [{ key: "one", targetKey: selen, display: "Tayfun Selen" }, { key: "two", targetKey: selen, display: "Tayfun Selen" }] }, async () => null, async () => []);
  assert.deepEqual([...actual.decisions.values()].map(row => row.standing), ["UNKNOWN", "UNKNOWN"]);
  assert.equal(actual.holderFor.size, 0);
});

test("a municipal place key cannot erase an explicitly different ward, seat, or position", async () => {
  const row = bridge.rows.find(row => row.holder.name === "Mark F. Wrobel") ?? bridge.rows.find(row => row.holder.name.includes("Wrobel"));
  assert.ok(row?.candidacy);
  assert.ok(await committedIncumbentHolderFor({ ocdId: row.candidacy.divisionId, title: row.candidacy.contestTitle }, row.candidacy.candidacyId));
  assert.equal(await committedIncumbentHolderFor({ ocdId: row.candidacy.divisionId, title: row.candidacy.contestTitle.replace("Ward 1", "Ward 2") }, row.candidacy.candidacyId), null);
  for (const kind of ["Ward", "Seat", "Position", "District"]) {
    assert.equal(sameSeatDiscriminators(`Council Member ${kind} 1`, `Council Member ${kind} 2`, row.candidacy.divisionId), false);
    assert.equal(sameSeatDiscriminators(`Council Member ${kind} 1`, "Council Member", row.candidacy.divisionId), false);
  }
});
