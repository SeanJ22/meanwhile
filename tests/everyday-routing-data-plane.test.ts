import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { GET as meetingsGET } from "../app/api/meetings/route.ts";
import { directPositiveSourceUrls } from "../lib/civic-data/manual-source-isolation.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { prepareManualProjectionSuccessor } from "../lib/civic-data/manual-successor.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { publishRecordedEdge } from "./helpers/reader-edge-meetings.ts";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";
import type { ManualSourceReview, ManualSourceSetReceipt } from "../lib/civic-data/types.ts";
import {
  EVERYDAY_ROUTING_CONTRACT_ID,
  currentEverydayRoutingProjection,
  everydayRoutingImportCandidate,
  readEverydayRoutingProjection,
} from "../lib/routing/everyday-data-plane.ts";
import {
  EVERYDAY_CONTACTS,
  EVERYDAY_MISSES,
  EVERYDAY_TOPIC_IDS,
  EVERYDAY_ZIPS,
  buildEverydayRoutingProjection,
  everydayContactsFor,
  everydayRoutingProjectionFromRecords,
  everydayRoutingProjectionProblems,
  type EverydayRoutingContactRecord,
  type EverydayRoutingProjection,
} from "../lib/routing/everyday.ts";

const T0 = "2026-09-09T12:00:00.000Z";
const T1 = "2026-09-09T12:05:00.000Z";
const BLOCKED = "https://www.tucsonaz.gov/Departments/Transportation-Mobility/Street-Maintenance";
const UNRELATED = "https://www.tucsonaz.gov/Departments/Water/Customer-Service/Contact-Tucson-Water";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function receiptFor(
  projection: EverydayRoutingProjection,
  at: string,
  blockedUrl: string | null = null,
): ManualSourceSetReceipt {
  const sources: ManualSourceReview[] = [...directPositiveSourceUrls(projection)].sort().map((url) => ({
    requestedUrl: url,
    finalUrl: url,
    publisher: "Exact named public-body publisher",
    sourceClass: "OFFICIAL_PUBLISHER",
    retrievedAt: at,
    httpStatus: url === blockedUrl ? 503 : 200,
    rawHash: hash(`${at}\n${url}`),
    reviewedEvidence: "The exact response bytes and this one source-scoped routing member were reviewed together.",
    ...(url === blockedUrl
      ? { reviewOutcome: "BLOCKED" as const, failureDetail: "The exact official page was unavailable for this review." }
      : { reviewOutcome: "SUPPORTED" as const }),
  }));
  return { contractVersion: 1, reviewedAt: at, reviewedBy: "pdc-everyday-routing-test", sources };
}

function contact(
  projection: EverydayRoutingProjection,
  sourceUrl: string,
): EverydayRoutingContactRecord {
  const record = projection.records.find((row) =>
    row.kind === "CONTACT" && row.contact.sourceUrl === sourceUrl
  );
  assert.ok(record?.kind === "CONTACT", `missing contact for ${sourceUrl}`);
  return record;
}

test("the tracked first import accounts for all 36 cells, 26 exact contact sources, and six honest obligations", () => {
  const projection = buildEverydayRoutingProjection();
  assert.deepEqual(everydayRoutingProjectionProblems(projection), []);
  assert.deepEqual(projection.denominator, {
    topics: 9,
    zips: 4,
    cells: 36,
    contactAvailableCells: 30,
    unknownContactOwedCells: 6,
    contactRecords: 36,
    contactSources: 26,
  });
  assert.equal(projection.records.length, 42);
  assert.equal(EVERYDAY_TOPIC_IDS.length * EVERYDAY_ZIPS.length, 36);
  assert.equal(EVERYDAY_MISSES.length, 6);
  const owed = projection.records.filter((record) => record.kind === "CONTACT_OWED");
  assert.equal(owed.length, 6);
  assert.ok(owed.every((record) =>
    record.disposition === "UNKNOWN" && record.holdingStatus === "CONTACT_OWED" &&
    /^https:\/\//.test(record.evidenceSourceUrl) && record.reason.length > 0
  ));
});

test("record identities are canonical and cannot create a second authority for one fact", () => {
  const projection = buildEverydayRoutingProjection();
  const [first, ...rest] = projection.records;
  assert.ok(first);
  const tampered = everydayRoutingProjectionFromRecords([
    { ...first, id: `${first.id}:competing` },
    ...rest,
  ]);
  assert.match(
    everydayRoutingProjectionProblems(tampered).join(" | "),
    /canonical|canonically keyed/,
  );
});

test("a verified contact in a new scope publishes incrementally while unacquired cells remain explicit and prior records survive", async () => {
  const store = new MemoryRoutineDataStore();
  const prior = buildEverydayRoutingProjection();
  const first = everydayRoutingImportCandidate({ version: T0, sourceThrough: T0,
    sourceReceipt: receiptFor(prior, T0), projection: prior });
  assert.ok((await processRegisteredManualCandidate(store, EVERYDAY_ROUTING_CONTRACT_ID, first, T0)).promoted);
  const partial = buildEverydayRoutingProjection([{
    topicId: "roads-local", zips: ["12345"], body: "Fixture borough public works", service: "Local road repair",
    phone: "555-0100", email: null, requestUrl: null, sourceUrl: "https://fixture.gov/roads",
    sourceOrg: "Fixture borough", collectedAt: T1, verification: "PAGE_FETCHED", note: "Isolated source fixture, not a real service record.",
  }], []);
  assert.deepEqual(everydayRoutingProjectionProblems(partial), []);
  assert.equal(partial.denominator.cells, EVERYDAY_TOPIC_IDS.length);
  assert.equal(partial.denominator.unacquiredCells, EVERYDAY_TOPIC_IDS.length - 1);
  const { unacquiredCells: _omitted, ...hiddenGaps } = partial.denominator;
  assert.match(everydayRoutingProjectionProblems({ ...partial, denominator: hiddenGaps }).join(" | "), /unacquiredCells/);
  const next = await prepareManualProjectionSuccessor({ contractId: EVERYDAY_ROUTING_CONTRACT_ID, version: T1, sourceThrough: T1,
    sourceReceipt: receiptFor(partial, T1), payload: partial }, store, T1);
  const published = await processRegisteredManualCandidate(store, EVERYDAY_ROUTING_CONTRACT_ID, next.candidate, T1, next.expectedBaseVersionId);
  assert.ok(published.promoted, JSON.stringify({ state: published.candidate.state,
    code: published.candidate.failureCode, detail: published.candidate.failureDetail }));
  const read = await readEverydayRoutingProjection({ store, now: T1, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") throw new Error("fixture publication absent");
  assert.equal(read.value.records.length, prior.records.length + 1);
  assert.equal(read.value.denominator.unacquiredCells, EVERYDAY_TOPIC_IDS.length - 1);
  assert.equal(read.value.records.filter(record => record.zip === "12345" && record.kind === "CONTACT_OWED").length, 0,
    "unacquired service topics are not invented publisher findings");
});

test("the manual import candidate promotes and the strict read model returns the canonical projection", async () => {
  const store = new MemoryRoutineDataStore();
  const projection = buildEverydayRoutingProjection();
  const candidate = everydayRoutingImportCandidate({
    version: "2026-08-14",
    sourceThrough: "2026-08-14",
    sourceReceipt: receiptFor(projection, T0),
    projection,
  });
  assert.equal(candidate.recordClass, "CURATED_READER_RECORD");
  assert.equal(candidate.scope, "US-AZ+US-NH+US-NJ:everyday-service-routing:v1");
  assert.equal(candidate.normalization.inputRecords, 42);
  assert.equal(candidate.normalization.outputRecords, 42);
  assert.equal(candidate.normalization.droppedRecords, 0);
  assert.ok(candidate.dependentChecks.every((check) =>
    !/(?:playwright|browser|office-opening-spell|pnpm\s+(?:test|build)|software suite)/i.test(`${check.consumer} ${check.detail}`)
  ));

  const outcome = await processRegisteredManualCandidate(
    store,
    EVERYDAY_ROUTING_CONTRACT_ID,
    candidate,
    T0,
  );
  assert.equal(outcome.candidate.state, "PROMOTED");
  assert.equal(outcome.candidate.receipt?.decision, "GOOD");
  const read = await readEverydayRoutingProjection({ store, bypassCache: true, now: T0 });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") {
    assert.deepEqual(read.value.denominator, projection.denominator);
    assert.equal(everydayContactsFor("roads-local", "85701", read.value)[0]?.phone, "311");
  }
});

test("one blocked official source retains only its LKG while an unrelated contact advances", async () => {
  const store = new MemoryRoutineDataStore();
  const first = buildEverydayRoutingProjection();
  const firstCandidate = everydayRoutingImportCandidate({
    version: "2026-08-14",
    sourceThrough: "2026-08-14",
    sourceReceipt: receiptFor(first, T0),
    projection: first,
  });
  const firstOutcome = await processRegisteredManualCandidate(
    store,
    EVERYDAY_ROUTING_CONTRACT_ID,
    firstCandidate,
    T0,
  );
  assert.ok(firstOutcome.promoted);

  const next = structuredClone(first);
  contact(next, BLOCKED).contact.phone = "520-000-0000";
  contact(next, UNRELATED).contact.phone = "520-791-9999";
  const nextCandidate = everydayRoutingImportCandidate(
    {
      version: "2026-08-14-review-2",
      sourceThrough: "2026-08-14",
      sourceReceipt: receiptFor(next, T1, BLOCKED),
      projection: next,
    },
    {
      prior: {
        versionId: firstCandidate.id,
        payload: firstCandidate.readModel as EverydayRoutingProjection,
        sourceReceipt: firstCandidate.retrieval.manualSourceReceipt!,
      },
    },
  );
  const merged = nextCandidate.readModel as EverydayRoutingProjection;
  assert.equal(contact(merged, BLOCKED).contact.phone, "311", "blocked source must retain only its old member");
  assert.equal(contact(merged, UNRELATED).contact.phone, "520-791-9999", "unrelated supported source must advance");
  assert.ok(nextCandidate.excludedFacts?.some((fact) =>
    fact.code === "MANUAL_MEMBER_HELD_LKG" && fact.detail.includes(BLOCKED)
  ));
  assert.deepEqual(everydayRoutingProjectionProblems(merged), []);

  const nextOutcome = await processRegisteredManualCandidate(
    store,
    EVERYDAY_ROUTING_CONTRACT_ID,
    nextCandidate,
    T1,
    firstCandidate.id,
  );
  assert.equal(nextOutcome.candidate.state, "PROMOTED");
  assert.equal(nextOutcome.promoted?.versionId, nextCandidate.id);
  const read = await readEverydayRoutingProjection({ store, bypassCache: true, now: T1 });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") {
    assert.equal(contact(read.value, BLOCKED).contact.phone, "311");
    assert.equal(contact(read.value, UNRELATED).contact.phone, "520-791-9999");
  }
});

test("a newly proven contact closes only its exact CONTACT_OWED cell", async () => {
  const first = buildEverydayRoutingProjection();
  const firstCandidate = everydayRoutingImportCandidate({
    version: "2026-08-14",
    sourceThrough: "2026-08-14",
    sourceReceipt: receiptFor(first, T0),
    projection: first,
  });
  const next = buildEverydayRoutingProjection(
    [...EVERYDAY_CONTACTS, {
      topicId: "parks",
      zips: ["85641"],
      body: "Pima County — Natural Resources, Parks and Recreation",
      service: "County parks and recreation facilities",
      phone: "520-724-5000",
      email: null,
      requestUrl: null,
      sourceUrl: "https://www.pima.gov/1193/",
      sourceOrg: "Pima County",
      collectedAt: "2026-09-09",
      verification: "PAGE_FETCHED",
      note: null,
    }],
    EVERYDAY_MISSES.filter((miss) => !(miss.topicId === "parks" && miss.zip === "85641")),
  );
  const nextCandidate = everydayRoutingImportCandidate(
    {
      version: "2026-09-09",
      sourceThrough: "2026-09-09",
      sourceReceipt: receiptFor(next, T1),
      projection: next,
    },
    {
      prior: {
        versionId: firstCandidate.id,
        payload: firstCandidate.readModel as EverydayRoutingProjection,
        sourceReceipt: firstCandidate.retrieval.manualSourceReceipt!,
      },
    },
  );
  const merged = nextCandidate.readModel as EverydayRoutingProjection;
  assert.deepEqual(everydayRoutingProjectionProblems(merged), []);
  assert.equal(merged.denominator.contactAvailableCells, 31);
  assert.equal(merged.denominator.unknownContactOwedCells, 5);
  assert.ok(merged.records.some((record) =>
    record.kind === "CONTACT" && record.topicId === "parks" && record.zip === "85641"
  ));
  assert.ok(!merged.records.some((record) =>
    record.kind === "CONTACT_OWED" && record.topicId === "parks" && record.zip === "85641"
  ));
  assert.ok(nextCandidate.excludedFacts?.some((fact) =>
    fact.code === "CONTACT_OWED_RESOLVED_BY_SUPPORTED_CONTACT"
  ));
});

test("the meeting server preload carries the full projection to the Reader shell", async () => {
  // The meetings route reads the registry and the Pima County Board of Supervisors' one sitting from the edge, as a reader request does.
  await installRegistryAuthority();
  const pima = MEETING_PARTITION_CONTRACTS.find((p) => p.id === "meetings:legistar:ocd-division%2Fcountry%3Aus%2Fstate%3Aaz%2Fcounty%3Apima%23governing")!;
  const now = new Date().toISOString();
  await publishRecordedEdge([{
    id: `${pima.meetingSource}:pima:test-sitting`, ocdId: pima.ocdId, bodyId: pima.bodyId, bodyName: pima.wiring!.publishingOrg,
    title: "Regular Meeting", startsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), timeZone: pima.wiring!.timeZone,
    location: null, online: { label: "Zoom Webinar", joinUrl: null }, agendaUrl: null, jurisdiction: pima.wiring!.jurisdiction,
    status: "SCHEDULED",
    provenance: { sourceUrl: "https://webapi.legistar.com/v1/pima/events", sourceOrg: pima.wiring!.publishingOrg, collectedAt: now, verifiedAt: null },
  }], [], now, { everydayRouting: buildEverydayRoutingProjection() });

  const response = await meetingsGET(new Request(
    "https://example.test/api/meetings?lat=32.21696&lng=-110.971&zip=85701",
  ));
  assert.equal(response.status, 200);
  const body = await response.json() as {
    everydayRouting?: EverydayRoutingProjection | null;
    everydayRoutingDataState?: string;
  };
  assert.equal(body.everydayRoutingDataState, "PROMOTED", "the edge carries the published projection");
  assert.equal(body.everydayRouting?.kind, "everyday-routing");
  assert.equal(body.everydayRouting?.denominator.cells, 36);
});

test("a store failure cannot reopen the tracked seed in production", async () => {
  const brokenStore = {
    async readPromotion() { throw new Error("database unavailable"); },
    async readCandidate() { throw new Error("must not read a candidate without a pointer"); },
  };
  const result = await readEverydayRoutingProjection({ store: brokenStore, bypassCache: true, now: T1 });
  assert.equal(result.kind, "STORE_UNREACHABLE");
  const previous = process.env.NODE_ENV;
  Object.defineProperty(process.env, "NODE_ENV", {
    value: "production",
    configurable: true,
    enumerable: true,
    writable: true,
  });
  try {
    assert.throws(() => currentEverydayRoutingProjection(), /STORE_UNREACHABLE/);
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Object.defineProperty(process.env, "NODE_ENV", {
      value: previous,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  }
});
