import assert from "node:assert/strict";
import test from "node:test";

import { ASK_GAP_CODES, heldBodyGaps, type HeldAskGap } from "../lib/ask/held-gaps.ts";
import { buildTopicTimeline } from "../lib/ask/topic-timeline.ts";
import { gapWords, type EvidencePack } from "../lib/ask/evidence.ts";
import { synthesisContextPayload } from "../lib/ask/synthesize.ts";
import { agendaTopicFor, type AgendaDocumentLike } from "../lib/routing/agenda-search.ts";
import type { PersistedSittingOutcomes } from "../lib/outcomes/types.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { MEETING_PARTITION_CONTRACTS, meetingPartitionId } from "../lib/civic-data/meeting-partitions.ts";
import { askGapNoteParts, parseAskGapObligationId } from "../lib/control-plane/ask-gap-id.ts";
import {
  askGapCarriers,
  askGapsProvider,
  type AskGapHoldings,
  type AskGapMeeting,
  type CarrierClock,
} from "../lib/control-plane/scheduler/providers/ask-gaps.ts";
import { ASK_GAP_CARRIER_TASKS, carrierClocks, readAskGapHoldings } from "../lib/control-plane/scheduler/ask-gap-holdings.ts";
import { buildRegistry } from "../lib/control-plane/scheduler/registry.ts";
import { routeExecutor } from "../lib/control-plane/scheduler/route-executor.ts";
import { decideExecutor } from "../lib/control-plane/scheduler/dispatch.ts";
import { isScheduled, scheduleObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { planSupersededRetirement, standing, supersededRetirementReason } from "../lib/control-plane/scheduler/durable.ts";
import { ZERO_COST, type Attempt, type WorkerRole } from "../lib/control-plane/attempt.ts";
import {
  OBLIGATION_PROVIDER_PREFIXES,
  askGapCountWords,
  assignmentCountClaims,
  assignmentRenderedNumbers,
  buildAssignmentView,
  buildAssignments,
  providerOfObligation,
  type AssignmentSources,
} from "../lib/control-plane/assignment-view.ts";
import { auditRenderedNumbers, checkStatedEqualsRendered } from "../lib/control-plane/owner-surface.ts";
import type { RouteTask } from "../lib/control-plane/route-task.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import { unitOf } from "./helpers/ask-gap-unit.ts";

const NOW_ISO = "2026-09-24T12:00:00.000Z";
const NOW = Date.parse(NOW_ISO);
const PIMA = "ocd-division/country:us/state:az/county:pima#governing";
const MESA = "ocd-division/country:us/state:az/place:mesa#governing";
const DATA_CENTER = agendaTopicFor("data center")!;
const FRESH = "2026-09-24T10:00:00.000Z";
const FOUR_DAYS_OLD = "2026-09-20T12:00:00.000Z";

const meetings: AskGapMeeting[] = [
  { id: "legistar:pima:1900", bodyId: PIMA, startsAt: "2026-09-15T09:00:00-07:00", timeZone: "America/Phoenix", agendaUrl: "https://pima.legistar.com/View.ashx?M=A&ID=1900", status: "CONCLUDED", provenance: { collectedAt: FRESH } },
  { id: "legistar:pima:1901", bodyId: PIMA, startsAt: "2026-10-06T09:00:00-07:00", timeZone: "America/Phoenix", agendaUrl: null, provenance: { collectedAt: FRESH } },
  { id: "legistar-insite:mesa:2000", bodyId: MESA, startsAt: "2026-09-15T17:45:00-07:00", timeZone: "America/Phoenix", agendaUrl: "https://mesa.legistar.com/View.ashx?M=A&ID=2000", status: "CONCLUDED", provenance: { collectedAt: FOUR_DAYS_OLD } },
  { id: "legistar-insite:mesa:2001", bodyId: MESA, startsAt: "2026-09-29T17:45:00-07:00", timeZone: "America/Phoenix", agendaUrl: "https://mesa.legistar.com/View.ashx?M=A&ID=2001", provenance: { collectedAt: FOUR_DAYS_OLD } },
];

const document = (meetingId: string, text: string): AgendaDocumentLike => ({
  meetingId,
  documentUrl: `https://example.gov/${meetingId}.pdf`,
  sourceUrl: `https://example.gov/${meetingId}.pdf`,
  sourceOrg: "Clerk",
  retrievedAt: FRESH,
  text,
  extraction: "text",
});
const documents: AgendaDocumentLike[] = [
  document("legistar:pima:1900", "1. Call to order 2. Moratorium on Data Center Development Discussion/Direction/Action"),
  document("legistar-insite:mesa:2000", "1. Call to order 2. Ordinance designating data centers a prohibited use"),
];

const PIMA_DETAIL = "https://pima.legistar.com/MeetingDetail.aspx?LEGID=1801&GID=243&G=7B470E9E-E35C-4698-8FA6-D778FB28F394";
const PIMA_MINUTES = "https://legistar.granicus.com/pima/meetings/2026/5/1801_M_Board_of_Supervisors_26-05-12_Meeting_Summary.pdf";
const PIMA_AGENDA = "https://legistar.granicus.com/pima/meetings/2026/5/1801_A_Board_of_Supervisors_26-05-12_Online_Agenda.pdf";
const PIMA_SITTING_TEMPLATE = {
  meetingId: "legistar:pima:1801",
  bodyId: PIMA,
  ocdId: "ocd-division/country:us/state:az/county:pima",
  slug: "pima",
  eventId: 1801,
  bodyName: "Board of Supervisors",
  jurisdiction: "Pima County, AZ",
  startsAt: "2026-05-12T13:00:00-07:00",
  sourceOrg: "Pima County Clerk of the Board",
  sourceUrl: PIMA_DETAIL,
  extraction: "RETRIEVED",
  extractionNote: null,
  publication: {
    agendaStatusName: "Final", agendaStatusId: 10, agendaFile: PIMA_AGENDA, agendaLastPublishedUtc: "2026-05-11T22:39:33.11",
    minutesStatusName: "Draft", minutesStatusId: 9, minutesFile: PIMA_MINUTES, minutesLastPublishedUtc: "2026-05-13T18:56:29.663",
    inSiteUrl: PIMA_DETAIL, lastModifiedUtc: "2026-05-13T18:56:29.83", videoStatus: "Public", observedAt: "2026-08-30T05:38:01.398Z",
  },
  minutesPointer: { url: PIMA_MINUTES, status: "Draft", host: "legistar.granicus.com", retrievalNote: "Not retrieved." },
  agenda: [],
  outcomes: [],
  rollCalls: [],
  failedRollCallExtractions: [314841],
  voteRequestFailures: [],
  routesWalked: ["WEBAPI_EVENTS", "WEBAPI_EVENTITEMS", "WEBAPI_EVENTITEM_VOTES"],
  publicationObservations: [{
    meetingId: "legistar:pima:1801",
    provenance: "FIRST_PARTY_PUBLISHER",
    report: "AVAILABLE",
    observedAt: "2026-08-30T05:38:01.398Z",
    observedUrl: PIMA_DETAIL,
    sourceOrg: "Pima County Clerk of the Board",
    evidenceQuote: `EventAgendaStatusName=Final; EventAgendaFile=${PIMA_AGENDA}; EventAgendaLastPublishedUTC=2026-05-11T22:39:33.11`,
    routeId: "WEBAPI_EVENT",
  }],
} as unknown as PersistedSittingOutcomes;

/** Pima's recorded-outcome sitting for September 15: its agenda read, and — until the read lands — no decision. */
function pimaSitting(decided: boolean): PersistedSittingOutcomes {
  const provenance = { endpoint: "https://webapi.legistar.com/v1/pima/events/1900/eventitems", sourceOrg: "Pima County Clerk of the Board", readOn: "2026-09-24" };
  return {
    ...PIMA_SITTING_TEMPLATE,
    meetingId: "legistar:pima:1900",
    eventId: 1900,
    startsAt: "2026-09-15T09:00:00-07:00",
    agenda: [{ recordClass: "AGENDA", eventItemId: 400001, eventId: 1900, sequence: 2, agendaNumber: "2.", title: "Moratorium on Data Center Development", matterFile: "File ID 21000", matterType: "Agenda Item", provenance }],
    outcomes: decided
      ? [{
          recordClass: "ACTION_SUMMARY", eventItemId: 400001, eventId: 1900, matterFile: "File ID 21000", action: "approve", disposition: "PASSED", dispositionRaw: "Pass",
          dispositionConflict: null, dispositionGap: null, mover: null, seconder: null, tallyText: "approved 3-2", matterStatus: "Approved", onConsentCalendar: false,
          rollCall: "OUTCOME_WITHOUT_ROLL_CALL", rollCallGap: null, provenance,
        }]
      : [],
    rollCalls: [],
  } as PersistedSittingOutcomes;
}

const MESA_PARTITION = meetingPartitionId("legistar-insite", MESA);
/** The deterministic lane's dispatch fields, as the dispatcher supplies them. */
const LANE = { executor: "DETERMINISTIC", bound: { maxAttempts: 1, maxWallMs: 1, maxCostUnits: 1 }, holder: "fixture" } as const;
const read = (lastSucceededAt: string, nextReadDueAt: string): CarrierClock => ({
  kind: "READ",
  lastSucceededAt,
  lastAttemptedAt: lastSucceededAt,
  requiredEveryMs: 3_600_000,
  nextReadDueAt,
});
/** Every Pima read is on cadence; Mesa's calendar partition last succeeded three hours ago against an hourly cadence. */
function clockOf(contractId: string): CarrierClock {
  if (contractId === MESA_PARTITION) {
    return { kind: "READ", lastSucceededAt: "2026-09-24T09:00:00.000Z", lastAttemptedAt: "2026-09-24T11:30:00.000Z", requiredEveryMs: 3_600_000, nextReadDueAt: "2026-09-24T12:30:00.000Z" };
  }
  return read("2026-09-24T11:30:00.000Z", "2026-09-24T12:30:00.000Z");
}

function holdings(over: Partial<AskGapHoldings> = {}): AskGapHoldings {
  return {
    source: "the fixture holdings",
    meetings,
    documents,
    sittings: [pimaSitting(false)],
    outcomesUnreadable: null,
    clockOf,
    ...over,
  };
}

/** The registry without Mesa's minutes reader, for the adapter-owed path. */
const WITHOUT_MESA_MINUTES = { contracts: ROUTINE_SOURCE_CONTRACTS.filter((c) => c.id !== "mesa-legistar-minutes-outcomes") };

const enumerate = (h: AskGapHoldings, registered?: Parameters<typeof askGapCarriers>[2]) =>
  buildRegistry([askGapsProvider({ holdings: () => h, ...(registered ? { registered } : {}) })], { root: ".", nowIso: NOW_ISO });


test("Ask's gaps carry a closed code, body and record class, and the model and the reader get the same words as before", () => {
  const mesa = meetings.filter((m) => m.bodyId === MESA).map((m) => ({ ...m, bodyName: "City Council", title: "City Council" }));
  const timeline = buildTopicTimeline({
    topic: DATA_CENTER, bodyId: MESA, bodyName: "Mesa City Council",
    meetings: mesa, documents: documents.filter((d) => d.meetingId.startsWith("legistar-insite:mesa")), sittings: [], now: NOW,
  });
  assert.deepEqual(
    timeline.gaps.map((g) => [g.code, g.bodyId, g.recordClass]),
    [["AGENDA_NOT_HELD", MESA, "MEETING"], ["CALENDAR_STALE", MESA, "MEETING"]],
  );
  assert.equal(
    timeline.gaps[0]!.statement,
    "The Mesa City Council meets next on September 29th, 2026; we do not yet hold an agenda for that meeting.",
    "the reader's sentence is the timeline's, unchanged",
  );
  assert.equal(
    timeline.gaps[1]!.statement,
    "The upcoming Mesa City Council meetings in this answer were last read from its calendar on September 20th, 2026; anything posted since then is not in this answer yet.",
  );
  // The concluded September 15 sitting's outcome is not read: coded on the timeline, stated in the entry's own sentence.
  assert.deepEqual(timeline.heldGaps.map((g) => g.code), ["AGENDA_NOT_HELD", "CALENDAR_STALE", "OUTCOME_NOT_READ"]);
  assert.equal(timeline.entries.find((e) => e.meetingId === "legistar-insite:mesa:2000")?.status, "OUTCOME_NOT_READ");

  const pack = (gaps: EvidencePack["gaps"]): EvidencePack => ({
    question: "is mesa voting on data centers", intent: "AGENDA_TOPIC", temporal: "ANY", subject: null, records: [], gaps, denominators: {}, today: "2026-09-24",
  } as unknown as EvidencePack);
  assert.equal(
    synthesisContextPayload(pack(timeline.gaps)),
    synthesisContextPayload(pack(timeline.gaps.map(gapWords))),
    "a gap's code never reaches the synthesis model",
  );
  assert.doesNotMatch(synthesisContextPayload(pack(timeline.gaps)), /AGENDA_NOT_HELD|CALENDAR_STALE|recordClass/);
});

test("an unreadable outcome store is coded OUTCOMES_UNREADABLE, and OUTCOME_NOT_READ is not guessed beside it", () => {
  const held = heldBodyGaps({ bodyId: PIMA, meetings: meetings.filter((m) => m.bodyId === PIMA), documents, sittings: [], now: NOW, outcomesUnavailable: true });
  assert.deepEqual(held.gaps.map((g) => g.code), ["AGENDA_NOT_HELD", "OUTCOMES_UNREADABLE"]);
  const timeline = buildTopicTimeline({
    topic: DATA_CENTER, bodyId: PIMA, bodyName: "Pima County Board Of Supervisors",
    meetings: meetings.filter((m) => m.bodyId === PIMA).map((m) => ({ ...m, bodyName: "Board", title: "Board" })), documents, sittings: [], now: NOW, outcomesUnavailable: true,
  });
  const store = timeline.gaps.find((g) => g.code === "OUTCOMES_UNREADABLE");
  assert.equal(store?.statement, "The recorded actions and votes we hold could not be read for this answer. This is a failure of our holding, not evidence that the body took no action.");
  assert.equal(store?.recordClass, "MEETING_OUTCOME");
});

test("PIMA: a concluded sitting with no outcome read is the RUNNER's routine outcomes re-read, carried and never re-fetched", () => {
  const pass = enumerate(holdings());
  const unit = unitOf(pass, PIMA, "OUTCOME_NOT_READ");
  assert.equal(unit.providerId, "ask-gaps");
  assert.equal(unit.obligation.recordClass, "ask-gap");
  assert.equal(unit.obligation.subjectId, PIMA);
  assert.equal(unit.obligation.routeId, "OUTCOME_NOT_READ");
  assert.deepEqual(parseAskGapObligationId(unit.obligation.id), { bodyId: PIMA, code: "OUTCOME_NOT_READ" });
  assert.equal(unit.route.open.kind, "ROUTINE_READ");
  if (unit.route.open.kind !== "ROUTINE_READ") return;
  assert.deepEqual(unit.route.open.contractIds, ["pima-legistar-outcomes"], "the outcomes contract that follows the Board's partitions carries it");
  assert.equal(unit.route.open.cadenceFailure, null, "its read is on cadence");
  assert.match(unit.route.open.reason, /legistar:pima:1900/, "the evidence names the sitting");
  assert.match(unit.route.open.reason, /outstanding since 2026-09-15T09:00:00-07:00/);
  assert.match(unit.route.open.reason, /NEXT READ: owed by 2026-09-24T12:30:00.000Z, by pima-legistar-outcomes$/);
  assert.equal(unit.route.executorClass, "DETERMINISTIC");
  assert.equal(decideExecutor({ routeId: unit.route.routeId, descriptor: unit.route, maturity: () => "UNGRADUATED" }).kind, "DETERMINISTIC", "never a model, never the paid lane");
  assert.equal(decideExecutor({ routeId: unit.route.routeId, descriptor: unit.route, maturity: () => "UNGRADUATED" }).disagreement, null);

  const agenda = unitOf(pass, PIMA, "AGENDA_NOT_HELD");
  assert.equal(agenda.route.open.kind, "ROUTINE_READ");
  if (agenda.route.open.kind === "ROUTINE_READ") {
    assert.deepEqual(agenda.route.open.contractIds, MEETING_PARTITION_CONTRACTS.filter((p) => p.bodyId === PIMA).map((p) => p.id).sort());
    assert.match(agenda.route.open.reason, /2026-10-06 \(legistar:pima:1901; upcoming, no agenda link listed\)/);
  }
  assert.equal(agenda.obligation.readerImpactAt, "2026-10-06T09:00:00-07:00", "a reader is hurt when the sitting arrives with its agenda unheld");
  assert.equal(pass.units.some((u) => u.obligation.id.endsWith(`${PIMA}#CALENDAR_STALE`)), false, "Pima's calendar was read two hours ago");
});

test("MESA: a concluded sitting with no decision and no outcomes route is ENGINEERING's, awaiting a named adapter — and the RUNNER's once Mesa's minutes reader is registered", () => {
  const pass = enumerate(holdings(), WITHOUT_MESA_MINUTES);
  const unit = unitOf(pass, MESA, "OUTCOME_NOT_READ");
  assert.equal(unit.route.open.kind, "NOT_MACHINE_EXECUTABLE");
  assert.equal(unit.route.awaitingAdapter, "Mesa: minutes reader");
  assert.equal(unit.route.executorClass, "DETERMINISTIC", "no model is spent standing in for an adapter");
  if (unit.route.open.kind === "NOT_MACHINE_EXECUTABLE") {
    assert.match(unit.route.open.reason, /No routine contract reads recorded outcomes/);
    assert.match(unit.route.open.reason, /legistar-insite:mesa:2000/);
  }

  // Mesa's minutes-outcomes contract follows its partition, and that is all it takes: no edit to the provider.
  assert.deepEqual(askGapCarriers(MESA, "MEETING_OUTCOME", { contracts: ROUTINE_SOURCE_CONTRACTS }), ["mesa-legistar-minutes-outcomes"]);
  const after = unitOf(enumerate(holdings()), MESA, "OUTCOME_NOT_READ");
  assert.equal(after.obligation.id, unit.obligation.id, "the same obligation, re-routed");
  assert.equal(after.route.open.kind, "ROUTINE_READ");
  if (after.route.open.kind === "ROUTINE_READ") assert.deepEqual(after.route.open.contractIds, ["mesa-legistar-minutes-outcomes"]);
});

test("a stale calendar is the RUNNER's, and a carrying read behind the owner's cadence is a named CADENCE_BROKEN failure", async () => {
  const unit = unitOf(enumerate(holdings()), MESA, "CALENDAR_STALE");
  assert.equal(unit.route.open.kind, "ROUTINE_READ");
  if (unit.route.open.kind !== "ROUTINE_READ") return;
  assert.deepEqual(unit.route.open.contractIds, [MESA_PARTITION]);
  assert.match(unit.route.open.reason, /last read 2026-09-20T12:00:00.000Z, 96.0 hours before this reading/);
  assert.equal(
    unit.route.open.cadenceFailure,
    `${MESA_PARTITION} last succeeded 2026-09-24T09:00:00.000Z, 3.0 hours before this reading, and the owner's cadence requires a read hourly while a sitting is within seven days; its last attempt, 2026-09-24T11:30:00.000Z, did not succeed.`,
  );

  // The executor sends nothing, closes the round DISCOVERED (still owed), and the note carries the named failure.
  const executor = routeExecutor({
    routeFor: () => unit.route,
    openOne: async () => { throw new Error("a routine-carried route must never be fetched by this process"); },
    now: () => NOW_ISO,
  });
  const row = scheduleObligation(unit.obligation, NOW);
  assert.ok(isScheduled(row));
  const outcome = await executor({ obligation: row, routeTaskId: "rt-1", workItemId: "wi-1", attemptId: "at-1", ...LANE });
  assert.equal(outcome.kind, "DISPOSED");
  assert.equal(outcome.disposition?.disposition, "DISCOVERED", "non-discharging: the record is still owed");
  assert.equal(outcome.cost?.requestCount, 0);
  const parts = askGapNoteParts(outcome.disposition!.note);
  assert.equal(parts.cadenceFailure, unit.route.open.cadenceFailure);
  assert.equal(parts.nextRead, `owed by 2026-09-24T12:30:00.000Z, by ${MESA_PARTITION}`);
});

test("gap gone: when a read holds the decision, the provider stops emitting it and the superseded path retires it by name", () => {
  const before = enumerate(holdings());
  const after = enumerate(holdings({ sittings: [pimaSitting(true)] }));
  const gone = `freshness:ask-gap:${PIMA}#OUTCOME_NOT_READ`;
  assert.ok(before.units.some((u) => u.obligation.id === gone));
  assert.equal(after.units.some((u) => u.obligation.id === gone), false, "the decision is held, so Ask states no such gap");
  assert.equal(after.byProvider[0]!.readFailure, null);

  const outside = before.units.filter((u) => !after.units.some((a) => a.obligation.id === u.obligation.id)).map((u) => standing(u.obligation, NOW_ISO));
  const plan = planSupersededRetirement({
    outside,
    corpus: after.units.map((u) => ({ providerId: u.providerId, obligationId: u.obligation.id })),
    providers: after.byProvider,
  });
  assert.deepEqual(plan.retire, [{ obligationId: gone, reason: supersededRetirementReason("ask-gaps") }]);
  assert.deepEqual(plan.heldBack, []);

  // An unreadable outcome store is a read failure: nothing retires on it, and no body without an outcomes route gets a row for it.
  const down = enumerate(holdings({ sittings: [], outcomesUnreadable: "STORE_UNREACHABLE: connect timeout" }));
  assert.match(down.byProvider[0]!.readFailure ?? "", /recorded outcomes Ask reads could not be read/);
  assert.ok(down.units.some((u) => u.obligation.id === `freshness:ask-gap:${PIMA}#OUTCOMES_UNREADABLE`));
  assert.ok(down.units.some((u) => u.obligation.id === `freshness:ask-gap:${MESA}#OUTCOMES_UNREADABLE`), "Mesa's minutes reader makes its outcome store Ask's too");
  const downWithoutMesa = enumerate(holdings({ sittings: [], outcomesUnreadable: "STORE_UNREACHABLE: connect timeout" }), WITHOUT_MESA_MINUTES);
  assert.equal(downWithoutMesa.units.some((u) => u.obligation.id === `freshness:ask-gap:${MESA}#OUTCOMES_UNREADABLE`), false);
  const held = planSupersededRetirement({
    outside: before.units.map((u) => standing(u.obligation, NOW_ISO)).filter((o) => !down.units.some((u) => u.obligation.id === o.id)),
    corpus: down.units.map((u) => ({ providerId: u.providerId, obligationId: u.obligation.id })),
    providers: down.byProvider,
  });
  assert.equal(held.retire.length, 0);
  assert.ok(held.heldBack.every((h) => h.code === "PROVIDER_NOT_READ_CLEANLY"));

  // And an unreadable meetings reading decides nothing.
  const none = buildRegistry([askGapsProvider()], { root: ".", nowIso: NOW_ISO });
  assert.equal(none.units.length, 0);
  assert.match(none.byProvider[0]!.readFailure ?? "", /could not be read/);
});

test("Ask and the provider agree: on every body of the fixture, the codes Ask holds are exactly the obligations the runner emits", () => {
  const held = holdings();
  const pass = enumerate(held);
  const bodies = [...new Set(meetings.flatMap((m) => (m.bodyId ? [m.bodyId] : [])))].sort();
  let compared = 0;
  for (const bodyId of bodies) {
    const bodyMeetings = meetings.filter((m) => m.bodyId === bodyId).map((m) => ({ ...m, bodyName: "Board", title: "Board" }));
    const ids = new Set(bodyMeetings.map((m) => m.id));
    const timeline = buildTopicTimeline({
      topic: DATA_CENTER, bodyId, bodyName: "Board",
      meetings: bodyMeetings, documents: documents.filter((d) => ids.has(d.meetingId)),
      sittings: held.sittings.filter((s) => s.bodyId === bodyId), now: NOW,
    });
    const askCodes = [...new Set(timeline.heldGaps.map((g: HeldAskGap) => g.code))].sort();
    const runnerCodes = pass.units.filter((u) => u.obligation.subjectId === bodyId).map((u) => u.obligation.routeId).sort();
    assert.deepEqual(runnerCodes, askCodes, bodyId);
    // Every stated gap sentence carries its code, and they are the held gaps less the per-entry outcome sentences.
    assert.deepEqual(timeline.gaps.map((g) => g.code), timeline.heldGaps.filter((g) => g.code !== "OUTCOME_NOT_READ").map((g) => g.code), bodyId);
    compared += 1;
  }
  assert.equal(compared, bodies.length);
  assert.ok(pass.units.length > 0);
  assert.ok(pass.units.every((u) => ASK_GAP_CODES.includes(u.obligation.routeId as never)));
});

test("the runner's reading: the sitting window decides the cadence a carrying read owes, and a failed read is named, never an empty domain", async () => {
  const task = ASK_GAP_CARRIER_TASKS.find((t) => t.id === MESA_PARTITION)!;
  assert.ok(task, "Mesa's partition is a carrying task");
  const hot = carrierClocks([{ task, ok: true, clock: { lastAttemptedAt: "2026-09-24T11:00:00.000Z", lastSucceededAt: "2026-09-24T11:00:00.000Z", lastSucceededObservedAt: "2026-09-24T11:00:05.000Z", sittingStarts: ["2026-09-29T17:45:00-07:00"] } }], NOW).get(MESA_PARTITION);
  assert.deepEqual(hot, { kind: "READ", lastSucceededAt: "2026-09-24T11:00:05.000Z", lastAttemptedAt: "2026-09-24T11:00:00.000Z", requiredEveryMs: 3_600_000, nextReadDueAt: "2026-09-24T12:00:05.000Z" });
  const cold = carrierClocks([{ task, ok: true, clock: { lastAttemptedAt: "2026-09-24T11:00:00.000Z", lastSucceededAt: "2026-09-24T11:00:00.000Z", lastSucceededObservedAt: "2026-09-24T11:00:00.000Z", sittingStarts: ["2026-11-29T17:45:00-07:00"] } }], NOW).get(MESA_PARTITION);
  assert.equal(cold?.kind === "READ" ? cold.requiredEveryMs : null, 12 * 3_600_000, "twice daily with no sitting within seven days");
  const failed = carrierClocks([{ task, ok: false, error: "statement timeout" }], NOW).get(MESA_PARTITION);
  assert.deepEqual(failed, { kind: "UNREAD", why: "statement timeout" });

  const unreachable = await readAskGapHoldings({
    now: NOW_ISO,
    readMeetings: async () => ({ kind: "STORE_UNREACHABLE", value: null, metadata: {} as never, code: "STORE_READ_FAILED", detail: "connect timeout" } as never),
  });
  assert.deepEqual(unreachable, { unreadable: "the meetings projection is STORE_UNREACHABLE: connect timeout" });
  const hung = await readAskGapHoldings({ now: NOW_ISO, boundMs: 20, readMeetings: () => new Promise(() => {}) });
  assert.deepEqual(hung, { unreadable: "the held reading did not finish within 0 s, so no gap is decided on it this cycle" }, "a hung read is named; it never holds the registry to the wall");

  const reading = await readAskGapHoldings({
    now: NOW_ISO,
    readMeetings: async () => ({ kind: "PROMOTED", value: { meetings, agendaDocuments: documents }, metadata: {}, partitions: [], detail: "fixture" } as never),
    readOutcomes: async () => ({ sittings: [pimaSitting(false)], unreadable: null }),
    readClock: async () => undefined,
  });
  assert.ok(!("unreadable" in reading));
  if ("unreadable" in reading) return;
  assert.equal(reading.meetings.length, meetings.length);
  assert.equal(reading.clockOf("no-such-contract").kind, "UNREAD");
  assert.equal(reading.clockOf(MESA_PARTITION).kind, "READ");
});

/** One dispatched round of an Ask-gap obligation, its disposition produced by the real route executor from the provider's route. */
async function dispatchedRound(unit: ReturnType<typeof unitOf>, n: number): Promise<Partial<AssignmentSources>> {
  const executor = routeExecutor({ routeFor: () => unit.route, openOne: async () => { throw new Error("never fetched"); }, now: () => NOW_ISO });
  const row = scheduleObligation(unit.obligation, NOW);
  assert.ok(isScheduled(row));
  const [wi, rt, at] = [`wi-${n}`, `rt-${n}`, `at-${n}`];
  const outcome = await executor({ obligation: row, routeTaskId: rt, workItemId: wi, attemptId: at, ...LANE });
  const disposition = { ...outcome.disposition!, attemptId: at, at: "2026-09-24T11:59:00.000Z", artifactIds: [] };
  const worker = { role: "ACQUIRER" as WorkerRole, provider: "we-the-people", version: "route-executor/1.0 (fixture)", instance: "fixture@1" };
  const attempt: Attempt = {
    id: at, routeTaskId: rt, workItemId: wi, worker, leaseId: `ls-${n}`, startedAt: "2026-09-24T11:58:00.000Z", endedAt: "2026-09-24T11:59:00.000Z",
    outcome: "COMPLETED", abortReason: null, artifactIds: [], cost: outcome.cost ?? ZERO_COST, methodVersion: 1, policyVersion: "fixture",
  };
  const routeTask: RouteTask = {
    id: rt, workItemId: wi, routeId: unit.route.routeId, routeLabel: unit.route.label, target: unit.obligation.subjectId, inherited: false,
    state: "DISPOSED", disposition, attemptIds: [at], createdAt: "2026-09-24T11:58:00.000Z",
  };
  const workItem = {
    id: wi, project: "freshness", subject: unit.obligation.subjectId, obligation: `${unit.obligation.id}#1`, why: "fixture", priority: "P2", state: "OPEN",
    contract: { inheritedRouteFloor: [], requiresValidation: true, requiresAudit: false, requiresCompleteDenominator: false, acceptableDispositions: null, instrumentEvidence: null },
    dependencies: [], routeTaskIds: [rt], escalations: [], createdAt: "2026-09-24T11:58:00.000Z",
    transitions: [{ from: null, to: "OPEN", at: "2026-09-24T11:58:00.000Z", by: "control-plane", why: "fixture" }],
  } as unknown as WorkItem;
  return {
    obligations: [{ ...standing(unit.obligation, NOW_ISO), nextDueAt: "2026-09-25T12:00:00.000Z", occurrenceCount: 1, lastWorkedAt: "2026-09-24T11:59:00.000Z" }],
    occurrences: [{
      id: `occ-${unit.obligation.id}-000001`, obligationId: unit.obligation.id, sequence: 1, dueAt: NOW_ISO, workItemId: wi, routeTaskId: rt,
      openedAt: "2026-09-24T11:58:00.000Z", closedAt: "2026-09-24T11:59:00.000Z", disposition: disposition.disposition, unresolvedReason: null,
    }],
    workItems: [workItem],
    routeTasks: [routeTask],
    attempts: [attempt],
  };
}

function sources(...parts: Partial<AssignmentSources>[]): AssignmentSources {
  const out: Record<string, unknown> = {
    nowIso: NOW_ISO, obligations: [], occurrences: [], workItems: [], routeTasks: [], attempts: [], debts: [], leases: [], dispositions: null,
    artifacts: [], costs: [], scoutResults: [], workerResults: [], pipeline: [], activation: null, servedReader: null, pilotZips: ["85701"],
  };
  for (const part of parts) for (const [k, v] of Object.entries(part)) out[k] = [...((out[k] as unknown[]) ?? []), ...(v as unknown[])];
  return out as unknown as AssignmentSources;
}

test("ADMIN: an Ask-gap obligation reads as an Ask gap, with the owner and the next step its own round names", async () => {
  assert.equal(providerOfObligation(`freshness:ask-gap:${MESA}#OUTCOME_NOT_READ`), "ask-gaps");
  assert.ok(OBLIGATION_PROVIDER_PREFIXES.some((p) => p.prefix === "freshness:ask-gap:" && p.providerId === "ask-gaps"));

  const pass = enumerate(holdings(), WITHOUT_MESA_MINUTES);
  const adapter = await dispatchedRound(unitOf(pass, MESA, "OUTCOME_NOT_READ"), 1);
  const broken = await dispatchedRound(unitOf(pass, MESA, "CALENDAR_STALE"), 2);
  const carried = await dispatchedRound(unitOf(pass, PIMA, "OUTCOME_NOT_READ"), 3);
  const rows = buildAssignments(sources(adapter, broken, carried));
  const row = (id: string) => {
    const found = rows.find((r) => r.id === id);
    assert.ok(found, `no row ${id}`);
    return found;
  };

  const mesaOutcome = row(`freshness:ask-gap:${MESA}#OUTCOME_NOT_READ`);
  assert.equal(mesaOutcome.what.title, "Ask gap: outcome not read — Mesa — Governing");
  assert.equal(mesaOutcome.state, "BLOCKED");
  assert.equal(mesaOutcome.waiting.owner, "ENGINEERING");
  assert.match(mesaOutcome.waiting.nextAction, /^Build the adapter owed: Mesa: minutes reader\./);

  const mesaCalendar = row(`freshness:ask-gap:${MESA}#CALENDAR_STALE`);
  assert.equal(mesaCalendar.what.title, "Ask gap: calendar read is stale — Mesa — Governing");
  assert.equal(mesaCalendar.waiting.owner, "RUNNER");
  assert.match(mesaCalendar.waiting.nextAction, /^Named failure, CADENCE_BROKEN as of 2026-09-24T11:59:00.000Z: meetings:legistar-insite:\S+ last succeeded 2026-09-24T09:00:00.000Z, 3.0 hours before this reading/);

  const pimaOutcome = row(`freshness:ask-gap:${PIMA}#OUTCOME_NOT_READ`);
  assert.equal(pimaOutcome.waiting.owner, "RUNNER");
  assert.equal(
    pimaOutcome.waiting.nextAction,
    "The routine read closes it — its next read is owed by 2026-09-24T12:30:00.000Z, by pima-legistar-outcomes (as of 2026-09-24T11:59:00.000Z); nothing is owed by anyone else.",
  );
});

test("ADMIN: open Ask gaps are counted by code, drawn with their denominators, and unknown is never zero", () => {
  const none = buildAssignmentView(sources());
  assert.equal(none.summary.askGaps?.held, false);
  assert.match(askGapCountWords(none), /^Open Ask gaps are not counted: no Ask-gap obligation is on record/);
  assert.match(askGapCountWords({ summary: { ...none.summary, askGaps: undefined } }), /built before the count existed/);

  const pass = enumerate(holdings());
  const retiredId = unitOf(pass, PIMA, "AGENDA_NOT_HELD").obligation.id;
  const retired = { ...standing(unitOf(pass, PIMA, "AGENDA_NOT_HELD").obligation, NOW_ISO), active: false, retiredAt: NOW_ISO, retirementReason: supersededRetirementReason("ask-gaps") };
  const open = pass.units.filter((u) => u.obligation.id !== retiredId).map((u) => standing(u.obligation, NOW_ISO));
  const view = buildAssignmentView(sources({ obligations: [...open, retired] }));
  const counted = view.summary.askGaps;
  assert.ok(counted?.held);
  if (!counted?.held) return;
  assert.equal(counted.value.open, 4, "a retired gap is not open");
  assert.deepEqual(counted.value.byCode.map((c) => [c.code, c.count.value, c.count.denominator]), [
    ["OUTCOME_NOT_READ", 2, 4],
    ["AGENDA_NOT_HELD", 1, 4],
    ["CALENDAR_STALE", 1, 4],
    ["OUTCOMES_UNREADABLE", 0, 4],
    ["MEETINGS_NOT_HELD", 0, 4],
  ]);
  assert.equal(
    askGapCountWords(view),
    "Open Ask gaps — 4: outcome not read 2 · agenda not held 1 · calendar read is stale 1 · recorded outcomes unreadable 0 · meetings not held 0." +
      " How often readers were told them is not on this list: the Ask-gap observations were not read for it.",
    "these sources carry no Ask-gap observations, and the words say so rather than implying nobody was told (tests/ask-gap-observation.test.ts)",
  );
  assert.ok(auditRenderedNumbers(assignmentRenderedNumbers(view)).ok);
  assert.ok(checkStatedEqualsRendered(assignmentCountClaims(view)).ok);
});
