import assert from "node:assert/strict";
import test from "node:test";

import {
  CURATED_READER_CONTRACT_IDS,
  readCuratedReaderProjection,
} from "../lib/civic-data/curated-reader-read-model.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import {
  manualProjectionCandidate,
  type CuratedReaderProjection,
  type ManualProjectionPackage,
} from "../lib/civic-data/manual-projections.ts";
import { projectRoutineDataObservability } from "../lib/civic-data/observability.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { ManualSourceClass, ManualSourceSetReceipt } from "../lib/civic-data/types.ts";
import { curatedReaderSourceClass } from "./helpers/curated-reader-source-class.ts";
import { stanceId } from "../lib/civic-data/stance-rows.ts";
import { CROSSWALK_CITATION } from "../lib/civic-data/meeting-body-crosswalk.ts";
import { REGISTRATION_TARGETS } from "../lib/registration/publication.ts";
import { ballotNavigationFor } from "../lib/ballot/navigation.ts";

const T0 = "2026-09-08T12:00:00.000Z";
const T1 = "2026-09-08T12:01:00.000Z";
const URLS = {
  "official-filings": ["https://elections.example.gov/filing.json"],
  "ballot-navigation": [
    "https://elections.example.gov/polling-place",
    "https://elections.example.gov/registration",
  ],
  stances: ["https://candidate.example/campaign/housing"],
  "campaign-sites": ["https://candidate.example/campaign"],
  "member-offices": ["https://data.openstates.org/people/current/az.csv"],
  "venue-resolutions": [
    "https://public.example.gov/meetings/venue",
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=100+Main+St&benchmark=Public_AR_Current&format=json",
  ],
  "meeting-body-crosswalk": [
    "https://www.test.example.gov/events/?ical=1",
    "https://www.test.example.gov/government/city-council",
  ],
} as const;

function receipt(
  id: (typeof CURATED_READER_CONTRACT_IDS)[number],
  at: string,
  hashCharacter: string,
): ManualSourceSetReceipt {
  return {
    contractVersion: 1,
    reviewedAt: at,
    reviewedBy: "pdc7-owner-test",
    sources: URLS[id].map((url, index) => ({
      requestedUrl: url,
      finalUrl: url,
      publisher: "Exact named primary publisher",
      sourceClass: curatedReaderSourceClass(id),
      retrievedAt: at,
      httpStatus: 200,
      rawHash: String.fromCharCode(hashCharacter.charCodeAt(0) + index).repeat(64),
      reviewedEvidence: "The exact response bytes and normalized record were reviewed together.",
    })),
  };
}

function payloadFor(
  id: (typeof CURATED_READER_CONTRACT_IDS)[number],
  at: string,
  hashCharacter = "a",
): CuratedReaderProjection {
  if (id === "official-filings") return { kind: id, records: [{ id: "filing:fixture", kind: "CANDIDATE_FILING_DOCUMENT",
    bodyId: "body:fixture", ocdId: "ocd-division/country:us/state:nh/place:fixture", bodyName: "Fixture Board", jurisdictionName: "Fixture",
    sourceUrl: URLS[id][0], documentUrl: URLS[id][0], collectedAt: at, verifiedAt: at, facts: { candidateName: "Fixture Person", office: "Board" } }] };
  if (id === "stances") return { kind: id, records: [{ id: stanceId("candidacy:fixture", "housing", "We must build more homes."),
    personId: "candidacy:fixture", personName: "Fixture Person", topicId: "housing", quote: "We must build more homes.", date: "2026-09-01",
    sourceKind: "CAMPAIGN_SITE", sourceUrl: URLS[id][0], collectedAt: at, verifiedAt: at }] };
  if (id === "meeting-body-crosswalk") {
    const ocdId = "ocd-division/country:us/state:az/place:test";
    return {
      kind: id,
      records: [{
        id: `${ocdId}#governing|ICAL`,
        jurisdictionId: "az:city:city-of-test",
        ocdId,
        bodyId: `${ocdId}#governing`,
        bodyRole: "GOVERNING",
        bodyName: "Test City Council",
        kind: "ICAL",
        route: URLS[id][0],
        officialHost: "www.test.example.gov",
        filter: { titleMatch: "City Council" },
        publishingOrg: "City of Test",
        timeZone: "America/Phoenix",
        evidence: {
          calendar: { url: URLS[id][0], sha256: hashCharacter.repeat(64), selected: 2, total: 5 },
          bodyPage: { url: URLS[id][1], sha256: String.fromCharCode(hashCharacter.charCodeAt(0) + 1).repeat(64), quote: "The Test City Council meets on the first Tuesday." },
          readAt: at,
        },
        status: "ACTIVE",
        reviewedBy: "a reviewing agent session",
        reviewedAt: at,
        authorization: CROSSWALK_CITATION,
      }],
    };
  }
  if (id === "ballot-navigation") {
    return {
      kind: id,
      records: [
        {
          id: "polling-place:AZ",
          kind: "POLLING_PLACE_LINK",
          value: { state: "AZ", url: URLS[id][0], verifiedAt: at, label: "Find a polling place" },
        },
        {
          id: "registration:AZ",
          kind: "REGISTRATION_LINK",
          value: { state: "AZ", url: URLS[id][1], verifiedAt: at, label: "Check registration" },
        },
      ],
    };
  }
  if (id === "member-offices") {
    return {
      kind: id,
      records: [{
        id: "member-office:az-legislature:fixture:capitol:0",
        kind: "MEMBER_OFFICE",
        officeholderId: "az-legislature:fixture",
        officeKind: "CAPITOL",
        office: { address: "1700 W Washington St", city: "Phoenix", state: "AZ", zip: "85007", phone: "602-555-0100", lat: null, lng: null },
        sourceUrl: URLS[id][0],
        sourceOrg: "Open States (Plural, CC-0)",
        official: false,
        collectedAt: at,
      }],
    };
  }
  if (id === "campaign-sites") {
    return {
      kind: id,
      records: [{
        id: "campaign-site:congress:C001133",
        officeholderId: "congress:C001133",
        site: {
          url: URLS[id][0],
          foundVia: "reviewed primary-source search",
          verification: "The site names the person and office.",
          attemptedAt: at,
        },
      }],
    };
  }
  return {
    kind: id,
    records: [{
      id: "venue:test:body:100mainst",
      sourceId: "test-source",
      bodyOcdId: "ocd-division/country:us/state:az/place:test",
      match: "Council Chamber, 100 Main St",
      name: "Test Council Chamber",
      address: "100 Main St, Test, AZ 85000",
      lat: 32.1,
      lng: -110.9,
      addressSourceUrl: URLS[id][0],
      coordinateSourceUrl: URLS[id][1],
      verifiedAt: at,
    }],
  };
}

function packageFor(
  id: (typeof CURATED_READER_CONTRACT_IDS)[number],
  at = T0,
  hashCharacter = "a",
): ManualProjectionPackage {
  return {
    contractId: id,
    version: at,
    sourceThrough: at,
    sourceReceipt: receipt(id, at, hashCharacter),
    payload: payloadFor(id, at, hashCharacter),
  };
}

test("each mutable curated Reader family promotes and reads from its own canonical pointer", async () => {
  const store = new MemoryRoutineDataStore();
  for (const id of CURATED_READER_CONTRACT_IDS) {
    const candidate = manualProjectionCandidate(packageFor(id));
    const outcome = await processRegisteredManualCandidate(store, id, candidate, T0);
    assert.equal(outcome.candidate.state, "PROMOTED", id);
    assert.equal(outcome.candidate.receipt?.decision, "GOOD", id);
    assert.equal(outcome.readerReadback?.status, "PASS", id);
    assert.deepEqual(
      (await store.events(candidate.id)).map((event) => event.state),
      ["FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED", "PROMOTED"],
      id,
    );
    const read = await readCuratedReaderProjection(id, { store, bypassCache: true, now: T0 }, id === "ballot-navigation" ? "AZ" : undefined);
    assert.equal(read.kind, "PROMOTED", id);
    if (read.kind === "PROMOTED") assert.equal(read.value.kind, id);
  }
});

test("every state's registration and polling links publish through its own navigation pointer", async () => {
  const store = new MemoryRoutineDataStore();
  for (const { state } of REGISTRATION_TARGETS) {
    const records = payloadFor("ballot-navigation", T0).records.map(record => ({ ...record, id: `${record.kind}:${state}`,
      value: { ...(record.value as Record<string, unknown>), state } }));
    const candidate = manualProjectionCandidate({ ...packageFor("ballot-navigation"), payload: { kind: "ballot-navigation", records } });
    assert.equal(candidate.scope, `US-${state}:official-ballot-navigation`);
    const outcome = await processRegisteredManualCandidate(store, "ballot-navigation", candidate, T0);
    assert.equal(outcome.candidate.state, "PROMOTED", outcome.candidate.failureDetail ?? undefined);
    assert.equal(outcome.readerReadback?.status, "PASS");
    const read = await readCuratedReaderProjection("ballot-navigation", { store, now: T0, bypassCache: true }, state);
    assert.equal(read.kind, "PROMOTED");
    const view = ballotNavigationFor(state, read.value!, read.metadata.versionId!, []);
    assert.equal(view.polling[0]?.url, URLS["ballot-navigation"][0], state);
    assert.equal(view.registrations[0]?.url, URLS["ballot-navigation"][1], state);
  }
});

test("a bad curated family is held against its own LKG and cannot affect another family", async () => {
  const store = new MemoryRoutineDataStore();
  const promotedIds = new Map<string, string>();
  const promotedCandidates = new Map<string, ReturnType<typeof manualProjectionCandidate>>();
  for (const id of CURATED_READER_CONTRACT_IDS) {
    const candidate = manualProjectionCandidate(packageFor(id));
    const outcome = await processRegisteredManualCandidate(store, id, candidate, T0);
    assert.ok(outcome.promoted, id);
    promotedIds.set(id, outcome.promoted!.versionId);
    promotedCandidates.set(id, candidate);
  }

  const broken = structuredClone(packageFor("campaign-sites", T1, "d"));
  const brokenPayload = broken.payload as CuratedReaderProjection;
  const site = brokenPayload.records[0]!.site as Record<string, unknown>;
  site.url = "http://not-an-authoritative-https-site.invalid";
  const refused = await processRegisteredManualCandidate(
    store,
    "campaign-sites",
    manualProjectionCandidate(broken, {
      prior: {
        versionId: promotedIds.get("campaign-sites")!,
        payload: promotedCandidates.get("campaign-sites")!.readModel as CuratedReaderProjection,
        sourceReceipt: promotedCandidates.get("campaign-sites")!.retrieval.manualSourceReceipt!,
      },
    }),
    T1,
  );
  assert.equal(refused.promoted, null);
  assert.equal(refused.candidate.state, "SEMANTIC_INVALID");

  for (const id of CURATED_READER_CONTRACT_IDS) {
    const contract = MANUAL_PRODUCTION_SOURCE_CONTRACTS.find((entry) => entry.id === id)!;
    assert.equal(
      (await store.readPromotion(contract.recordClass, id === "ballot-navigation" ? "US-AZ:official-ballot-navigation" : contract.scope))?.versionId,
      promotedIds.get(id),
      `${id} LKG/pointer changed after the unrelated campaign-site refusal`,
    );
  }
});

test("curated Reader evidence is source-scoped and never names software certification", () => {
  for (const id of CURATED_READER_CONTRACT_IDS) {
    const candidate = manualProjectionCandidate(packageFor(id));
    const contract = MANUAL_PRODUCTION_SOURCE_CONTRACTS.find((entry) => entry.id === id)!;
    assert.deepEqual(candidate.sourceProjectionEvidence, {
      kind: "SOURCE_PROJECTION_CONTRACT",
      sourceId: contract.sourceId,
      recordClass: contract.recordClass,
      scope: candidate.scope,
    });
    assert.ok(candidate.dependentChecks.every((check) => !/(?:playwright|office-opening-spell|pnpm\s+(?:test|build)|browser installation|full test tier)/i.test(`${check.consumer} ${check.detail}`)));
  }
});

test("store failure does not reopen any curated tracked first seed", async () => {
  let candidateReads = 0;
  const brokenStore = {
    async readPromotion() { throw new Error("database unavailable"); },
    async readCandidate() { candidateReads += 1; return null; },
  };
  const reads = await Promise.all(CURATED_READER_CONTRACT_IDS.map((id) =>
    readCuratedReaderProjection(id, { store: brokenStore, bypassCache: true }, id === "ballot-navigation" ? "AZ" : undefined)
  ));
  assert.ok(reads.every((read) => read.kind === "STORE_UNREACHABLE"));
  assert.equal(candidateReads, 0);
});

test("Admin projects every curated authority including official filings without inventing a clock", () => {
  const ids = new Set<string>(CURATED_READER_CONTRACT_IDS);
  const contracts = MANUAL_PRODUCTION_SOURCE_CONTRACTS.filter((contract) => ids.has(contract.id));
  assert.deepEqual(contracts.map(row => row.id).sort(), ["official-filings", "ballot-navigation", "stances", "campaign-sites", "member-offices", "venue-resolutions", "meeting-body-crosswalk"].sort());
  assert.ok(contracts.every((contract) => contract.execution === "EXPLICIT_OWNER_INVOCATION_ONLY"));
  assert.ok(contracts.every((contract) => !("cadence" in contract) && !("retry" in contract)));
  const view = projectRoutineDataObservability({ candidates: [], events: [], promotions: [] }, T0, contracts);
  assert.ok(view.contracts.every((row) => row.cadence.clock === "MANUAL"));
  assert.ok(view.contracts.every((row) => row.cadence.nextDue.kind === "NOT_APPLICABLE"));
});

test("reference-publisher evidence is confined to venue coordinates", async () => {
  const venue = structuredClone(packageFor("venue-resolutions"));
  (venue.sourceReceipt.sources[1]! as { sourceClass: ManualSourceClass }).sourceClass = "REFERENCE_PUBLISHER";
  const venueOutcome = await processRegisteredManualCandidate(
    new MemoryRoutineDataStore(),
    "venue-resolutions",
    manualProjectionCandidate(venue),
    T0,
  );
  assert.equal(venueOutcome.candidate.state, "PROMOTED");

  for (const id of ["ballot-navigation", "campaign-sites"] as const) {
    const wrong = structuredClone(packageFor(id));
    (wrong.sourceReceipt.sources[0]! as { sourceClass: ManualSourceClass }).sourceClass = "REFERENCE_PUBLISHER";
    const outcome = await processRegisteredManualCandidate(
      new MemoryRoutineDataStore(),
      id,
      manualProjectionCandidate(wrong),
      T0,
    );
    assert.equal(outcome.candidate.state, "SEMANTIC_INVALID", id);
    assert.equal(outcome.promoted, null, id);
    assert.ok(outcome.candidate.receipt?.checks.some((check) =>
      check.check === "SEMANTIC_VALIDITY" && check.detail.includes(`cannot authorize ${id}`)
    ), id);
  }

  const wrongVenueField = structuredClone(packageFor("venue-resolutions"));
  (wrongVenueField.sourceReceipt.sources[0]! as { sourceClass: ManualSourceClass }).sourceClass = "REFERENCE_PUBLISHER";
  const wrongVenueOutcome = await processRegisteredManualCandidate(
    new MemoryRoutineDataStore(),
    "venue-resolutions",
    manualProjectionCandidate(wrongVenueField),
    T0,
  );
  assert.equal(wrongVenueOutcome.candidate.state, "SEMANTIC_INVALID");
});
