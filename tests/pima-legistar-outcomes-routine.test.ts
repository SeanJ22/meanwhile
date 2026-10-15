import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { cadenceMsAt, routineContract, ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { SITTING_WINDOW_ADMISSION_LEAD_MS, SITTING_WINDOW_BASE_ADMISSION_LEAD_MS } from "../lib/civic-data/sitting-window-admission.ts";
import {
  MANUAL_PRODUCTION_SOURCE_CONTRACTS,
  manualProductionContract,
  type ManualProductionContractId,
} from "../lib/civic-data/manual-contracts.ts";
import { observableRoutineContracts } from "../lib/civic-data/meeting-partitions.ts";
import {
  processRegisteredManualCandidate,
  processRegisteredRoutineCandidate,
  routineCandidateContractIssue,
} from "../lib/civic-data/promotion.ts";
import { ROUTINE_SOURCE_TASKS, routineTaskDue, routineTaskFromContract } from "../lib/civic-data/runner.ts";
import {
  durableRoutineRunnerReceiptIssue,
  parseRoutineRunnerReceipt,
  successfulRoutineRunnerReceiptIssue,
} from "../lib/civic-data/runner-receipt.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { latestUnchangedConfirmation } from "../lib/civic-data/unchanged-confirmation.ts";
import { pimaLegistarOutcomesCandidate } from "../lib/outcomes/data-plane.ts";
import { readDoorOutcomeProjection, resetOutcomeSnapshotCache } from "../lib/outcomes/store.ts";
import type { OutcomeSnapshot, PersistedSittingOutcomes } from "../lib/outcomes/types.ts";
import { findClient, type LegistarClient } from "../lib/sources/legistar/client-registry.ts";
import type { LegistarEvent } from "../lib/sources/legistar/types.ts";
import {
  legistarUtcInstant,
  outcomeSourceThrough,
  parsePimaOutcomeIngestArgs,
  pimaOutcomeWindow,
  runPimaLegistarOutcomeIngest,
  type PimaOutcomeIngestArgs,
} from "../scripts/legistar-outcomes-ingest.mts";
import { withSourceTransport as withFetch } from "./helpers/source-fetch.ts";

// Events, items and votes are recorded responses under tests/fixtures. Native body fixtures are explicit;
// the stub refuses any route it was not given.

const CONTRACT_ID: string = "pima-legistar-outcomes";
const SCOPE = "US-AZ:county:pima:legistar-outcomes";
const EVENTS_ROUTE = "https://webapi.legistar.com/v1/pima/events";
const HOUR = 60 * 60 * 1_000;
const B64 = "b".repeat(64);

function fixture<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/${path}`, import.meta.url), "utf8")) as T;
}

function requestPath(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname;
}

const PIMA_ENDPOINT = (eventId: number) => `https://webapi.legistar.com/v1/pima/events/${eventId}/eventitems`;
const PIMA_PROVENANCE = { endpoint: PIMA_ENDPOINT(1801), sourceOrg: "Pima County Clerk of the Board", readOn: "2026-08-29" };
const SITTING_URL = "https://pima.legistar.com/MeetingDetail.aspx?LEGID=1801&GID=243&G=7B470E9E-E35C-4698-8FA6-D778FB28F394";

/** A held sitting the routine passes below do not re-read. */
function heldSeed(): OutcomeSnapshot {
  const sitting = {
    meetingId: "legistar:pima:1801",
    bodyId: "ocd-division/country:us/state:az/county:pima#governing",
    ocdId: "ocd-division/country:us/state:az/county:pima",
    slug: "pima",
    eventId: 1801,
    bodyName: "Board of Supervisors",
    jurisdiction: "Pima County, AZ",
    startsAt: "2026-05-12T13:00:00-07:00",
    sourceOrg: "Pima County Clerk of the Board",
    sourceUrl: SITTING_URL,
    extraction: "RETRIEVED",
    extractionNote: null,
    publication: {
      agendaStatusName: "Final", agendaStatusId: 10,
      agendaFile: "https://legistar.granicus.com/pima/meetings/2026/5/1801_A_Board_of_Supervisors_26-05-12_Online_Agenda.pdf",
      agendaLastPublishedUtc: "2026-05-11T22:39:33.11",
      minutesStatusName: "Draft", minutesStatusId: 9,
      minutesFile: "https://legistar.granicus.com/pima/meetings/2026/5/1801_M_Board_of_Supervisors_26-05-12_Meeting_Summary.pdf",
      minutesLastPublishedUtc: "2026-05-13T18:56:29.663",
      inSiteUrl: SITTING_URL,
      lastModifiedUtc: "2026-05-13T18:56:29.83",
      videoStatus: "Public",
      observedAt: "2026-08-30T05:38:01.398Z",
    },
    minutesPointer: {
      url: "https://legistar.granicus.com/pima/meetings/2026/5/1801_M_Board_of_Supervisors_26-05-12_Meeting_Summary.pdf",
      status: "Draft",
      host: "legistar.granicus.com",
      retrievalNote: "Not retrieved. The host disallows all crawling, so this route is not walked.",
    },
    agenda: [{ recordClass: "AGENDA", eventItemId: 314834, eventId: 1801, sequence: 1, agendaNumber: null, title: "PUBLIC COMMENTS", matterFile: null, matterType: null, provenance: PIMA_PROVENANCE }],
    outcomes: [{
      recordClass: "ACTION_SUMMARY", eventItemId: 314842, eventId: 1801, matterFile: null, action: "waive privilege",
      disposition: "NOT_RECORDED", dispositionRaw: null, dispositionConflict: null,
      dispositionGap: "The published record says the body moved to waive privilege this item and carries no pass or fail result for the motion. The result is missing from their record, not decided against.",
      mover: null, seconder: null, tallyText: "Without objection, the Chair waived this item.", matterStatus: null, onConsentCalendar: false,
      rollCall: "OUTCOME_WITHOUT_ROLL_CALL",
      rollCallGap: "The publisher recorded the action and no per-person roll call for it. How each member voted is missing from their record.",
      provenance: PIMA_PROVENANCE,
    }],
    rollCalls: [],
    failedRollCallExtractions: [],
    voteRequestFailures: [],
    routesWalked: ["WEBAPI_EVENTS", "WEBAPI_EVENTITEMS", "WEBAPI_EVENTITEM_VOTES"],
    publicationObservations: [{
      meetingId: "legistar:pima:1801", provenance: "FIRST_PARTY_PUBLISHER", report: "AVAILABLE", observedAt: "2026-08-30T05:38:01.398Z",
      observedUrl: SITTING_URL, sourceOrg: "Pima County Clerk of the Board",
      evidenceQuote: "EventAgendaStatusName=Final; EventAgendaFile=https://legistar.granicus.com/pima/meetings/2026/5/1801_A_Board_of_Supervisors_26-05-12_Online_Agenda.pdf; EventAgendaLastPublishedUTC=2026-05-11T22:39:33.11",
      routeId: "WEBAPI_EVENT",
    }],
  } as unknown as PersistedSittingOutcomes;
  return { generatedOn: "2026-08-29", generatedAt: "2026-08-30T05:40:12.819Z", tenants: ["pima"], sittings: [sitting] };
}

const EVIDENCE = [{
  source: CONTRACT_ID,
  requestedUrl: `${EVENTS_ROUTE}?$top=1000`,
  finalUrl: `${EVENTS_ROUTE}?$top=1000`,
  httpStatus: 200,
  rawHash: B64,
  byteCount: 123,
}] as const;

/** 1825 (2026-08-25) and 1821 (2026-07-14), exactly as the publisher returned them. */
function recordedEvent(eventId: 1821 | 1825, lastModifiedUtc?: string): LegistarEvent {
  const event = eventId === 1825
    ? fixture<LegistarEvent & { EventItems?: unknown }>("legistar/pima-event-1825.json")
    : fixture<LegistarEvent[]>("legistar-pima-events.json").find((row) => row.EventId === 1821)!;
  const { EventItems: _notOnTheEventsRoute, ...row } = event as LegistarEvent & { EventItems?: unknown };
  return lastModifiedUtc === undefined ? row : { ...row, EventLastModifiedUtc: lastModifiedUtc };
}

const RECORDED_ITEMS: Readonly<Record<number, unknown[]>> = {
  1821: fixture<unknown[]>("legistar/pima-eventitems-1821.json"),
  1825: fixture<unknown[]>("legistar/pima-eventitems-1825.json"),
};
const RECORDED_VOTES: Readonly<Record<number, unknown[]>> = {
  329182: fixture<unknown[]>("legistar/pima-votes-329182.json"),
};

function recordedLegistar(routes: {
  readonly events: readonly LegistarEvent[] | number;
  readonly items?: Readonly<Record<number, number>>;
  readonly bodies?: readonly { readonly BodyId: number; readonly BodyName: string }[];
}) {
  const requests: string[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  const fetchImpl = async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push(url);
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://webapi.legistar.com", `unexpected host ${url}`);
    if (parsed.pathname === "/v1/pima/bodies" && routes.bodies) return json(routes.bodies);
    if (parsed.pathname === "/v1/pima/events") {
      return typeof routes.events === "number" ? new Response("refused", { status: routes.events }) : json(routes.events);
    }
    const items = /^\/v1\/pima\/events\/(\d+)\/eventitems$/.exec(parsed.pathname);
    if (items) {
      const eventId = Number(items[1]);
      const status = routes.items?.[eventId];
      if (status !== undefined) return new Response("refused", { status });
      const body = RECORDED_ITEMS[eventId];
      assert.ok(body, `no recorded eventitems for ${eventId}`);
      return json(body);
    }
    const votes = /^\/v1\/pima\/eventitems\/(\d+)\/votes$/.exec(parsed.pathname);
    if (votes) return json(RECORDED_VOTES[Number(votes[1])] ?? []);
    throw new Error(`unrecorded Legistar route ${url}`);
  };
  return { requests, fetchImpl };
}

function steppedClock(startIso: string): () => string {
  let at = Date.parse(startIso);
  return () => {
    at += 1_000;
    return new Date(at).toISOString();
  };
}

/** The live pointer before the pass: the held seed, without the two sittings the pass will read. */
async function storeHoldingSeed(): Promise<MemoryRoutineDataStore> {
  const seed = heldSeed();
  const store = new MemoryRoutineDataStore();
  const prior = pimaLegistarOutcomesCandidate({
    snapshot: { ...seed, sittings: seed.sittings.filter((sitting) => sitting.eventId !== 1821 && sitting.eventId !== 1825) },
    acquisitions: EVIDENCE,
    retrievedAt: "2026-08-30T06:00:00.000Z",
    sourceThrough: "2026-08-30T05:40:12.819Z",
  });
  const outcome = await processRegisteredRoutineCandidate(store, CONTRACT_ID, prior, "2026-08-30T06:00:00.000Z");
  assert.equal(outcome.candidate.state, "PROMOTED");
  return store;
}

const ROUTINE_ARGS: PimaOutcomeIngestArgs = {
  ...parsePimaOutcomeIngestArgs(["--promote", "--slug", "pima"]),
};

async function routinePass(
  store: MemoryRoutineDataStore,
  stub: ReturnType<typeof recordedLegistar>,
  clockStart: string,
  unresolvedClient?: LegistarClient,
) {
  const client = unresolvedClient ?? findClient("pima");
  assert.ok(client);
  const lines: string[] = [];
  const result = await withFetch(stub.fetchImpl, () => runPimaLegistarOutcomeIngest({
    store,
    client,
    args: ROUTINE_ARGS,
    window: { from: "2026-05-24", to: "2026-09-21" },
    now: steppedClock(clockStart),
    log: (line) => lines.push(line),
  }));
  return { result, lines };
}

/** The exact supervisor-side proof the standing runner applies to a child's receipt. */
async function supervisorVerdict(
  store: MemoryRoutineDataStore,
  receiptLine: string | null,
  exitCode: number,
): Promise<{ readonly outcome: "SUCCESS" | "HELD"; readonly issue: string | null; readonly candidateId: string }> {
  assert.ok(receiptLine);
  const parsed = parseRoutineRunnerReceipt(`diagnostic line\n${receiptLine}\n`);
  assert.ok(parsed.ok, "the child emits exactly one schema-valid RCD_RECEIPT line");
  const outcome = successfulRoutineRunnerReceiptIssue(parsed.receipt) === null ? "SUCCESS" : "HELD";
  assert.equal(exitCode === 0, outcome === "SUCCESS", "the process exit agrees with the durable receipt");
  const task = ROUTINE_SOURCE_TASKS.find(({ id }) => id === CONTRACT_ID)!;
  return {
    outcome,
    issue: await durableRoutineRunnerReceiptIssue(parsed.receipt, task, store, outcome),
    candidateId: parsed.receipt.candidateId,
  };
}

test("(a) Pima Legistar outcomes are one routine contract on the standing clock, not an owner-invoked manual contract", () => {
  const contract = routineContract(CONTRACT_ID);
  assert.ok(contract);
  assert.equal(manualProductionContract(CONTRACT_ID), null);
  assert.equal(ROUTINE_SOURCE_CONTRACTS.filter(({ id }) => id === CONTRACT_ID).length, 1);
  assert.deepEqual(
    [...observableRoutineContracts(), ...MANUAL_PRODUCTION_SOURCE_CONTRACTS]
      .filter(({ recordClass, scope }) => recordClass === "MEETING_OUTCOME" && scope === SCOPE)
      .map(({ id }) => id),
    [CONTRACT_ID],
    "the scope has exactly one authoritative writer across both registries",
  );

  assert.equal(contract.sourceId, "pima-legistar-outcomes");
  assert.equal(contract.recordClass, "MEETING_OUTCOME");
  assert.equal(contract.scope, SCOPE);
  assert.equal(contract.parserNormalizerVersion, "pima-legistar-outcomes/2");
  assert.deepEqual(contract.acquisitionAdapter, {
    authorityMode: "REGISTERED_SOURCE_ROUTES",
    command: ["scripts/legistar-outcomes-ingest.mts", "--promote", "--slug", "pima"],
  });
  assert.equal(contract.autoPromotable, true);
  assert.equal(contract.classification, "RUNTIME_CIVIC_DATA");
  assert.deepEqual(contract.readerProjection, { id: CONTRACT_ID, consumers: ["agenda", "Ask", "meeting Reader records", "map"] });
  assert.deepEqual(contract.bootstrapFixturePaths, []);

  // Fourteen hours through election day, then a day, so the twelve-hour re-read plus one failed retry lands before STALE.
  assert.equal(cadenceMsAt(contract, Date.parse("2026-09-24T12:00:00.000Z")), 14 * HOUR);
  assert.equal(cadenceMsAt(contract, Date.parse("2026-11-03T23:59:59.999Z")), 14 * HOUR);
  assert.equal(cadenceMsAt(contract, Date.parse("2026-11-04T00:00:00.000Z")), 24 * HOUR);
  assert.equal(contract.retry.afterMs, HOUR);
  // Hourly within seven days of a sitting on either of its partitions, else twice daily.
  assert.deepEqual(contract.schedule, {
    kind: "SITTING_WINDOW",
    windowMs: 7 * 24 * HOUR,
    hotEveryMs: HOUR,
    baseEveryMs: 12 * HOUR,
    follows: [
      { meetingSource: "legistar", bodyId: "ocd-division/country:us/state:az/county:pima#governing" },
      { meetingSource: "legistar-insite", bodyId: "ocd-division/country:us/state:az/county:pima#governing" },
    ],
  });

  // The standing runner accepts it with no special case.
  const task = routineTaskFromContract(contract);
  assert.deepEqual(ROUTINE_SOURCE_TASKS.filter(({ id }) => id === CONTRACT_ID), [task]);
  assert.equal(task.requestedUrl, "", "each acquired route is checked against Pima's registered authority");
  assert.equal(task.acquisitionFailureDomain, "routine-source:pima-legistar-outcomes");
  assert.equal(task.retryMs, HOUR);
  const succeededAt = Date.parse("2026-09-24T09:00:00.000Z");
  const clock = {
    lastAttemptedAt: "2026-09-24T09:00:00.000Z",
    lastSucceededAt: "2026-09-24T08:59:58.000Z",
    lastSucceededObservedAt: "2026-09-24T09:00:00.000Z",
  };
  // Owed an hour (hot) or twelve hours after its success, and admitted 15 minutes or 2 hours before it is owed.
  const LEAD = SITTING_WINDOW_ADMISSION_LEAD_MS;
  const BASE_LEAD = SITTING_WINDOW_BASE_ADMISSION_LEAD_MS;
  assert.equal(routineTaskDue(task, clock, succeededAt + 12 * HOUR - BASE_LEAD - 1, false), false);
  assert.equal(routineTaskDue(task, clock, succeededAt + 12 * HOUR - BASE_LEAD, false), true);
  assert.equal(routineTaskDue(task, clock, succeededAt + HOUR - LEAD - 1, true), false);
  assert.equal(routineTaskDue(task, clock, succeededAt + HOUR - LEAD, true), true);
  assert.equal(routineTaskDue(task, clock, succeededAt + HOUR - LEAD, undefined), true, "an unreadable window is read as hot");
  assert.equal(routineTaskDue(task, undefined, succeededAt), true, "a never-run task is due at once");
});

test("(b) a GOOD Pima candidate promotes through the routine door and a later failed read leaves that GOOD pointer as LKG", async () => {
  const memory = new MemoryRoutineDataStore();
  const seed = heldSeed();
  const snapshot: OutcomeSnapshot = seed;
  const good = pimaLegistarOutcomesCandidate({
    snapshot,
    acquisitions: EVIDENCE,
    retrievedAt: "2026-09-20T19:00:00.000Z",
    sourceThrough: "2026-09-20T18:59:00.000Z",
  });
  assert.equal(routineCandidateContractIssue(CONTRACT_ID, good), null, "the recorded events route is inside Pima's registered source authority");
  const promoted = await processRegisteredRoutineCandidate(memory, CONTRACT_ID, good, "2026-09-20T19:01:00.000Z");
  assert.equal(promoted.candidate.state, "PROMOTED");
  assert.equal(promoted.promoted?.versionId, good.id);
  assert.equal(promoted.readerReadback?.status, "PASS", JSON.stringify(promoted.readerReadback));

  const failed = pimaLegistarOutcomesCandidate({
    snapshot: { ...snapshot, sittings: [{ ...snapshot.sittings[0]!, extraction: "REQUEST_FAILED", extractionNote: "seeded items timeout" }] },
    acquisitions: EVIDENCE,
    retrievedAt: "2026-09-20T22:00:00.000Z",
    sourceThrough: "2026-09-20T22:00:00.000Z",
    failureDetail: "Sitting legistar:pima:1825 acquisition failed: seeded items timeout",
  });
  const refused = await processRegisteredRoutineCandidate(memory, CONTRACT_ID, failed, "2026-09-20T22:00:01.000Z");
  assert.equal(refused.candidate.state, "SOURCE_BLOCKED");
  assert.equal(refused.promoted, null);
  assert.equal(refused.candidate.lastKnownGoodVersion, good.id);
  const pointer = await memory.readPromotion("MEETING_OUTCOME", SCOPE);
  assert.equal(pointer?.versionId, good.id);
  assert.equal(pointer?.lastKnownGoodVersionId, good.id);
  const read = await readDoorOutcomeProjection(SCOPE, { store: memory, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(read.metadata.versionId, good.id);

  // The owner-invoked manual door no longer knows this contract at all.
  await assert.rejects(
    processRegisteredManualCandidate(memory, CONTRACT_ID as string as ManualProductionContractId, good, "2026-09-20T22:05:00.000Z"),
    /MANUAL_PRODUCTION_SOURCE_CONTRACT_MISSING:pima-legistar-outcomes/,
  );
  assert.equal((await memory.readPromotion("MEETING_OUTCOME", SCOPE))?.versionId, good.id);
  resetOutcomeSnapshotCache();
});
test("the rolling routine window ends today where the Board sits and reaches back 120 days", () => {
  // 05:30Z on the 24th is still the 23rd locally.
  assert.deepEqual(
    pimaOutcomeWindow({ from: null, to: null }, "America/Phoenix", new Date("2026-09-24T05:30:00.000Z")),
    { from: "2026-05-26", to: "2026-09-23" },
  );
  assert.deepEqual(
    pimaOutcomeWindow({ from: "2026-01-01", to: "2026-02-01" }, "America/Phoenix", new Date("2026-09-24T05:30:00.000Z")),
    { from: "2026-01-01", to: "2026-02-01" },
  );
  assert.throws(() => pimaOutcomeWindow({ from: "2026-02-30", to: null }, "America/Phoenix", new Date()), /PIMA_OUTCOME_WINDOW_INVALID/);
  assert.throws(() => pimaOutcomeWindow({ from: "2026-09-02", to: "2026-09-01" }, "America/Phoenix", new Date()), /PIMA_OUTCOME_WINDOW_INVALID/);
  const defaults = parsePimaOutcomeIngestArgs(["--promote", "--slug", "pima"]);
  assert.equal(defaults.from, null);
  assert.equal(defaults.to, null);
  assert.equal(defaults.maxSittings, 40);
  assert.equal(parsePimaOutcomeIngestArgs(["--dry-run", "--from", "2026-08-01", "--to", "2026-08-31"]).from, "2026-08-01");
});

test("body-first Pima acquisition promotes the exact native body's outcomes and retains every source receipt", async () => {
  const store = await storeHoldingSeed();
  const heldClient = findClient("pima");
  assert.ok(heldClient);
  const event = recordedEvent(1825, "2026-09-20T18:00:00.12");
  const client = { ...heldClient, eventBodyId: undefined, eventBodyName: event.EventBodyName };
  const stub = recordedLegistar({
    bodies: [{ BodyId: event.EventBodyId, BodyName: event.EventBodyName }, { BodyId: 999, BodyName: "Another Pima body" }],
    events: [event, { ...recordedEvent(1821), EventBodyId: 999 }],
  });
  const { result } = await routinePass(store, stub, "2026-09-21T00:00:00.000Z", client);
  assert.equal(result.exitCode, 0);
  assert.equal(result.promotedSittings, 1, "a different native body cannot become the Board even when the event label matches");
  assert.equal(requestPath(stub.requests[0]), "/v1/pima/bodies");
  const eventsRequest = stub.requests.find(url => requestPath(url) === "/v1/pima/events");
  assert.ok(eventsRequest);
  assert.match(new URL(eventsRequest).searchParams.get("$filter")!, new RegExp(`EventBodyId eq ${event.EventBodyId}`));
  assert.ok(!stub.requests.some(url => /\/events\/1821\/eventitems/.test(url)), "wrong-body event items are never requested");
  const verdict = await supervisorVerdict(store, result.receiptLine, result.exitCode);
  assert.deepEqual({ outcome: verdict.outcome, issue: verdict.issue }, { outcome: "SUCCESS", issue: null });
  const saved = await store.readCandidate(verdict.candidateId);
  assert.equal(requestPath(saved!.candidate.retrieval.requestedUrl), "/v1/pima/bodies",
    "the candidate names its actual first response, without relabeling body evidence as events");
  const acquisitions = (saved!.candidate.normalizedPayload as { acquisitions: typeof EVIDENCE }).acquisitions;
  for (const path of ["/v1/pima/bodies", "/v1/pima/events", "/v1/pima/events/1825/eventitems", "/v1/pima/eventitems/329182/votes"]) {
    assert.ok(acquisitions.some(row => requestPath(row.requestedUrl) === path && row.source === CONTRACT_ID), `${path} remains attributed evidence`);
  }
  const read = await readDoorOutcomeProjection(SCOPE, { store, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") {
    assert.ok(read.value.sittings.some(sitting => sitting.eventId === 1825 && sitting.rollCalls.some(row => row.eventItemId === 329182)));
    assert.ok(!read.value.sittings.some(sitting => sitting.eventId === 1821));
  }
  resetOutcomeSnapshotCache();
});

test("a requested Pima body that disagrees with the native body is durably held before events and keeps LKG", async () => {
  const store = await storeHoldingSeed();
  const before = await store.readPromotion("MEETING_OUTCOME", SCOPE);
  const heldClient = findClient("pima");
  assert.ok(heldClient);
  const event = recordedEvent(1825);
  const stub = recordedLegistar({ bodies: [{ BodyId: event.EventBodyId, BodyName: event.EventBodyName }], events: [event] });
  const result = await withFetch(stub.fetchImpl, () => runPimaLegistarOutcomeIngest({
    store, client: { ...heldClient, eventBodyId: undefined, eventBodyName: event.EventBodyName },
    args: { ...ROUTINE_ARGS, bodyId: 999 }, window: { from: "2026-05-24", to: "2026-09-21" },
    now: steppedClock("2026-09-21T00:00:00.000Z"), log: () => {},
  }));
  assert.equal(result.exitCode, 2);
  assert.deepEqual(stub.requests.map(requestPath), ["/v1/pima/bodies"]);
  const verdict = await supervisorVerdict(store, result.receiptLine, result.exitCode);
  assert.deepEqual({ outcome: verdict.outcome, issue: verdict.issue }, { outcome: "HELD", issue: null });
  assert.match((await store.readCandidate(verdict.candidateId))!.candidate.retrieval.failureDetail!, /LEGISTAR_OUTCOME_BODY_IDENTITY_MISMATCH/);
  assert.equal((await store.readPromotion("MEETING_OUTCOME", SCOPE))?.versionId, before!.versionId);
  resetOutcomeSnapshotCache();
});

test("Pima's multi-route contract admits its body lookup but refuses another tenant or API host", () => {
  const candidateFor = (requestedUrl: string) => pimaLegistarOutcomesCandidate({ snapshot: heldSeed(),
    acquisitions: [{ ...EVIDENCE[0], requestedUrl, finalUrl: requestedUrl }],
    retrievedAt: "2026-09-20T19:00:00.000Z", sourceThrough: "2026-09-20T18:59:00.000Z" });
  assert.equal(routineCandidateContractIssue(CONTRACT_ID, candidateFor("https://webapi.legistar.com/v1/pima/bodies?$top=1000")), null);
  for (const url of ["https://webapi.legistar.com/v1/mesa/bodies", "https://webapi.legistar.com/v1/pima-other/events", "https://unrelated.example/v1/pima/bodies"]) {
    assert.notEqual(routineCandidateContractIssue(CONTRACT_ID, candidateFor(url)), null, url);
  }
});

test("a Legistar UTC stamp is read as UTC, and a candidate's source-through never precedes the pointer it extends", () => {
  assert.equal(legistarUtcInstant("2026-08-27T18:33:36.35"), "2026-08-27T18:33:36.350Z");
  assert.equal(legistarUtcInstant("2026-08-27T18:33:36.35Z"), "2026-08-27T18:33:36.350Z");
  assert.equal(legistarUtcInstant(""), null);
  assert.equal(legistarUtcInstant(null), null);
  assert.equal(legistarUtcInstant("not a stamp"), null);
  assert.equal(outcomeSourceThrough(null, "2026-09-10T12:00:00.340Z"), "2026-09-10T12:00:00.340Z");
  assert.equal(outcomeSourceThrough("2026-09-23T18:00:00.120Z", "2026-09-10T12:00:00.340Z"), "2026-09-23T18:00:00.120Z");
  assert.equal(outcomeSourceThrough("2026-09-10T12:00:00.340Z", "2026-09-23T18:00:00.120Z"), "2026-09-23T18:00:00.120Z");
  // Later by instant but not by the string order the GOOD contract also applies: keep the pointer's value.
  assert.equal(outcomeSourceThrough("2026-09-23T18:00:00Z", "2026-09-23T18:00:00.500Z"), "2026-09-23T18:00:00Z");
});

test("a routine pass promotes every changed sitting, including one modified earlier than a sitting walked before it", async () => {
  const store = await storeHoldingSeed();
  const stub = recordedLegistar({
    events: [recordedEvent(1821, "2026-09-10T12:00:00.34"), recordedEvent(1825, "2026-09-20T18:00:00.12")],
  });
  const { result, lines } = await routinePass(store, stub, "2026-09-21T00:00:00.000Z");

  assert.equal(result.exitCode, 0);
  assert.equal(result.promotedSittings, 2);
  assert.deepEqual(result.refusedSittings, []);
  assert.equal(result.tally.walked, 2);
  assert.equal(stub.requests.filter((url) => url.startsWith(`${EVENTS_ROUTE}?`)).length, 1);
  assert.equal(stub.requests.filter((url) => /\/eventitems\?/.test(url)).length, 2);
  // The newest sitting is walked first even though the older sitting's record changed later.
  assert.ok(lines.findIndex((line) => line.includes("legistar:pima:1825")) < lines.findIndex((line) => line.includes("legistar:pima:1821")));

  const verdict = await supervisorVerdict(store, result.receiptLine, result.exitCode);
  assert.deepEqual({ outcome: verdict.outcome, issue: verdict.issue }, { outcome: "SUCCESS", issue: null });
  const read = await readDoorOutcomeProjection(SCOPE, { store, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  assert.equal(read.metadata.versionId, verdict.candidateId);
  assert.equal(read.metadata.sourceThrough, "2026-09-20T18:00:00.120Z");
  assert.equal(read.value.sittings.length, heldSeed().sittings.length + 2);
  for (const meetingId of ["legistar:pima:1821", "legistar:pima:1825"]) {
    const sitting: PersistedSittingOutcomes | undefined = read.value.sittings.find((row) => row.meetingId === meetingId);
    assert.equal(sitting?.extraction, "RETRIEVED", meetingId);
    assert.ok((sitting?.outcomes.length ?? 0) > 0, `${meetingId} carries its recorded actions`);
  }
  assert.ok(
    read.value.sittings.find(({ meetingId }) => meetingId === "legistar:pima:1825")!.rollCalls
      .some(({ eventItemId }) => eventItemId === 329182),
    "the recorded per-member roll call reaches the Reader projection",
  );

  // The pass carries the pointer's source-through forward: stamped with only its own older modification time, the
  // same snapshot is refused as a regression.
  const regressed = pimaLegistarOutcomesCandidate({
    snapshot: read.value,
    acquisitions: EVIDENCE,
    retrievedAt: "2026-09-21T01:00:00.000Z",
    sourceThrough: "2026-09-10T12:00:00.340Z",
  });
  const refused = await processRegisteredRoutineCandidate(store, CONTRACT_ID, regressed, "2026-09-21T01:00:00.000Z");
  assert.equal(refused.promoted, null);
  assert.equal(refused.candidate.failureCode, "VERSION_REGRESSION");
  resetOutcomeSnapshotCache();
});

test("an unchanged day costs one events request and ends in a validated no-change receipt", async () => {
  const store = await storeHoldingSeed();
  const events = [recordedEvent(1821, "2026-09-10T12:00:00.34"), recordedEvent(1825, "2026-09-20T18:00:00.12")];
  const first = await routinePass(store, recordedLegistar({ events }), "2026-09-21T00:00:00.000Z");
  assert.equal(first.result.exitCode, 0);
  const pointerBefore = await store.readPromotion("MEETING_OUTCOME", SCOPE);

  const unchanged = recordedLegistar({ events });
  const { result } = await routinePass(store, unchanged, "2026-09-21T03:00:00.000Z");
  assert.deepEqual(unchanged.requests.map((url) => url.slice(0, EVENTS_ROUTE.length + 1)), [`${EVENTS_ROUTE}?`]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.tally.skippedUnchanged, 2);
  assert.equal(result.tally.walked, 0);
  const verdict = await supervisorVerdict(store, result.receiptLine, result.exitCode);
  assert.deepEqual({ outcome: verdict.outcome, issue: verdict.issue }, { outcome: "SUCCESS", issue: null });
  // An unchanged pass confirms the existing version.
  assert.equal(verdict.candidateId, pointerBefore?.versionId);
  assert.equal(latestUnchangedConfirmation(await store.events(verdict.candidateId), verdict.candidateId)?.retrieval.retrievedAt, "2026-09-21T03:00:03.000Z");
  const pointerAfter = await store.readPromotion("MEETING_OUTCOME", SCOPE);
  assert.deepEqual(pointerAfter?.payload, pointerBefore?.payload);
  resetOutcomeSnapshotCache();
});

test("a failed or empty events read is a durable held attempt, exits non-zero, and leaves the LKG live", async () => {
  for (const events of [403, []] as const) {
    const store = await storeHoldingSeed();
    const before = await store.readPromotion("MEETING_OUTCOME", SCOPE);
    const { result } = await routinePass(store, recordedLegistar({ events }), "2026-09-21T00:00:00.000Z");
    assert.equal(result.exitCode, 2, `events=${JSON.stringify(events)}`);
    const verdict = await supervisorVerdict(store, result.receiptLine, result.exitCode);
    assert.deepEqual({ outcome: verdict.outcome, issue: verdict.issue }, { outcome: "HELD", issue: null });
    const held = await store.readCandidate(verdict.candidateId);
    assert.equal(held?.state, "SOURCE_BLOCKED");
    assert.equal(held?.lastKnownGoodVersion, before?.versionId);
    assert.equal((await store.readPromotion("MEETING_OUTCOME", SCOPE))?.versionId, before?.versionId);
  }
  resetOutcomeSnapshotCache();
});

test("a refused sitting holds the pass even when a later sitting promotes, and the receipt proves the moved LKG", async () => {
  const store = await storeHoldingSeed();
  const stub = recordedLegistar({
    events: [recordedEvent(1821, "2026-09-10T12:00:00.34"), recordedEvent(1825, "2026-09-20T18:00:00.12")],
    items: { 1825: 403 },
  });
  const { result } = await routinePass(store, stub, "2026-09-21T00:00:00.000Z");
  assert.equal(result.exitCode, 2);
  assert.equal(result.promotedSittings, 1);
  assert.equal(result.refusedSittings.length, 1);
  assert.match(result.refusedSittings[0]!, /^legistar:pima:1825 /);

  const verdict = await supervisorVerdict(store, result.receiptLine, result.exitCode);
  assert.deepEqual({ outcome: verdict.outcome, issue: verdict.issue }, { outcome: "HELD", issue: null });
  const runRecord = await store.readCandidate(verdict.candidateId);
  assert.equal(runRecord?.state, "SOURCE_BLOCKED");
  assert.match(runRecord?.candidate.retrieval.failureDetail ?? "", /legistar:pima:1825/);
  const read = await readDoorOutcomeProjection(SCOPE, { store, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  assert.equal(runRecord?.lastKnownGoodVersion, read.metadata.versionId, "the held receipt names the pointer as it now stands");
  assert.ok(read.value.sittings.some(({ meetingId }) => meetingId === "legistar:pima:1821"), "the unaffected sitting is live");
  assert.ok(!read.value.sittings.some(({ meetingId }) => meetingId === "legistar:pima:1825"), "the refused sitting never entered the pointer");
  resetOutcomeSnapshotCache();
});

test("a dry run reads the events route and writes nothing", async () => {
  const store = await storeHoldingSeed();
  const before = await store.readPromotion("MEETING_OUTCOME", SCOPE);
  const client = findClient("pima");
  assert.ok(client);
  const stub = recordedLegistar({ events: [recordedEvent(1825, "2026-09-20T18:00:00.12")] });
  const lines: string[] = [];
  const result = await withFetch(stub.fetchImpl, () => runPimaLegistarOutcomeIngest({
    store,
    client,
    args: parsePimaOutcomeIngestArgs(["--dry-run", "--slug", "pima"]),
    window: { from: "2026-05-24", to: "2026-09-21" },
    now: steppedClock("2026-09-21T00:00:00.000Z"),
    log: (line) => lines.push(line),
  }));
  assert.equal(result.receiptLine, null);
  assert.equal(result.exitCode, 0);
  assert.equal(stub.requests.length, 1);
  assert.ok(lines.some((line) => line.includes("would walk legistar:pima:1825 — NEW")));
  assert.equal((await store.readPromotion("MEETING_OUTCOME", SCOPE))?.versionId, before?.versionId);
  resetOutcomeSnapshotCache();
});

test("DB-07: outcomes older than the routine window stay published; a narrower window changes only what is re-read", async () => {
  const store = await storeHoldingSeed();
  const before = heldSeed().sittings.filter((sitting) => sitting.eventId !== 1821 && sitting.eventId !== 1825);
  assert.ok(before.length > 0, "the held seed carries sittings");
  // A window that starts after every held sitting: the events route says nothing about any of them.
  const latestHeld = before.map((sitting) => String(sitting.startsAt ?? "").slice(0, 10)).sort().at(-1)!;
  const from = new Date(Date.parse(`${latestHeld}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
  const stub = recordedLegistar({ events: [recordedEvent(1825, "2026-09-20T18:00:00.12")] });
  const client = findClient("pima");
  assert.ok(client);
  const result = await withFetch(stub.fetchImpl, () => runPimaLegistarOutcomeIngest({
    store,
    client,
    args: ROUTINE_ARGS,
    window: { from, to: "2026-09-21" },
    now: steppedClock("2026-09-21T00:00:00.000Z"),
    log: () => {},
  }));
  assert.equal(result.exitCode, 0);
  const read = await readDoorOutcomeProjection(SCOPE, { store, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  const held = new Set(read.value.sittings.map((sitting) => sitting.meetingId));
  for (const sitting of before) assert.ok(held.has(sitting.meetingId), `${sitting.meetingId} stays published past the window`);
  assert.ok(held.has("legistar:pima:1825"), "the sitting this window did read is added");
  resetOutcomeSnapshotCache();
});
