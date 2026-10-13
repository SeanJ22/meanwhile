import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyManualEdit, checkDoorDraft } from "../lib/doors/registry.ts";
import { readPollingDoor } from "../lib/ballot/polling-door-reader.ts";
import { parseVotingCapture, votingRowsToSites } from "../lib/ballot/voting-source-readers.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";
import type { RecordExtractionShape } from "../lib/control-plane/workers/types.ts";
import type { Registry } from "../lib/registry/types.ts";
import { votingChiefRoots, votingScopeResolvers, votingSourceEvidence, votingReadHasFacts } from "../scripts/fetch-voting-sites.mts";

const doors = JSON.parse(readFileSync("data/reference/voting-legacy-doors.json", "utf8")) as VotingSourceDoor[];
const named = (id: string) => { const door = doors.find(row => row.id === id); assert.ok(door); return door; };
const at = "2026-10-13T00:00:00.000Z";

test("FEC directory provenance remains the first discovery stop in every requested jurisdiction", () => {
  const reference = JSON.parse(readFileSync("data/reference/voting-source-doors.json", "utf8")) as VotingSourceDoor[];
  const roots = votingChiefRoots(reference);
  assert.equal(new Set(roots.map(door => door.scope.state)).size, 52);
  assert.ok(roots.every(door => door.discoveredFrom === "data/reference/fec_state_election_offices.csv"));
  assert.ok(roots.some(door => door.scope.state === "DC"));
  assert.ok(roots.some(door => door.scope.state === "PR"));
});

test("the actual Census registry fixes county and town identity without borrowing a same-name place from another state", () => {
  const registry = JSON.parse(readFileSync("lib/registry/registry.json", "utf8")) as Registry;
  const resolve = votingScopeResolvers(registry);
  assert.equal(resolve.resolveCountyFips?.("Pima County", "AZ"), "04019");
  assert.equal(resolve.resolveCountyFips?.("Pima County", "NH"), null);
  const town = resolve.resolveScope?.("New London", "https://newlondon.nh.gov/", { state: "NH", name: "New Hampshire", ocdId: "ocd-division/country:us/state:nh" });
  assert.equal(town?.countySubdivisionGeoid, "3301352100");
  assert.equal(town?.countyFips, "33013");
  const wrongCounty = resolve.resolveScope?.("New London", "https://newlondon.nh.gov/", { state: "NH", name: "Hillsborough", ocdId: "ocd-division/country:us/state:nh/county:hillsborough", countyFips: "33011" });
  assert.equal(wrongCounty, null);
  const morris = { state: "NJ", name: "Morris", ocdId: "ocd-division/country:us/state:nj/county:morris", countyFips: "34027" };
  assert.equal(resolve.resolveScope?.("Chatham Township Polling Locations", "https://www.morriscountynj.gov/", morris)?.countySubdivisionGeoid, "3402712130");
  assert.equal(resolve.resolveScope?.("Chatham Borough Polling Locations", "https://www.morriscountynj.gov/", morris)?.countySubdivisionGeoid, "3402712100");
  assert.equal(resolve.resolveScope?.("Chatham", "https://www.morriscountynj.gov/", morris), null, "the source must distinguish the borough from the township");
});

test("source publication needs acquired facts and keeps only its own source evidence", () => {
  const door = named("legacy:cochise:vote-center-pdf");
  const raw = { url: door.url, contentType: "application/pdf", bytes: readFileSync("tests/fixtures/cochise-2026-vote-centers.pdf") };
  const read = { doorId: door.id, sites: [], rules: [], sources: [], office: door.office, blanks: [], attempts: [], rawBodies: [] };
  assert.equal(votingReadHasFacts(door, read), false, "configured contact text is not a successful source read");
  const captured = { ...read, sources: [{ publisher: door.publisher, url: door.url }], rawBodies: [raw] };
  assert.equal(votingReadHasFacts(door, captured), true);
  const other = named("cochise:ballot-box-table");
  const evidence = votingSourceEvidence(door, captured, [{ url: other.url, contentType: "text/html",
    bytes: readFileSync("tests/fixtures/voting-sources/cochise-voter-information-official-extract.html") }]);
  assert.equal(evidence.length, 1);
  assert.deepEqual(Buffer.from(evidence[0]!.split("\n\n")[1]!, "base64"), raw.bytes);
});

test("the prior official routes remain data, including mixed-election filters and the closed public state list", () => {
  assert.equal(new Set(doors.map(door => door.id)).size, doors.length);
  const layers = doors.filter(door => door.shape === "map-service");
  assert.equal(layers.length, 4);
  assert.ok(layers.every(door => /FeatureServer\/0$/.test(door.url)));
  assert.deepEqual(named("pima:ballot-drop-boxes").covers, ["DROP_BOX"]);
  assert.deepEqual(named("legacy:pima:Primary_2024_EVS_Locations").extraction?.filters, { Election: "2026 General" });
  assert.deepEqual(named("legacy:pima:mobileVotingSites").extraction?.filters, { Election: "2026 General" });
  assert.equal(named("legacy:morris:municipal-polling-directory").delegation, "town");
  assert.equal(named("legacy:nh:clerk-and-polling-list").access?.status, "bot-wall");
  assert.match(named("legacy:nh:clerk-and-polling-list").access?.detail ?? "", /deliberately not called/);
  assert.equal(named("legacy:nh:new-london:town-clerk").electionAssociationVerified, false);
});

test("the official county HTML table keeps all five ballot boxes, their hours and the day-before close rule", async () => {
  const door = named("cochise:ballot-box-table");
  const capture = { url: door.url, contentType: "text/html", bytes: readFileSync("tests/fixtures/voting-sources/cochise-voter-information-official-extract.html") };
  const result = votingRowsToSites(await parseVotingCapture(capture, door), door, { publisher: door.publisher, url: door.url });
  assert.equal(result.sites.length, 5);
  const bisbee = result.sites.find(site => site.town === "Bisbee");
  assert.equal(bisbee?.name, "Cochise County Recorder");
  assert.equal(bisbee?.address, "1415 Melody Lane, Building B");
  assert.match(bisbee?.hours ?? "", /24 hours\s+7 days a week/);
  assert.ok(result.sites.every(site => site.kind === "DROP_BOX"));
  assert.match(result.sites.find(site => site.town === "Benson")?.hours ?? "", /Monday - Friday\s+8:00 am - 5:00 pm/);
  assert.match(door.rules?.[0]?.text ?? "", /November 2nd at 5:00 pm/);
  assert.match(door.rules?.[0]?.text ?? "", /any Vote Center or the Recorder's Office in Bisbee/);
  assert.equal(result.office?.phone, "520-432-8350");
});

test("registered polling publication retains hours, notes, office phone, rules and citations from the real county PDF", async () => {
  const sourceDoor = named("legacy:cochise:vote-center-pdf");
  const bytes = readFileSync("tests/fixtures/cochise-2026-vote-centers.pdf");
  const source = { publisher: sourceDoor.publisher, url: sourceDoor.url };
  const sites = votingRowsToSites(await parseVotingCapture({ url: sourceDoor.url, contentType: "application/pdf", bytes }, sourceDoor), sourceDoor, source).sites;
  const rows = sites.map(site => ({ jurisdictionName: sourceDoor.scope.name, model: sourceDoor.model, name: site.name,
    address: site.address, kind: site.kind, days: site.days, hours: site.hours, locationNotes: site.locationNotes,
    officeName: sourceDoor.office?.name, officePhone: sourceDoor.office?.phone,
    rules: sourceDoor.rules?.[0]?.text, sourceTitle: sourceDoor.title }));
  const text = JSON.stringify({ rows });
  const extraction: RecordExtractionShape = { format: "JSON_RECORDS", rowsPointer: "/rows",
    fields: Object.fromEntries(Object.keys(rows[0]!).map(key => [key, { source: `/${key}`, type: "STRING" as const }])) };
  const draft = checkDoorDraft({ doorId: "polling:county-pdf", kind: "polling-places-json", ocdId: sourceDoor.scope.ocdId,
    hosts: [new URL(sourceDoor.url).hostname], config: { extraction: JSON.stringify(extraction) } });
  assert.ok(draft.ok);
  const read = readPollingDoor({ door: applyManualEdit(null, draft.value, at), jurisdictionName: sourceDoor.scope.name,
    capture: { httpStatus: 200, transport: "REACHABLE", partial: false, observedAt: at,
      evidence: { artifactId: "county-pdf-text", contentHash: `sha256-${createHash("sha256").update(text).digest("hex")}`,
        text, acquiredByAttemptId: "saved-real-pdf", canonicalUrl: sourceDoor.url, retrievedAt: at,
        sourceId: sourceDoor.publisher, methodRouteId: sourceDoor.id,
        sourceDocument: { artifactId: "county-pdf", contentHash: `sha256-${createHash("sha256").update(bytes).digest("hex")}`, kind: "PDF_TABLES" } } } });
  assert.equal(read.model, "VOTE_CENTER");
  assert.equal(read.sites.length, 18);
  assert.ok(read.sites.every(site => site.kind === "VOTE_CENTER" && site.hours === "6:00 a.m. to 7:00 p.m."));
  assert.equal(read.office?.phone, "520-432-8970");
  const center = read.sites.find(site => site.name === "Shiloh Christian Ministries");
  assert.equal(center?.locationNotes, "Sierra Vista East (Mega VC)");
  assert.equal(center?.rules?.[0]?.source.url, sourceDoor.url);
  assert.equal(center?.sources?.[0]?.title, sourceDoor.title);
  assert.equal(read.sourceRawSha256, createHash("sha256").update(bytes).digest("hex"));
});
