import { publishPollingDoor } from "../lib/civic-data/worker-polling-publication.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { readVotingSitesProjection } from "../lib/ballot/voting-sites-server.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { applyManualEdit, checkDoorDraft } from "../lib/doors/registry.ts";
import { readPollingDoor, type POLLING_DOOR_KINDS } from "../lib/ballot/polling-door-reader.ts";
import type { RecordExtractionShape } from "../lib/control-plane/workers/types.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";

const at = "2026-10-04T09:00:00Z", division = "ocd-division/country:us/state:oh/county:alder";
const fields = ["jurisdictionName", "model", "name", "address", "kind", "election", "serves", "lat", "lng"];
const rows = [["Alder County", "Vote centers", "Library", "1 Public Road", "Election day", "", "", "0", "0"],
  ["Alder County", "Vote centers", "School", "2 Public Road", "Early voting", "", "", "10", "20"]];
const hash = (value: string) => `sha256-${createHash("sha256").update(value).digest("hex")}`;
function fixture(kind: typeof POLLING_DOOR_KINDS[number], sourceRows = rows, ocdId = division) {
  const json = kind === "polling-places-json", html = kind === "polling-places-html";
  const htmlFields = fields.filter((field, at) => !["election", "serves", "lat", "lng"].includes(field) || !sourceRows.every(row => !row[at]));
  const text = json ? JSON.stringify({ count: sourceRows.length, rows: sourceRows.map(row => Object.fromEntries(fields.map((key, at) => [key, row[at]]))) })
    : html ? `<table><tr>${htmlFields.map(field => `<th>${field}</th>`).join("")}</tr>${sourceRows.map(row => `<tr>${htmlFields.map(field => `<td>${row[fields.indexOf(field)]}</td>`).join("")}</tr>`).join("")}</table>`
    : fields.join(",") + "\n" + sourceRows.map(row => row.join(",")).join("\n");
  const extraction: RecordExtractionShape = { ...(json ? { format: "JSON_RECORDS" as const, rowsPointer: "/rows", countPointer: "/count" }
    : html ? { format: "HTML_TABLE" as const, tableIndex: 0, headerRows: 1 }
    : { format: "DELIMITED_TEXT" as const, delimiter: "," as const, headerRows: 1 }),
    fields: Object.fromEntries(fields.flatMap((field, at) => ["election", "serves", "lat", "lng"].includes(field) && sourceRows.every(row => !row[at]) ? [] : [[field, { source: json ? `/${field}` : html ? htmlFields.indexOf(field) : at, type: ["lat", "lng"].includes(field) ? "NUMBER" as const : "STRING" as const }]])) };
  const checked = checkDoorDraft({ doorId: "polling:alder", kind, ocdId, hosts: ["elections.example.gov"], config: { extraction: JSON.stringify(extraction) } });
  assert.ok(checked.ok);
  const capture: WorkerPublicationCapture = { httpStatus: 200, transport: "REACHABLE", partial: false, observedAt: at,
    evidence: { artifactId: "sites", contentHash: hash(text), text, acquiredByAttemptId: "fixture-read", canonicalUrl: "https://elections.example.gov/sites",
      retrievedAt: at, sourceId: "Fixture election authority", methodRouteId: "sites",
      ...(kind === "polling-places-pdf-text" ? { sourceDocument: { artifactId: "raw-pdf", contentHash: hash("%PDF-1.4 fixture bytes"), kind: "PDF_TEXT" as const } } : {}) } };
  return { door: applyManualEdit(null, checked.value, at), capture, jurisdictionName: "Alder County" };
}

test("CSV, JSON, HTML and extracted PDF door mappings preserve every site and source-stated coordinates, leaving unreported election and assignment unknown", () => {
  for (const kind of ["polling-places-csv", "polling-places-json", "polling-places-html", "polling-places-pdf-text"] as const) {
    const input = fixture(kind), read = readPollingDoor(input);
    assert.equal(read.sites.length, 2);
    assert.equal(read.model, "VOTE_CENTER");
    assert.equal(read.election, null, "an unreported election remains unknown");
    assert.equal(read.sites[0].election, null);
    assert.equal(read.sites[1].election, null);
    assert.equal(read.sites[0].lat, 0);
    assert.equal(read.sites[1].lat, 10);
    assert.equal(read.sites[1].address, "2 Public Road");
    assert.equal(read.sites[1].serves, null, "the reader never guesses an assignment");
    const unlocated = rows.map(row => [...row]);
    for (const row of unlocated) { row[7] = ""; row[8] = ""; }
    const unknown = readPollingDoor(fixture(kind, unlocated));
    assert.equal(unknown.sites[0].lat, null);
    assert.equal(unknown.sites[1].lng, null);
    assert.equal(unknown.sites[1].address, "2 Public Road");
    if (kind === "polling-places-pdf-text") assert.equal(read.sourceRawSha256, hash("%PDF-1.4 fixture bytes").slice(7));
  }
});

test("a registered door in another state, district or territory uses the same reader, with source-stated assignments", () => {
  const assigned = rows.map(row => [...row]);
  for (const row of assigned) { row[1] = "Assigned"; row[6] = "Ward 2"; }
  for (const [ocdId, state] of [["ocd-division/country:us/state:mi/place:birch", "MI"],
    ["ocd-division/country:us/district:dc/ward:2", "DC"], ["ocd-division/country:us/territory:pr/municipio:alder", "PR"]]) {
    const read = readPollingDoor(fixture("polling-places-csv", assigned, ocdId));
    assert.equal(read.state, state);
    assert.equal(read.model, "ASSIGNED");
    assert.equal(read.sites[0].serves, "Ward 2");
  }
});

test("incomplete, empty, repeated, cross-jurisdiction or contradictory site captures cannot replace a held list", () => {
  const complete = fixture("polling-places-csv");
  assert.throws(() => readPollingDoor({ ...complete, capture: { ...complete.capture, partial: true } }), /incomplete/);
  assert.throws(() => readPollingDoor(fixture("polling-places-csv", [])), /empty/);
  assert.throws(() => readPollingDoor(fixture("polling-places-csv", [rows[0], rows[0]])), /ambiguous/);
  assert.throws(() => readPollingDoor({ ...complete, jurisdictionName: "Birch County" }), /another jurisdiction/);
  const contradictory = rows.map(row => [...row]); contradictory[1][1] = "Assigned";
  assert.throws(() => readPollingDoor(fixture("polling-places-csv", contradictory)), /contradicts/);
  const halfPoint = rows.map(row => [...row]); for (const row of halfPoint) row[8] = "";
  const knownSites = readPollingDoor(fixture("polling-places-csv", halfPoint));
  assert.equal(knownSites.sites.length, 2, "a missing point never removes a verified voting site");
  assert.equal(knownSites.sites[0].lat, null); assert.equal(knownSites.sites[0].lng, null);
  const mixed = rows.map(row => [...row]); mixed[1][7] = "";
  assert.throws(() => readPollingDoor(fixture("polling-places-csv", mixed)), /lacks mapped field/,
    "until the shared extractor supports nullable cells, hold mixed known/unknown columns instead of dropping known values");
});


test("registered polling doors publish through the normal Slide and typed ballot reader while retaining other jurisdictions", async () => {
  const store = new MemoryRoutineDataStore();
  for (const [kind, ocdId] of [
    ["polling-places-csv", division], ["polling-places-json", "ocd-division/country:us/state:mi/place:alder"],
    ["polling-places-html", "ocd-division/country:us/district:dc/ward:2"],
    ["polling-places-pdf-text", "ocd-division/country:us/territory:pr/municipio:alder"],
  ] as const) {
    const input = fixture(kind, rows, ocdId);
    const published = await publishPollingDoor({ ...input, store, now: at });
    assert.ok(published.promoted);
    const read = await readVotingSitesProjection({ store, now: at, bypassCache: true });
    assert.equal(read.kind, "PROMOTED");
    if (read.kind !== "PROMOTED") throw new Error("Polling sites absent");
    const current = read.value.jurisdictions.find(j => j.ocdId === ocdId)!;
    assert.equal(current.sites.length, 2); assert.equal(current.sites[0].lat, 0);
    assert.equal(current.sites[1].serves, null); assert.equal(current.sites[0].election, null);
    if (kind === "polling-places-pdf-text") assert.equal(current.sourceRawSha256, hash("%PDF-1.4 fixture bytes").slice(7));
    await assert.rejects(publishPollingDoor({ ...input, capture: { ...input.capture, partial: true }, store, now: at }));
    assert.equal((await readVotingSitesProjection({ store, now: at, bypassCache: true })).metadata.versionId, published.promoted.versionId);
  }
  const final = await readVotingSitesProjection({ store, now: at, bypassCache: true });
  assert.equal(final.kind, "PROMOTED");
  if (final.kind === "PROMOTED") assert.equal(final.value.jurisdictions.length, 4);
});
