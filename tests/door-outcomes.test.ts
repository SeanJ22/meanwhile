import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";

import { routineContract, ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { RUNTIME_ROUTINE_CONTRACTS } from "../lib/civic-data/runtime-routine-contracts.ts";
import {
  DOOR_OUTCOMES_SOURCE_ID,
  OUTCOME_PARTITION_CONTRACTS,
  buildOutcomePartitions,
  outcomePartitionsAreCurrent,
  refreshOutcomePartitions,
  stateJurisdictionOf,
} from "../lib/civic-data/outcome-partitions.ts";
import { sittingWindowSourceIds, observableRoutineContracts } from "../lib/civic-data/meeting-partitions.ts";
import { authorityFor, installDoorHosts } from "../lib/civic-data/source-authority.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { applyManualEdit, checkDoorDraft, type DoorDraft, type DoorRecord } from "../lib/doors/registry.ts";
import { legistarOutcomesCandidate } from "../lib/outcomes/data-plane.ts";
import { DOOR_OUTCOME_POINTERS, setDoorOutcomePointers } from "../lib/outcomes/door-outcome-pointers.ts";
import {
  combinedOutcomeVersionId,
  combineOutcomeProjections,
  doorOutcomeParts,
  type DoorOutcomePart,
  getOutcomeSnapshot,
  primeOutcomeProjection,
  readDoorOutcomeProjections,
  resetOutcomeSnapshotCache,
  useOutcomeSnapshotForTests,
} from "../lib/outcomes/store.ts";
import type { OutcomeSnapshot } from "../lib/outcomes/types.ts";
import { legistarClientsFromWiring } from "../lib/sources/legistar/client-registry.ts";
import type { LegistarEvent } from "../lib/sources/legistar/types.ts";
import { wiringRowsFromDoors } from "../lib/doors/rows.ts";
import { runPimaLegistarOutcomeIngest, parsePimaOutcomeIngestArgs } from "../scripts/legistar-outcomes-ingest.mts";
import { withSourceTransport as withFetch } from "./helpers/source-fetch.ts";

const AT = "2026-10-06T00:00:00.000Z";
const B64 = "b".repeat(64);

function door(overrides: Partial<DoorDraft> & { readonly doorId: string }): DoorRecord {
  const draft = checkDoorDraft({
    kind: "legistar",
    ocdId: "ocd-division/country:us/state:az/county:demo",
    bodyIds: ["ocd-division/country:us/state:az/county:demo#governing"],
    hosts: ["webapi.legistar.com"],
    config: { slug: "demo", sourceRoutes: "legistar", eventBodyId: "138" },
    holds: ["meetings", "outcomes"],
    checkEveryMinutes: null,
    notes: "test door",
    meeting: {
      agendaSourceType: "LEGISTAR",
      jurisdiction: "Demo County, AZ",
      publishingOrg: "Demo County Clerk",
      timeZone: "America/Phoenix",
      verifiedAt: "2026-10-01",
    },
    status: "OPEN",
    readNow: false,
    ...overrides,
  });
  assert.ok(draft.ok, draft.ok ? "" : draft.why);
  return applyManualEdit(null, draft.value, AT);
}

const DEMO = door({ doorId: "meetings:legistar:demo" });

afterEach(() => {
  refreshOutcomePartitions([]);
  setDoorOutcomePointers([]);
  installDoorHosts(null);
  resetOutcomeSnapshotCache();
  useOutcomeSnapshotForTests(null);
});

describe("DB-22: outcome contracts are built from doors", () => {
  it("builds one contract per Legistar door that holds outcomes, in its own scope under the door-outcomes authority", () => {
    const { contracts, skipped } = buildOutcomePartitions([DEMO]);
    assert.deepEqual(skipped, []);
    assert.equal(contracts.length, 1);
    const [contract] = contracts;
    assert.equal(contract.sourceId, DOOR_OUTCOMES_SOURCE_ID);
    assert.equal(contract.recordClass, "MEETING_OUTCOME");
    assert.equal(contract.id, "meetings:legistar:ocd-division%2Fcountry%3Aus%2Fstate%3Aaz%2Fcounty%3Ademo%23governing:outcomes");
    assert.match(contract.scope, /^door:.+:outcomes$/);
    assert.deepEqual(contract.acquisitionAdapter.command.slice(0, 5), ["scripts/legistar-outcomes-ingest.mts", "--promote", "--slug", "demo", "--door"]);
    assert.equal(contract.tenant.jurisdiction, "US-AZ");
    assert.equal(contract.tenant.requestedUrl, "https://webapi.legistar.com/v1/demo/events");
    assert.deepEqual(contract.schedule?.follows, [{ meetingSource: "legistar", bodyId: "ocd-division/country:us/state:az/county:demo#governing" }]);
    assert.equal(contract.acquisitionFailureDomain, "meeting-upstream:webapi.legistar.com/demo", "the body's own lane, the one its meetings are read in");
    assert.equal(stateJurisdictionOf("ocd-division/country:us/state:nh/place:concord"), "US-NH");
  });

  it("leaves out a door without the outcomes hold, a suspended door, a non-Legistar door, and the two places that already have contracts", () => {
    const pima = door({
      doorId: "meetings:legistar:pima", bodyIds: ["ocd-division/country:us/state:az/county:pima#governing"],
      ocdId: "ocd-division/country:us/state:az/county:pima", config: { slug: "pima", sourceRoutes: "legistar" },
    });
    const mesa = door({
      doorId: "meetings:legistar-insite:mesa", kind: "legistar-insite", bodyIds: ["ocd-division/country:us/state:az/place:mesa#governing"],
      ocdId: "ocd-division/country:us/state:az/place:mesa",
      config: { slug: "mesa", sourceRoutes: "legistar-insite", insiteHost: "mesa.legistar.com", insiteBodyNames: "City Council", insiteBodyName: "City Council" },
    });
    const meetingsOnly = door({ doorId: "meetings:legistar:x", holds: ["meetings"] });
    const suspended = door({ doorId: "meetings:legistar:y", status: "SUSPENDED" });
    const ical = door({ doorId: "meetings:ical:z", kind: "ical", config: { slug: "z", feed: "https://example.gov/cal.ics" } });
    const { contracts, skipped } = buildOutcomePartitions([pima, mesa, meetingsOnly, suspended, ical]);
    assert.deepEqual(contracts, []);
    assert.deepEqual(skipped, []);
  });

  it("one door that cannot be built holds back no other door", () => {
    const noSlug = door({ doorId: "meetings:legistar:bad", bodyIds: ["ocd-division/country:us/state:az/county:bad#governing"], config: { slug: "Not A Slug!", sourceRoutes: "legistar" } });
    const noInsiteNames = door({
      doorId: "meetings:legistar-insite:portal", kind: "legistar-insite", bodyIds: ["ocd-division/country:us/state:az/place:portal#governing"],
      config: { slug: "portal", sourceRoutes: "legistar-insite", insiteHost: "portal.legistar.com" },
    });
    const { contracts, skipped } = buildOutcomePartitions([noSlug, DEMO, noInsiteNames]);
    assert.deepEqual(contracts.map((contract) => contract.tenant.slug), ["demo"]);
    assert.equal(skipped.length, 2);
    assert.match(skipped.map((skip) => skip.why).join(" "), /SLUG_INVALID/);
    assert.match(skipped.map((skip) => skip.why).join(" "), /INSITE_BODY_NAMES_MISSING/);
  });

  it("builds an InSite minutes door on its own portal host", () => {
    const insite = door({
      doorId: "meetings:legistar-insite:portal", kind: "legistar-insite", bodyIds: ["ocd-division/country:us/state:az/place:portal#governing"],
      ocdId: "ocd-division/country:us/state:az/place:portal", hosts: ["portal.legistar.com"],
      config: { slug: "portal", sourceRoutes: "legistar-insite", insiteHost: "portal.legistar.com", insiteBodyNames: "City Council", insiteBodyName: "City Council" },
    });
    const { contracts } = buildOutcomePartitions([insite]);
    assert.equal(contracts[0].tenant.portalHost, "portal.legistar.com");
    assert.equal(contracts[0].tenant.requestedUrl, "https://portal.legistar.com/Calendar.aspx");
    assert.equal(contracts[0].acquisitionAdapter.command[0], "scripts/legistar-insite-minutes-ingest.mts");
  });

  it("a refresh installs the list for the runner, the contract lookup, the sitting window and the Reader, and an empty read clears it", () => {
    const result = refreshOutcomePartitions([DEMO]);
    assert.equal(result.refreshed, true);
    assert.equal(outcomePartitionsAreCurrent(), true);
    const [contract] = OUTCOME_PARTITION_CONTRACTS;
    assert.equal(routineContract(contract.id), contract);
    assert.equal(ROUTINE_SOURCE_CONTRACTS.some(({ id }) => id === contract.id), false, "the code's own list is untouched");
    assert.ok(observableRoutineContracts().some(({ id }) => id === contract.id));
    assert.deepEqual(sittingWindowSourceIds(contract.id), [contract.doorId]);
    assert.deepEqual(DOOR_OUTCOME_POINTERS.map((pointer) => pointer.scope), [contract.scope]);
    refreshOutcomePartitions([]);
    assert.deepEqual(RUNTIME_ROUTINE_CONTRACTS, []);
    assert.deepEqual(DOOR_OUTCOME_POINTERS, []);
    assert.equal(routineContract(contract.id), null);
  });

  it("the promotion door accepts a body's portal host only once its doors are installed, and never an arbitrary host", () => {
    const portal = "https://portal.legistar.com/Calendar.aspx";
    assert.equal(authorityFor(DOOR_OUTCOMES_SOURCE_ID, "MEETING_OUTCOME", "https://webapi.legistar.com/v1/demo/events").ok, true);
    assert.equal(authorityFor(DOOR_OUTCOMES_SOURCE_ID, "MEETING_OUTCOME", portal).ok, false);
    installDoorHosts(["portal.legistar.com"]);
    assert.equal(authorityFor(DOOR_OUTCOMES_SOURCE_ID, "MEETING_OUTCOME", portal).ok, true);
    assert.equal(authorityFor(DOOR_OUTCOMES_SOURCE_ID, "MEETING_OUTCOME", "https://evil.example/v1/demo/events").ok, false);
  });
});

function recorded<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/${path}`, import.meta.url), "utf8")) as T;
}

/** One sitting in the persisted outcome shape. */
function recordedSitting(slug: string, id: number, prefix = "legistar"): OutcomeSnapshot["sittings"][number] {
  return {
    slug, eventId: id, meetingId: `${prefix}:${slug}:${id}`, bodyId: `b:${slug}`, startsAt: "2026-09-01T10:00:00.000Z", extraction: "RETRIEVED",
    extractionNote: null, sourceOrg: "Org", publication: { observedAt: AT }, minutesPointer: null, routesWalked: [], publicationObservations: [],
    agenda: [], outcomes: [], rollCalls: [], failedRollCallExtractions: [], voteRequestFailures: [],
  } as unknown as OutcomeSnapshot["sittings"][number];
}

/** A recorded Legistar sitting answered as the demo tenant's own routes. */
function demoLegistar() {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const { EventItems: _unused, ...event } = recorded<LegistarEvent & { EventItems?: unknown }>("legistar/pima-event-1825.json");
  return async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.origin, "https://webapi.legistar.com");
    if (url.pathname === "/v1/demo/events") return json([event]);
    if (/^\/v1\/demo\/events\/1825\/eventitems$/.test(url.pathname)) return json(recorded("legistar/pima-eventitems-1825.json"));
    if (/^\/v1\/demo\/eventitems\/\d+\/votes$/.test(url.pathname)) return json([]);
    throw new Error(`unrecorded Legistar route ${url.href}`);
  };
}

describe("DB-22: a door's outcomes are collected, promoted and read back beside the others", () => {
  it("a pass for a body added as a door promotes its sittings in its own scope and never touches another pointer", async () => {
    refreshOutcomePartitions([DEMO]);
    installDoorHosts(["webapi.legistar.com"]);
    const [partition] = OUTCOME_PARTITION_CONTRACTS;
    const store = new MemoryRoutineDataStore();
    const client = legistarClientsFromWiring(wiringRowsFromDoors([DEMO]))[0];
    let tick = Date.now() - 60_000;
    const lines: string[] = [];
    const run = await withFetch(demoLegistar(), () => runPimaLegistarOutcomeIngest({
      store,
      client,
      tenant: partition.tenant,
      args: parsePimaOutcomeIngestArgs(["--promote", "--slug", "demo", "--door", partition.doorId]),
      window: { from: "2026-08-01", to: "2026-09-30" },
      now: () => new Date((tick += 1_000)).toISOString(),
      log: (line) => lines.push(line),
    }));
    assert.equal(run.exitCode, 0, lines.join("\n"));
    assert.equal(run.promotedSittings, 1);
    assert.match(run.receiptLine ?? "", new RegExp(`"source":"${partition.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));

    const pointer = await store.readPromotion("MEETING_OUTCOME", partition.scope);
    assert.ok(pointer?.versionId, "the door's own scope has a promoted pointer");
    assert.equal(await store.readPromotion("MEETING_OUTCOME", "US-AZ:county:pima:legistar-outcomes"), null, "Pima's pointer was never touched");

    await readDoorOutcomeProjections({ store, bypassCache: true });
    const [part] = doorOutcomeParts();
    assert.equal(part.pointer.contractId, partition.id);
    assert.deepEqual(part.value.sittings.map((sitting) => sitting.meetingId), ["legistar:demo:1825"]);
    assert.ok(part.value.sittings[0].outcomes.length + part.value.sittings[0].agenda.length > 0, "the recorded agenda and actions came through");

    // The Reader's one snapshot now carries the door's sitting.
    assert.deepEqual(getOutcomeSnapshot().sittings.filter((sitting) => sitting.slug === "demo").map((sitting) => sitting.meetingId), ["legistar:demo:1825"]);
  });

  it("a candidate for one door refuses another tenant's sitting", async () => {
    refreshOutcomePartitions([DEMO]);
    const [partition] = OUTCOME_PARTITION_CONTRACTS;
    const other = recordedSitting("another-tenant", 1);
    const candidate = legistarOutcomesCandidate({
      snapshot: { generatedOn: "2026-10-06", generatedAt: AT, tenants: ["another-tenant"], sittings: [other] },
      acquisitions: [{ source: partition.sourceId, requestedUrl: partition.tenant.requestedUrl, finalUrl: partition.tenant.requestedUrl, httpStatus: 200, rawHash: B64, byteCount: 1 }],
      retrievedAt: AT,
      sourceThrough: AT,
    }, partition.tenant);
    assert.ok(candidate.semantics.violations.some((violation) => /different tenant/.test(violation)));
  });

  it("the combined version names every door, so a moved door re-publishes and an unmoved one does not", () => {
    assert.equal(combinedOutcomeVersionId([{ contractId: "b", versionId: "2" }, { contractId: "a", versionId: "1" }]), "a=1|b=2");
    assert.equal(combinedOutcomeVersionId([{ contractId: "a", versionId: "1" }]), "a=1");
    assert.equal(combinedOutcomeVersionId([]), null);
  });

  it("an edge artifact carries the doors' sittings and its pointers, and a reader that primes from it sees them", () => {
    const part = (slug: string, id: number, contractId: string, versionId: string, prefix = "legistar"): DoorOutcomePart => ({
      value: { generatedOn: "2026-10-06", generatedAt: AT, tenants: [slug], sittings: [recordedSitting(slug, id, prefix)] },
      pointers: [{ contractId, tenant: slug, versionId }],
    });
    const combined = combineOutcomeProjections([
      part("pima", 1, "pima-legistar-outcomes", "p1"),
      part("mesa", 2, "mesa-legistar-minutes-outcomes", "m1", "legistar-insite"),
      part("demo", 3, "door-a", "d1"),
    ])!;
    assert.equal(combined.versionId, "door-a=d1|mesa-legistar-minutes-outcomes=m1|pima-legistar-outcomes=p1");
    assert.deepEqual(combined.value.pointers?.map((pointer) => pointer.contractId), ["door-a", "mesa-legistar-minutes-outcomes", "pima-legistar-outcomes"]);

    resetOutcomeSnapshotCache();
    primeOutcomeProjection(combined.value, combined.versionId);
    assert.deepEqual(getOutcomeSnapshot().sittings.map((row) => row.meetingId), ["legistar-insite:mesa:2", "legistar:demo:3", "legistar:pima:1"]);
  });
});
