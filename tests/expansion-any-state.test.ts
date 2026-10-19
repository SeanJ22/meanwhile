import { runCensusState } from "../lib/control-plane/discovery/census-lane.ts";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { BuiltGrouping, BuiltScope } from "../lib/census-geography/dataset.ts";
import { createLookup } from "../lib/census-geography/lookup.ts";
import type { PublishedLookupState } from "../lib/census-geography/reader.ts";
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
import { reviewedBodyForGovernment } from "../lib/control-plane/discovery/reviewed-body.ts";
import { walkableByFreeWalk } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { applyDispatchWork, dispatchWorkReading, planDispatchWork, scopeWorkTarget, type DispatchWorkReading } from "../lib/control-plane/expansion/dispatch-work.ts";
import type { PlannedScope } from "../lib/control-plane/expansion/membership.ts";
import { loadExpansionPlan, readTerritoryIndex } from "../lib/control-plane/expansion/runner-load.ts";
import { registrationGovernmentsPlaced, stateSendPreviewSentence, type PreviewCode } from "../lib/control-plane/expansion/send-preview.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import type { ActionRequest } from "../lib/control-plane/gateway/contract.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { readEveryAssignmentSource } from "./helpers/assignment-sources.ts";
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
} from "../lib/control-plane/scheduler/providers/meetings-discovery.ts";
import { buildRegistry } from "../lib/control-plane/scheduler/registry.ts";
import type { JurisdictionRegistry } from "../lib/hunt/jurisdiction-universe.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { registrationCandidate, type RegistrationReadModel } from "../lib/registration/candidate.ts";
import { preloadRegistrationJurisdictions } from "../lib/registration/jurisdictions.ts";
import { REGISTRATION_SOURCE_BYTES, REGISTRATION_SOURCE_SHA256, REGISTRATION_SOURCE_URL, registrationTarget } from "../lib/registration/publication.ts";
import { readRegistrationProjection } from "../lib/registration/reader.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { makeIcalSource } from "../lib/sources/ical/index.ts";
import { curatedReaderSourceClass } from "./helpers/curated-reader-source-class.ts";
import { ics, localStart, reviewedIds } from "./helpers/expansion-fixtures.ts";
import { freshEdge, publishPass, readPlace } from "./helpers/meeting-body-fixtures.ts";
import { recordedDiscoveryOpen, type RecordedReply } from "./helpers/recorded-discovery-open.ts";

const ROOT = join(import.meta.dirname, "..");

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
const COLUMBUS_DIVISION = "ocd-division/country:us/state:oh/place:columbus";
const COLUMBUS_HOST = "www.columbus.gov";
const COLUMBUS_ROUTE = `https://${COLUMBUS_HOST}/calendar/city-council.ics`;
const ALLOW: RecordedReply = { status: 200, body: "User-agent: *\nAllow: /\n", contentType: "text/plain" };

installOperationalReferenceBundle(operationalReferenceBundle(
  JSON.parse(readFileSync(join(ROOT, "tests/fixtures/jurisdiction-registries.json"), "utf8")) as Record<"az" | "nh" | "nj", JurisdictionRegistry>,
));

const sha = (value: unknown): string => createHash("sha256").update(canonicalCivicDataJson(value)).digest("hex");

const COLUMBUS_FEED = ics([
  { uid: "cc-1@columbus", summary: "Columbus City Council Regular Meeting", start: localStart(BASE, 3, 17) },
  { uid: "cc-2@columbus", summary: "City Council Regular Meeting", start: localStart(BASE, 10, 17) },
  { uid: "hol-1@columbus", summary: "City Offices Closed", start: localStart(BASE, 12, 8) },
]);
const COLUMBUS_HOME = `<html><body><h1>City of Columbus, Ohio</h1><p>Columbus City Council meets Mondays at 5 p.m.</p>
<a href="/calendar/city-council.ics">City Council meetings (iCal)</a></body></html>`;

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

const GEOGRAPHY: readonly (BuiltGrouping & { readonly type: "county" | "place" })[] = [
  { type: "county", geoid: "39049", ocdId: "ocd-division/country:us/state:oh/county:franklin", label: "Franklin County, Ohio",
    stateFips: "39", stateAbbr: "OH", memberStates: ["OH"], overlaps: [{ zcta5: "43215", whole: true, fraction: 1 }] },
  { type: "place", geoid: "3918000", ocdId: "ocd-division/country:us/state:oh/place:columbus", label: "Columbus city",
    stateFips: "39", stateAbbr: "OH", memberStates: ["OH"], overlaps: [{ zcta5: "43215", whole: false, fraction: 0.8 }] },
  { type: "county", geoid: "72001", ocdId: "ocd-division/country:us/territory:pr/county:adjuntas", label: "Adjuntas Municipio, Puerto Rico",
    stateFips: "72", stateAbbr: "PR", memberStates: ["PR"], overlaps: [{ zcta5: "00601", whole: false, fraction: 0.8 }] },
];

function lookupOf(counties: Readonly<Record<string, { readonly label: string; readonly stateAbbr: string }>>): () => Promise<PublishedLookupState> {
  const states = new Set(Object.values(counties).map(c => c.stateAbbr));
  const scopes: BuiltScope[] = (["county", "place"] as const).map(type => {
    const groupings = GEOGRAPHY.filter(g => g.type === type && states.has(g.stateAbbr));
    return {
      type, version: `${type}:2020`, fractionBasis: "area", groupings, instanceCount: groupings.length,
      zctaEdgeCount: groupings.reduce((count, g) => count + g.overlaps.length, 0),
      versionMeta: { key: `${type}:2020`, type, plan: "2020", zctaTabulation: "2020", effectiveFor: "Synthetic integration fixture",
        provenance: { sourceUrls: [`https://fixtures.example/census/${type}-area-overlaps`], sourceDataset: "Synthetic integration fixture",
          sourceFiles: [`${type}-area-overlaps.json`], sourceChecksums: [sha(groupings)], method: "Explicit fixture area observations", computedAt: T_REGISTRATION } },
    };
  });
  const versionId = "cv-lookup-test";
  const lookup = createLookup({ formatVersion: 1, builtAt: T_REGISTRATION, coverage: "Integration fixtures only", scopes,
    zctaUniverse: [...new Set(scopes.flatMap(s => s.groupings.flatMap(g => g.overlaps.map(o => o.zcta5))))] }, versionId);
  return async () => ({ source: "published", versionId, lookup });
}

async function send(repos: ControlPlaneRepositories, geography: Record<string, string>, key: string): Promise<void> {
  let ms = Date.parse(T_SEND);
  const request: ActionRequest = {
    type: "expansion.scope.set",
    subject: geography.label!,
    input: { geography, priority: "1", budgetUsd: "1", note: "Every government here." },
    stateVersion: null,
    idempotencyKey: key,
    caller: "OWNER_SESSION",
    actorRef: "adm_test-session",
  };
  const outcome = await submit(request, { repos, now: () => new Date((ms += 1000)).toISOString(), currentStateVersion: "world-1", codeSha: null });
  assert.equal(outcome.ok, true, outcome.receipt.says);
}

function postgresOverRegistration(versionId: string, model: RegistrationReadModel): ReadOnlyQuery {
  return async (statements) =>
    statements.map((s): Row[] => {
      if (s.text.startsWith("SELECT current_version_id")) return [{ version_id: versionId }];
      const wanted = new Set(s.params[2] as string[]);
      return (model.governments ?? []).filter(g => g.kind !== "EDUCATION_AGENCY").flatMap(g =>
        g.associations.filter(a => wanted.has(a.divisionId)).map(a => ({
          jurisdiction_id: g.jurisdictionId ?? g.id, ocd_id: a.divisionId, body_id: g.bodyIds[0] ?? null,
        })));
    });
}

async function previewCodes(geoid: string): Promise<PreviewCode[]> {
  const county = GEOGRAPHY.find(g => g.type === "county" && g.geoid === geoid)!;
  const { lookup } = await lookupOf({ [geoid]: county })();
  const { overlaps } = await lookup.zctasForGrouping({ type: "county", geoid, version: "county:2020" });
  return Promise.all(overlaps.map(async o => {
    const { memberships } = await lookup.groupingsForZcta(o.zcta5);
    return { ...o, divisions: memberships.flatMap(m => m.geography.ocdId ?? []),
      partial: memberships.filter(m => !m.whole).flatMap(m => m.geography.ocdId ?? []) };
  }));
}

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
    loadTerritory: (states, zips, places) => {
      const promoted = promotedRegistries();
      assert.ok("registries" in promoted);
      return readTerritoryIndex(ROOT, [...promoted.registries.values()], [...states], zips, places);
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

test("A SEND FOR FRANKLIN COUNTY, OHIO: the preview's count is what the runner creates, from registration, and Columbus's calendar reaches the Reader", async (t) => {
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

  const FRANKLIN = { "39049": { label: "Franklin County, Ohio", stateAbbr: "OH" } };
  const codes = await previewCodes("39049");
  const slice = await registrationGovernments("OH", [...new Set(codes.flatMap((c) => c.divisions))], postgresOverRegistration(versionId, model));
  assert.equal(slice.kind, "HELD");
  if (slice.kind !== "HELD") return;
  const preview = registrationGovernmentsPlaced(codes, slice.value);
  assert.deepEqual(preview.certain, [COLUMBUS, "oh:county:county-of-franklin"], "only governments with qualified native associations enter this held geometry");
  assert.ok(slice.value.every(g => g.bodyId === null), "registration does not manufacture governing bodies");
  for (const id of ["oh:county:county-of-franklin", COLUMBUS]) assert.ok(preview.certain.includes(id), `${id} is in the preview`);
  const sentence = stateSendPreviewSentence({ kind: "REGISTRATION", state: "OH", versionId, governments: preview.certain, edge: preview.edge });
  assert.match(sentence, new RegExp(`creates work for ${preview.certain.length} governments here`));
  assert.match(sentence, /from registration \(the 2022 Census of Governments, promoted version .+\) — no reviewed registry exists for OH/);

  await send(repos, { type: "county", geoid: "39049", version: "county:2020", label: "Franklin County, Ohio", stateAbbr: "OH" }, "scope-franklin-0001");
  const dry = (await runnerCycle(repos, store, FRANKLIN, T_CYCLE, "PLAN_ONLY")).reading.targets[0]!;
  assert.equal(dry.requirements.created, 0, "a cycle that may not write creates nothing");
  const first = (await runnerCycle(repos, store, FRANKLIN, T_CYCLE)).reading.targets[0]!;
  assert.equal(first.requirements.created + first.requirements.deferred, dry.requirements.deferred, "all planned missing requirements are created");
  assert.equal(first.requirements.deferred, 0, "one pass creates every source-discovery requirement in this scope");
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
  assert.equal(target.requirements.defined, target.units.placed, "one meetings discovery need per government");
  assert.equal(target.requirements.created, target.requirements.defined);
  assert.equal(target.requirements.createdThisCycle, second.requirements.deferred, "the normal next cycle creates the remainder without duplicates");
  assert.equal(target.requirements.deferred, 0);
  assert.equal(target.requirements.createdFromRegistration, target.requirements.defined);
  assert.equal(target.requirements.carried, 0);
  assert.deepEqual(target.reordered, { obligations: 0, of: 0 }, "nothing stood on a clock here to reorder");
  const n = target.units.placed;
  assert.match(target.says.join(" "), new RegExp(`${n} of the ${n} governments here come from registration \\(the 2022 Census of Governments; OH version ${versionId}\\)`));

  const created = (await repos.obligations.list()).map((row) => row.value).filter((o) => o.materializedBy === OWNER_DISPATCH);
  assert.equal(created.length, n, "the store holds exactly what the runner counted");
  // The real gateway/runner marks survive the publisher's bounded list: the same exact-reference filter Admin reads.
  const assignmentSources = await readEveryAssignmentSource(repos, T_CYCLE);
  const publishedWork = buildAssignmentView(assignmentSources, { perGroup: 1 });
  const instruction = created[0]!.assignments![0]!.assignmentKey;
  assert.equal(Object.values(publishedWork.instructionCounts?.[instruction] ?? {}).reduce((sum, count) => sum + count, 0), created.length);
  assert.ok(publishedWork.selection.omitted > 0);
  assert.ok(publishedWork.rows.every(row => row.assignmentKeys?.includes(instruction)));
  const placed = [...new Set(created.map((o) => o.subjectId))].sort();

  for (const id of preview.certain) assert.ok(placed.includes(id), `${id}: counted certain, and created`);
  for (const id of placed) assert.ok(preview.certain.includes(id) || preview.edge.includes(id), `${id}: created, and inside the preview's edge`);
  assert.ok(n >= preview.certain.length && n <= preview.certain.length + preview.edge.length);
  assert.ok(created.every((o) => o.materializedFrom === "REGISTRATION"), "each created row says it came from registration");
  const ohio = requiredJurisdictionRegistry("oh");
  assert.equal(ohio.registration?.versionId, versionId, "read from the promoted version, the one readers use");
  const findOwnSite = created.filter((o) => o.id.endsWith("#find-own-site"));
  for (const o of findOwnSite) assert.equal(ohio.jurisdictions.find((j) => j.id === o.subjectId)?.ownWebAddress, null, `${o.subjectId}: no address is invented`);
  assert.ok(created.some((o) => o.id === `${MEETINGS_DISCOVERY_NAMESPACE}${COLUMBUS}#own-site-meetings`));

  const again = await runnerCycle(repos, store, FRANKLIN, T_WALK);
  assert.equal(again.reading.targets[0]!.requirements.createdThisCycle, 0);
  assert.equal(again.reading.targets[0]!.requirements.created, created.length);

  const ids = new Set(created.map((o) => o.id));
  const pass = buildRegistry([meetingsDiscoveryProvider({ registered: () => ({ registries: new Map(), refused: new Map() }), materialized: () => ({ ids }) }), localJurisdictionsProvider({
    trackedStates: { read: () => ({ states: [], source: "fixture: no standing state work" }) }, materialized: () => ({ ids }),
  })], { root: ROOT, nowIso: T_NEXT });
  assert.deepEqual(pass.byProvider.map((p) => p.readFailure), [null, null]);
  assert.deepEqual(pass.units.map((u) => u.obligation.id).sort(), [...ids].sort(), "every created row stays in the corpus");

  const dispatched = materializedDiscoveryNeeds([...ids]);
  assert.deepEqual(dispatched.failures, []);
  const needs = dispatched.entries.map((e) => ({ ...e.need, addressSource: dispatchedAddressSource(e.reg, null) }));
  const columbus = needs.find((n) => n.jurisdictionId === COLUMBUS)!;
  assert.equal(columbus.ownWebAddress, "http://www.columbus.gov/", "the Census of Governments' own record");
  assert.deepEqual(columbus.addressSource, { source: "REGISTRATION", versionId });
  const subjects = needs.map((n) => ({ jurisdictionId: n.jurisdictionId, walkable: walkableByFreeWalk(n) }));
  assert.equal((await readFreeDiscoveryWalks(repos, subjects)).latestFor(COLUMBUS), "NOT_WALKED");
  const vault = new Map<string, HeldBytes>();
  let tick = 0;
  await runCensusState({
    repos, state: "OH", needs: [columbus],
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
  const walked = await repos.discoveryAttempts.read(columbus.jurisdictionId);
  assert.deepEqual(walked.map((a) => [a.jurisdictionId, a.outcome]), [[COLUMBUS, "FOUND"]], "the free walk took the Send's city first");
  const [attempt] = walked;
  assert.equal(attempt!.found[0]?.url, COLUMBUS_ROUTE);
  assert.equal(attempt!.site?.address?.source, "WEBSITE_EVIDENCE");
  assert.ok(vault.has(attempt!.site!.address!.versionId!), "the host is attested by its saved source copy");
  assert.equal((await readFreeDiscoveryWalks(repos, subjects)).latestFor(COLUMBUS), "FOUND");

  const regInput: DerivedInputRef = { kind: "PROMOTED_VERSION", recordClass: "REGISTRATION", scope: reg.metadata.scope, versionId, readModelSha256: sha(reg.value), promotedAt: reg.metadata.promotedAt! };
  const columbusDivision = "ocd-division/country:us/state:oh/place:columbus";
  assert.equal(model.bodies.length, 0, "native government registration supplies no unreviewed councils");
  assert.equal(ohio.jurisdictions.find(j => j.id === COLUMBUS)?.bodyId, null);

  const bodyPage = [...vault.values()].find(held => held.text === COLUMBUS_HOME)!;
  assert.ok(bodyPage.text.includes("Columbus City Council meets"));
  const reviewedBody = { id: COLUMBUS_BODY, ocdId: columbusDivision, bodyClass: "GOVERNING", censusId: "209050" };
  const body = reviewedBodyForGovernment(loadRegistrationReference(ROOT, "OH"), COLUMBUS, [reviewedBody]);
  assert.ok(body, "the independently reviewed council joins only by native Census identity");
  const walk = { attempt: attempt!, recordId: "pos-columbus", recordedAt: attempt!.finishedAt };
  const review = reviewDiscoveryWalk({
    walk,
    registered: { ...body, input: bodyPage.evidence },
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

  installFactReader(async () => []);
  t.after(() => installFactReader(undefined));
  const edge = freshEdge();
  assert.equal((await publishPass(store, edge, T_READER)).status, "PUBLISHED");
  const reader = await readPlace(edge, store, [COLUMBUS_DIVISION], T_READER);
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
  assert.equal(target!.requirements.created, target!.units.placed);

  const created = (await repos.obligations.list()).map((row) => row.value).filter((o) => o.materializedBy === OWNER_DISPATCH);
  const placed = [...new Set(created.map((o) => o.subjectId))].sort();
  assert.ok(placed.includes("pr:county:adjuntas-municipio"), `the municipio is placed by the explicit held area observation (${placed.join(", ")})`);
  for (const id of preview.certain) assert.ok(placed.includes(id));
  for (const id of placed) assert.ok(inPreview.has(id), `${id} is inside the preview's edge`);
  assert.ok(created.every((o) => o.materializedFrom === "REGISTRATION"));
  assert.ok(created.filter(o => o.id.startsWith(MEETINGS_DISCOVERY_NAMESPACE)).every(o => o.id.endsWith("#find-own-site")));

  const dispatched = materializedDiscoveryNeeds(created.map((o) => o.id));
  assert.deepEqual(dispatched.failures, []);
  const adjuntas = dispatched.entries.find((e) => e.need.jurisdictionId === "pr:county:adjuntas-municipio")!;
  assert.equal(adjuntas.need.basis, "NO_MEETINGS_SOURCE_RECORDED");
  assert.equal(adjuntas.need.ownWebAddress, null, "TIGER/Line records no web address, so none is invented");
  assert.equal(walkableByFreeWalk(adjuntas.need), false, "the free walk has no site to open");
  const walks = await readFreeDiscoveryWalks(repos, [{ jurisdictionId: adjuntas.need.jurisdictionId, walkable: false }]);
  assert.equal(walks.latestFor(adjuntas.need.jurisdictionId), "NO_SITE_TO_WALK");
  const route = buildRegistry([meetingsDiscoveryProvider({ registered: () => ({ registries: new Map(), refused: new Map() }), materialized: () => ({ ids: new Set(created.map((o) => o.id)) }) })], { root: ROOT, nowIso: T_NEXT })
    .routeFor(`${MEETINGS_DISCOVERY_NAMESPACE}pr:county:adjuntas-municipio#find-own-site`);
  assert.match(route?.citation ?? "", /PR's registration names this government \(promoted version .+\), and the Census records no web address for it, so none is invented/);
  clearRegistrationJurisdictionRegistries();
});
