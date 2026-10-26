import assert from "node:assert/strict";
import test from "node:test";
import { votingSourceContentHash, votingSourceHashKey, votingSourceManifest, votingSourceReadComplete } from "../lib/ballot/voting-source-hash.ts";
import type { VotingSourceDoor, VotingSourceRead } from "../lib/ballot/voting-source-types.ts";
import type { VotingSitesFile } from "../lib/ballot/voting-sites.ts";

const door: VotingSourceDoor = { id: "town-list", url: "https://elections.example.gov/locations.csv", publisher: "Town clerk",
  scope: { state: "AZ", ocdId: "ocd-division/country:us/state:az/county:example", name: "Example County" },
  shape: "file", covers: ["ELECTION_DAY"], electionDate: "2026-11-03", electionPageUrl: "https://elections.example.gov/",
  extraction: { format: "csv", columns: { name: "Location", address: "Address" } } };
const read: VotingSourceRead = { doorId: door.id, sites: [], rules: [], sources: [], blanks: [], attempts: [], rawBodies: [
  { url: door.url, contentType: "text/csv", bytes: new TextEncoder().encode("Location,Address\nLibrary,1 Main St") },
  { url: "https://elections.example.gov/robots.txt", contentType: "text/plain", bytes: new TextEncoder().encode("old robots") },
] };

test("voting source hashes observe content and extraction changes, independently of body order, robots and check stamps", () => {
  const hash = votingSourceContentHash([door], read);
  const changedRobots = { ...read, rawBodies: [{ ...read.rawBodies[1]!, bytes: new TextEncoder().encode("new robots") }, read.rawBodies[0]!, read.rawBodies[0]!] };
  assert.equal(votingSourceContentHash([{ ...door, access: { status: "open", checkedAt: "2026-11-01" } }], changedRobots), hash);
  assert.notEqual(votingSourceContentHash([door], { ...read, rawBodies: [{ ...read.rawBodies[0]!, bytes: new TextEncoder().encode("Location,Address\nLibrary,2 Main St") }] }), hash);
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
