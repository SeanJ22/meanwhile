import assert from "node:assert/strict";
import test from "node:test";

import {
  processRegisteredManualCandidate,
  processRegisteredRoutineCandidate,
} from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { ManualSourceSetReceipt } from "../lib/civic-data/types.ts";
import {
  executiveActionStore,
  readExecutiveActionsProjection,
  resetExecutiveActionCache,
  type ExecutiveActionStore,
} from "../lib/officials/executive-actions.ts";
import {
  azOfficialActionsCandidate,
  PIMA_OUTCOME_TENANT,
  pimaLegistarOutcomesCandidate,
} from "../lib/outcomes/data-plane.ts";
import {
  getOutcomeSnapshot,
  readDoorOutcomeProjection,
  resetOutcomeSnapshotCache,
} from "../lib/outcomes/store.ts";
import type { OutcomeSnapshot } from "../lib/outcomes/types.ts";

const B64 = "b".repeat(64);

function actionReceipt(
  store: ExecutiveActionStore,
  at: string,
  blockedUrl: string | null = null,
): ManualSourceSetReceipt {
  const urls = [...new Set([
    store.source.index,
    ...(store.legislative ? [store.legislative.index.chapters, store.legislative.index.letters] : []),
    ...store.actions.map((action) => action.documentUrl ?? action.sourceUrl),
  ])];
  return {
    contractVersion: 1,
    reviewedAt: at,
    reviewedBy: "pdc-test-owner",
    sources: urls.map((finalUrl, index) => ({
      requestedUrl: finalUrl,
      finalUrl,
      publisher: store.actions[0]?.sourceOrg ?? "Named Arizona primary publisher",
      sourceClass: "OFFICIAL_PUBLISHER",
      retrievedAt: at,
      httpStatus: finalUrl === blockedUrl ? 503 : 200,
      rawHash: String.fromCharCode("a".charCodeAt(0) + index).repeat(64),
      reviewedEvidence: `Exact official publication bytes for ${finalUrl}`,
      ...(finalUrl === blockedUrl ? {
        reviewOutcome: "BLOCKED" as const,
        failureDetail: "The exact official document route was unavailable.",
      } : {}),
    })),
  };
}

function action(n: string, occurredAt: string, title: string): ExecutiveActionStore["actions"][number] {
  return {
    id: `az-eo-2026-${n}`,
    officeholderId: "statewide:az/governor",
    officeholderName: "Test Governor",
    officeTitle: "Governor",
    ocdId: "ocd-division/country:us/state:az",
    kind: "EXECUTIVE_ORDER",
    designation: `Executive Order 2026-${n}`,
    title,
    occurredAt,
    sourceUrl: `https://azgovernor.gov/office-arizona-governor/executive-order/2026-${n}`,
    documentUrl: `https://azgovernor.gov/sites/default/files/executive-order-2026-${n}.pdf`,
    sourceOrg: "Office of the Arizona Governor",
    collectedAt: "2026-08-28",
    occurredAtState: "PUBLISHED",
    sessionId: null,
    chapter: null,
    coveredBills: [],
    enactmentRoute: null,
  } as ExecutiveActionStore["actions"][number];
}

function actionStore(): ExecutiveActionStore {
  return {
    note: "Read from the Governor's own executive-order index and detail pages.",
    source: {
      index: "https://azgovernor.gov/executive-orders",
      publisher: "Office of the Arizona Governor",
      permission: "robots.txt allows content paths",
      collectedAt: "2026-08-28",
    },
    denominator: { indexedAcrossPagesWalked: 37, indexPagesWalked: 4, detailPagesRead: 12, reachedEndOfIndex: false },
    legislative: null,
    actions: [
      action("02", "2026-07-08", "Prohibiting State Government Workers from Using Nonpublic Information for Personal Profit"),
      action("01", "2026-05-20", "Protecting Paychecks"),
    ],
  };
}

function oneActionStore(): { store: ExecutiveActionStore; receipt: ManualSourceSetReceipt } {
  const full = actionStore();
  const store = { ...full, actions: [full.actions[0]!] };
  return {
    store,
    receipt: actionReceipt(store, "2026-09-08T18:00:00.000Z"),
  };
}

function oneGoodSitting(): OutcomeSnapshot {
  const provenance = {
    endpoint: "https://webapi.legistar.com/v1/pima/events/1801/eventitems",
    sourceOrg: "Pima County Clerk of the Board",
    readOn: "2026-08-29",
  };
  const detail = "https://pima.legistar.com/MeetingDetail.aspx?LEGID=1801&GID=243";
  const agendaFile = "https://legistar.granicus.com/pima/meetings/2026/5/1801_A_Board_of_Supervisors_Agenda.pdf";
  const minutesFile = "https://legistar.granicus.com/pima/meetings/2026/5/1801_M_Board_of_Supervisors_Summary.pdf";
  return {
    generatedOn: "2026-08-29",
    generatedAt: "2026-08-30T05:40:12.819Z",
    tenants: ["pima"],
    sittings: [{
      meetingId: "legistar:pima:1801",
      bodyId: "ocd-division/country:us/state:az/county:pima#governing",
      ocdId: "ocd-division/country:us/state:az/county:pima",
      slug: "pima",
      eventId: 1801,
      bodyName: "Board of Supervisors",
      jurisdiction: "Pima County, AZ",
      startsAt: "2026-05-12T13:00:00-07:00",
      sourceOrg: "Pima County Clerk of the Board",
      sourceUrl: detail,
      extraction: "RETRIEVED",
      extractionNote: null,
      publication: {
        agendaStatusName: "Final",
        agendaStatusId: 10,
        agendaFile,
        agendaLastPublishedUtc: "2026-05-11T22:39:33.11",
        minutesStatusName: "Draft",
        minutesStatusId: 9,
        minutesFile,
        minutesLastPublishedUtc: "2026-05-13T18:56:29.663",
        inSiteUrl: detail,
        lastModifiedUtc: "2026-05-13T18:56:29.83",
        videoStatus: "Public",
        observedAt: "2026-08-30T05:38:01.398Z",
      },
      minutesPointer: {
        url: minutesFile,
        status: "Draft",
        host: "legistar.granicus.com",
        retrievalNote: "Not retrieved; the host disallows all paths.",
      },
      agenda: [{
        recordClass: "AGENDA",
        eventItemId: 314842,
        eventId: 1801,
        sequence: 9,
        agendaNumber: "2.",
        title: "PLEDGE OF ALLEGIANCE",
        matterFile: null,
        matterType: null,
        provenance,
      }],
      outcomes: [{
        recordClass: "ACTION_SUMMARY",
        eventItemId: 314842,
        eventId: 1801,
        matterFile: null,
        action: "waive privilege",
        disposition: "NOT_RECORDED",
        dispositionRaw: null,
        dispositionConflict: null,
        dispositionGap: "The published record carries no pass or fail result for the motion.",
        mover: null,
        seconder: null,
        tallyText: "Without objection, the Chair waived this item.",
        matterStatus: null,
        onConsentCalendar: false,
        rollCall: "OUTCOME_WITHOUT_ROLL_CALL",
        rollCallGap: "The publisher recorded the action and no per-person roll call for it.",
        provenance,
      }],
      rollCalls: [],
      failedRollCallExtractions: [],
      voteRequestFailures: [],
      routesWalked: ["WEBAPI_EVENTS", "WEBAPI_EVENTITEMS", "WEBAPI_EVENTITEM_VOTES"],
      publicationObservations: [{
        meetingId: "legistar:pima:1801",
        provenance: "FIRST_PARTY_PUBLISHER",
        report: "AVAILABLE",
        observedAt: "2026-08-30T05:38:01.398Z",
        observedUrl: detail,
        sourceOrg: "Pima County Clerk of the Board",
        evidenceQuote: `EventAgendaStatusName=Final; EventAgendaFile=${agendaFile}; EventAgendaLastPublishedUTC=2026-05-11T22:39:33.11`,
        routeId: "WEBAPI_EVENT",
      }],
    }],
  } as unknown as OutcomeSnapshot;
}

const evidence = [{
  source: "pima-legistar-outcomes",
  requestedUrl: "https://webapi.legistar.com/v1/pima/events?$top=1000",
  finalUrl: "https://webapi.legistar.com/v1/pima/events?$top=1000",
  httpStatus: 200,
  rawHash: B64,
  byteCount: 123,
}] as const;

test("an unreceipted official action is held alone while its prior member and supported authority metadata remain live", async () => {
  const memory = new MemoryRoutineDataStore();
  const first = oneActionStore();
  const good = azOfficialActionsCandidate({
    store: first.store,
    sourceReceipt: first.receipt,
    retrievedAt: "2026-09-08T18:01:00.000Z",
    sourceThrough: "2026-09-08T17:00:00.000Z",
  });
  const promoted = await processRegisteredManualCandidate(memory, "az-official-actions", good, "2026-09-08T18:02:00.000Z");
  assert.equal(promoted.candidate.state, "PROMOTED");
  assert.equal(promoted.readerReadback?.status, "PASS");

  const badStore = structuredClone(first.store);
  badStore.actions[0]!.documentUrl = "https://www.azleg.gov/unreceipted.pdf";
  const refused = await processRegisteredManualCandidate(memory, "az-official-actions", azOfficialActionsCandidate({
    store: badStore,
    sourceReceipt: first.receipt,
    retrievedAt: "2026-09-08T18:03:00.000Z",
    sourceThrough: "2026-09-08T17:30:00.000Z",
    prior: { versionId: good.id, store: first.store, sourceReceipt: first.receipt },
  }), "2026-09-08T18:04:00.000Z");
  assert.equal(refused.candidate.state, "PROMOTED");
  assert.ok(refused.promoted);
  assert.deepEqual(refused.candidate.candidate.changeSet?.removed, []);
  assert.ok(refused.candidate.candidate.changeSet?.held.some((fact) =>
    fact.key === `action:${first.store.actions[0]!.id}` && fact.code === "MANUAL_MEMBER_HELD_LKG"
  ));
  assert.deepEqual((refused.promoted!.payload as ExecutiveActionStore).actions, first.store.actions);

  const read = await readExecutiveActionsProjection({ store: memory, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(executiveActionStore()?.actions[0]?.id, first.store.actions[0]?.id);
  resetExecutiveActionCache();
});

test("one blocked Arizona publication cannot hold an unrelated valid official action", async () => {
  const full = actionStore();
  const actions = full.actions.slice(0, 2);
  const firstStore = { ...full, actions };
  const firstReceipt = actionReceipt(firstStore, "2026-09-08T20:00:00.000Z");
  const memory = new MemoryRoutineDataStore();
  const first = azOfficialActionsCandidate({
    store: firstStore,
    sourceReceipt: firstReceipt,
    retrievedAt: "2026-09-08T20:00:00.000Z",
    sourceThrough: "2026-09-08T20:00:00.000Z",
  });
  await processRegisteredManualCandidate(memory, "az-official-actions", first, "2026-09-08T20:00:00.000Z", null);

  const attempted = structuredClone(firstStore);
  attempted.actions[0]!.designation = `${attempted.actions[0]!.designation} (reviewed revision)`;
  attempted.actions[1]!.designation = `${attempted.actions[1]!.designation} (must not enter)`;
  const blockedUrl = attempted.actions[1]!.documentUrl ?? attempted.actions[1]!.sourceUrl;
  const nextReceipt = actionReceipt(attempted, "2026-09-08T21:00:00.000Z", blockedUrl);
  const next = azOfficialActionsCandidate({
    store: attempted,
    sourceReceipt: nextReceipt,
    retrievedAt: "2026-09-08T21:00:00.000Z",
    sourceThrough: "2026-09-08T21:00:00.000Z",
    prior: { versionId: first.id, store: firstStore, sourceReceipt: firstReceipt },
  });
  const outcome = await processRegisteredManualCandidate(
    memory,
    "az-official-actions",
    next,
    "2026-09-08T21:00:00.000Z",
    first.id,
  );
  assert.equal(outcome.candidate.state, "PROMOTED");
  assert.deepEqual(outcome.candidate.candidate.changeSet?.removed, []);
  assert.deepEqual(outcome.candidate.candidate.changeSet?.changed.map((change) => change.key), [`action:${actions[0]!.id}`]);
  assert.ok(outcome.candidate.candidate.changeSet?.held.some((fact) =>
    fact.key === `action:${actions[1]!.id}` && fact.code === "MANUAL_MEMBER_HELD_LKG"
  ));
  const promoted = outcome.promoted!.payload as ExecutiveActionStore;
  assert.equal(
    promoted.actions.find((action) => action.id === actions[0]!.id)?.designation,
    attempted.actions[0]!.designation,
  );
  assert.equal(
    promoted.actions.find((action) => action.id === actions[1]!.id)?.designation,
    firstStore.actions[1]!.designation,
  );
});

test("a failed Legistar sitting is durable, cannot replace LKG, and cannot affect a later source-scoped promotion", async () => {
  const memory = new MemoryRoutineDataStore();
  const snapshot = oneGoodSitting();
  const good = pimaLegistarOutcomesCandidate({
    snapshot,
    acquisitions: evidence,
    retrievedAt: "2026-09-08T19:00:00.000Z",
    sourceThrough: "2026-09-08T18:59:00.000Z",
  });
  const promoted = await processRegisteredRoutineCandidate(memory, "pima-legistar-outcomes", good, "2026-09-08T19:01:00.000Z");
  assert.equal(promoted.candidate.state, "PROMOTED");
  assert.equal(promoted.readerReadback?.status, "PASS");

  const failedSnapshot: OutcomeSnapshot = {
    ...snapshot,
    sittings: [{ ...snapshot.sittings[0]!, extraction: "REQUEST_FAILED", extractionNote: "seeded source timeout" }],
  };
  const failed = pimaLegistarOutcomesCandidate({
    snapshot: failedSnapshot,
    acquisitions: evidence,
    retrievedAt: "2026-09-08T19:02:00.000Z",
    sourceThrough: "2026-09-08T19:02:00.000Z",
    failureDetail: "seeded source timeout",
  });
  const refused = await processRegisteredRoutineCandidate(memory, "pima-legistar-outcomes", failed, "2026-09-08T19:03:00.000Z");
  assert.equal(refused.candidate.state, "SOURCE_BLOCKED");
  assert.equal(refused.promoted, null);
  assert.equal((await memory.events(failed.id)).at(-1)?.state, "SOURCE_BLOCKED");
  assert.equal((await memory.readPromotion("MEETING_OUTCOME", "US-AZ:county:pima:legistar-outcomes"))?.versionId, good.id);

  const read = await readDoorOutcomeProjection(PIMA_OUTCOME_TENANT.scope, { store: memory, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(getOutcomeSnapshot().sittings[0]?.meetingId, snapshot.sittings[0]?.meetingId);
  resetOutcomeSnapshotCache();
});

test("store failure never reopens tracked action or outcome snapshots", async () => {
  const failedStore = {
    readPromotion: async () => { throw new Error("seeded database outage"); },
    readCandidate: async () => null,
  };
  const actionRead = await readExecutiveActionsProjection({ store: failedStore, bypassCache: true });
  const outcomeRead = await readDoorOutcomeProjection(PIMA_OUTCOME_TENANT.scope, { store: failedStore, bypassCache: true });
  assert.equal(actionRead.kind, "STORE_UNREACHABLE");
  assert.equal(outcomeRead.kind, "STORE_UNREACHABLE");
  assert.equal(executiveActionStore(), null);
  assert.deepEqual(getOutcomeSnapshot().sittings, []);
  resetExecutiveActionCache();
  resetOutcomeSnapshotCache();
});
