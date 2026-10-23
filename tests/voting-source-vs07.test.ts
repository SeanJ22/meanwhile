import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readVotingSource } from "../lib/ballot/voting-source-readers.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";

// Saved official responses or trimmed excerpts of them (manifest `excerpt.of` names the full document's
// hash). Multi-page PDFs keep their first page here; full documents stay in the evidence store the replay reads.
const root = "tests/fixtures/voting-sources/vs-07/";
const doors = JSON.parse(readFileSync("data/reference/voting-source-doors.json", "utf8")) as VotingSourceDoor[];
interface Capture { url: string; finalUrl?: string; file: string; status: number; contentType: string; savedHash: string }
const captures = JSON.parse(readFileSync(root + "manifest.json", "utf8")) as Capture[];
const byUrl = new Map(captures.flatMap(capture => [[capture.url, capture], ...(capture.finalUrl ? [[capture.finalUrl, capture] as const] : [])] as const));
const door = (id: string) => { const found = doors.find(source => source.id === id); assert.ok(found, id); return found; };
function runtime(changes = new Map<string, string>()) {
  const fetcher: typeof fetch = async input => {
    const url = String(input), capture = byUrl.get(url);
    assert.ok(capture, `Native response not captured: ${url}`);
    const bytes = readFileSync(root + capture.file);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), capture.savedHash, capture.file);
    return new Response(changes.get(url) ?? bytes, { status: capture.status, headers: { "content-type": capture.contentType } });
  };
  return { fetch: fetcher, now: () => "2026-10-23T12:00:00.000Z" };
}

test("North Carolina's common Election Day hours are checked against its native official guidance", async () => {
  const source = door("vs07-nc-election-day-hours");
  const read = await readVotingSource(source, runtime());
  assert.deepEqual(read.blanks, []);
  assert.equal(read.rules.length, 1);
  assert.equal(read.rules[0]!.text, "Polling places will be open from 6:30 a.m. to 7:30 p.m. on Election Day.");
  assert.ok(read.rawBodies.some(body => body.url === source.url));
  const missing = await readVotingSource(source, runtime(new Map([[source.url, "<html><h1>Election Day</h1></html>"]])));
  assert.equal(missing.rules.length, 0);
  assert.ok(missing.blanks.some(blank => blank.reason === "extraction"));
});

test("San Diego's official November lists retain every center and drop box with their published hours", async () => {
  for (const [id, count] of [["vs07-ca-san-diego-vote-centers", 221], ["vs07-ca-san-diego-early-voting", 221], ["vs07-ca-san-diego-drop-boxes", 152]] as const) {
    const read = await readVotingSource(door(id), runtime());
    assert.equal(read.sites.length, count, id);
    assert.deepEqual(read.blanks, [], id);
    assert.ok(read.sites.every(site => site.electionDate === "2026-11-03" && site.hours), id);
    assert.ok(read.sites.every(site => site.sources?.some(source => source.documentHash && source.documentUrl)), id);
    if (id.endsWith("vote-centers")) assert.ok(read.sites.every(site => site.schedules?.every(schedule => schedule.date === "2026-11-03")));
    if (id.endsWith("early-voting")) assert.ok(read.sites.every(site => site.days?.endsWith("November 2")), "early schedules end before Election Day");
  }
});

test("Philadelphia's native ArcGIS division universe yields every physical polling facility and linked official hours", async () => {
  const source = door("vs07-pa-philadelphia-polling-map"), read = await readVotingSource(source, runtime());
  assert.equal(read.sites.length, 683);
  assert.deepEqual(read.blanks, []);
  assert.ok(read.sites.every(site => site.electionDate === "2026-11-03" && site.hours === "7 A.M. to 8 P.M"));
  assert.equal(new Set(read.sites.flatMap(site => site.assignments?.map(assignment => `${assignment.ward}:${assignment.precinct}`) ?? [])).size, 1703);
  const page = byUrl.get(source.electionPageUrl)!;
  assert.ok(read.sites.every(site => site.sources?.some(evidence => evidence.documentHash === page.savedHash && evidence.documentUrl === source.electionPageUrl)));
  assert.ok(read.sites.every(site => site.sources?.some(evidence => evidence.documentUrl?.includes("/POLLING_PLACES/FeatureServer/0/query?"))), "row evidence remains attached beside the schedule page");
});

test("Bexar's dated official PDFs keep correct addresses and every Election Day center on the saved page", async () => {
  const electionDay = await readVotingSource(door("vs07-tx-bexar-election-day-pdf"), runtime());
  assert.equal(electionDay.sites.length, 29, "page 1 of the 8-page official list");
  assert.deepEqual(electionDay.blanks, []);
  assert.ok(electionDay.sites.every(site => site.electionDate === "2026-11-03" && site.hours === "7:00 AM-7:00 PM"));
  const early = await Promise.all(["vs07-tx-bexar-early-pdf", "vs07-tx-bexar-early-justice-center", "vs07-tx-bexar-early-valley-ranch"].map(id => readVotingSource(door(id), runtime())));
  assert.equal(early.reduce((total, read) => total + read.sites.length, 0), 58);
  assert.ok(early.every(read => read.blanks.length === 0 && read.sites.every(site => site.electionDate === "2026-11-03")));
  const lasPalmas = early.flatMap(read => read.sites).find(site => /LAS PALMAS/i.test(site.name));
  assert.ok(lasPalmas);
  assert.match(lasPalmas.address, /515.*Castroville.*78237/i);
  assert.ok(!early.flatMap(read => read.sites).some(site => /78923|SANANTONIIO/.test(site.address)), "contradictory legacy map address is not used");
});

test("Yuba's native November PDF keeps all 22 places separate across superscript street ordinals", async () => {
  const read = await readVotingSource(door("vs07-ca-yuba-polling-places"), runtime());
  assert.equal(read.sites.length, 22);
  assert.deepEqual(read.blanks, []);
  assert.ok(read.sites.every(site => site.electionDate === "2026-11-03"));
  assert.equal(new Set(read.sites.map(site => site.name)).size, 22);
  assert.ok(read.sites.every(site => site.address.length < 130));
});

test("a linked schedule page cannot authorize a configured facility name or address", async () => {
  const source = structuredClone(door("vs07-pa-philadelphia-polling-map"));
  source.extraction = { ...source.extraction, constants: { ...source.extraction?.constants, name: "Unrelated official office", address: "1400 John F Kennedy Boulevard" } };
  const read = await readVotingSource(source, runtime());
  assert.equal(read.sites.length, 0);
  assert.ok(read.blanks.some(blank => blank.reason === "missing-sites"));
});

test("Pima's active 2026 official CMS article establishes the current filtered app, including its three All-election centers", async () => {
  for (const [id, count] of [["vs07-az-pima-election-day", 129], ["vs07-az-pima-early-voting", 16], ["vs07-az-pima-drop-boxes", 9], ["vs07-az-pima-mobile-voting", 4]] as const) {
    const source = door(id), read = await readVotingSource(source, runtime());
    assert.equal(read.sites.length, count, id);
    assert.deepEqual(read.blanks, [], id);
    assert.ok(read.sites.every(site => site.electionDate === "2026-11-03"), id);
    assert.ok(read.sites.every(site => site.sources?.some(evidence => [source.electionPageUrl, "https://www.pima.gov/pima-votes"].includes(evidence.documentUrl ?? "") && evidence.documentHash)), "the active official page remains cited beside each data row");
  }
});

test("Pima's archived CMS content cannot establish a current election for an active 2024 article", async () => {
  const source = door("vs07-az-pima-election-day"), page = byUrl.get(source.electionPageUrl)!;
  const html = readFileSync(root + page.file, "utf8");
  const quoted = html.match(/\bwindow\.__PRELOADED_STATE__\s*=\s*'((?:\\.|[^'\\])*)'/)![1]!;
  const state = JSON.parse(quoted.replace(/\\([\\'"])/g, "$1"));
  for (const widget of Object.values(state.widgets.universal) as { contentItems: Record<string, { data?: { name?: { en?: string }; article?: { en?: string } } }> }[]) {
    for (const item of Object.values(widget.contentItems)) if (item.data?.name?.en?.includes("2026 General Election")) item.data.name.en = "2024 General Election";
  }
  state.contentItems.archived = { data: { name: { en: "2026 General Election" }, article: { en: `<h2>November 3, 2026</h2><a href="${source.url}">Archived map</a>` } } };
  const embedded = JSON.stringify(state).replace(/<\/script/gi, "<\\/script").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const changed = `<script>window.__PRELOADED_STATE__='${embedded}';</script>`;
  const read = await readVotingSource(source, runtime(new Map([[source.electionPageUrl, changed]])));
  assert.equal(read.sites.length, 129);
  assert.equal(read.sites.filter(site => site.electionDate === "2026-11-03").length, 126, "only rows explicitly naming 2026 General remain associated");
  assert.ok(read.blanks.some(blank => blank.owed === "Current official election-page association for this list"));
});

test("Los Angeles and San Bernardino native lists expand coverage beyond previously held California counties", async () => {
  // San Bernardino's PDFs are first-page excerpts (of 10 and 5 pages); Los Angeles' HTML lists are complete.
  for (const [id, count] of [["vs07-ca-los-angeles-vote-centers", 645], ["vs07-ca-los-angeles-early", 645], ["vs07-ca-los-angeles-drop-boxes", 429], ["vs07-ca-san-bernardino-polling", 14], ["vs07-ca-san-bernardino-drop-boxes", 7]] as const) {
    const read = await readVotingSource(door(id), runtime());
    assert.equal(read.sites.length, count, id);
    assert.deepEqual(read.blanks, [], id);
    assert.ok(read.sites.every(site => site.electionDate === "2026-11-03"), id);
  }
});
