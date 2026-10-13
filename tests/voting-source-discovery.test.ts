import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { discoverVotingDoors } from "../lib/ballot/voting-source-discovery.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";

const references = ["voting-source-doors.json", "voting-legacy-doors.json"].flatMap(file =>
  JSON.parse(readFileSync(`data/reference/${file}`, "utf8")) as VotingSourceDoor[]);
function named(id: string): VotingSourceDoor {
  const door = references.find(value => value.id === id);
  assert.ok(door);
  return door;
}
function fixtureFetch(url: string, fixture: string): typeof fetch {
  const bytes = readFileSync(`tests/fixtures/voting-sources/${fixture}`);
  return (async input => {
    const requested = String(input);
    if (requested === url) return new Response(bytes, { headers: { "content-type": "text/html" } });
    // Unmapped routes (including robots.txt) are absent in this offline transport.
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}
const sourceOnlyFields: (keyof VotingSourceDoor)[] = [
  "office", "rules", "publication", "publicationMessage", "fileUpdatedAt", "boundaries",
  "matchingUnit", "model", "delegation", "access", "extraction", "changeNotices",
];

test("the real county drop-box page's polling-PDF link does not inherit its box rules or recorder contact", async () => {
  const parent = named("cochise:ballot-box-table");
  assert.ok(parent.rules?.length && parent.office?.phone && parent.model && parent.extraction);
  const result = await discoverVotingDoors(parent, {
    fetch: fixtureFetch(parent.url, "cochise-voter-information-official-extract.html"),
  });
  const child = result.doors.find(door => door.url === "https://www.cochise.az.gov/DocumentCenter/View/4575/Vote-Center-Locations-PDF");
  assert.ok(child);
  assert.equal(child.shape, "file");
  assert.deepEqual(child.covers, ["ELECTION_DAY", "VOTE_CENTER"]);
  assert.deepEqual(child.scope, parent.scope);
  assert.equal(child.discoveredFrom, parent.url);
  assert.equal(child.electionDate, "2026-11-03");
  assert.equal(child.electionAssociationVerified, false, "a parent's verified flag does not replace a date on this linking page");
  assert.equal(child.officialLinkingPage?.url, parent.url);
  assert.match(child.officialLinkingPage?.html ?? "", /Vew Election Day Polling Locations/);
  for (const field of sourceOnlyFields) assert.equal(field in child, false, `${field} belongs to its own source`);
});

test("the native chief-office page keeps its official link chain without stamping its contact or access check onto children", async () => {
  const parent = named("fec-mt-chief");
  assert.ok(parent.office?.phone && parent.access?.checkedAt);
  const discovered: VotingSourceDoor[] = [];
  const result = await discoverVotingDoors(parent, {
    fetch: fixtureFetch(parent.url, "mt-chief-election-native.html"),
    onDiscoveredDoor: async door => { discovered.push(door); },
  });
  const child = result.doors.find(door => door.url === named("mt-statewide-polling-2026").url);
  assert.ok(child);
  assert.ok(discovered.includes(child), "the independently attributed route reaches immediate publication");
  assert.equal(child.publisher, parent.publisher);
  assert.equal(child.electionDate, parent.electionDate);
  assert.equal(child.officialLinkingPage?.url, parent.url);
  assert.deepEqual(child.officialLinkingPage?.linkingPage, parent.officialLinkingPage);
  for (const door of discovered) for (const field of sourceOnlyFields) {
    assert.equal(field in door, false, `${field} must not migrate from a chief-office page`);
  }
  assert.strictEqual(result.doors[0], parent, "the root keeps its own verified metadata");
});
