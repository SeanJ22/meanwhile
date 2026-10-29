import assert from "node:assert/strict";
import test from "node:test";
import { votingSourceContentHash, votingSourceHashKey, votingSourceManifest, votingSourceReadComplete } from "../lib/ballot/voting-source-hash.ts";
import type { VotingSourceDoor, VotingSourceRead } from "../lib/ballot/voting-source-types.ts";
import type { VotingSitesFile } from "../lib/ballot/voting-sites.ts";

const door: VotingSourceDoor = { id: "town-list", url: "https://elections.example.gov/locations.csv", publisher: "Town clerk",
  scope: { state: "AZ", ocdId: "ocd-division/country:us/state:az/county:example", name: "Example County" },
  shape: "file", covers: ["ELECTION_DAY"], electionDate: "2026-11-03", electionPageUrl: "https://elections.example.gov/",
  extraction: { format: "csv", columns: { name: "Location", address: "Address" } } };
const site = { id: "voting-library", name: "Library", address: "1 Main St", sources: [{ publisher: door.publisher, url: door.url, checkedAt: "2026-10-25" }] } as VotingSourceRead["sites"][number];
const read: VotingSourceRead = { doorId: door.id, sites: [site], rules: [], sources: site.sources!, blanks: [], attempts: [], rawBodies: [
  { url: door.url, contentType: "text/csv", bytes: new TextEncoder().encode("Location,Address\nLibrary,1 Main St") },
  { url: "https://elections.example.gov/robots.txt", contentType: "text/plain", bytes: new TextEncoder().encode("old robots") },
] };

test("voting source fingerprints observe what readers could see and the extraction, never fetch noise, robots or check stamps", () => {
  const hash = votingSourceContentHash([door], read);
  const noise = { ...read, sites: [{ ...site, sources: [{ ...site.sources![0]!, checkedAt: "2026-11-01" }] }], attempts: [{ url: door.url, route: "direct" as const, outcome: "200" }],
    rawBodies: [{ ...read.rawBodies[0]!, bytes: new TextEncoder().encode("Location,Address\nLibrary,1 Main St\n<script src=\"/_Incapsula_Resource?cb=7\"></script>") }] };
  assert.equal(votingSourceContentHash([{ ...door, access: { status: "open", checkedAt: "2026-11-01" } }], noise), hash);
  assert.notEqual(votingSourceContentHash([door], { ...read, sites: [{ ...site, address: "2 Main St" }] }), hash);
  assert.notEqual(votingSourceContentHash([{ ...door, extraction: { ...door.extraction, headerRow: 1 } }], read), hash);
  assert.equal(votingSourceReadComplete(read), true);
  assert.equal(votingSourceReadComplete({ ...read, blanks: [{ id: "more", doorId: door.id, scope: door.scope, reason: "access", status: "open", owed: "Remaining sections", tried: [], next: [] }] }), false);
});

test("an older state package seeds every retained source as owed before any source can confirm the state", () => {
  const unknown = "https://other.example.gov/voting.csv";
  const file: VotingSitesFile = { generatedAt: "2026-10-25", jurisdictions: [
    { ocdId: door.scope.ocdId, state: "AZ", name: "Example County", model: "ASSIGNED", election: null, sites: [],
      sourceOrg: door.publisher, sourceUrl: door.url, collectedAt: "2026-10-25", office: { name: "Town clerk" }, refusal: null },
    { ocdId: "ocd-division/country:us/state:az/county:other", state: "AZ", name: "Other County", model: "ASSIGNED", election: null, sites: [],
      sourceOrg: "Other clerk", sourceUrl: unknown, collectedAt: "2026-10-25", office: { name: "Other clerk" }, refusal: null },
  ] };
  const hashes = votingSourceManifest(file, [door]);
  assert.deepEqual(hashes, { [votingSourceHashKey(door)]: null, [`${file.jurisdictions[1]!.ocdId}|${unknown}`]: null });
  const seeded = { ...file, sourceHashes: { ...hashes, [votingSourceHashKey(door)]: "a".repeat(64) }, sourceManifestVersion: 1 as const };
  assert.deepEqual(votingSourceManifest(seeded, [door]), seeded.sourceHashes);
});
