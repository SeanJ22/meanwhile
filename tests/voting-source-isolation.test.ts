import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { recordVotingDiscoveryObservation, votingScopeResolvers, votingSourceEvidence } from "../scripts/fetch-voting-sites.mts";
import { VotingSourceDocumentHeld } from "../lib/ballot/voting-source-evidence.ts";
import { discoverVotingDoors } from "../lib/ballot/voting-source-discovery.ts";
import { votingFetchSession } from "../lib/ballot/voting-source-fetch.ts";
import { combineVotingSourceReads, holdVotingRawEvidence, mergeVotingSourceRead } from "../lib/ballot/voting-source-publication.ts";
import { readVotingSource } from "../lib/ballot/voting-source-readers.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { cycleVault } from "../lib/control-plane/scheduler/vault.ts";
import type { VotingSourceDoor, VotingSourceRuntime } from "../lib/ballot/voting-source-types.ts";

const at = "2026-10-21T05:00:00.000Z";
const door = (JSON.parse(readFileSync("data/reference/voting-source-doors.json", "utf8")) as VotingSourceDoor[])
  .find(row => row.url === "https://vip.sos.nd.gov/Precincts.aspx?eid=348")!;
// Construct a protocol credential without putting a usable credential in the fixture tree.
const credential = ["AI", "za"].join("") + "P".repeat(35);
const restricted = new TextEncoder().encode(`<html><title>North Dakota polling places</title><script>const key='${credential}'</script></html>`);
const clean = readFileSync("tests/fixtures/voting-sources/nd-2026-native.html");

test("a real restricted-store refusal holds that document, then the next official page is read and saved", async () => {
  const root = await mkdtemp(join(tmpdir(), "voting-source-held-"));
  try {
    const repos = createMemoryRepositories(), vault = cycleVault(root);
    const heldUrl = "https://vip.sos.nd.gov/held-polling-list";
    const observed: string[] = [], published: string[] = [];
    const runtime: VotingSourceRuntime = {
      fetch: (async input => String(input).endsWith("/robots.txt") ? new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } })
        : [heldUrl, door.url].includes(String(input)) ? new Response(String(input) === heldUrl ? restricted : `<main><h1>North Dakota polling places</h1>${clean}</main>`, { headers: { "content-type": "text/html" } })
        : new Response(null, { status: 404 })) as typeof fetch,
      onDiscoveredSource: async (observation: Parameters<NonNullable<import("../lib/ballot/voting-source-types.ts").VotingSourceRuntime["onDiscoveredSource"]>>[0]) => {
        observed.push(observation.source.url);
        const result = await recordVotingDiscoveryObservation(repos, { url: observation.source.url, ocdId: door.scope.ocdId,
          state: "ND", names: [door.scope.name], disposition: observation.disposition, capture: observation.capture }, at, vault);
        if (result !== "HELD" && observation.disposition.kind === "EVIDENCE" && observation.disposition.family === "voting") {
          const read = await readVotingSource(observation.source, { fetch: runtime.fetch, now: () => at });
          assert.equal(read.sites.length, 26);
          await holdVotingRawEvidence(read);
          published.push(observation.source.url);
        }
        return result;
      },
      onDiscoveredDoor: async (source: VotingSourceDoor) => { published.push(source.url); },
    };
    const held = await discoverVotingDoors({ ...door, url: heldUrl }, runtime);
    assert.equal(held.skips.length, 1);
    assert.equal(published.length, 0, "the restricted page cannot publish before storage is checked");
    const next = await discoverVotingDoors(door, runtime);
    assert.ok(observed.includes(door.url));
    assert.ok(published.includes(door.url), "the next independently saved official page is still usable");
    assert.ok(next.doors.length + next.evidence.length);
    const notes = JSON.stringify((await repos.fieldManual.list()).map(row => row.value));
    assert.match(notes, /encrypted restricted evidence storage/);
    assert.equal(notes.includes(credential), false);
    assert.equal([...vault.ledger.values()].some(value => value.canonicalUrl === heldUrl), false);
    assert.ok([...vault.ledger.values()].some(value => value.canonicalUrl === door.url));
    assert.ok((await readdir(root)).length);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an unrelated storage failure still fails the source run", async () => {
  const repos = createMemoryRepositories();
  await assert.rejects(recordVotingDiscoveryObservation(repos, { url: door.url, state: "ND", ocdId: door.scope.ocdId,
    names: [door.scope.name], disposition: { kind: "EVIDENCE", family: "voting", recordClass: "VOTING_SITE", belongs: true, quote: "", reason: "Protocol" },
    capture: { contentType: "text/html", bytes: clean } }, at, { putBytes: async () => { throw new Error("disk unavailable"); } }), /disk unavailable/);
});

test("restricted voting documents stay held; official linking pages use a traced sanitized derivative", async () => {
  const body = { url: door.url, contentType: "text/html", bytes: restricted };
  await assert.rejects(holdVotingRawEvidence({ rawBodies: [body] }), error => error instanceof VotingSourceDocumentHeld && error.url === door.url);
  const read = await readVotingSource(door, { fetch: (async () => new Response(clean, { headers: { "content-type": "text/html" } })) as typeof fetch, now: () => at });
  const linking = { ...door, officialLinkingPage: { url: "https://elections.example.gov/link", html: new TextDecoder().decode(restricted) } };
  const evidence = await votingSourceEvidence(linking, read);
  const page = evidence.find(capture => capture.url === linking.officialLinkingPage.url)!;
  assert.ok(page.derivation);
  assert.notEqual(page.derivation.rawHash, page.derivation.derivedHash);
  const saved = gunzipSync(Buffer.from(page.savedDocument!.body, "base64")).toString("utf8");
  assert.equal(saved.includes(credential), false);
  assert.match(saved, /North Dakota polling places/);
  assert.equal(page.derivation.derivedHash, `sha256-${page.rawHash}`);
});

test("separate mappings from the same document replace its prior facts together", async () => {
  const read = await readVotingSource(door, { fetch: (async () => new Response(clean, { headers: { "content-type": "text/html" } })) as typeof fetch, now: () => at });
  const midpoint = Math.floor(read.sites.length / 2);
  const first = { ...read, sites: read.sites.slice(0, midpoint), blanks: [] };
  const second = { ...read, sites: read.sites.slice(midpoint), blanks: [] };
  const previous = mergeVotingSourceRead(undefined, door, read, at);
  const combined = combineVotingSourceReads([first, second]);
  assert.equal(combined.rawBodies.length, new Set(read.rawBodies.map(body => body.url)).size);
  assert.deepEqual(mergeVotingSourceRead(previous, door, combined, at).sites, previous.sites);
});

test("a public polling list may include an unrelated login and CAPTCHA footer", async () => {
  const publicPage = `${clean}<footer><form><input name="password" type="password"><div class="g-recaptcha"></div></form></footer>`;
  const runtime = { fetch: (async () => new Response(publicPage, { headers: { "content-type": "text/html" } })) as typeof fetch };
  assert.ok((await votingFetchSession(runtime).get(door.url)).bytes.length);
  const read = await readVotingSource(door, runtime);
  assert.equal(read.sites.length, 26);
});

test("spreadsheet discovery classifies extracted cells rather than binary ZIP bytes", async () => {
  const workbook = readFileSync("tests/fixtures/voting-sources/mt-2026-polling-satellite.xlsx");
  const source = (JSON.parse(readFileSync("data/reference/voting-source-doors.json", "utf8")) as VotingSourceDoor[]).find(row => row.id === "mt-statewide-polling-2026")!;
  const dispositions: string[] = [];
  await discoverVotingDoors(source, { fetch: (async () => new Response(workbook, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } })) as typeof fetch,
    onDiscoveredSource: async ({ disposition }) => { dispositions.push(JSON.stringify(disposition)); } });
  assert.ok(dispositions.length);
  assert.ok(dispositions.every(value => !value.includes("\\u0000")), "Postgres JSONB cannot store NUL decoded from ZIP bytes");
});

test("a same-source street abbreviation keeps the existing site's identity and publishes its refreshed hours", async () => {
  const fixtures = "tests/fixtures/voting-sources/vs-04-northeast/";
  const source = (JSON.parse(readFileSync(`${fixtures}config-fragment.json`, "utf8")) as VotingSourceDoor[]).find(row => row.id === "vs04-nh-new-london")!;
  const captures = JSON.parse(readFileSync(`${fixtures}captures.json`, "utf8")) as { url: string; finalUrl: string; file: string; status: number; contentType: string }[];
  const read = await readVotingSource(source, { now: () => at, fetch: (async input => {
    const capture = captures.find(row => row.url === String(input) || row.finalUrl === String(input));
    assert.ok(capture);
    return new Response(readFileSync(fixtures + capture.file), { status: capture.status, headers: { "content-type": capture.contentType } });
  }) as typeof fetch });
  assert.equal(read.sites.length, 1);
  const legacy = (JSON.parse(readFileSync("data/reference/voting-legacy-doors.json", "utf8")) as VotingSourceDoor[]).find(row => row.id === "legacy:nh:new-london:town-clerk")!;
  const previous = mergeVotingSourceRead(undefined, source, read, at);
  previous.sites = [{ ...previous.sites[0]!, id: "previously-published-site", address: legacy.extraction!.constants!.address!, hours: undefined, schedules: [], lat: 43.413148146571, lng: -71.980241633663 }];
  const next = mergeVotingSourceRead(previous, source, read, at);
  assert.equal(next.sites.length, 1);
  assert.equal(next.sites[0]!.id, "previously-published-site");
  assert.equal(next.sites[0]!.hours, "7:00am to 7:00pm");
  assert.equal(next.sites[0]!.address, "25 Seamans Rd");
  assert.deepEqual([next.sites[0]!.lat, next.sites[0]!.lng], [previous.sites[0]!.lat, previous.sites[0]!.lng], "the known same-facility point survives an incomplete coordinate refresh");
  const legacyShape = { ...previous, countyFips: undefined, sites: [{ ...previous.sites[0]!, town: undefined, countyFips: undefined, sources: undefined }] };
  assert.equal(mergeVotingSourceRead(legacyShape, source, read, at).sites[0]!.id, "previously-published-site", "legacy scope fields remain authoritative at jurisdiction level");
  const moved = { ...read, sites: [{ ...read.sites[0]!, address: "27 Seamans Rd" }] };
  assert.equal(mergeVotingSourceRead(previous, source, moved, at).sites[0]!.id, read.sites[0]!.id, "a different house number is a different location");
  const ambiguous = { ...previous, sites: [...previous.sites, { ...previous.sites[0]!, id: "second-possible-site" }] };
  assert.equal(mergeVotingSourceRead(ambiguous, source, read, at).sites[0]!.id, read.sites[0]!.id, "ambiguous matches cannot reuse an identity");
});

test("typed county names distinguish Virginia cities from their same-named counties", () => {
  const reference = JSON.parse(readFileSync("data/reference/national_county_time_zones.json", "utf8")) as { counties: [string, string, string, string[]][] };
  const rows = reference.counties.filter(([, state, name]) => state === "VA" && /Fairfax|Richmond|King and Queen/.test(name));
  const scope = "ocd-division/country:us/state:va";
  const divisions = rows.map(([geoid, state, label]) => ({ ocdId: `${scope}/county:${geoid}`, divisionType: "county", geoid, state, label })) as import("../lib/registry/types.ts").Division[];
  const resolver = votingScopeResolvers({ divisions, bodies: [] });
  for (const [geoid, , name] of rows) assert.equal(resolver.resolveCountyFips!(name, "VA"), geoid, name);
  assert.equal(resolver.resolveCountyFips!("Fairfax", "VA"), null, "a bare ambiguous name stays open");
  assert.equal(resolver.resolveCountyFips!("King & Queen County", "VA"), "51097");
});
