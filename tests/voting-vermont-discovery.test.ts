import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { discoverVotingDoors, type ClassifiedVotingSource } from "../lib/ballot/voting-source-discovery.ts";
import { readVotingSource } from "../lib/ballot/voting-source-readers.ts";
import { mergeVotingSourceRead, registeredVotingSourceDoors, saveVotingSourceDoor } from "../lib/ballot/voting-source-publication.ts";
import { planVotingSourceBlanks } from "../lib/ballot/voting-source-blanks.ts";
import type { VotingSourceDoor, VotingSourceRead, VotingSourceRuntime } from "../lib/ballot/voting-source-types.ts";
import { pageAddress } from "../lib/doors/page-doors.ts";
import { classifySourceContent, SOURCE_FAMILIES, sourceLinks } from "../lib/doors/source-content.ts";
import { recordSourceObservation } from "../lib/doors/source-capture.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { cycleVault } from "../lib/control-plane/scheduler/vault.ts";

const NOW = "2026-10-13T18:00:00.000Z";
const path = (file: string) => `tests/fixtures/voting-sources/${file}`;
const manifest = JSON.parse(readFileSync(path("vt-native-capture.json"), "utf8")) as { files: { file: string; url: string; httpStatus: number; sha256: string }[] };
const replay = JSON.parse(readFileSync(path("vt-discovery-replay.json"), "utf8"));
const roots = (JSON.parse(readFileSync(replay.rootReference, "utf8")) as VotingSourceDoor[]).filter(source => source.scope.state === "VT");
const byUrl = new Map(manifest.files.map(file => [pageAddress(file.url)!.url, file]));
const text = (file: string) => readFileSync(path(file), "utf8");

function transport() {
  const requests = new Map<string, number>();
  const fetcher = (async (input: unknown) => {
    const url = pageAddress(String(input))?.url ?? String(input);
    requests.set(url, (requests.get(url) ?? 0) + 1);
    const file = byUrl.get(url);
    return file ? new Response(readFileSync(path(file.file)), { status: file.httpStatus,
      headers: { "content-type": file.file.endsWith(".pdf") ? "application/pdf" : "text/html" } }) : new Response(null, { status: 404 });
  }) as typeof fetch;
  return { fetcher, requests };
}

test("Vermont native replay creates clocks for collections, captures single facts, and keeps only place obligations as blanks", async () => {
  for (const file of manifest.files) assert.equal(createHash("sha256").update(readFileSync(path(file.file))).digest("hex"), file.sha256);
  const repos = createMemoryRepositories(), location = await mkdtemp(join(tmpdir(), "vt-discovery-"));
  const observations: ClassifiedVotingSource[] = [], reads = new Map<string, VotingSourceRead>();
  const { fetcher, requests } = transport();
  const runtime: VotingSourceRuntime = { fetch: fetcher, now: () => NOW, captureCache: new Map(), discoverySeen: new Set() };
  const vault = cycleVault(location);
  runtime.onDiscoveredDoor = async source => { await saveVotingSourceDoor(repos.doors, source, NOW); };
  runtime.onDiscoveredSource = async observation => {
    observations.push(observation);
    const { source, disposition, capture } = observation;
    await recordSourceObservation(repos, { url: source.url, ocdId: source.scope.ocdId, state: "VT", names: [source.scope.name], disposition, capture }, NOW, vault);
    if (disposition.kind === "SKIP") return;
    const mappings = roots.filter(root => pageAddress(root.url)?.url === pageAddress(source.url)?.url);
    for (const mapping of mappings) reads.set(mapping.id, await readVotingSource(mapping, runtime));
  };
  try {
    for (const root of roots) await discoverVotingDoors(root, runtime);
    assert.equal(observations.filter(row => row.disposition.kind === "DOOR").length, replay.after.doors);
    assert.equal(observations.filter(row => row.disposition.kind === "EVIDENCE").length, replay.after.evidence);
    assert.equal(observations.filter(row => row.disposition.kind === "SKIP").length, replay.after.skips);
    assert.equal(observations.filter(row => row.capture).length, replay.heldTargetCaptures);
    assert.equal(new Set(observations.map(row => pageAddress(row.source.url)!.url)).size, observations.length);
    const registered = await registeredVotingSourceDoors(repos.doors);
    assert.equal(registered.length, replay.after.doors);
    assert.ok((await repos.doors.list()).every(row => row.value.checkEveryMinutes !== null && row.value.ocdId));
    const notice = roots.find(root => root.id === "vt-bennington-drop-box-2026")!;
    assert.ok(!registered.some(door => pageAddress(door.url)?.url === pageAddress(notice.url)?.url));
    const read = reads.get(notice.id)!;
    const published = mergeVotingSourceRead(undefined, notice, read, NOW);
    assert.equal(published.sites[0]?.address, "205 South Street, Bennington");
    assert.ok(published.sources?.some(source => source.url === notice.url), "the evidence remains cited in Sources");
    const arlington = roots.find(root => root.id === "vt-arlington-drop-box-closure-2026")!;
    assert.ok(reads.get(arlington.id)?.sites[0]?.locationNotes?.includes("checked daily"));
    const albany = { state: "VT", ocdId: "ocd-division/country:us/state:vt/county:orleans/place:albany_town", name: "Albany town" };
    const places = [notice.scope, arlington.scope, albany];
    const blanks = planVotingSourceBlanks({ electionDate: notice.electionDate, places, doors: roots, reads: [...reads.values()] });
    assert.equal(blanks.length, replay.after.placeBlanks);
    assert.equal(blanks.length, replay.after.blanks);
    assert.ok(blanks.every(blank => places.some(place => place.ocdId === blank.scope.ocdId)));
    assert.ok(blanks.every(blank => !/Match the delegated office|Public voting locations and official delegated-office routes/.test(blank.owed)));
    const bank = await repos.fieldManual.list();
    assert.equal(bank.filter(row => row.value.kind === "SOURCE_EVIDENCE").length, replay.after.evidence);
    assert.equal(bank.filter(row => row.value.kind === "SOURCE_SKIPPED").length, replay.after.skips);
    assert.ok(bank.filter(row => row.value.kind === "SOURCE_EVIDENCE").every(row => (row.value.payload as { copyId: string }).copyId));
    assert.equal(requests.get(pageAddress(notice.url)!.url), 1, "all three place mappings reuse the actual notice capture");
  } finally { await rm(location, { recursive: true, force: true }); }
});

test("content and place decide the disposition on any domain, including a homepage that actually publishes notices", () => {
  const html = text("vt-bennington-nov3-original.html");
  for (const url of ["https://www.benningtonvt.org/_T8_R868.php", "https://media.example.com/video"]) {
    assert.equal(classifySourceContent({ url, text: html, contentType: "text/html", names: ["Bennington"], owed: SOURCE_FAMILIES }).kind, "EVIDENCE");
  }
  assert.equal(classifySourceContent({ url: "https://www.benningtonvt.org", text: text("vt-bennington-home-original.html"), contentType: "text/html", names: ["Bennington"], owed: SOURCE_FAMILIES }).kind, "DOOR");
  assert.equal(classifySourceContent({ url: "https://arlingtonvermont.org/town-clerk", text: text("vt-arlington-clerk-original.html"), contentType: "text/html", names: ["Bennington"], owed: SOURCE_FAMILIES }).kind, "SKIP");
  const links = sourceLinks(text("vt-arlington-home-original.html"), "https://arlingtonvermont.org");
  assert.ok(links.some(link => new URL(link.url).hostname !== "arlingtonvermont.org"));
  assert.equal(new Set(links.map(link => link.url)).size, links.length);
});

test("one normalized voting URL keeps every place mapping on one clock", async () => {
  const repos = createMemoryRepositories();
  const noticeMappings = roots.filter(root => root.url.includes("_T8_R868"));
  for (const [index, source] of noticeMappings.entries()) await saveVotingSourceDoor(repos.doors,
    { ...source, url: `${source.url}${index === 0 ? "" : `?utm_source=${index}#top`}` }, NOW);
  assert.equal((await repos.doors.list()).length, 1);
  assert.deepEqual((await registeredVotingSourceDoors(repos.doors)).map(source => source.id).sort(), noticeMappings.map(source => source.id).sort());
});
