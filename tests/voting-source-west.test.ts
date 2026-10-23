import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseVotingCapture, readVotingSource } from "../lib/ballot/voting-source-readers.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";

const root = "tests/fixtures/voting-sources/vs-04-west";
interface Capture {
  url: string; finalUrl: string; path: string; status: number; contentType: string;
  savedHash: string; capturedAt: string; responseHeaders?: Record<string, string>;
}
const captures = JSON.parse(readFileSync(`${root}/captures.json`, "utf8")) as Capture[];
const byUrl = new Map(captures.map(capture => [capture.url, capture]));
const doors = JSON.parse(readFileSync(`${root}/config-fragment.json`, "utf8")) as VotingSourceDoor[];
const at = "2026-10-21T04:40:00.000Z";
function door(id: string): VotingSourceDoor { const found = doors.find(row => row.id === id); assert.ok(found, id); return found; }
function saved(url: string): Capture { const capture = byUrl.get(url); assert.ok(capture, `Saved source request: ${url}`); return capture; }
function runtime() {
  const requested: string[] = [];
  const fetcher: typeof fetch = async input => {
    const url = String(input); requested.push(url);
    const capture = saved(url), bytes = readFileSync(capture.path);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), capture.savedHash, capture.path);
    return new Response(bytes, { status: capture.status, headers: { "content-type": capture.contentType, ...capture.responseHeaders } });
  };
  return { fetch: fetcher, now: () => at, requested };
}

test("western statewide files keep all Oregon counties and Washington publisher coordinates", async () => {
  const wa = door("wa-statewide-dropboxes-2026"), capture = saved(wa.url);
  const rows = await parseVotingCapture({ url: wa.url, contentType: capture.contentType, bytes: new Uint8Array(readFileSync(capture.path)) }, wa);
  assert.equal(rows.length, 662, "all publisher rows, including services at shared facilities");
  const washington = await readVotingSource(wa, runtime());
  assert.equal(washington.sites.length, 627);
  assert.equal(new Set(washington.sites.map(site => site.countyName)).size, 39);
  assert.ok(washington.sites.every(site => site.geocodeSource === "PUBLISHER"));
  const oregon = await readVotingSource(door("or-statewide-drop-sites-2026"), runtime());
  assert.equal(oregon.sites.length, 334);
  assert.equal(new Set(oregon.sites.map(site => site.countyName)).size, 36);
  assert.ok(oregon.sites.some(site => site.name === "Baker County Clerk's Office & Drive Up Drop Site" && site.address === "1995 3rd St Suite 150 Baker City OR 97814"));
  assert.ok(oregon.sites.every(site => site.electionDate === "2026-11-03"));
  assert.ok(oregon.sites.every(site => site.hours === "All drop sites are open until 8 PM Election Day"));
  assert.ok(oregon.sites.every(site => !/FINAL|Page \d+ of/.test(`${site.countyName} ${site.address}`)));
});

test("Hawaii current-election tables exclude the primary schedules and retain separate services", async () => {
  const current = doors.filter(source => source.scope.state === "HI");
  assert.equal(current.length, 16);
  const reads = await Promise.all(current.map(source => readVotingSource(source, runtime())));
  assert.ok(reads.every(read => read.sites.length > 0 && read.blanks.length === 0));
  const sites = reads.flatMap(read => read.sites);
  assert.equal(sites.length, 71);
  assert.ok(sites.every(site => site.electionDate === "2026-11-03"));
  assert.ok(sites.every(site => /General Election/.test(site.hours ?? "")));
  assert.ok(sites.every(site => !/Primary Election|August 8|July 27/.test(site.hours ?? "")));
  assert.ok(sites.some(site => site.name === "Honolulu Hale (Courtyard)" && site.kind === "VOTE_CENTER"));
  assert.ok(sites.some(site => site.name === "Honolulu Hale" && site.kind === "DROP_BOX"));
});

test("county files supply public locations without voter identity and retain dated hours", async () => {
  for (const [id, count] of [["ca-alameda-vote-centers-2026", 100], ["co-arapahoe-drop-boxes-2026", 39],
    ["co-arapahoe-vote-centers-2026", 34], ["id-canyon-early-voting-2026", 2],
    ["nm-santa-fe-early_voting-2026", 8], ["nm-santa-fe-vote_center-2026", 34],
    ["wy-natrona-early-voting-2026", 1]] as const) {
    const transport = runtime(), read = await readVotingSource(door(id), transport);
    assert.equal(read.sites.length, count, id);
    assert.ok(read.sites.every(site => site.sources?.every(source => source.documentHash && source.documentUrl)), id);
    assert.ok(!read.blanks.some(blank => blank.reason === "access" || blank.reason === "extraction"), id);
    assert.ok(transport.requested.every(url => !/VoterSearch|WhereToVote|VOSearch|VoterServices|ViewPollingLocation/i.test(url)), id);
    if (id === "id-canyon-early-voting-2026") {
      const office = read.sites.find(site => site.name === "Canyon County Elections Office");
      assert.equal(office?.address, "5815 Graye Lane. Caldwell, ID 83607");
      assert.equal(office?.schedules?.length, 2);
    }
    if (id === "nm-santa-fe-early_voting-2026") {
      assert.ok(read.sites.some(site => site.address.includes("Española")));
      assert.ok(read.sites.every(site => site.hours?.includes("Saturdays: 10am - 6pm")));
    }
  }
});

test("Alaska source failure stays an access gap and a borough municipal file is not relabeled", async () => {
  const alaska = (JSON.parse(readFileSync("data/reference/voting-source-doors.json", "utf8")) as VotingSourceDoor[])
    .find(source => source.id === "fec-ak-chief");
  assert.ok(alaska);
  const read = await readVotingSource(alaska, runtime());
  assert.deepEqual(read.sites, []);
  assert.ok(read.blanks.some(blank => blank.reason === "access" && blank.tried.some(detail => /HTTP 503/.test(detail))));
  const municipal = saved("https://www.fnsb.gov/DocumentCenter/View/468/Polling-Places-by-District-PDF");
  const { pdfVotingTables } = await import("../lib/ballot/voting-source-tables.ts");
  const tables = await pdfVotingTables(new Uint8Array(readFileSync(municipal.path)));
  assert.match(tables[0]?.documentText ?? "", /Regular Municipal Election Polling Places/);
  assert.ok(!doors.some(source => source.url === municipal.url), "a municipal list does not establish the November 3 state election");
});
