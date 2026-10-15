import assert from "node:assert/strict";
import test from "node:test";
import { registryMemberCitedUrls } from "../lib/registry/cited-urls.ts";
import { personCardSources } from "../lib/officials/card-sources.ts";
import type { SeatHolder } from "../lib/officials/lookup.ts";

const oldUrl = "https://city.example.gov/old-council";
const newUrl = "https://city.example.gov/council";
const source = { sourceUrl: oldUrl, sourceOrg: "City Council", collectedAt: "2026-09-01", verifiedAt: "2026-09-01" };

test("a roster member is not a registry record that cites its own URLs", () => {
  assert.deepEqual(registryMemberCitedUrls("body-roster:ocd-division/country:us/state:az/place:example#council", { sourceUrl: newUrl }), []);
});

test("a reader's source panel names each fact's own page beside the member's seat", () => {
  const holder = { id: "member-1", name: "A Person", officeTitle: "Council Member", sourceUrl: newUrl,
    provenance: { sourceUrl: newUrl, sourceOrg: "City Council", collectedAt: "2026-09-28", verifiedAt: null },
    fieldSources: { email: source } } as unknown as SeatHolder;
  const sources = personCardSources(holder);
  assert.equal(sources.length, 2);
  assert.equal(sources[0]?.provenance.sourceUrl, newUrl);
  assert.equal(sources[1]?.provenance.sourceUrl, oldUrl);
  assert.match(sources[1]?.what ?? "", /A Person — /);
});
