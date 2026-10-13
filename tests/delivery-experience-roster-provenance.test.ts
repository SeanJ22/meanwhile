import assert from "node:assert/strict";
import test from "node:test";
import { inheritedRosterSourceFacts, registryMemberCitedUrls } from "../lib/registry/cited-urls.ts";
import { personCardSources } from "../lib/officials/card-sources.ts";
import type { SeatHolder } from "../lib/officials/lookup.ts";

const oldUrl = "https://city.example.gov/old-council";
const newUrl = "https://city.example.gov/council";
const profileUrl = "https://city.example.gov/council/member-1";
const source = { sourceUrl: oldUrl, sourceOrg: "City Council", collectedAt: "2026-09-01" };
const before = {
  bodyId: "ocd-division/country:us/state:az/place:example#council",
  sourceUrl: oldUrl, sourceOrg: source.sourceOrg, collectedAt: source.collectedAt,
  members: [{ id: "member-1", name: "A Person", officeTitle: "Council Member", termNote: "Term ends 2028",
    email: "office@example.gov", phone: "(555) 010-1000", websiteUrl: profileUrl }],
};
const after = {
  ...before, sourceUrl: newUrl, collectedAt: "2026-09-28",
  members: [{ ...before.members[0], phone: "(555) 010-2000",
    retainedFieldSources: { email: source, termNote: source } }],
};

test("an incomplete roster update cites the prior authority only for unchanged retained facts", () => {
  const cited = registryMemberCitedUrls(`body-roster:${before.bodyId}`, after);
  assert.deepEqual(cited, [newUrl, oldUrl].sort());
  assert.ok(inheritedRosterSourceFacts(before, after).has(oldUrl));
  assert.equal(cited.includes(profileUrl), false, "an official profile link on the roster is a link fact, not a read of that profile");
});

test("changed or reattributed optional facts cannot inherit an older source receipt", () => {
  const changedEmail = { ...after, members: [{ ...after.members[0], email: "new@example.gov" }] };
  assert.equal(inheritedRosterSourceFacts(before, changedEmail).has(oldUrl), false);
  const changedPerson = { ...after, members: [{ ...after.members[0], name: "Different Person" }] };
  assert.equal(inheritedRosterSourceFacts(before, changedPerson).has(oldUrl), false);
});

test("a reader's source panel distinguishes the current roster from retained contact evidence", () => {
  const holder = { id: "member-1", name: "A Person", officeTitle: "Council Member", sourceUrl: newUrl,
    provenance: { sourceUrl: newUrl, sourceOrg: "City Council", collectedAt: "2026-09-28", verifiedAt: null },
    retainedFieldSources: { email: source, termNote: source } } as SeatHolder;
  const sources = personCardSources(holder);
  assert.equal(sources.length, 2);
  assert.equal(sources[0]?.provenance.sourceUrl, newUrl);
  assert.equal(sources[1]?.provenance.sourceUrl, oldUrl);
  assert.match(sources[1]?.what ?? "", /previously verified office email.*previously verified term wording/i);
  assert.doesNotMatch(sources[1]?.what ?? "", /and \d+ more from this source/);
});
