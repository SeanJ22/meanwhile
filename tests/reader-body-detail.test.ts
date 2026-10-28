import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { projectBodyDetail } from "../lib/reader/body-detail.ts";
import { withRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { membersOfBody, earlierMembersOfBody } from "../lib/registry/body-membership.ts";
import { officePhoneForBody } from "../lib/meetings/office-phone.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";

test("one-body detail retains the existing member, photo, phone and field sources", () => {
  const fixture = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/registry-transfer-import.json.gz", import.meta.url))).toString());
  const bodyId = "ocd-division/country:us/state:az/county:pima#governing";
  const source = { sourceUrl: "https://example.gov/council", sourceOrg: "Council", collectedAt: "2026-10-01", verifiedAt: null };
  const member = { id: "roster:fixture#one", name: "A Person", officeTitle: "Chair", termNote: null,
    email: "a@example.gov", phone: "520-555-0100", websiteUrl: null, fieldSources: { phone: source } };
  const registry = { ...fixture.projection.payload,
    registry: { ...fixture.projection.payload.registry, bodies: [{ id: bodyId, fieldSources: { officePhone: source } }] },
    bodyRosters: [{ bodyId, bodyName: "County Board", sourceUrl: source.sourceUrl, sourceOrg: source.sourceOrg,
      collectedAt: source.collectedAt, partisanship: "UNDETERMINED", members: [member] }],
    rosterReaderDispositions: [], officialPhotos: { photos: [] }, rosterPhotos: { [member.id]: "/person.jpg" },
  } as RegistryRuntimeReadModel;
  const expected = withRegistryRuntimeProjection(registry, ["AZ"], () => ({
    members: membersOfBody(bodyId).members, earlierMembers: earlierMembersOfBody(bodyId), officePhone: officePhoneForBody(bodyId),
  }));
  const detail = projectBodyDetail("AZ", bodyId, registry, []);
  assert.deepEqual(detail.roster.members, expected.members);
  assert.deepEqual(detail.roster.earlierMembers ?? [], expected.earlierMembers);
  assert.deepEqual(detail.roster.officePhone, expected.officePhone);
  assert.equal(detail.roster.members[0].photoUrl, "/person.jpg");
  assert.deepEqual(detail.fieldSources, { officePhone: source });
});
