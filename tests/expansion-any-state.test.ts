/**
 * **A SEND IN ANY REGISTERED STATE CREATES WORK, AND THE WORK REACHES READERS
 * WITH NO CODE CHANGE.** (2026-09-25. docs/rulings.md §1.)
 *
 * Until now a Send outside Arizona, New Hampshire and New Jersey stopped before
 * any work was created: only those three have a reviewed jurisdiction registry,
 * so the plan named every other state's governments NO_JURISDICTION_REGISTRY.
 * Every state is registered, though, and a state with no reviewed registry now
 * reads its registration as one (`lib/registration/jurisdictions.ts`).
 *
 * Every step below is the production path on the in-memory stores, against the
 * committed Ohio and Puerto Rico registration references, the committed Census
 * files and the committed national ZIP index. Nothing reaches the network, no
 * model is called, and nothing names Ohio's governments in code:
 *
 * 1. Admin's preview counts the governments a Send for Franklin County, Ohio
 *    would create work for, from registration, by the runner's rule;
 * 2. the owner's Send (`expansion.scope.set`, the gateway's own door) is read
 *    by the runner, which reads Ohio's promoted registration, places the
 *    county's governments and creates exactly that many obligations, each
 *    labelled as coming from registration;
 * 3. the next cycle's providers keep that work in the corpus;
 * 4. the FREE discovery walk takes the City of Columbus first, at the web
 *    address the Census of Governments records for it, robots first, while the
 *    paid lane remains governed by the owner's separate pause and budgets;
 * 5. it finds the city's iCal feed on the city's own host; the automatic
 *    reviewer accepts it for the city's registered body; the crosswalk, the
 *    wiring and Ohio's derived family promote; and the Reader shows the
 *    sittings under the City Council of Columbus;
 * 6. a Send for a Puerto Rico municipio creates discovery needs that honestly
 *    say `find-own-site`: the territory's governments carry no web address.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { canonicalCivicDataJson } from "../lib/civic-data/changes.ts";
import { planDerivedVersion, type DerivedInputRef } from "../lib/civic-data/derived-authority.ts";
import { composeCrosswalk, derivedCrosswalkCandidate, planDerivedCrosswalk, readDerivedMeetingBodyCrosswalk } from "../lib/civic-data/derived-crosswalk.ts";
import { buildDerivedFamily, derivedFamilyCandidate, type FamilyMemberRead } from "../lib/civic-data/derived-meeting-family.ts";
import { bodySourceWiringFor, derivedWiringCandidate, derivedWiringKey, familyMembers, readDerivedMeetingWiring } from "../lib/civic-data/derived-meeting-wiring.ts";
import { manualProjectionCandidate, type ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import { derivedMeetingFamilyId, requiredMeetingPartitionContract } from "../lib/civic-data/meeting-partitions.ts";
import {
  clearRegistrationJurisdictionRegistries,
  installOperationalReferenceBundle,
  operationalReferenceBundle,
  requiredJurisdictionRegistry,
} from "../lib/civic-data/operational-references.ts";
import { processRegisteredManualCandidate, processRegisteredMeetingPartitionCandidate, processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { registrationGovernments, type ReadOnlyQuery, type Row } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { autoCrosswalkReviewerId, reviewDiscoveryWalk, type HeldBytes } from "../lib/control-plane/discovery/auto-crosswalk.ts";
import { deriveWiringDecisions, wiringRowFor } from "../lib/control-plane/discovery/derived-wiring.ts";
import { readHeldCalendars, type HeldCalendarReading } from "../lib/control-plane/discovery/derived-wiring-reading.ts";
import { readFreeDiscoveryWalks } from "../lib/control-plane/discovery/free-walks.ts";
import { runMeetingsDiscovery, walkableByFreeWalk } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { applyDispatchWork, dispatchWorkReading, planDispatchWork, scopeWorkTarget, type DispatchWorkReading } from "../lib/control-plane/expansion/dispatch-work.ts";
import type { PlannedScope } from "../lib/control-plane/expansion/membership.ts";
import { loadExpansionPlan, readTerritoryIndex } from "../lib/control-plane/expansion/runner-load.ts";
import { registrationGovernmentsPlaced, stateSendPreviewSentence, type PreviewCode } from "../lib/control-plane/expansion/send-preview.ts";
import { scopeCreationSentence } from "../lib/control-plane/expansion/view.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import type { ActionRequest } from "../lib/control-plane/gateway/contract.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { readAllAssignmentSources } from "../lib/control-plane/assignment-read.ts";
import { buildAssignmentView } from "../lib/control-plane/assignment-view.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { OWNER_DISPATCH } from "../lib/control-plane/scheduler/obligation.ts";
import { localJurisdictionsProvider } from "../lib/control-plane/scheduler/providers/local-jurisdictions.ts";
import { promotedRegistries, UNREAD_MEETING_PARTITIONS } from "../lib/control-plane/scheduler/provider-inputs.ts";
import {
  MEETINGS_DISCOVERY_NAMESPACE,
  dispatchedAddressSource,
  materializedDiscoveryNeeds,
  meetingsDiscoveryProvider,
  paidDiscoveryHold,
} from "../lib/control-plane/scheduler/providers/meetings-discovery.ts";
import { buildRegistry } from "../lib/control-plane/scheduler/registry.ts";
import { zipDivisionEntry } from "../lib/geo/zip-division-index.ts";
import type { JurisdictionRegistry } from "../lib/hunt/jurisdiction-universe.ts";
import { readMeetingsProjection } from "../lib/meetings/snapshot.ts";
import { registrationCandidate, type RegistrationReadModel } from "../lib/registration/candidate.ts";
import { preloadRegistrationJurisdictions } from "../lib/registration/jurisdictions.ts";
import { REGISTRATION_SOURCE_BYTES, REGISTRATION_SOURCE_SHA256, REGISTRATION_SOURCE_URL, registrationTarget } from "../lib/registration/publication.ts";
import { readRegistrationProjection } from "../lib/registration/reader.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { makeIcalSource } from "../lib/sources/ical/index.ts";
import { curatedReaderSourceClass } from "./helpers/curated-reader-source-class.ts";
import { ics, localStart, reviewedIds } from "./helpers/expansion-fixtures.ts";
import { recordedDiscoveryOpen, type RecordedReply } from "./helpers/recorded-discovery-open.ts";

const ROOT = join(import.meta.dirname, "..");
/* Anchored to the real clock: the engine refuses an event dated in the future. */
const HOUR = 3_600_000;
const BASE = Date.now();
const at = (hoursFromNow: number): string => new Date(BASE + hoursFromNow * HOUR).toISOString();
const T_REGISTRATION = at(-48);
const T_SEND = at(-8);
const T_CYCLE = at(-7);
const T_NEXT = at(-6);
const T_WALK = at(-5);
const T_CROSSWALK = at(-4);
const T_WIRING = at(-3);
const T_FAMILY = at(-2);
const T_READER = at(-1);

const COLUMBUS = "oh:city:city-of-columbus";
const COLUMBUS_BODY = "ocd-division/country:us/state:oh/place:columbus#governing";
const COLUMBUS_HOST = "www.columbus.gov";
const COLUMBUS_ROUTE = `https://${COLUMBUS_HOST}/calendar/city-council.ics`;
const ALLOW: RecordedReply = { status: 200, body: "User-agent: *\nAllow: /\n", contentType: "text/plain" };

/* The reviewed registries exactly as the runner holds them: the three reviewed states, from their committed seeds. */
installOperationalReferenceBundle(operationalReferenceBundle({
  az: JSON.parse(readFileSync(join(ROOT, "data/states/az/jurisdictions/az.json"), "utf8")) as JurisdictionRegistry,
  nh: JSON.parse(readFileSync(join(ROOT, "data/states/nh/jurisdictions/nh.json"), "utf8")) as JurisdictionRegistry,
  nj: JSON.parse(readFileSync(join(ROOT, "data/states/nj/jurisdictions/nj.json"), "utf8")) as JurisdictionRegistry,
}));

const sha = (value: unknown): string => createHash("sha256").update(canonicalCivicDataJson(value)).digest("hex");

const COLUMBUS_FEED = ics([
  { uid: "cc-1@columbus", summary: "Columbus City Council Regular Meeting", start: localStart(BASE, 3, 17) },
  { uid: "cc-2@columbus", summary: "City Council Regular Meeting", start: localStart(BASE, 10, 17) },
  { uid: "hol-1@columbus", summary: "City Offices Closed", start: localStart(BASE, 12, 8) },
]);
const COLUMBUS_HOME = `<html><body><h1>City of Columbus, Ohio</h1><p>Columbus City Council meets Mondays at 5 p.m.</p>
<a href="/calendar/city-council.ics">City Council meetings (iCal)</a></body></html>`;

/** One state's registration, through its own routine door (the Census source, pinned). */
async function promoteRegistration(store: MemoryRoutineDataStore, state: string): Promise<void> {
  const candidate = registrationCandidate({
    target: registrationTarget(state),
    reference: loadRegistrationReference(ROOT, state),
    receipt: { requestedUrl: REGISTRATION_SOURCE_URL, finalUrl: REGISTRATION_SOURCE_URL, httpStatus: 200, retrievedAt: T_REGISTRATION, sha256: REGISTRATION_SOURCE_SHA256, bytes: REGISTRATION_SOURCE_BYTES, confirmedBy: "BYTES_HASHED" },
    reviewed: reviewedIds(ROOT),
  });
  const outcome = await processRegisteredRoutineCandidate(store, `registration-${state.toLowerCase()}`, candidate, T_REGISTRATION);
  assert.equal(outcome.candidate.state, "PROMOTED", outcome.candidate.failureDetail ?? "");
}

/** A county's ZCTAs as the published lookup states them: each ZCTA's area share inside it, from the sampled overlap. */
const SAMPLES = JSON.parse(readFileSync(join(ROOT, "data/derived/zip-governments.json"), "utf8")).zips as Record<string, { layer: string; id: string; samples: number }[]>;
function countyOverlaps(geoid: string): { zcta5: string; whole: boolean; fraction: number | null }[] {
  const out: { zcta5: string; whole: boolean; fraction: number | null }[] = [];
  for (const [zcta5, edges] of Object.entries(SAMPLES)) {
    const counties = edges.filter((e) => e.layer === "county");
    const total = counties.reduce((n, e) => n + e.samples, 0);
    const mine = counties.find((e) => e.id === geoid);
    if (mine === undefined || total === 0) continue;
    out.push({ zcta5, whole: mine.samples >= total, fraction: mine.samples >= total ? 1 : mine.samples / total });
  }
  return out.sort((a, b) => a.zcta5.localeCompare(b.zcta5));
}

/** A published lookup that knows these counties: what `loadPublishedLookupState` answers in production. */
function lookupOf(counties: Readonly<Record<string, { readonly label: string; readonly stateAbbr: string }>>) {
  return async () => ({
    source: "published" as const,
    versionId: "cv-lookup-test",
    lookup: {
      // This fixture publishes county-to-ZIP rows only; no reverse layer is held.
      groupingsForZcta: async () => ({ status: { kind: "OK" }, memberships: [] }),
      listVersions: async () => [],
      zctasForGrouping: async (g: { type: string; geoid: string; version: string }) => ({
        status: { kind: "OK" },
        geography: { type: g.type, geoid: g.geoid, version: g.version, ocdId: null, label: counties[g.geoid]!.label, stateFips: g.geoid.slice(0, 2), stateAbbr: counties[g.geoid]!.stateAbbr, memberStates: [counties[g.geoid]!.stateAbbr] },
        overlaps: countyOverlaps(g.geoid).map((o) => ({ ...o, fractionBasis: "area" })),
      }),
    },
  }) as never;
}

/** The owner's Send, through the gateway's one door, exactly as the composer posts it. */
async function send(repos: ControlPlaneRepositories, geography: Record<string, string>, key: string): Promise<void> {
  let ms = Date.parse(T_SEND);
  const request: ActionRequest = {
    type: "expansion.scope.set",
    subject: geography.label!,
    input: { geography, priority: "1", budgetUsd: "0", note: "Every government here." },
    stateVersion: null,
    idempotencyKey: key,
    caller: "OWNER_SESSION",
    actorRef: "adm_test-session",
  };
  const outcome = await submit(request, { repos, now: () => new Date((ms += 1000)).toISOString(), currentStateVersion: "world-1", codeSha: null });
  assert.equal(outcome.ok, true, outcome.receipt.says);
}

/** What Postgres answers for the preview's registration slice, from the promoted pointer. */
function postgresOverRegistration(versionId: string, model: RegistrationReadModel): ReadOnlyQuery {
  return async (statements) =>
    statements.map((s): Row[] => {
      if (s.text.startsWith("SELECT current_version_id")) return [{ version_id: versionId }];
      const wanted = new Set(s.params[2] as string[]);
      return model.bodies
        .filter((b) => b.jurisdictionId !== null && wanted.has(b.ocdId))
        .map((b) => ({ jurisdiction_id: b.jurisdictionId, ocd_id: b.ocdId, body_id: b.id }));
    });
}

/** The preview's codes: the lookup's overlaps, each joined to the national ZIP index, as the geography-preview route reads them. */
async function previewCodes(geoid: string): Promise<PreviewCode[]> {
  return Promise.all(countyOverlaps(geoid).map(async (o) => {
    const entry = await zipDivisionEntry(o.zcta5);
    return { ...o, divisions: entry?.ids ?? [], partial: entry?.partial ?? [] };
  }));
}

/**
 * One runner cycle's Send step, as scripts/freshness-shadow.mts runs it: scopes, registration, territory, plan, and
 * apply — or, for a cycle that may not write (a dry run), the plan alone: the runner's own preview.
 */
async function runnerCycle(
  repos: ControlPlaneRepositories,
  store: MemoryRoutineDataStore,
  counties: Parameters<typeof lookupOf>[0],
  now: string,
  writes: "APPLIED" | "PLAN_ONLY" = "APPLIED",
): Promise<{ reading: DispatchWorkReading; scope: PlannedScope }> {
  const expansionLoad = await loadExpansionPlan({
    repos,
    root: ROOT,
    now,
    obligations: [],
    loadLookup: lookupOf(counties),
    beforeTerritory: async (states) =>
      [...(await preloadRegistrationJurisdictions({ root: ROOT, states, options: { store, bypassCache: true, now } })).refused].map(([s, why]) => `${s}: ${why}`),
    loadTerritory: () => {
      const promoted = promotedRegistries();
      assert.ok("registries" in promoted);
      return readTerritoryIndex(ROOT, [...promoted.registries.values()]);
    },
  });
  assert.deepEqual(expansionLoad.conditions, []);
  const [scope] = expansionLoad.plan?.scopes ?? [];
  assert.ok(scope !== undefined && scope.kind === "RESOLVED", "the Send's geography resolves");
  const promoted = promotedRegistries();
  assert.ok("registries" in promoted);
  if (!("registries" in promoted)) throw new Error("unreachable");
  const durable = new Map((await repos.obligations.list()).map((row) => [row.id, { active: row.value.active, materializedBy: row.value.materializedBy }] as const));
  const plan = planDispatchWork({
    targets: [scopeWorkTarget(scope)],
    world: {
      registries: promoted.registries,
      territory: expansionLoad.territory ?? null,
      territoryDetail: expansionLoad.territoryDetail ?? null,
      corpus: [],
      durable,
      meetingPartitions: UNREAD_MEETING_PARTITIONS,
      refusedRegistries: promoted.refused,
    },
  });
  const applied = writes === "APPLIED" ? await applyDispatchWork(repos, plan, { now }) : null;
  const reading = dispatchWorkReading(plan, applied, {
    at: now, modelLaneClosed: "closed: the owner's pause", ceilingUsd: 25, ceilingSource: "FALLBACK", writes, planOnlyWhy: writes === "APPLIED" ? null : "--dry writes nothing",
  });
  return { reading, scope };
}

/** A promoted venue-resolutions version: every adapter reading resolves through it (derived-wiring-reading.ts). */
async function promoteVenues(store: MemoryRoutineDataStore): Promise<void> {
  const urls = ["https://public.example.gov/venue", "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=90+W+Broad+St&benchmark=Public_AR_Current&format=json"];
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
        id: "venue:test:columbus:90wbroad", sourceId: "test-source", bodyOcdId: "ocd-division/country:us/state:oh/place:columbus", match: "90 W Broad St",
        name: "Columbus City Hall", address: "90 W Broad St, Columbus, OH 43215", lat: 39.96, lng: -83.0,
        addressSourceUrl: urls[0], coordinateSourceUrl: urls[1], verifiedAt: T_REGISTRATION,
      }],
    },
  };
  const outcome = await processRegisteredManualCandidate(store, "venue-resolutions", manualProjectionCandidate(pkg), T_REGISTRATION);
  assert.equal(outcome.candidate.state, "PROMOTED", outcome.candidate.failureDetail ?? "");
}

test("A SEND FOR FRANKLIN COUNTY, OHIO: the preview's count is what the runner creates, from registration, and Columbus's calendar reaches the Reader", async () => {
  clearRegistrationJurisdictionRegistries();
  const store = new MemoryRoutineDataStore();
  const repos = createMemoryRepositories();
  await repos.adminConfig.put(ADMIN_CONFIG_ID, defaultAdminConfig(T_REGISTRATION), T_REGISTRATION);
  await promoteRegistration(store, "OH");
  await promoteVenues(store);
  const reg = await readRegistrationProjection("OH", { store, bypassCache: true, now: T_SEND });
  assert.equal(reg.kind, "PROMOTED");
  if (reg.kind !== "PROMOTED") return;
  const model = reg.value as RegistrationReadModel;
  const versionId = reg.metadata.versionId!;
  assert.throws(() => requiredJurisdictionRegistry("oh"), /JURISDICTION_REGISTRY_NOT_READ:oh/, "nothing has read Ohio's registration yet");

  /* 1. Admin's preview, before anything is sent: the promoted registration's slice, placed by the runner's rule. */
  const FRANKLIN = { "39049": { label: "Franklin County, Ohio", stateAbbr: "OH" } };
  const codes = await previewCodes("39049");
  const slice = await registrationGovernments("OH", [...new Set(codes.flatMap((c) => c.divisions))], postgresOverRegistration(versionId, model));
  assert.equal(slice.kind, "HELD");
  if (slice.kind !== "HELD") return;
  const preview = registrationGovernmentsPlaced(codes, slice.value);
  assert.ok(preview.certain.length > 30, `Franklin County holds dozens of governments (${preview.certain.length})`);
  for (const id of ["oh:county:county-of-franklin", COLUMBUS]) assert.ok(preview.certain.includes(id), `${id} is in the preview`);
  const sentence = stateSendPreviewSentence({ kind: "REGISTRATION", state: "OH", versionId, governments: preview.certain, edge: preview.edge });
  assert.match(sentence, new RegExp(`creates work for ${preview.certain.length} governments here`));
  assert.match(sentence, /from registration \(the 2022 Census of Governments, promoted version .+\) — no reviewed registry exists for OH/);

  /* 2. The owner's Send; the runner's own preview (a cycle that may not write); then its next cycle. */
  await send(repos, { type: "county", geoid: "39049", version: "county:2020", label: "Franklin County, Ohio", stateAbbr: "OH" }, "scope-franklin-0001");
  const dry = (await runnerCycle(repos, store, FRANKLIN, T_CYCLE, "PLAN_ONLY")).reading.targets[0]!;
  assert.equal(dry.requirements.created, 0, "a cycle that may not write creates nothing");
  const first = (await runnerCycle(repos, store, FRANKLIN, T_CYCLE)).reading.targets[0]!;
  assert.equal(first.requirements.created + first.requirements.deferred, dry.requirements.deferred, "all planned missing requirements are created");
  assert.equal(first.requirements.deferred, 0, "one pass creates all work beyond the former 200-row cap");
  const second = (await runnerCycle(repos, store, FRANKLIN, T_NEXT)).reading.targets[0]!;
  assert.equal(second.requirements.createdThisCycle, 0, "the second pass creates no duplicates");
  assert.equal(second.requirements.deferred, 0);
  const { reading } = await runnerCycle(repos, store, FRANKLIN, new Date(Date.parse(T_NEXT) + 3_600_000).toISOString());
  const [target] = reading.targets;
  assert.ok(target !== undefined);
  assert.deepEqual(target.blocked, [], "nothing is blocked: Ohio's registration names its governments");
  assert.equal(target.units.placed, dry.units.placed, "the cycle places what its own preview placed");
  assert.equal(target.requirements.created, dry.requirements.deferred, "and creates what that preview counted as owed");
  assert.equal(target.units.fromRegistration, target.units.placed, "every one of them from registration");
  assert.equal(target.requirements.defined, target.units.placed * 8, "meetings, five missing-family obligations, independently verified public-comment rules and body-directory discovery for every registered body");
  assert.equal(target.requirements.created, target.requirements.defined);
  assert.equal(target.requirements.createdThisCycle, second.requirements.deferred, "the normal next cycle creates the remainder without duplicates");
  assert.equal(target.requirements.deferred, 0);
  assert.equal(target.requirements.createdFromRegistration, target.requirements.defined);
  assert.equal(target.requirements.carried, 0);
  assert.deepEqual(target.reordered, { obligations: 0, of: 0 }, "nothing stood on a clock here to reorder");
  const n = target.units.placed;
  assert.match(target.says.join(" "), new RegExp(`${n} of the ${n} governments here come from registration \\(the 2022 Census of Governments; OH version ${versionId}\\)`));
  assert.match(scopeCreationSentence(target), /come from registration \(the 2022 Census of Governments\): their state has no reviewed registry/);

  const created = (await repos.obligations.list()).map((row) => row.value).filter((o) => o.materializedBy === OWNER_DISPATCH);
  assert.equal(created.length, n * 8, "the store holds exactly what the runner counted");
  // The real gateway/runner marks survive the publisher's bounded list. This
  // is the same exact-reference filter Admin reads, not a geographic guess.
  const assignmentSources = await readAllAssignmentSources(repos, { nowIso: T_CYCLE, activation: null, pilotZips: [] });
  const publishedWork = buildAssignmentView(assignmentSources, { perGroup: 1 });
  const instruction = created[0]!.assignments![0]!.assignmentKey;
  assert.equal(Object.values(publishedWork.instructionCounts?.[instruction] ?? {}).reduce((sum, count) => sum + count, 0), created.length);
  assert.ok(publishedWork.selection.omitted > 0);
  assert.ok(publishedWork.rows.every(row => row.assignmentKeys?.includes(instruction)));
  const placed = [...new Set(created.map((o) => o.subjectId))].sort();
  /* Admin's preview: every government it counts as certain is created, and nothing outside its edge is. */
  for (const id of preview.certain) assert.ok(placed.includes(id), `${id}: counted certain, and created`);
  for (const id of placed) assert.ok(preview.certain.includes(id) || preview.edge.includes(id), `${id}: created, and inside the preview's edge`);
  assert.ok(n >= preview.certain.length && n <= preview.certain.length + preview.edge.length);
  assert.ok(created.every((o) => o.materializedFrom === "REGISTRATION"), "each created row says it came from registration");
  const missingFamilies = created.filter(o => !o.id.startsWith(MEETINGS_DISCOVERY_NAMESPACE));
  assert.equal(missingFamilies.length, n * 7);
  assert.equal(missingFamilies.filter(o => o.autonomousPlan?.contract.recordClass === "OFFICIAL_BOARD_DIRECTORY").length, n);
  assert.equal(missingFamilies.filter(o => o.autonomousPlan?.publication?.contractId === "official-filings").length, n, "finance filing work reaches its verified-fact publisher");
  assert.equal(missingFamilies.filter(o => o.autonomousPlan?.publication?.contractId === "ballot-contests" && o.autonomousPlan.contract.recordClass === "BALLOT_CONTEST").length, n, "candidate lists reach the whole-contest publisher");
  assert.equal(missingFamilies.filter(o => o.autonomousPlan?.publication?.contractId === "everyday-routing").length, n);
  assert.equal(missingFamilies.filter(o => o.autonomousPlan?.publication?.contractId === "ballot-navigation").length, n);
  assert.equal(missingFamilies.filter(o => o.autonomousPlan?.publication?.contractId === "comment-access").length, n, "every mapped body owes its own verified participation rules");
  assert.ok(missingFamilies.every(o => o.autonomousPlan?.contract.schemaVersion === 2 && o.autonomousPlan.contract.extraction.format === "UNSUPPORTED" && o.autonomousPlan.sources.length === 0), "new discovery instructions invent no observed sources or extracted records");
  const ohio = requiredJurisdictionRegistry("oh");
  assert.equal(ohio.registration?.versionId, versionId, "read from the promoted version, the one readers use");
  const findOwnSite = created.filter((o) => o.id.endsWith("#find-own-site"));
  assert.ok(findOwnSite.length > 0, "a government the Census records no web address for owes finding its site first");
  for (const o of findOwnSite) assert.equal(ohio.jurisdictions.find((j) => j.id === o.subjectId)?.ownWebAddress, null, `${o.subjectId}: no address is invented`);
  assert.ok(created.some((o) => o.id === `${MEETINGS_DISCOVERY_NAMESPACE}${COLUMBUS}#own-site-meetings`));

  /* A second Send of the same geography creates nothing new. */
  const again = await runnerCycle(repos, store, FRANKLIN, T_WALK);
  assert.equal(again.reading.targets[0]!.requirements.createdThisCycle, 0);
  assert.equal(again.reading.targets[0]!.requirements.created, created.length);

  /* 3. The next cycle's providers keep the created work: the same accessor reads Ohio's registration. */
  const ids = new Set(created.map((o) => o.id));
  const pass = buildRegistry([meetingsDiscoveryProvider({ materialized: () => ({ ids }) }), localJurisdictionsProvider({
    trackedStates: { read: () => ({ states: [], source: "fixture: no standing state work" }) }, materialized: () => ({ ids }),
  })], { root: ROOT, nowIso: T_NEXT });
  assert.deepEqual(pass.byProvider.map((p) => p.readFailure), [null, null]);
  assert.deepEqual(pass.units.map((u) => u.obligation.id).sort(), [...ids].sort(), "every created row stays in the corpus");

  /* 4. Use the free walk at the recorded address; paid work remains subject to the separate owner pause and budget. */
  const dispatched = materializedDiscoveryNeeds([...ids]);
  assert.deepEqual(dispatched.failures, []);
  const needs = dispatched.entries.map((e) => ({ ...e.need, addressSource: dispatchedAddressSource(e.reg, null) }));
  const columbus = needs.find((n) => n.jurisdictionId === COLUMBUS)!;
  assert.equal(columbus.ownWebAddress, "http://www.columbus.gov/", "the Census of Governments' own record");
  assert.deepEqual(columbus.addressSource, { source: "REGISTRATION", versionId });
  const subjects = needs.map((n) => ({ jurisdictionId: n.jurisdictionId, walkable: walkableByFreeWalk(n) }));
  const columbusId = `${MEETINGS_DISCOVERY_NAMESPACE}${COLUMBUS}#own-site-meetings`;
  assert.equal(paidDiscoveryHold(columbusId, await readFreeDiscoveryWalks(repos, subjects)), null);
  const vault = new Map<string, HeldBytes>();
  let tick = 0;
  const walked = await runMeetingsDiscovery(repos, {
    needs,
    cycleIndex: 0,
    maxWalks: 1,
    firstIds: new Set([COLUMBUS]),
    runtime: {
      open: recordedDiscoveryOpen({
        [`https://${COLUMBUS_HOST}/robots.txt`]: ALLOW,
        [`https://${COLUMBUS_HOST}/`]: { status: 200, body: COLUMBUS_HOME },
        [COLUMBUS_ROUTE]: { status: 200, body: COLUMBUS_FEED, contentType: "text/calendar" },
      }),
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
  assert.deepEqual(walked.walked.map((a) => [a.jurisdictionId, a.outcome]), [[COLUMBUS, "FOUND"]], "the free walk took the Send's city first");
  const [attempt] = walked.walked;
  assert.equal(attempt!.found[0]?.url, COLUMBUS_ROUTE);
  assert.deepEqual(attempt!.site?.address, { source: "REGISTRATION", versionId }, "the host is attested by the registration it was recorded in");
  assert.match(paidDiscoveryHold(columbusId, await readFreeDiscoveryWalks(repos, subjects))?.why ?? "", /already found/);

  /* 5. The automatic crosswalk, the wiring, Ohio's family and the Reader. */
  const regInput: DerivedInputRef = { kind: "PROMOTED_VERSION", recordClass: "REGISTRATION", scope: reg.metadata.scope, versionId, readModelSha256: sha(reg.value), promotedAt: reg.metadata.promotedAt! };
  const labels = new Map(model.divisions.map((d) => [d.ocdId, d.label] as const));
  const body = model.bodies.find((b) => b.jurisdictionId === COLUMBUS)!;
  assert.equal(body.id, COLUMBUS_BODY);
  /* The registered government's division: the registration stub below answers only a row on it. */
  const columbusDivision = body.ocdId;
  assert.equal(ohio.jurisdictions.find((j) => j.id === COLUMBUS)?.bodyId, COLUMBUS_BODY, "the registry row carries the body registration minted");
  const walk = { attempt: attempt!, recordId: "pos-columbus", recordedAt: attempt!.finishedAt };
  const review = reviewDiscoveryWalk({
    walk,
    registered: { bodyId: body.id, ocdId: body.ocdId, publishingOrg: labels.get(body.ocdId) ?? COLUMBUS, input: regInput },
    held: (id) => vault.get(id) ?? null,
    handWired: () => false,
    reviewer: autoCrosswalkReviewerId("feedfacecafe0123"),
    now: T_CROSSWALK,
  });
  assert.deepEqual(review.accepted.map((a) => [a.row.bodyId, a.row.bodyName]), [[COLUMBUS_BODY, "City Council"]], JSON.stringify(review.held));
  const crosswalkOutcome = await processRegisteredRoutineCandidate(store, "meeting-body-crosswalk-derived", derivedCrosswalkCandidate(planDerivedCrosswalk({ previous: [], reviews: [review] }), [], T_CROSSWALK), T_CROSSWALK);
  assert.equal(crosswalkOutcome.candidate.state, "PROMOTED", `${crosswalkOutcome.candidate.failureCode ?? ""} ${crosswalkOutcome.candidate.failureDetail ?? ""}`);

  const automatic = await readDerivedMeetingBodyCrosswalk({ store, bypassCache: true, now: T_WIRING });
  assert.equal(automatic.kind, "PROMOTED");
  if (automatic.kind !== "PROMOTED") return;
  const automaticInput: DerivedInputRef = {
    kind: "PROMOTED_VERSION", recordClass: "CURATED_READER_RECORD", scope: "US:meeting-body-crosswalk-derived",
    versionId: automatic.metadata.versionId!, readModelSha256: sha(automatic.value), promotedAt: automatic.metadata.promotedAt!,
  };
  const composed = composeCrosswalk(null, automatic.value.records);
  const readings: HeldCalendarReading[] = composed.rows.map((row) => {
    const artifactId = attempt!.found.find((f) => f.url === row.route)!.artifactId!;
    return { key: `${row.id}\u0000${artifactId}`, row: wiringRowFor(row), held: { text: vault.get(artifactId)!.text, contentType: "text/calendar" }, evidence: vault.get(artifactId)!.evidence, others: [] };
  });
  const read = await readHeldCalendars({ options: { store, bypassCache: true, now: T_WIRING }, now: T_WIRING, adapterDigest: () => "ical@0123456789ab", readings });
  assert.equal(read.kind, "READ", read.kind === "UNREADABLE" ? read.detail : "");
  if (read.kind !== "READ") return;
  const decisions = deriveWiringDecisions({
    crosswalk: { input: automaticInput, versionId: automatic.metadata.versionId!, rows: composed.rows, automatic: { input: automaticInput, versionId: automatic.metadata.versionId!, rowIds: composed.automaticIds } },
    registration: (row) => (row.jurisdictionId === COLUMBUS && row.ocdId === columbusDivision ? { input: regInput } : { notRegistered: `no body for ${row.jurisdictionId}` }),
    attempts: [walk],
    handWired: () => false,
    vaulted: (id) => vault.get(id)?.evidence ?? null,
    vaultedBytes: (hex) => [...vault.values()].find((b) => b.sha256 === hex)?.evidence ?? null,
    verify: (row, _binding, evidence) => read.verifications.get(`${row.crosswalkRowId}\u0000${evidence.artifactId}`) ?? { refused: "not read" },
    adapterDigest: () => "ical@0123456789ab",
    previous: [],
    now: T_WIRING,
  });
  assert.deepEqual(decisions.map((d) => [d.key, d.disposition]), [[derivedWiringKey("ICAL", COLUMBUS_BODY, COLUMBUS_ROUTE), "PROMOTE"]]);
  const wiringPlan = planDerivedVersion([], decisions);
  const wiringOutcome = await processRegisteredRoutineCandidate(store, "meeting-source-wiring", derivedWiringCandidate(wiringPlan, [automaticInput], T_WIRING), T_WIRING);
  assert.equal(wiringOutcome.candidate.state, "PROMOTED", `${wiringOutcome.candidate.failureCode ?? ""} ${wiringOutcome.candidate.failureDetail ?? ""}`);

  const wiring = await readDerivedMeetingWiring({ store, bypassCache: true, now: T_FAMILY });
  assert.equal(wiring.kind, "PROMOTED");
  if (wiring.kind !== "PROMOTED") return;
  const members = familyMembers(wiring.value, "US-OH");
  assert.deepEqual(members.map((m) => [m.id, m.status]), [[derivedWiringKey("ICAL", COLUMBUS_BODY, COLUMBUS_ROUTE), "ACTIVE"]]);
  const reads: FamilyMemberRead[] = members.map((member) => ({
    member,
    acquisitions: [{ requestedUrl: member.row.route, finalUrl: member.row.route, httpStatus: 200, rawHash: vault.get(attempt!.found[0]!.artifactId!)!.sha256, byteCount: COLUMBUS_FEED.length }],
    ok: true,
    error: null,
    freshMeetings: makeIcalSource([bodySourceWiringFor(member.row)]).normalizeWithDrops([{ wiring: bodySourceWiringFor(member.row), ics: COLUMBUS_FEED, collectedAt: T_FAMILY, sourceUrl: member.row.route }], new Date(T_FAMILY)).meetings,
    freshAgendaDocuments: [],
    retrievedAt: T_FAMILY,
  }));
  const partition = requiredMeetingPartitionContract(derivedMeetingFamilyId("US-OH"));
  const build = buildDerivedFamily({
    wiringInput: { kind: "PROMOTED_VERSION", recordClass: "CURATED_READER_RECORD", scope: "US:meeting-source-wiring", versionId: wiring.metadata.versionId!, readModelSha256: sha(wiring.value), promotedAt: wiring.metadata.promotedAt! },
    members, reads, previous: null, generatedAt: T_FAMILY,
    reconcile: (r) => ({ meetings: r.freshMeetings, agendaDocuments: [], removalEvidence: [] }),
  });
  const familyOutcome = await processRegisteredMeetingPartitionCandidate(store, partition.id, derivedFamilyCandidate(partition, build), T_FAMILY);
  assert.equal(familyOutcome.candidate.state, "PROMOTED", `${familyOutcome.candidate.failureCode ?? ""} ${familyOutcome.candidate.failureDetail ?? ""}`);

  const reader = await readMeetingsProjection({ store, now: T_READER, bypassCache: true });
  assert.equal(reader.kind, "PROMOTED");
  if (reader.kind !== "PROMOTED") return;
  const sittings = reader.value.meetings.filter((m) => m.bodyId === COLUMBUS_BODY);
  assert.deepEqual(sittings.map((m) => m.title).sort(), ["City Council Regular Meeting", "Columbus City Council Regular Meeting"], "the council's sittings, and never the office closure");
  for (const m of sittings) {
    assert.equal(m.bodyName, "City Council");
    assert.equal(m.ocdId, "ocd-division/country:us/state:oh/place:columbus");
    assert.equal(m.provenance.sourceUrl, COLUMBUS_ROUTE, "each sitting links the city's own calendar");
    assert.equal(m.timeZone, "America/New_York");
  }
  clearRegistrationJurisdictionRegistries();
});

test("A SEND FOR A PUERTO RICO MUNICIPIO creates its discovery needs from registration, honestly find-own-site: no address is recorded, and none is invented", async () => {
  clearRegistrationJurisdictionRegistries();
  const store = new MemoryRoutineDataStore();
  const repos = createMemoryRepositories();
  await repos.adminConfig.put(ADMIN_CONFIG_ID, defaultAdminConfig(T_REGISTRATION), T_REGISTRATION);
  await promoteRegistration(store, "PR");
  const reg = await readRegistrationProjection("PR", { store, bypassCache: true, now: T_SEND });
  assert.equal(reg.kind, "PROMOTED");
  if (reg.kind !== "PROMOTED") return;
  const versionId = reg.metadata.versionId!;

  const ADJUNTAS = { "72001": { label: "Adjuntas Municipio, Puerto Rico", stateAbbr: "PR" } };
  const codes = await previewCodes("72001");
  const slice = await registrationGovernments("PR", [...new Set(codes.flatMap((c) => c.divisions))], postgresOverRegistration(versionId, reg.value as RegistrationReadModel));
  assert.equal(slice.kind, "HELD");
  if (slice.kind !== "HELD") return;
  const preview = registrationGovernmentsPlaced(codes, slice.value);
  const inPreview = new Set([...preview.certain, ...preview.edge]);
  assert.ok(inPreview.has("pr:county:adjuntas-municipio"), JSON.stringify(preview));

  await send(repos, { type: "county", geoid: "72001", version: "county:2020", label: "Adjuntas Municipio, Puerto Rico", stateAbbr: "PR" }, "scope-adjuntas-0001");
  const { reading } = await runnerCycle(repos, store, ADJUNTAS, T_CYCLE);
  const [target] = reading.targets;
  assert.deepEqual(target!.blocked, [], "a territory's governments are registered too: nothing is blocked");
  assert.equal(target!.requirements.created, target!.units.placed * 8);

  const created = (await repos.obligations.list()).map((row) => row.value).filter((o) => o.materializedBy === OWNER_DISPATCH);
  const placed = [...new Set(created.map((o) => o.subjectId))].sort();
  assert.ok(placed.includes("pr:county:adjuntas-municipio"), `the municipio itself is placed by its sampled share (${placed.join(", ")})`);
  for (const id of preview.certain) assert.ok(placed.includes(id));
  for (const id of placed) assert.ok(inPreview.has(id), `${id} is inside the preview's edge`);
  assert.ok(created.every((o) => o.materializedFrom === "REGISTRATION"));
  assert.ok(created.filter(o => o.id.startsWith(MEETINGS_DISCOVERY_NAMESPACE)).every(o => o.id.endsWith("#find-own-site")));
  assert.ok(created.filter(o => !o.id.startsWith(MEETINGS_DISCOVERY_NAMESPACE)).every(o => o.autonomousPlan?.seedUrls.length === 0 && o.autonomousPlan.sources.length === 0), "no territory source address is invented");

  const dispatched = materializedDiscoveryNeeds(created.map((o) => o.id));
  assert.deepEqual(dispatched.failures, []);
  const adjuntas = dispatched.entries.find((e) => e.need.jurisdictionId === "pr:county:adjuntas-municipio")!;
  assert.equal(adjuntas.need.basis, "NO_MEETINGS_SOURCE_RECORDED");
  assert.equal(adjuntas.need.ownWebAddress, null, "TIGER/Line records no web address, so none is invented");
  assert.equal(walkableByFreeWalk(adjuntas.need), false, "the free walk has no site to open");
  const walks = await readFreeDiscoveryWalks(repos, [{ jurisdictionId: adjuntas.need.jurisdictionId, walkable: false }]);
  assert.equal(walks.latestFor(adjuntas.need.jurisdictionId), "NO_SITE_TO_WALK");
  assert.equal(paidDiscoveryHold(`${MEETINGS_DISCOVERY_NAMESPACE}pr:county:adjuntas-municipio#find-own-site`, walks), null, "finding the site is the paid lane's, inside the owner's budgets");
  const route = buildRegistry([meetingsDiscoveryProvider({ materialized: () => ({ ids: new Set(created.map((o) => o.id)) }) })], { root: ROOT, nowIso: T_NEXT })
    .routeFor(`${MEETINGS_DISCOVERY_NAMESPACE}pr:county:adjuntas-municipio#find-own-site`);
  assert.match(route?.citation ?? "", /PR's registration names this government \(promoted version .+\), and the Census records no web address for it, so none is invented/);
  clearRegistrationJurisdictionRegistries();
});
