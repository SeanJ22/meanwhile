import assert from "node:assert/strict";
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { performance } from "node:perf_hooks";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { parseCsv } from "../lib/reference/csv.ts";
import { derivedFamilyReadGroups, readDerivedFamilyMembers } from "../lib/civic-data/derived-meeting-acquisition.ts";
import { derivedWiringKey, type DerivedWiringRecord } from "../lib/civic-data/derived-meeting-wiring.ts";
import { familyMemberReadIssue } from "../lib/civic-data/derived-meeting-family.ts";
import { meetingFetchPass } from "../lib/meetings/shared-fetch.ts";
import { parseMunicodeMeetings } from "../lib/sources/municode/index.ts";

const argument = (name: string, fallback: number) => Number(process.argv.find(value => value.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
const limit = argument("governments", Number.POSITIVE_INFINITY);
const offset = argument("offset", 0);
let inspected = 0;
const pages = argument("pages", 3);
const periods = argument("periods", 4);
assert.ok(pages > 0 && pages <= 9 && periods > 0);
const now = new Date("2026-10-15T12:00:00Z");
const live = process.argv.find(value => value.startsWith("--samples="))?.slice(10);
const samples = ["bremerton", "manor", "hideout"].map(name => {
  const metadata = JSON.parse(readFileSync(`tests/fixtures/municode/${name}.meta.json`, "utf8"));
  const text = readFileSync(live ? `${live}/${name}.html` : `tests/fixtures/municode/${name}.html`, "utf8");
  return { name, bytes: Buffer.byteLength(text), rows: parseMunicodeMeetings(text, metadata.sourceUrl).length };
});
const header = "<table class=\"mcm\"><tr><th>Meeting</th><th>Date</th><th>Time</th><th>Agenda</th><th>Minutes</th></tr>";
const responses = Array.from({ length: pages }, (_, page) => header + Array.from({ length: periods * 8 }, (_, index) => {
  const body = index % 8, serial = page * periods * 8 + index;
  const date = new Date(Date.UTC(2026, 6, 1 + (page * periods + Math.floor(index / 8)) % 180));
  const printed = `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
  return `<tr><td>Body ${body} Board</td><td>${printed}</td><td>7:00 PM</td><td><a href="/agenda.pdf?me=${serial}">Agenda</a></td><td><a href="/minutes.pdf?me=${serial}">Minutes</a></td></tr>`;
}).join("") + `</table><a href="?page=${page + 1}" rel="next">next</a>`);
responses.push(`${header}<tr><td>Old Board</td><td>1/1/2000</td><td></td><td></td><td></td></tr></table>`);
let sourceRequests = 0, sourceBytes = 0, governments = 0, meetings = 0, elapsedMs = 0, longestPlaceMs = 0;
const states = new Map<string, number>();
const started = performance.now();
globalThis.fetch = async () => { throw new Error("UNEXPECTED_NETWORK_OR_DATABASE_ACCESS"); };
const transport = (async input => {
  sourceRequests++;
  const page = Number(new URL(String(input)).searchParams.get("page") ?? 0);
  assert.ok(page < responses.length);
  const text = responses[page];
  sourceBytes += Buffer.byteLength(text);
  return new Response(text, { headers: { "content-type": "text/html" } });
}) as typeof fetch;
const input = createInterface({ input: createReadStream("data/reference/census_govt_units_2022.csv"), crlfDelay: Infinity });
let columns: string[] | null = null, record = "", quoted = false;
for await (const line of input) {
  record += `${line}\n`;
  if ((line.match(/"/g)?.length ?? 0) % 2 !== 0) quoted = !quoted;
  if (quoted) continue;
  const cells = parseCsv(record)[0];
  record = "";
  if (columns === null) { columns = cells; continue; }
  if (!cells?.length) continue;
  if (inspected++ < offset) continue;
  const unit = Object.fromEntries(columns.map((key, index) => [key, cells[index] ?? ""]));
  const state = FIPS_TO_STATE[unit.fips_state]?.postal;
  assert.ok(state);
  unit.state = state;
  assert.ok(unit.census_id_pid6 && unit.unit_name);
  const ocdId = `ocd-division/country:us/state:${unit.state.toLowerCase()}/place:scale-${unit.census_id_pid6}`;
  const route = `https://scale-${unit.census_id_pid6}.municodemeetings.com/`;
  const members: DerivedWiringRecord[] = Array.from({ length: 8 }, (_, body) => {
    const bodyId = `${ocdId}#board-${body}`;
    return { id: derivedWiringKey("MUNICODE", bodyId, route), status: "ACTIVE", row: {
      bodyId, ocdId, bodyName: `Body ${body} Board`, kind: "MUNICODE", route, officialHost: new URL(route).hostname,
      jurisdictionId: `${unit.state}:${unit.census_id_pid6}`, state: `US-${unit.state}`, publishingOrg: unit.unit_name,
      timeZone: "America/Chicago", config: { portalUrl: route, slug: `${unit.census_id_pid6}-${body}`, nameTerms: `Body ${body} Board` },
      crosswalkRowId: `scale-${bodyId}`, reviewedAt: now.toISOString(), verifiedAt: now.toISOString() } };
  });
  const placeStart = performance.now();
  const before = sourceRequests;
  for (const group of derivedFamilyReadGroups(members)) {
    const pass = meetingFetchPass({ fetchImpl: transport });
    const reads = await readDerivedFamilyMembers(group, pass, undefined, now);
    assert.equal(reads.length, 8);
    for (const read of reads) {
      assert.equal(familyMemberReadIssue(read), null);
      assert.equal(read.freshMeetings.length, periods * pages);
      assert.ok(read.freshMeetings.every(meeting => meeting.bodyId === read.member.row.bodyId));
      meetings += read.freshMeetings.length;
    }
    pass.forgetGet(reads[0].acquisitions.map(row => row.requestedUrl));
  }
  assert.equal(sourceRequests - before, pages + 1);
  const placeMs = performance.now() - placeStart;
  elapsedMs += placeMs;
  longestPlaceMs = Math.max(longestPlaceMs, placeMs);
  governments++;
  states.set(unit.state, (states.get(unit.state) ?? 0) + 1);
  if (governments % 1000 === 0) console.error(JSON.stringify({ governments, peakRssMiB: process.resourceUsage().maxRSS / 1024, elapsedSeconds: (performance.now() - started) / 1000 }));
  if (governments >= limit) break;
}
const peakRssMiB = process.resourceUsage().maxRSS / 1024;
console.log(JSON.stringify({ governments, inventoryOffset: offset, states: Object.fromEntries(states), bodies: governments * 8, meetings,
  heldPagesPerPlace: pages, rowsPerPlace: periods * pages * 8, sourceRequests, sourceBytes, sourceBytesPerPlace: sourceBytes / governments,
  databaseBytesReadPerPlace: 0, databaseBytesWrittenPerPlace: 0, databaseBytesReadPerRun: 0, databaseBytesWrittenPerRun: 0,
  databaseBytesPerDayAt24Runs: 0, elapsedSeconds: (performance.now() - started) / 1000,
  acquisitionSeconds: elapsedMs / 1000, meanPlaceMs: elapsedMs / governments, longestPlaceMs, peakRssMiB,
  copiesWith8GiBHostAnd768MiBMargin: Math.floor((8192 - 768) / peakRssMiB),
  copiesWith2928MiBParentAnd1258MiBReservation: Math.floor((8192 - 768 - 2928) / Math.max(1258, peakRssMiB)),
  samples, scope: "portal acquisition, normalization, acquisition evidence, and family body splitting; no database publication" }, null, 2));
