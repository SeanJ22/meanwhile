import assert from "node:assert/strict";
import test from "node:test";

import { currentCuratedReaderRecords, readCuratedReaderProjection } from "../lib/civic-data/curated-reader-read-model.ts";
import type { DerivedInputRef } from "../lib/civic-data/derived-authority.ts";
import { manualProjectionCandidate, type ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import { CROSSWALK_CITATION, type MeetingBodyCrosswalkRow } from "../lib/civic-data/meeting-body-crosswalk.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { deriveWiringDecisions, wiringRowFor, type DerivedWiringInputs, type WiringVerification } from "../lib/control-plane/discovery/derived-wiring.ts";
import { adapterThrowVerification, readHeldCalendars, type HeldCalendarReading } from "../lib/control-plane/discovery/derived-wiring-reading.ts";
import { walkMeetingsDiscoveryNeed } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import type { MeetingsDiscoveryNeed } from "../lib/hunt/meetings-discovery.ts";
import { ZeroRowExtractionError } from "../lib/sources/normalize-account.ts";
import { curatedReaderSourceClass } from "./helpers/curated-reader-source-class.ts";
import { recordedDiscoveryOpen } from "./helpers/recorded-discovery-open.ts";

const NOW = "2026-09-25T02:00:00.000Z";
const T0 = "2026-09-24T12:00:00.000Z";
const JURISDICTION = "az:city:town-of-example";
const OCD = "ocd-division/country:us/state:az/place:example";
const ROUTE = "https://www.example.gov/council.ics";
/* A sitting in the reader window with a place, so the adapter resolves its venue through the projection. */
const ICS = [
  "BEGIN:VCALENDAR", "VERSION:2.0",
  "BEGIN:VEVENT", "UID:council-2026-10-01@example.gov", "SUMMARY:Town Council",
  "DTSTART:20261001T180000Z", "LOCATION:Council Chamber\\, 100 Main St", "END:VEVENT",
  "END:VCALENDAR", "",
].join("\r\n");
const ROBOTS_ALLOW = "User-agent: *\nAllow: /\n";
const VENUE_URLS = [
  "https://public.example.gov/meetings/venue",
  "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=100+Main+St&benchmark=Public_AR_Current&format=json",
];

/** A promoted venue-resolutions version, through the real manual door. */
async function storeWithVenues(): Promise<MemoryRoutineDataStore> {
  const store = new MemoryRoutineDataStore();
  const pkg: ManualProjectionPackage = {
    contractId: "venue-resolutions",
    version: T0,
    sourceThrough: T0,
    sourceReceipt: {
      contractVersion: 1,
      reviewedAt: T0,
      reviewedBy: "a reviewing agent session (test)",
      sources: VENUE_URLS.map((url, index) => ({
        requestedUrl: url, finalUrl: url, publisher: "Exact named primary publisher",
        sourceClass: curatedReaderSourceClass("venue-resolutions"), retrievedAt: T0, httpStatus: 200,
        rawHash: String.fromCharCode("a".charCodeAt(0) + index).repeat(64),
        reviewedEvidence: "The exact response bytes and normalized record were reviewed together.",
      })),
    },
    payload: {
      kind: "venue-resolutions",
      records: [{
        id: "venue:test:body:100mainst", sourceId: "test-source", bodyOcdId: OCD, match: "Council Chamber, 100 Main St",
        name: "Test Council Chamber", address: "100 Main St, Example, AZ 85000", lat: 32.1, lng: -110.9,
        addressSourceUrl: VENUE_URLS[0], coordinateSourceUrl: VENUE_URLS[1], verifiedAt: T0,
      }],
    },
  };
  const outcome = await processRegisteredManualCandidate(store, "venue-resolutions", manualProjectionCandidate(pkg), T0);
  assert.equal(outcome.candidate.state, "PROMOTED", outcome.candidate.failureDetail ?? "");
  return store;
}

/** Set the environment production runs in: the synchronous Reader selectors have no test seed to fall back to. */
function productionEnvironment(): () => void {
  const saved = { NODE_ENV: process.env.NODE_ENV, NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT };
  Reflect.set(process.env, "NODE_ENV", "production");
  Reflect.deleteProperty(process.env, "NODE_TEST_CONTEXT");
  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else Reflect.set(process.env, key, value);
    }
  };
}

async function asProduction<T>(run: () => Promise<T>): Promise<T> {
  const restore = productionEnvironment();
  try {
    return await run();
  } finally {
    restore();
  }
}

function asProductionSync<T>(run: () => T): T {
  const restore = productionEnvironment();
  try {
    return run();
  } finally {
    restore();
  }
}

/** The synchronous selector the adapters' venue lookup uses. */
const currentVenueResolutionRecords = () => currentCuratedReaderRecords("venue-resolutions", []);

function crosswalkRow(patch: Partial<MeetingBodyCrosswalkRow> = {}): MeetingBodyCrosswalkRow {
  const bodyId = `${OCD}#governing`;
  const kind = patch.kind ?? "ICAL";
  return {
    id: `${bodyId}|${kind}`, jurisdictionId: JURISDICTION, ocdId: OCD, bodyId, bodyRole: "GOVERNING", bodyName: "Town Council",
    kind, route: ROUTE, officialHost: "www.example.gov", filter: { titleMatch: "Town Council" },
    publishingOrg: "Town of Example", timeZone: "America/Phoenix",
    evidence: {
      bodyPage: { url: "https://www.example.gov/council", sha256: "1".repeat(64), quote: "The Town Council meets monthly" },
      calendar: { url: ROUTE, sha256: "2".repeat(64), selected: 1, total: 1 },
      readAt: "2026-09-24T20:00:00.000Z",
    },
    status: "ACTIVE", reviewedBy: "a reviewing agent session", reviewedAt: "2026-09-24T20:10:00.000Z", authorization: CROSSWALK_CITATION,
    ...patch,
  };
}

const evidence = { kind: "VAULTED_EVIDENCE" as const, artifactId: "ar-calendar", contentHash: `sha256-${"e".repeat(64)}`, tier: "RAW" as const, retrievedAt: "2026-09-24T21:00:05.000Z" };

function reading(row = crosswalkRow(), text = ICS): HeldCalendarReading {
  return { key: `${row.id}\u0000ar-calendar`, row: wiringRowFor(row), held: { text, contentType: "text/calendar" }, evidence, others: [] };
}

test("C16: the derive reads venue resolutions before any adapter reading, with no test seed to fall back to", async () => {
  const store = await storeWithVenues();
  await readCuratedReaderProjection("venue-resolutions", { store: new MemoryRoutineDataStore(), bypassCache: true, now: NOW });
  assert.throws(() => asProductionSync(() => currentVenueResolutionRecords()), /venue-resolutions projection is NOT_RECORDED/);
  const read = await asProduction(() => readHeldCalendars({
    options: { store, bypassCache: true, now: NOW },
    now: NOW,
    adapterDigest: () => "ical@0123456789ab",
    readings: [reading()],
  }));
  assert.equal(read.kind, "READ", read.kind === "UNREADABLE" ? read.detail : "");
  if (read.kind !== "READ") return;
  const verification = read.verifications.get(reading().key);
  assert.ok(verification !== undefined && "verified" in verification, `the reading verified the row: ${JSON.stringify(verification)}`);
  assert.equal(verification.verified.sittings, 1);
  assert.deepEqual(verification.selected, ["2026-10-01T18:00:00.000Z|Town Council"]);
});

test("a body without a saved venue still reads its verified meeting calendar", async () => {
  const read = await asProduction(() => readHeldCalendars({
    options: { store: new MemoryRoutineDataStore(), bypassCache: true, now: NOW },
    now: NOW,
    adapterDigest: () => "ical@0123456789ab",
    readings: [reading()],
  }));
  assert.equal(read.kind, "READ");
  if (read.kind === "READ") assert.equal(read.verifications.size, 1);
});

/** A reviewed iCal row whose walk confirmed its calendar, decided with the given reading (the derived-wiring fixture). */
async function decisionFor(verification: WiringVerification) {
  const open = recordedDiscoveryOpen({
    "https://example.gov/robots.txt": { status: 200, body: ROBOTS_ALLOW, contentType: "text/plain" },
    "https://example.gov/": { status: 301, location: "https://www.example.gov/" },
    "https://www.example.gov/robots.txt": { status: 200, body: ROBOTS_ALLOW, contentType: "text/plain" },
    "https://www.example.gov/": { status: 200, body: `<a href="/council.ics">Council calendar</a>` },
    [ROUTE]: { status: 200, body: ICS, contentType: "text/calendar" },
  });
  const need: MeetingsDiscoveryNeed = {
    jurisdictionId: JURISDICTION, stateCode: "AZ", name: "TOWN OF EXAMPLE", govClass: "CITY_OR_TOWN",
    ownWebAddress: "example.gov", basis: "SOURCE_DISCOVERY_OWED", sources: [],
    addressSource: { source: "GAP_LEDGER", versionId: "b".repeat(64) },
  };
  let tick = 0;
  const attempt = await walkMeetingsDiscoveryNeed(need, {
    open, spaceOut: async () => {}, vault: async (artifact) => ({ stored: true, where: `vault/${artifact.id}`, why: "stored" }),
    now: () => new Date(Date.parse("2026-09-24T21:00:00.000Z") + (tick++) * 1000).toISOString(), budget: { spent: () => false },
  });
  const crosswalkInput: DerivedInputRef = { kind: "PROMOTED_VERSION", recordClass: "CURATED_READER_RECORD", scope: "US-AZ+US-NH+US-NJ:meeting-body-crosswalk", versionId: "xw-1", readModelSha256: "d".repeat(64), promotedAt: "2026-09-24T20:30:00.000Z" };
  const inputs: DerivedWiringInputs = {
    crosswalk: { input: crosswalkInput, versionId: "xw-1", rows: [crosswalkRow()] },
    registration: () => ({ input: { kind: "PROMOTED_VERSION", recordClass: "REGISTRATION", scope: "US-AZ:registration:v1", versionId: "reg-1", readModelSha256: "c".repeat(64), promotedAt: "2026-09-24T20:00:00.000Z" } }),
    attempts: [{ attempt, recordId: attempt.attemptId, recordedAt: attempt.finishedAt }],
    handWired: () => false,
    vaulted: (artifactId) => ({ ...evidence, artifactId }),
    vaultedBytes: (sha) => ({ ...evidence, artifactId: `ar-bytes-${sha.slice(0, 6)}` }),
    verify: () => verification,
    adapterDigest: () => "ical@0123456789ab",
    previous: [],
    now: NOW,
  };
  return deriveWiringDecisions(inputs)[0];
}

test("C16: an adapter throw of ours is ADAPTER_REFUSED, never CALENDAR_CHANGED: the unread-projection throw itself", async () => {
  /* The venue selector asked before its projection was read. */
  await readCuratedReaderProjection("venue-resolutions", { store: new MemoryRoutineDataStore(), bypassCache: true, now: NOW });
  let thrown: unknown = null;
  try {
    asProductionSync(() => currentVenueResolutionRecords());
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof Error, "the unread selector throws in production");
  const verification = adapterThrowVerification(thrown, ROUTE);
  assert.ok("refused" in verification && !("changed" in verification), JSON.stringify(verification));
  const decision = await decisionFor(verification);
  assert.ok(decision !== undefined && decision.disposition === "HOLD", JSON.stringify(decision));
  assert.equal(decision.reason, "ADAPTER_REFUSED", decision.detail);
  assert.match(decision.detail, /venue-resolutions projection is NOT_RECORDED/);
});

test("C16: the adapter's zero-row extraction stays CALENDAR_CHANGED: the held calendar selects nothing for the reviewed filter", async () => {
  const store = await storeWithVenues();
  /* The body's events page, held, now lists no event at all: the adapter's zero-row extraction. */
  const page = crosswalkRow({ kind: "OFFICIAL_PAGE_EVENTS", route: "https://www.example.gov/council", filter: { nameTerms: "Town Council" } });
  const empty = reading(page, "<html><body><h1>Town Council</h1></body></html>");
  const read = await asProduction(() => readHeldCalendars({
    options: { store, bypassCache: true, now: NOW },
    now: NOW,
    adapterDigest: () => "official-page-events@0123456789ab",
    readings: [empty],
  }));
  assert.equal(read.kind, "READ", read.kind === "UNREADABLE" ? read.detail : "");
  if (read.kind !== "READ") return;
  const verification = read.verifications.get(empty.key)!;
  assert.ok("changed" in verification, JSON.stringify(verification));
  assert.match(verification.changed, /extracted 0 meeting/);
  assert.ok("changed" in adapterThrowVerification(new ZeroRowExtractionError("ical", 1), ROUTE));
  const decision = await decisionFor(verification);
  assert.ok(decision !== undefined && decision.disposition === "HOLD", JSON.stringify(decision));
  assert.equal(decision.reason, "REVIEW_TRIGGERED", "a row never promoted waits for review, unpromoted; a promoted one is suspended");
});
