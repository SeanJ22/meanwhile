import { runCensusState } from "../lib/control-plane/discovery/census-lane.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { canonicalCivicDataJson } from "../lib/civic-data/changes.ts";
import { DERIVED_MEETING_FAMILY_STATES } from "../lib/civic-data/contracts.ts";
import { planDerivedVersion, type DerivedInputRef } from "../lib/civic-data/derived-authority.ts";
import {
  composeCrosswalk,
  derivedCrosswalkCandidate,
  planDerivedCrosswalk,
  readDerivedMeetingBodyCrosswalk,
} from "../lib/civic-data/derived-crosswalk.ts";
import { buildDerivedFamily, derivedFamilyCandidate, type FamilyMemberRead } from "../lib/civic-data/derived-meeting-family.ts";
import {
  bodySourceWiringFor,
  derivedWiringCandidate,
  derivedWiringKey,
  familyMembers,
  readDerivedMeetingWiring,
} from "../lib/civic-data/derived-meeting-wiring.ts";
import { manualProjectionCandidate, type ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import { MEETING_PARTITION_CONTRACTS, derivedMeetingFamilyId, requiredMeetingPartitionContract } from "../lib/civic-data/meeting-partitions.ts";
import { POST_FIXTURE_MEETING_PARTITIONS } from "./helpers/meeting-partition-fixture.ts";
import { promoteDerivedMeetingFamily } from "../scripts/ingest.ts";
import {
  processRegisteredManualCandidate,
  processRegisteredMeetingPartitionCandidate,
  processRegisteredRoutineCandidate,
} from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { autoCrosswalkReviewerId, reviewDiscoveryWalk, type HeldBytes } from "../lib/control-plane/discovery/auto-crosswalk.ts";
import { deriveWiringDecisions, wiringRowFor } from "../lib/control-plane/discovery/derived-wiring.ts";
import { readHeldCalendars, type HeldCalendarReading } from "../lib/control-plane/discovery/derived-wiring-reading.ts";
import { readFreeDiscoveryWalks } from "../lib/control-plane/discovery/free-walks.ts";
import { reviewedBodyForGovernment } from "../lib/control-plane/discovery/reviewed-body.ts";
import { walkableByFreeWalk } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { applyDispatchWork, dispatchWorkTarget, planDispatchWork } from "../lib/control-plane/expansion/dispatch-work.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import {
  MEETINGS_DISCOVERY_NAMESPACE,
  materializedDiscoveryNeeds,
} from "../lib/control-plane/scheduler/providers/meetings-discovery.ts";
import type { Jurisdiction, JurisdictionRegistry } from "../lib/hunt/jurisdiction-universe.ts";
import { meetingsDiscoveryNeeds } from "../lib/hunt/meetings-discovery.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { registrationCandidate, type RegistrationReadModel } from "../lib/registration/candidate.ts";
import { REGISTRATION_SOURCE_BYTES, REGISTRATION_SOURCE_SHA256, REGISTRATION_SOURCE_URL, REGISTRATION_TARGETS, registrationTarget } from "../lib/registration/publication.ts";
import { readRegistrationProjection } from "../lib/registration/reader.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { makeIcalSource } from "../lib/sources/ical/index.ts";
import { curatedReaderSourceClass } from "./helpers/curated-reader-source-class.ts";
import { ics, localStart as localStartFrom, reviewedIds } from "./helpers/expansion-fixtures.ts";
import { freshEdge, publishPass, readPlace } from "./helpers/meeting-body-fixtures.ts";
import { recordedDiscoveryOpen, type RecordedReply } from "./helpers/recorded-discovery-open.ts";

const ROOT = join(import.meta.dirname, "..");
/* Anchored to the real clock: the engine refuses an event dated in the future. */
const HOUR = 3_600_000;
const BASE = Date.now();
const at = (hoursFromNow: number): string => new Date(BASE + hoursFromNow * HOUR).toISOString();
const T_REGISTRATION = at(-48);
const T_SEND = at(-6);
const T_WALK = at(-5);
const T_CROSSWALK = at(-4);
const T_WIRING = at(-3);
const T_FAMILY = at(-2);
const T_READER = at(-1);

const COUNTY = "oh:county:county-of-franklin";
const CITY = "oh:city:city-of-franklin";
const COUNTY_HOST = "www.franklincounty.oh.example.gov";
const CITY_HOST = "www.franklin.oh.example.gov";
const COUNTY_ROUTE = `https://${COUNTY_HOST}/calendar/commissioners.ics`;
const CITY_ROUTE = `https://${CITY_HOST}/events.ics`;
const COUNTY_BODY = "ocd-division/country:us/state:oh/county:franklin#governing";
const COUNTY_DIVISION = "ocd-division/country:us/state:oh/county:franklin";
const ALLOW: RecordedReply = { status: 200, body: "User-agent: *\nAllow: /\n", contentType: "text/plain" };

/** `DTSTART;TZID=America/New_York` a whole number of days from now, at a wall-clock hour. */
const localStart = (days: number, hour: number): string => localStartFrom(BASE, days, hour);
const COUNTY_FEED = ics([
  { uid: "boc-1@franklin", summary: "Board of Commissioners General Session", start: localStart(3, 10) },
  { uid: "boc-2@franklin", summary: "Franklin County Board of Commissioners Briefing", start: localStart(10, 9) },
  { uid: "hol-1@franklin", summary: "County Offices Closed", start: localStart(12, 8) },
]);
const COUNTY_HOME = `<html><body><h1>Franklin County, Ohio</h1><p>The Board of Commissioners meets every Tuesday at 10 a.m.</p>
<a href="/calendar/commissioners.ics">Commissioners' meetings (iCal)</a></body></html>`;
/* The city's only events each name two bodies: whose sitting each is, is a review. */
const CITY_FEED = ics([
  { uid: "j-1@franklin-city", summary: "City Council and Planning Commission Joint Meeting", start: localStart(4, 19) },
]);
const CITY_HOME = `<html><body><p>City Council. Planning Commission.</p><a href="/events.ics">Events</a></body></html>`;

/** A registered state's registry, read from the trimmed fixture. */
function azRegistryFixture(): JurisdictionRegistry {
  return (JSON.parse(readFileSync(join(ROOT, "tests/fixtures/jurisdiction-registries.json"), "utf8")) as Record<string, JurisdictionRegistry>).az!;
}

/** The Ohio registry the Send reads: two governments the Census names, each owing meetings discovery on its own site. */
function ohioRegistry(): JurisdictionRegistry {
  const az = azRegistryFixture();
  const meetings = "MEETINGS:THIS_JURISDICTION:this-government-itself";
  const row = (id: string, name: string, govClass: Jurisdiction["govClass"], site: string): Jurisdiction => ({
    ...az.jurisdictions[0]!, id, stateCode: "OH", name, govClass, countyName: "FRANKLIN", ownWebAddress: site, sourceIds: [meetings],
  });
  return {
    ...az,
    stateCode: "OH",
    sourceCatalog: { [meetings]: az.sourceCatalog[meetings]! },
    jurisdictions: [row(COUNTY, "COUNTY OF FRANKLIN", "COUNTY", `https://${COUNTY_HOST}/`), row(CITY, "CITY OF FRANKLIN", "CITY_OR_TOWN", `https://${CITY_HOST}/`)],
  };
}

const sha = (value: unknown): string => createHash("sha256").update(canonicalCivicDataJson(value)).digest("hex");

/** A promoted venue-resolutions version: every adapter reading resolves through it (lib/control-plane/discovery/derived-wiring-reading.ts). */
async function promoteVenues(store: MemoryRoutineDataStore): Promise<void> {
  const urls = ["https://public.example.gov/venue", "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=373+S+High+St&benchmark=Public_AR_Current&format=json"];
  const pkg: ManualProjectionPackage = {
    contractId: "venue-resolutions",
    version: T_REGISTRATION,
    sourceThrough: T_REGISTRATION,
    sourceReceipt: {
      contractVersion: 1, reviewedAt: T_REGISTRATION, reviewedBy: "a reviewing agent session (test)",
      sources: urls.map((url, index) => ({
        requestedUrl: url, finalUrl: url, publisher: "Exact named primary publisher", sourceClass: curatedReaderSourceClass("venue-resolutions"),
        retrievedAt: T_REGISTRATION, httpStatus: 200, rawHash: String.fromCharCode(97 + index).repeat(64),
        reviewedEvidence: "The exact response bytes and normalized record were reviewed together.",
      })),
    },
    payload: {
      kind: "venue-resolutions",
      records: [{
        id: "venue:test:franklin:373shigh", sourceId: "test-source", bodyOcdId: "ocd-division/country:us/state:oh/county:franklin", match: "373 S High St",
        name: "Franklin County Courthouse", address: "373 S High St, Columbus, OH 43215", lat: 39.95, lng: -82.99,
        addressSourceUrl: urls[0], coordinateSourceUrl: urls[1], verifiedAt: T_REGISTRATION,
      }],
    },
  };
  const outcome = await processRegisteredManualCandidate(store, "venue-resolutions", manualProjectionCandidate(pkg), T_REGISTRATION);
  assert.equal(outcome.candidate.state, "PROMOTED", outcome.candidate.failureDetail ?? "");
}

test("EXPANSION END TO END: a Send for an Ohio county is walked free, reviewed by rule, wired and read by the Reader; an ambiguous calendar publishes nothing and says why", async (t) => {
  assert.ok(DERIVED_MEETING_FAMILY_STATES.includes("US-OH"), "Ohio has a derived family with no code change");

  /* 1. The owner's Send creates the work. */
  const repos = createMemoryRepositories();
  const OH = ohioRegistry();
  const plan = planDispatchWork({
    targets: [dispatchWorkTarget({ intentId: "intent-ohio", note: "Franklin, Ohio", requestedAt: T_SEND })],
    world: {
      registries: new Map([["oh", OH]]), territory: null, territoryDetail: null, corpus: [], durable: new Map(),
      meetingPartitions: { ownerOf: () => "NONE", source: "test" },
    },
  });
  const applied = await applyDispatchWork(repos, plan, { now: T_SEND });
  const ids = (await repos.obligations.list()).map((row) => row.id).filter((id) => id.startsWith(MEETINGS_DISCOVERY_NAMESPACE)).sort();
  assert.deepEqual(ids, [
    `${MEETINGS_DISCOVERY_NAMESPACE}${CITY}#own-site-meetings`,
    `${MEETINGS_DISCOVERY_NAMESPACE}${COUNTY}#own-site-meetings`,
  ], `the Send wrote ${applied.written.length} row(s)`);

  /* 2. The free walk goes first on the dispatched needs, ahead of any mission's blanks. */
  const materialized = materializedDiscoveryNeeds(ids, (state) => {
    if (state !== "oh") throw new Error(`OPERATIONAL_REFERENCE_STATE_NOT_REGISTERED:${state}`);
    return OH;
  });
  assert.deepEqual(materialized.failures, []);
  const dispatched = materialized.entries.map((e) => ({ ...e.need, addressSource: { source: "OPERATIONAL_REFERENCE" as const, versionId: "ref-oh-1" } }));
  /* Another Send's mission blanks, in another state, walk after the dispatched needs. */
  const azRegistry = azRegistryFixture();
  const mission = meetingsDiscoveryNeeds([azRegistry]);
  assert.equal(mission.some((n) => n.stateCode.toUpperCase() === "OH"), false, "the other mission holds no Ohio government");
  const needs = dispatched;
  const subjects = dispatched.map((n) => ({ jurisdictionId: n.jurisdictionId, walkable: walkableByFreeWalk(n) }));
  const before = await readFreeDiscoveryWalks(repos, subjects);
  for (const s of subjects) assert.equal(before.latestFor(s.jurisdictionId), "NOT_WALKED");

  const site: Record<string, RecordedReply> = {
    [`https://${COUNTY_HOST}/robots.txt`]: ALLOW,
    [`https://${COUNTY_HOST}/`]: { status: 200, body: COUNTY_HOME },
    [COUNTY_ROUTE]: { status: 200, body: COUNTY_FEED, contentType: "text/calendar" },
    [`https://${CITY_HOST}/robots.txt`]: ALLOW,
    [`https://${CITY_HOST}/`]: { status: 200, body: CITY_HOME },
    [CITY_ROUTE]: { status: 200, body: CITY_FEED, contentType: "text/calendar" },
  };
  const vault = new Map<string, HeldBytes>();
  let tick = 0;
  await runCensusState({
    repos, state: "OH", needs,
    runtime: {
      open: recordedDiscoveryOpen(site),
      spaceOut: async () => {},
      vault: async (artifact, body) => {
        vault.set(artifact.id, {
          text: body, sha256: artifact.contentHash.slice("sha256-".length),
          evidence: { kind: "VAULTED_EVIDENCE", artifactId: artifact.id, contentHash: artifact.contentHash, tier: artifact.tier === "SANITIZED_DERIVED" ? "SANITIZED_DERIVED" : "RAW", retrievedAt: artifact.retrievedAt },
        });
        return { stored: true, where: `vault/${artifact.id}`, why: "stored" };
      },
      now: () => new Date(Date.parse(T_WALK) + (tick++) * 1000).toISOString(),
      budget: { spent: () => false },
    },
  });
  const walked = (await Promise.all(needs.map(need => repos.discoveryAttempts.read(need.jurisdictionId)))).flat();
  assert.deepEqual(walked.map((a) => a.jurisdictionId).sort(), [CITY, COUNTY], "the free walk took the Send's governments, not the ledger's rotation");
  assert.ok(walked.every((a) => a.outcome === "FOUND"));
  const after = await readFreeDiscoveryWalks(repos, subjects);
  for (const s of subjects) assert.equal(after.latestFor(s.jurisdictionId), "FOUND");

  /* 3. Registration: which body each government is (the Census, through its own routine door). */
  const store = new MemoryRoutineDataStore();
  const registration = registrationCandidate({
    target: registrationTarget("OH"),
    reference: loadRegistrationReference(ROOT, "OH"),
    receipt: { requestedUrl: REGISTRATION_SOURCE_URL, finalUrl: REGISTRATION_SOURCE_URL, httpStatus: 200, retrievedAt: T_REGISTRATION, sha256: REGISTRATION_SOURCE_SHA256, bytes: REGISTRATION_SOURCE_BYTES, confirmedBy: "BYTES_HASHED" },
    reviewed: reviewedIds(ROOT),
  });
  assert.equal((await processRegisteredRoutineCandidate(store, "registration-oh", registration, T_REGISTRATION)).candidate.state, "PROMOTED");
  await promoteVenues(store);
  const reg = await readRegistrationProjection("OH", { store, bypassCache: true, now: T_CROSSWALK });
  assert.equal(reg.kind, "PROMOTED");
  if (reg.kind !== "PROMOTED") return;
  const regInput: DerivedInputRef = { kind: "PROMOTED_VERSION", recordClass: "REGISTRATION", scope: reg.metadata.scope, versionId: reg.metadata.versionId!, readModelSha256: sha(reg.value), promotedAt: reg.metadata.promotedAt! };
  const model = reg.value as RegistrationReadModel;
  assert.equal(model.bodies.length, 0, "government inventory does not invent governing bodies");
  const reference = loadRegistrationReference(ROOT, "OH");
  const reviewedBodies = [
    { id: COUNTY_BODY, ocdId: "ocd-division/country:us/state:oh/county:franklin", bodyClass: "GOVERNING",
      censusId: reference.reference.governments.find(row => row[1] === COUNTY)![0] },
    { id: "ocd-division/country:us/state:oh/place:franklin#governing", ocdId: "ocd-division/country:us/state:oh/place:franklin", bodyClass: "GOVERNING",
      censusId: reference.reference.governments.find(row => row[1] === CITY)![0] },
  ];
  // Separately reviewed identities are backed by the captured official pages.
  // A geography or a Census listing alone cannot establish either board.
  const registeredFor = (jurisdictionId: string) => {
    const page = [...vault.values()].find(held => held.text === (jurisdictionId === COUNTY ? COUNTY_HOME : CITY_HOME));
    assert.ok(page && /Board of Commissioners|City Council/.test(page.text));
    const body = reviewedBodyForGovernment(reference, jurisdictionId, reviewedBodies);
    return body === null
      ? { notRegistered: `no body for ${jurisdictionId}` }
      : { ...body, input: page.evidence };
  };

  /* 4. The runner's reviewer, one walk at a time. */
  const walks = await Promise.all([COUNTY, CITY].map(async (id) => {
    const [attempt] = await repos.discoveryAttempts.readRecent(id, 1);
    assert.ok(attempt);
    return { attempt, recordId: `pos-${id}`, recordedAt: attempt.finishedAt };
  }));
  const reviewer = autoCrosswalkReviewerId("feedfacecafe0123");
  const reviews = walks.map((walk) => reviewDiscoveryWalk({
    walk, registered: registeredFor(walk.attempt.jurisdictionId), held: (id) => vault.get(id) ?? null, handWired: () => false, reviewer, now: T_CROSSWALK,
  }));
  const [countyReview, cityReview] = reviews;
  assert.deepEqual(countyReview!.accepted.map((a) => [a.row.bodyId, a.row.bodyName, a.row.filter]), [[COUNTY_BODY, "Board of Commissioners", { titleMatch: "Board of Commissioners" }]]);
  assert.deepEqual(cityReview!.accepted, [], "the ambiguous calendar publishes nothing");
  const cityHold = cityReview!.held.find((h) => h.reason === "AMBIGUOUS_TITLE" && h.bodyId === "ocd-division/country:us/state:oh/place:franklin#governing");
  assert.ok(cityHold, JSON.stringify(cityReview!.held));

  /* 5a. The automatic crosswalk promotes through the routine door. */
  const crosswalkPlan = planDerivedCrosswalk({ previous: [], reviews });
  const crosswalkCandidate = derivedCrosswalkCandidate(crosswalkPlan, [], T_CROSSWALK);
  const crosswalkOutcome = await processRegisteredRoutineCandidate(store, "meeting-body-crosswalk-derived", crosswalkCandidate, T_CROSSWALK);
  assert.equal(crosswalkOutcome.candidate.state, "PROMOTED", `${crosswalkOutcome.candidate.failureCode ?? ""} ${crosswalkOutcome.candidate.failureDetail ?? ""}`);
  assert.equal(crosswalkOutcome.readerReadback?.status, "PASS", JSON.stringify(crosswalkOutcome.readerReadback));
  /* The held city is on the version's durable record, with its dead end: what Admin's held records show. */
  const heldFact = crosswalkOutcome.candidate.receipt?.excludedFacts.find((f) => f.key === cityHold.key);
  assert.equal(heldFact?.code, "AUTO_CROSSWALK_HELD_AMBIGUOUS_TITLE");
  assert.match(heldFact?.detail ?? "", /City Council and Planning Commission Joint Meeting/);
  assert.equal((heldFact?.record as { whoMovesNext?: string } | undefined)?.whoMovesNext, "a reviewing agent session");

  /* 5b. The wiring derives from the automatic rows, no reviewed crosswalk promoted at all. */
  const automatic = await readDerivedMeetingBodyCrosswalk({ store, bypassCache: true, now: T_WIRING });
  assert.equal(automatic.kind, "PROMOTED");
  if (automatic.kind !== "PROMOTED") return;
  const automaticInput: DerivedInputRef = {
    kind: "PROMOTED_VERSION", recordClass: "CURATED_READER_RECORD", scope: "US:meeting-body-crosswalk-derived",
    versionId: automatic.metadata.versionId!, readModelSha256: sha(automatic.value), promotedAt: automatic.metadata.promotedAt!,
  };
  const composed = composeCrosswalk(null, automatic.value.records);
  const readings: HeldCalendarReading[] = [];
  for (const row of composed.rows) {
    const walk = walks.find((w) => w.attempt.jurisdictionId === row.jurisdictionId)!;
    const artifactId = walk.attempt.found.find((f) => f.url === row.route)!.artifactId!;
    readings.push({ key: `${row.id}\u0000${artifactId}`, row: wiringRowFor(row), held: { text: vault.get(artifactId)!.text, contentType: "text/calendar" }, evidence: vault.get(artifactId)!.evidence, others: [] });
  }
  const read = await readHeldCalendars({ options: { store, bypassCache: true, now: T_WIRING }, now: T_WIRING, adapterDigest: () => "ical@0123456789ab", readings });
  assert.equal(read.kind, "READ", read.kind === "UNREADABLE" ? read.detail : "");
  if (read.kind !== "READ") return;
  const decisions = deriveWiringDecisions({
    crosswalk: { input: automaticInput, versionId: automatic.metadata.versionId!, rows: composed.rows, automatic: { input: automaticInput, versionId: automatic.metadata.versionId!, rowIds: composed.automaticIds } },
    registration: (row) => {
      const r = registeredFor(row.jurisdictionId);
      return "notRegistered" in r ? r : { input: regInput };
    },
    attempts: walks,
    handWired: () => false,
    vaulted: (id) => vault.get(id)?.evidence ?? null,
    vaultedBytes: (hex) => [...vault.values()].find((b) => b.sha256 === hex)?.evidence ?? null,
    verify: (row, _binding, evidence) => read.verifications.get(`${row.crosswalkRowId}\u0000${evidence.artifactId}`) ?? { refused: "not read" },
    adapterDigest: () => "ical@0123456789ab",
    previous: [],
    now: T_WIRING,
  });
  assert.deepEqual(decisions.map((d) => [d.key, d.disposition]), [[derivedWiringKey("ICAL", COUNTY_BODY, COUNTY_ROUTE), "PROMOTE"]]);
  const wiringPlan = planDerivedVersion([], decisions);
  assert.deepEqual(wiringPlan.refusals, []);
  const wiringOutcome = await processRegisteredRoutineCandidate(store, "meeting-source-wiring", derivedWiringCandidate(wiringPlan, [automaticInput], T_WIRING), T_WIRING);
  assert.equal(wiringOutcome.candidate.state, "PROMOTED", `${wiringOutcome.candidate.failureCode ?? ""} ${wiringOutcome.candidate.failureDetail ?? ""}`);

  /* 5c. Ohio's derived family reads the member on its own attested host and promotes. */
  const wiring = await readDerivedMeetingWiring({ store, bypassCache: true, now: T_FAMILY });
  assert.equal(wiring.kind, "PROMOTED");
  if (wiring.kind !== "PROMOTED") return;
  const partition = requiredMeetingPartitionContract(derivedMeetingFamilyId("US-OH"));
  const members = familyMembers(wiring.value, "US-OH");
  assert.deepEqual(members.map((m) => [m.id, m.status]), [[derivedWiringKey("ICAL", COUNTY_BODY, COUNTY_ROUTE), "ACTIVE"]]);
  const reads: FamilyMemberRead[] = members.map((member) => {
    const source = makeIcalSource([bodySourceWiringFor(member.row)]);
    const fresh = source.normalizeWithDrops([{ wiring: bodySourceWiringFor(member.row), ics: COUNTY_FEED, collectedAt: T_FAMILY, sourceUrl: member.row.route }], new Date(T_FAMILY)).meetings;
    return {
      member,
      acquisitions: [{ requestedUrl: member.row.route, finalUrl: member.row.route, httpStatus: 200, rawHash: vault.get(walks[0]!.attempt.found[0]!.artifactId!)!.sha256, byteCount: COUNTY_FEED.length }],
      ok: true, error: null, freshMeetings: fresh, freshAgendaDocuments: [], retrievedAt: T_FAMILY,
    };
  });
  const build = buildDerivedFamily({
    wiringInput: { kind: "PROMOTED_VERSION", recordClass: "CURATED_READER_RECORD", scope: "US:meeting-source-wiring", versionId: wiring.metadata.versionId!, readModelSha256: sha(wiring.value), promotedAt: wiring.metadata.promotedAt! },
    members, reads, previous: null, generatedAt: T_FAMILY,
    reconcile: (r) => ({ meetings: r.freshMeetings, agendaDocuments: [], removalEvidence: [] }),
  });
  const familyOutcome = await processRegisteredMeetingPartitionCandidate(store, partition.id, derivedFamilyCandidate(partition, build), T_FAMILY);
  assert.equal(familyOutcome.candidate.state, "PROMOTED", `${familyOutcome.candidate.failureCode ?? ""} ${familyOutcome.candidate.failureDetail ?? ""}`);

  /* 6. The Reader. */
  let factReads = 0;
  installFactReader(async () => {
    factReads++;
    assert.fail("published meeting composition must not query facts");
  });
  t.after(() => installFactReader(undefined));
  const edge = freshEdge();
  assert.equal((await publishPass(store, edge, T_READER)).status, "PUBLISHED");
  const reader = await readPlace(edge, store, [COUNTY_DIVISION, "ocd-division/country:us/state:oh/place:franklin"], T_READER);
  assert.equal(factReads, 0, "published meeting composition does not query facts");
  assert.equal(reader.kind, "PROMOTED");
  if (reader.kind !== "PROMOTED") return;
  const sittings = reader.value.meetings.filter((m) => m.bodyId === COUNTY_BODY);
  assert.deepEqual(sittings.map((m) => m.title).sort(), ["Board of Commissioners General Session", "Franklin County Board of Commissioners Briefing"], "the county's sittings, and never its office closure");
  for (const m of sittings) {
    assert.equal(m.bodyName, "Board of Commissioners");
    assert.equal(m.ocdId, "ocd-division/country:us/state:oh/county:franklin");
    assert.equal(m.provenance.sourceUrl, COUNTY_ROUTE, "each sitting links the county's own calendar");
    assert.equal(m.timeZone, "America/New_York");
  }
  assert.equal(reader.value.meetings.some((m) => m.ocdId === "ocd-division/country:us/state:oh/place:franklin"), false, "the held city publishes nothing");
  assert.ok(await store.readPromotion("MEETING", partition.scope), "the state's derived family is promoted");
  assert.equal(
    reader.value.sources.some((s) => s.source === "derived" && !s.ok),
    false,
    "a state with no connected calendar yet is not a failed source",
  );
});

test("EVERY REGISTERED STATE HAS A FAMILY: registration's own state list, each family on its own lane, no code naming a state", () => {
  const families = MEETING_PARTITION_CONTRACTS.filter((p) => p.derivedFamily !== null);
  assert.deepEqual(families.map((p) => p.derivedFamily), REGISTRATION_TARGETS.map((t) => t.jurisdiction));
  assert.equal(families.length, 56, "every state, DC and territory in the FIPS table");
  assert.equal(new Set(families.map((p) => p.acquisitionFailureDomain)).size, families.length, "one state's slow member never waits on another state's");
  assert.deepEqual(
    POST_FIXTURE_MEETING_PARTITIONS.filter((id) => id.startsWith("meetings:derived:")),
    families.map((p) => p.id),
    "the Reader proof counts every family as registered after the frozen import",
  );
});

test("A STATE WITH NO CONNECTED CALENDAR: its family reads the wiring first and refuses by name, with no preload and no publisher read", async () => {
  const store = new MemoryRoutineDataStore();
  let prepared = 0;
  const partition = requiredMeetingPartitionContract(derivedMeetingFamilyId("US-WY"));
  await promoteDerivedMeetingFamily(store, partition, async () => {
    prepared += 1;
  });
  assert.equal(prepared, 0, "a family with no member never loads the registry and venue projections (about 24 MB a run)");
  assert.equal(await store.readPromotion("MEETING", partition.scope), null, "nothing is published for a state with no member");
  const ingest = readFileSync(join(ROOT, "scripts", "ingest.ts"), "utf8");
  const main = ingest.slice(ingest.indexOf("async function main()"));
  assert.ok(
    main.indexOf("promoteDerivedMeetingFamily(") < main.indexOf("await preloadCanonicalMeetingDependencies({ sourceName: name, state });"),
    "the child routes a family before the preload every source/body partition needs",
  );
});
