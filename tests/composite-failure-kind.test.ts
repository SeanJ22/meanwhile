import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { CompositeSource } from "../lib/sources/composite/index.ts";
import { makeIcalSource } from "../lib/sources/ical/index.ts";
import { wiringForTypes } from "../lib/registry/source-wiring.ts";
import { fetchFailureKind, jobFailureDetail } from "../lib/sources/composite/failure-kind.ts";
import { SourceHttpError } from "../lib/sources/http.ts";
import { sourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-error.ts";
import { parseMeetingPartitionRunnerReceipts } from "../lib/civic-data/runner-receipt.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";

/**
 * WALL versus JOB is decided from the thrown value (RULING 250: check whose
 * stopwatch ran out before naming a wall; RULING 283: an unclassified failure
 * escalates). 2026-09-24: our own VENUE_RESOLUTIONS_MISSING was filed as a
 * publisher wall on three Legistar partitions for ten days.
 */

test("publisher-side failures are walls", () => {
  assert.equal(fetchFailureKind(new SourceHttpError("HTTP 403 for https://pima.legistar.com/Calendar.aspx", 403, "https://pima.legistar.com/Calendar.aspx", 3)), "WALL");
  assert.equal(fetchFailureKind(sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "pima: the publisher request did not complete (TypeError).")), "WALL");
  assert.equal(fetchFailureKind(new TypeError("fetch failed")), "WALL");
  assert.equal(fetchFailureKind(new Error("HTTP 503 for https://example.gov/")), "WALL");
  assert.equal(fetchFailureKind(Object.assign(new Error("aborted"), { name: "AbortError" })), "WALL");
  assert.equal(fetchFailureKind(new Error("connect ECONNREFUSED 10.0.0.1:443")), "WALL");
  assert.equal(fetchFailureKind(new SyntaxError("Unexpected token < in JSON at position 0")), "WALL", "HTML where JSON was promised is the publisher's response");
});

test("our own code and configuration failures are jobs, and so is an unknown", () => {
  assert.equal(fetchFailureKind(new Error("VENUE_RESOLUTIONS_MISSING:legistar:ocd-division/country:us/state:az/county:pima")), "JOB");
  assert.equal(fetchFailureKind(new Error("LEGISTAR_INSITE_SOURCE_WIRING_INVALID:pima-bos")), "JOB");
  assert.equal(fetchFailureKind(new Error("PIMA_OUTCOME_STORE_UNREACHABLE: HTTP 500 from the store")), "JOB", "a coded failure of ours is decided before an inner transport word");
  assert.equal(fetchFailureKind(new TypeError("Cannot read properties of undefined (reading 'venues')")), "JOB");
  assert.equal(fetchFailureKind(new RangeError("Invalid time value")), "JOB");
  assert.equal(fetchFailureKind("something odd happened"), "JOB", "unknown escalates");
});

test("a JOB failure detail says whose failure it is, once", () => {
  const detail = jobFailureDetail("VENUE_RESOLUTIONS_MISSING:legistar:x");
  assert.match(detail, /^JOB_FAILURE: our own code or configuration failed .* not a publisher wall\. VENUE_RESOLUTIONS_MISSING/);
  assert.equal(jobFailureDetail(detail), detail);
});

test("meeting partition receipts parse with and without the additive failureKind", () => {
  const base = {
    source: "meetings:legistar:x", partitionId: "meetings:legistar:x", meetingSource: "legistar", bodyId: "b", scope: "s",
    candidateId: "c-1", acquisitionSucceeded: false, state: "SOURCE_BLOCKED", decision: "FAIL",
    promotedVersion: null, lastKnownGoodVersion: "v-lkg", failureDetail: "HTTP 503", structuralReleaseContract: ZERO_RELEASE_EVENTS,
  };
  const old = parseMeetingPartitionRunnerReceipts(`RCD_MEETING_PARTITION_RECEIPT=${JSON.stringify(base)}`);
  assert.equal(old.ok, true, "an old-shape receipt still parses");
  const tagged = parseMeetingPartitionRunnerReceipts(`RCD_MEETING_PARTITION_RECEIPT=${JSON.stringify({ ...base, failureKind: "JOB", failureDetail: jobFailureDetail("VENUE_RESOLUTIONS_MISSING:x") })}`);
  assert.equal(tagged.ok, true, "the additive field is accepted by the durable receipt contract");
  if (tagged.ok) assert.equal(tagged.receipts[0]?.lastKnownGoodVersion, "v-lkg", "the partition keeps its last-known-good");
});

/*
 * **A REFUSED ROW IS THE PUBLISHER'S ANSWER, NOT OUR EMPTY EXTRACTION.**
 * (2026-09-24.) Sutton and Newbury, NH serve their calendars from one
 * CivicPlus host behind Cloudflare, which intermittently answers the feed
 * with a managed challenge. The fetch layer named it; the iCal row kept only
 * `{ refused: true }`; the composite's zero-row guard then counted that row as
 * a document in hand and filed the town's wall as our JOB — 13 partitions in
 * one hour on 2026-09-24, every one reading "our own code … not a publisher
 * wall". These run the REAL adapter inside the REAL composite on the recorded
 * challenge. An injected fetch never climbs the ladder, so nothing leaves the
 * process.
 */
const SUTTON_CHALLENGE = readFileSync(
  join(process.cwd(), "tests", "fixtures", "sutton-cloudflare-challenge-head.html"),
  "utf8",
);
// Sutton Mills, NH. The iCal rows read their own wired feed; the point only keys the composite cache.
const SUTTON_QUERY = { lat: 43.33, lng: -71.95, radiusKm: 25 } as Parameters<CompositeSource["fetch"]>[0];
const AFTER_THE_CHALLENGE = new Date("2026-09-24T16:00:00Z");

function suttonRows() {
  const rows = wiringForTypes(["ICAL"]).filter((row) => row.config.feedUrl?.includes("suttonnh.gov"));
  assert.ok(rows.length >= 2, `expected Sutton's wired boards, got ${rows.length}`);
  return rows;
}

async function icalChildReport(fetchImpl: typeof fetch, rows = suttonRows()) {
  const composite = new CompositeSource([makeIcalSource(rows, fetchImpl)]);
  const raw = await composite.fetch(SUTTON_QUERY);
  const meetings = composite.normalize(raw, AFTER_THE_CHALLENGE);
  const child = composite.lastReport?.children.find((report) => report.source === "ical");
  assert.ok(child, "the composite reports the iCal child");
  return { child, meetings };
}

test("the town feed answering a Cloudflare challenge is the town's WALL, in its own words", async () => {
  let requests = 0;
  const challenged: typeof fetch = async () => {
    requests += 1;
    return new Response(SUTTON_CHALLENGE, {
      status: 403,
      headers: { "content-type": "text/html; charset=UTF-8", "cf-mitigated": "challenge", server: "cloudflare" },
    });
  };
  const { child, meetings } = await icalChildReport(challenged);
  assert.equal(meetings.length, 0);
  assert.equal(child.ok, false, "a refused retrieval is never a success");
  assert.equal(child.failure, "WALL", "the publisher's challenge is the publisher's wall");
  assert.doesNotMatch(child.error ?? "", /extracted 0 meeting/, "a refusal is not reported as our empty extraction");
  assert.match(child.error ?? "", /every row this source fetched was refused/);
  assert.match(child.error ?? "", /suttonnh\.gov/, "the refusal names the URL that refused");
  assert.equal(child.walledAtRung, 2, "the rung the injected client stopped at is kept");
  assert.equal(requests, 1, "every Sutton row shares one feed: one request, one wall");
  assert.match(jobFailureDetail(child.error ?? ""), /^JOB_FAILURE/, "(control) the JOB wording exists and is not what this child carries");
  assert.notEqual(child.failure, "JOB");
});

test("a challenge served with HTTP 200 is the same wall", async () => {
  const challenged: typeof fetch = async () =>
    new Response(SUTTON_CHALLENGE, { status: 200, headers: { "content-type": "text/html; charset=UTF-8" } });
  const { child } = await icalChildReport(challenged);
  assert.equal(child.ok, false);
  assert.equal(child.failure, "WALL");
  assert.match(child.error ?? "", /challenge page/i);
});

test("a calendar envelope holding no events is refused as the publisher's answer, not our extraction", async () => {
  const empty: typeof fetch = async () =>
    new Response("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nEND:VCALENDAR\r\n", {
      status: 200,
      headers: { "content-type": "text/calendar" },
    });
  const { child } = await icalChildReport(empty);
  assert.equal(child.ok, false);
  assert.equal(child.failure, "WALL");
  assert.match(child.error ?? "", /answered a calendar envelope holding no events/);
});

test("a real calendar we extract nothing from is still OUR zero-row JOB", async () => {
  // The guard's other half: a document genuinely in hand and zero rows out of
  // it stays a failed extraction of ours (RULING 43/269). One row, so the
  // event cannot be accounted as another board's notConfigured drop.
  const planningBoard = suttonRows().filter((row) => row.config.bodyName === "Planning Board");
  assert.equal(planningBoard.length, 1);
  const served: typeof fetch = async () =>
    new Response(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Test//EN",
        "BEGIN:VEVENT",
        "UID:sutton-planning-2019-01-08@test",
        "DTSTART:20190108T190000",
        "SUMMARY:Planning Board Meeting",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
      { status: 200, headers: { "content-type": "text/calendar" } },
    );
  const { child } = await icalChildReport(served, planningBoard);
  assert.equal(child.ok, false);
  assert.equal(child.failure, "JOB");
  assert.match(child.error ?? "", /extracted 0 meeting/);
});
