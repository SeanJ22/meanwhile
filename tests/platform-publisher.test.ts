import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { platformPublisherFetch, withPlatformPublisher } from "../lib/doors/platform-publisher.ts";
import { websiteRequestLimit, websiteSizeFromHoldings } from "../lib/control-plane/scheduler/host-supervision.ts";
import { memoryWebsitePacing, websiteOf } from "../lib/control-plane/website-pacing.ts";
import type { BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { readCivicPlusGovernment } from "../lib/control-plane/discovery/platform-civicplus.ts";
import { captureSourceAcquisitions } from "../lib/sources/acquisition-trace.ts";
import { retainMeetingFetchBytes } from "../lib/civic-data/retained-meeting-bytes.ts";

test("a platform reader built before acquisition retains the actual response and its source evidence", async () => {
  const original = globalThis.fetch;
  const url = "https://school.community.diligentoneplatform.com/Services/MeetingsService.svc/meetings";
  globalThis.fetch = async () => new Response('[{"Id":161,"Name":"Board meeting"}]', { headers: { "content-type": "application/json" } });
  try {
    const read = platformPublisherFetch([{ config: { governmentWebsite: "https://school.k12.de.us", platformPublisherUrl: url } } as unknown as BodySourceWiring])!;
    const retained = await retainMeetingFetchBytes(() => captureSourceAcquisitions(run => run("diligent", async () => (await read(url)).text())));
    assert.equal(retained.value.evidence.length, 1);
    assert.equal(retained.responses.length, 1);
    assert.equal(retained.value.evidence[0]!.source, "diligent");
    assert.equal(retained.value.evidence[0]!.rawHash, retained.responses[0]!.rawHash);
    assert.equal(new TextDecoder().decode(retained.responses[0]!.bytes), retained.value.value);
  } finally { globalThis.fetch = original; }
});

test("an ordinary platform door applies its registered small publisher's ten-request allowance without leaking to another government or a national API", async t => {
  const root = mkdtempSync(join(tmpdir(), "mp01-publisher-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "data/states/ny/reference/publisher-sizes.jsonl"); mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ state: "ny", host: "small.gov", website: "https://small.gov/", censusId: "one", name: "Small Government",
    kind: "local-government", population: 9999, students: null, populationYear: 2022, studentsYear: null,
    source: { url: "https://census.gov/fixture", dataset: "TEST FIXTURE", row: 1, sheet: "TEST FIXTURE", sha256: "a".repeat(64), archiveSha256: "b".repeat(64) } }));
  const size = websiteSizeFromHoldings(["NY"], root), pacing = memoryWebsitePacing(), target = "https://ny-small.civicplus.com/AgendaCenter";
  const fetchImpl: typeof fetch = async input => {
    const url = String(input), limit = websiteRequestLimit(size(url));
    assert.equal(limit, 10);
    if (!(await pacing.take(websiteOf(url), limit, 0)).ok) throw new Error("Publisher hourly allowance exhausted");
    return new Response("published calendar");
  };
  const row = { config: { governmentWebsite: "https://small.gov/", platformPublisherUrl: target } } as unknown as BodySourceWiring;
  const read = platformPublisherFetch([row], fetchImpl)!;
  for (let n = 0; n < 10; n++) await read(target);
  await assert.rejects(read(target), /hourly allowance/);
  assert.equal(size(target), null, "another worker inherits no publisher alias");
  assert.equal(withPlatformPublisher("https://small.gov/", "https://webapi.legistar.com/v1/small/events", () => size("https://webapi.legistar.com/v1/small/events")), null);
  assert.equal(platformPublisherFetch([], undefined), undefined, "unrelated adapters keep their existing default HTTP reader");
});

test("a paced CivicPlus retry resumes other category feeds instead of rereading already acquired calendars", async () => {
  const now = "2026-10-20T00:00:00Z", origin = "https://small.civicplus.com", checkedCalendars: Record<string, string> = {};
  const first = `${origin}/common/modules/iCalendar/iCalendar.aspx?catID=1&feed=calendar`;
  const second = `${origin}/common/modules/iCalendar/iCalendar.aspx?catID=2&feed=calendar`;
  const requests: string[] = []; let refuseSecond = true;
  const index = `<a href="${first}">City Council</a><a href="${second}">Planning Commission</a>`;
  const runtime = { now: () => now, spaceOut: async () => {}, budget: { spent: () => false }, vault: async () => ({ stored: true, where: "fixture", why: "saved" }),
    open: async ({ url }: { url: string }) => { requests.push(url); const failed = url === second && refuseSecond;
      const body = url.endsWith("/iCalendar.aspx") ? index : url === first || url === second ? "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:fixture\nDTSTART:20261020T190000Z\nSUMMARY:City Council\nEND:VEVENT\nEND:VCALENDAR" : "User-agent: *\nAllow: /";
      return { status: failed ? null : 200, body: failed ? "" : body, contentType: url === first || url === second ? "text/calendar" : "text/html", bytes: body.length, transportError: failed ? "Website allowance exhausted" : null, location: null }; } };
  const input = { need: { jurisdictionId: "ny:city:small", stateCode: "NY", name: "Small City", govClass: "CITY_OR_TOWN", ownWebAddress: origin, sources: [], basis: "SOURCE_DISCOVERY_OWED" as const }, runtime, checkedCalendars,
    publisher: { url: `${origin}/AgendaCenter`, page: { status: 200, body: "<title>Small City</title>", bytes: 25, contentType: "text/html", transportError: null, location: null } } };
  await readCivicPlusGovernment(input);
  assert.ok(Object.keys(checkedCalendars).some(key => key.startsWith(first + "|")));
  requests.length = 0; refuseSecond = false;
  await readCivicPlusGovernment(input);
  assert.ok(!requests.includes(first), "its ordinary door owns the current feed");
  assert.ok(requests.includes(second), "the remaining calendar gets the next hourly allowance");
});
