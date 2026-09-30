import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { initializeFederalVoteFirstSeed } from "./helpers/federal-vote-first-seed.ts";
import { installOutcomeFirstSeed, installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";
import { september22Sitting } from "./helpers/pima-september-22-sitting.ts";
import { unitOf } from "./helpers/ask-gap-unit.ts";
import {
  ASK_GAP_OBSERVATION_FIELDS,
  ASK_GAP_OBSERVATION_UPSERT,
  askGapObservation,
  askGapObservationId,
  askGapObservationIssue,
  foldAskGapObservations,
  observationDayStart,
  parseAskGapObservationId,
  pgAskGapObservationSink,
  readAskGapObservations,
  repositoryAskGapObservationSink,
  type AskGapObservation,
  type AskGapObservationSink,
} from "../lib/control-plane/ask-gap-observations.ts";
import {
  installAskGapObservationSinkForTests,
  planAskGapObservations,
  recordAskGapObservations,
  statedAskGaps,
} from "../lib/ask/gap-observation.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { askGapsProvider, type AskGapHoldings, type AskGapMeeting, type CarrierClock } from "../lib/control-plane/scheduler/providers/ask-gaps.ts";
import { buildRegistry } from "../lib/control-plane/scheduler/registry.ts";
import { decideExecutor } from "../lib/control-plane/scheduler/dispatch.ts";
import { isScheduled, scheduleObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { planSupersededRetirement, standing, supersededRetirementReason } from "../lib/control-plane/scheduler/durable.ts";
import { askGapCountWords, askGapRenderedNumbers, assignmentCountClaims, buildAssignments, buildAssignmentView, type AssignmentSources } from "../lib/control-plane/assignment-view.ts";
import { assertAggregateOnly, auditRenderedNumbers, checkStatedEqualsRendered } from "../lib/control-plane/owner-surface.ts";
import { readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import { assertDetailIsAnonymous } from "../lib/db/search-log.ts";
import { enterReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { pimaLegistarOutcomesCandidate } from "../lib/outcomes/data-plane.ts";
import { readOutcomeProjection, resetOutcomeSnapshotCache, useOutcomeSnapshotForTests } from "../lib/outcomes/store.ts";
import type { AgendaDocumentLike } from "../lib/routing/agenda-search.ts";
import type { OutcomeSnapshot } from "../lib/outcomes/types.ts";

/**
 * **A GAP A READER WAS TOLD BECOMES TARGETED WORK — AND NOTHING ABOUT THE
 * READER IS KEPT.** (2026-09-25.)
 *
 * The owner's decision of that day: "Recording the government body behind an
 * unanswered Ask question is approved. Record the body identifier and
 * necessary work metadata so the system can create targeted work to fill the
 * information gap. This does not approve new storage of personal information,
 * raw question histories, or tracking individual readers. Verify that the
 * recorded gap creates useful work and that acquired information can improve
 * subsequent answers."
 *
 * These tests run the REAL grounded Ask route, the REAL `ask-gaps` provider,
 * and the REAL routine promotion door, offline, over the committed seeds. The
 * only substitutions: the observation store is the in-memory aggregate
 * repository (the same contract as the control plane's table), and the
 * promoted outcome projection is handed to the route in-process rather than
 * read back through the reader edge.
 */

await Promise.all([initializeFederalVoteFirstSeed(), installRegistryRuntimeFirstSeeds(), installOutcomeFirstSeed()]);
delete process.env.ANTHROPIC_API_KEY;

const { POST, resetGroundedState } = await import("@/app/api/ask/grounded/route");

const NOW_ISO = "2026-09-24T12:00:00.000Z";
const NOW = Date.parse(NOW_ISO);
const DAY = "2026-09-24";
const PIMA_BOARD = "ocd-division/country:us/state:az/county:pima#governing";
const MARANA = "ocd-division/country:us/state:az/place:marana#governing";
const AZ = "ocd-division/country:us/state:az";
const PIMA_READER = [AZ, "ocd-division/country:us/state:az/county:pima"];
const QUESTION = "is pima county voting on data centers";

const seed = JSON.parse(readFileSync("data/meetings-snapshot.json", "utf8")) as { meetings: AskGapMeeting[]; agendaDocuments: AgendaDocumentLike[] };
const outcomeSeed = JSON.parse(readFileSync("data/states/az/outcomes/legistar-outcomes.json", "utf8")) as OutcomeSnapshot;

/** Every carrying read on cadence: this suite is about what readers were told, not about a late read. */
const onCadence = (): CarrierClock => ({
  kind: "READ",
  lastSucceededAt: "2026-09-24T11:30:00.000Z",
  lastAttemptedAt: "2026-09-24T11:30:00.000Z",
  requiredEveryMs: 3_600_000,
  nextReadDueAt: "2026-09-24T12:30:00.000Z",
});

function holdings(over: Partial<AskGapHoldings> = {}): AskGapHoldings {
  return {
    source: "the committed snapshot",
    meetings: seed.meetings,
    documents: seed.agendaDocuments,
    sittings: outcomeSeed.sittings,
    outcomesUnreadable: null,
    clockOf: onCadence,
    ...over,
  };
}

type Observed = Awaited<ReturnType<typeof readAskGapObservations>>;
const enumerate = (h: AskGapHoldings, observed?: Observed) =>
  buildRegistry([askGapsProvider({ holdings: () => h, ...(observed ? { observations: () => observed } : {}) })], { root: ".", nowIso: NOW_ISO });


interface AskPayload {
  mode: string;
  answer: string | null;
  subject: { id: string } | null;
  gaps: { whose: string; statement: string; code?: string; bodyId?: string }[];
}

/** The reader's request, with everything a request can carry about a person: an address, a cookie, a key, a place. */
async function ask(question: string, options: { readonly synthetic?: boolean; readonly ocdIds?: readonly string[]; readonly zip?: string } = {}): Promise<AskPayload> {
  resetGroundedState();
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://wtp.test",
      host: "wtp.test",
      "x-forwarded-for": "203.0.113.77",
      "user-agent": "PrivacyProbe/9.9",
      cookie: "wtp.reaction_key=cookie-5c1e",
      ...(options.synthetic ? { "x-wtp-synthetic-run": "ask-gap-observation-test" } : {}),
    },
    body: JSON.stringify({
      question,
      ocdIds: options.ocdIds ?? PIMA_READER,
      approximateLocation: options.zip ?? "85701",
      surface: "MAP",
      today: DAY,
      continuityKey: "continuity-9d2b",
    }),
  }));
  assert.equal(response.status, 200);
  return await response.json() as AskPayload;
}

/** Install an in-memory observation store for one test, on the pinned clock. */
function observationStore() {
  const repos = createMemoryRepositories();
  installAskGapObservationSinkForTests(repositoryAskGapObservationSink(repos.askGapObservations), { now: () => NOW_ISO });
  return repos.askGapObservations;
}

/* ================================================================ the record */

test("an observation is exactly a body, a gap code, its record class, a UTC day and a count — and the id says the same", () => {
  const one = askGapObservation({ bodyId: PIMA_BOARD, code: "AGENDA_NOT_HELD" }, "2026-09-24T23:59:59.000-07:00");
  assert.deepEqual(one, { bodyId: PIMA_BOARD, code: "AGENDA_NOT_HELD", recordClass: "MEETING", day: "2026-09-25", count: 1 }, "the UTC day of the instant, never the instant");
  assert.deepEqual(Object.keys(one).sort(), [...ASK_GAP_OBSERVATION_FIELDS].sort());
  const id = askGapObservationId(PIMA_BOARD, "AGENDA_NOT_HELD", "2026-09-25");
  assert.equal(id, `${PIMA_BOARD}#AGENDA_NOT_HELD#2026-09-25`);
  assert.deepEqual(parseAskGapObservationId(id), { bodyId: PIMA_BOARD, code: "AGENDA_NOT_HELD", day: "2026-09-25" }, "a body id may itself carry '#'");
  assert.equal(parseAskGapObservationId(`${PIMA_BOARD}#NOT_A_CODE#2026-09-25`), null);
  assert.equal(observationDayStart("2026-09-25"), "2026-09-25T00:00:00.000Z");

  // A question cannot ride in through the body id, and no other field is held.
  assert.throws(() => askGapObservation({ bodyId: "is pima county voting on data centers", code: "AGENDA_NOT_HELD" }, NOW_ISO), /ASK_GAP_OBSERVATION_REFUSED: bodyId/);
  assert.throws(() => askGapObservation({ bodyId: "ocd-division/country:us/state:az/county:pima#governing jane@example.com", code: "AGENDA_NOT_HELD" }, NOW_ISO), /bodyId/);
  assert.throws(() => askGapObservation({ bodyId: PIMA_BOARD, code: "NOT_A_CODE" as never }, NOW_ISO), /REFUSED/);
  for (const extra of ["question", "questionText", "ip", "userAgent", "sessionId", "continuityKey", "approximateLocation", "ocdIds", "runId", "occurredAt"]) {
    assert.match(askGapObservationIssue({ ...one, [extra]: "x" }) ?? "", /holds exactly bodyId, code, count, day, recordClass/, `${extra} is refused`);
  }
  assert.match(askGapObservationIssue({ ...one, recordClass: "MEETING_OUTCOME" }) ?? "", /recordClass/);
  assert.match(askGapObservationIssue({ ...one, day: "2026-09-25T10:00:00Z" }) ?? "", /day/);
  assert.match(askGapObservationIssue({ ...one, count: 0 }) ?? "", /count/);
});

test("repeated asks raise one row's count, the stored stamp is the day's start, and a lost race is retried rather than dropped", async () => {
  const repos = createMemoryRepositories();
  const sink = repositoryAskGapObservationSink(repos.askGapObservations);
  const one = askGapObservation({ bodyId: PIMA_BOARD, code: "CALENDAR_STALE" }, NOW_ISO);
  await Promise.all([sink.record([one]), sink.record([one]), sink.record([one])]);
  const rows = await repos.askGapObservations.list();
  assert.equal(rows.length, 1, "three asks the same day are one row");
  assert.deepEqual(rows[0]!.value, { ...one, count: 3 });
  assert.equal(rows[0]!.revision, 3);
  assert.equal(rows[0]!.updatedAt, "2026-09-24T00:00:00.000Z", "no instant finer than the day is stored");
  // Another day is another row.
  await sink.record([askGapObservation({ bodyId: PIMA_BOARD, code: "CALENDAR_STALE" }, "2026-09-25T09:00:00.000Z")]);
  assert.equal((await repos.askGapObservations.list()).length, 2);
});

test("the Postgres sink sends one bounded atomic upsert per observation, and refuses a non-observation before any SQL is sent", async () => {
  const calls: { text: string; params: readonly unknown[] | undefined }[] = [];
  const sql = { query: async (text: string, params?: readonly unknown[]) => { calls.push({ text, params }); return [{ revision: 1 }]; } };
  const sink = pgAskGapObservationSink("postgres://never-contacted.invalid/db", { sql });
  const one = askGapObservation({ bodyId: MARANA, code: "MEETINGS_NOT_HELD" }, NOW_ISO);
  assert.equal(await sink.record([one]), 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.text, ASK_GAP_OBSERVATION_UPSERT);
  assert.match(ASK_GAP_OBSERVATION_UPSERT, /^INSERT INTO cp_ask_gap_observations .* ON CONFLICT \(id\) DO UPDATE SET revision = cp_ask_gap_observations\.revision \+ 1/);
  assert.deepEqual(calls[0]!.params?.slice(0, 2), [askGapObservationId(MARANA, "MEETINGS_NOT_HELD", DAY), "2026-09-24T00:00:00.000Z"]);
  assert.deepEqual(JSON.parse(calls[0]!.params![2] as string), one, "the stored value is the observation, and only it");

  await assert.rejects(sink.record([{ ...one, question: "is marana meeting" } as unknown as AskGapObservation]), /ASK_GAP_OBSERVATION_REFUSED/);
  assert.equal(calls.length, 1, "nothing was sent for the refused value");
});

test("the window: the last 30 days fold into asks and days per body and gap, and a malformed row is counted as refused, never as an ask", () => {
  const at = (day: string, code: "AGENDA_NOT_HELD" | "CALENDAR_STALE", count: number): AskGapObservation =>
    ({ ...askGapObservation({ bodyId: PIMA_BOARD, code }, `${day}T12:00:00.000Z`), count });
  const folded = foldAskGapObservations([
    at("2026-08-25", "AGENDA_NOT_HELD", 9), // the 31st day back: outside
    at("2026-08-26", "AGENDA_NOT_HELD", 2),
    at("2026-09-24", "AGENDA_NOT_HELD", 3),
    at("2026-09-24", "CALENDAR_STALE", 1),
    { bodyId: PIMA_BOARD, code: "AGENDA_NOT_HELD", day: DAY, count: 1, question: "smuggled" },
  ], NOW_ISO);
  assert.equal(folded.fromDay, "2026-08-26");
  assert.equal(folded.refused, 1);
  assert.deepEqual(folded.asked.get(`${PIMA_BOARD}#AGENDA_NOT_HELD`), {
    bodyId: PIMA_BOARD, code: "AGENDA_NOT_HELD", recordClass: "MEETING", asks: 5, days: 2, firstDay: "2026-08-26", lastDay: DAY,
  });
  assert.equal(folded.asked.get(`${PIMA_BOARD}#CALENDAR_STALE`)?.asks, 1);
});

/* ================================================================ the route */

test("PRIVACY: an Ask stores nothing of the question, the reader, their place or their request — only the body, the gap, the day and the count", async () => {
  const store = observationStore();
  try {
    // A reader in Mesa, with an address and an email in the question, asks about Pima.
    const question = "My email is jane.doe@example.com and I live at 12 Oak St. Is Pima County voting on data centers?";
    const reader = [AZ, "ocd-division/country:us/state:az/county:maricopa", "ocd-division/country:us/state:az/place:mesa"];
    const body = await ask(question, { ocdIds: reader, zip: "85201" });
    assert.equal(body.subject?.id, PIMA_BOARD);
    const rows = await store.list();
    assert.ok(rows.length > 0, "the answer stated coded gaps, so it recorded them");
    const stored = JSON.stringify(rows);
    for (const personal of [
      "jane", "example.com", "Oak St", "data center", "voting", // the question
      "85201", "place:mesa", "county:maricopa", // where the reader is
      "203.0.113.77", "PrivacyProbe", "cookie-5c1e", "continuity-9d2b", // the request
      "T12:00", // any instant finer than the day
    ]) {
      assert.ok(!stored.toLowerCase().includes(personal.toLowerCase()), `the store holds '${personal}': ${stored}`);
    }
    for (const row of rows) {
      assert.deepEqual(Object.keys(row.value).sort(), [...ASK_GAP_OBSERVATION_FIELDS].sort(), row.id);
      assert.equal(askGapObservationIssue(row.value), null);
      assert.equal(row.id, askGapObservationId(row.value.bodyId, row.value.code, row.value.day));
      assert.equal(row.updatedAt, observationDayStart(row.value.day));
      // The product's two existing identifier guards agree: the control plane's aggregate-only guard and the search log's key guard.
      assert.doesNotThrow(() => assertAggregateOnly(row.value, "an Ask-gap observation"));
      assert.doesNotThrow(() => assertDetailIsAnonymous(row.value as unknown as Record<string, string | number | boolean>));
    }
    assert.ok(rows.every((row) => row.value.bodyId === PIMA_BOARD), "the body asked about, never the reader's own");
  } finally {
    installAskGapObservationSinkForTests("restore");
  }
});

test("PRIVACY: the route hands the plan the stated gaps and the run class — no question, request, place or key reaches it", () => {
  const source = readFileSync("app/api/ask/grounded/route.ts", "utf8");
  const start = source.indexOf("planAskGapObservations({");
  assert.ok(start > 0);
  const call = source.slice(start, source.indexOf("});", start) + 3);
  assert.equal(
    call.replace(/\s+/g, " "),
    "planAskGapObservations({ stated: statedAskGaps({ gaps: packGaps, timelines: topicTimeline ? [topicTimeline] : areaTimelines }), runClass: markerFromRequest(request).runClass, });",
    "the only inputs are the delivered gaps, the timelines they came from, and whether this is a reader",
  );
});

test("a synthetic run, an edge-only context, and an answer with no coded gap record nothing — by name", async () => {
  const store = observationStore();
  try {
    await ask(QUESTION, { synthetic: true });
    assert.deepEqual(await store.list(), [], "a declared synthetic run is not a reader");

    const stated = [{ bodyId: PIMA_BOARD, code: "AGENDA_NOT_HELD" as const }];
    assert.deepEqual(planAskGapObservations({ stated: [], runClass: "ORGANIC", nowIso: NOW_ISO }).kind, "SKIPPED");
    assert.equal((planAskGapObservations({ stated, runClass: "SYNTHETIC", nowIso: NOW_ISO }) as { why?: string }).why, "NOT_A_READER");
    /* The keep-warm context, entered in a callback of its own so it cannot outlive it (AsyncLocalStorage.enterWith). */
    const edgeOnly = await new Promise<ReturnType<typeof planAskGapObservations>>((resolve) => setImmediate(() => {
      enterReaderAuthorityEdge({ edgeOnly: true });
      resolve(planAskGapObservations({ stated, runClass: "ORGANIC", nowIso: NOW_ISO }));
    }));
    assert.equal(edgeOnly.kind, "SKIPPED");
    assert.equal((edgeOnly as { why?: string }).why, "EDGE_ONLY_CONTEXT", "the keep-warm context never reaches a database");
    assert.equal(planAskGapObservations({ stated, runClass: "ORGANIC", nowIso: NOW_ISO }).kind, "RECORD", "and the refusal did not leak out of that context");
    assert.equal((await recordAskGapObservations(edgeOnly)).kind, "SKIPPED");
    assert.deepEqual(await store.list(), []);
  } finally {
    installAskGapObservationSinkForTests("restore");
  }
});

test("a store that fails never reaches the reader: the same answer is delivered and the failure is named", async () => {
  installAskGapObservationSinkForTests(null);
  const baseline = await ask(QUESTION);
  const failing: AskGapObservationSink = { describe: "a failing store", record: async () => { throw Object.assign(new Error("relation does not exist; postgres://user:secret@host/db"), { name: "NeonDbError", code: "42P01" }); } };
  installAskGapObservationSinkForTests(failing, { now: () => NOW_ISO });
  try {
    const failed = await ask(QUESTION);
    assert.equal(failed.answer, baseline.answer);
    assert.deepEqual(failed.gaps, baseline.gaps);
    const outcome = await recordAskGapObservations(planAskGapObservations({ stated: [{ bodyId: PIMA_BOARD, code: "CALENDAR_STALE" }], runClass: "ORGANIC", nowIso: NOW_ISO }));
    assert.deepEqual(outcome, { kind: "FAILED", detail: "NeonDbError (42P01)" }, "named by error name and code; the driver message, which can carry a connection string, is not repeated");
  } finally {
    installAskGapObservationSinkForTests("restore");
  }
  // Outside production with no sink installed, nothing is written anywhere.
  const none = await recordAskGapObservations(planAskGapObservations({ stated: [{ bodyId: PIMA_BOARD, code: "CALENDAR_STALE" }], runClass: "ORGANIC", nowIso: NOW_ISO }));
  assert.equal(none.kind, "SKIPPED");
  assert.equal((none as { why?: string }).why, "NO_STORE");
});

test("stated gaps: a coded sentence counts, a timeline's 'outcome not read' counts when an entry says it, and each body and code counts once", () => {
  const stated = statedAskGaps({
    gaps: [
      { whose: "OURS", statement: "a", code: "AGENDA_NOT_HELD", bodyId: PIMA_BOARD, recordClass: "MEETING" },
      { whose: "OURS", statement: "b", code: "AGENDA_NOT_HELD", bodyId: PIMA_BOARD, recordClass: "MEETING" },
      { whose: "OURS", statement: "an uncoded gap" },
    ],
    timelines: [
      { entries: [{ status: "OUTCOME_NOT_READ" }], heldGaps: [{ code: "OUTCOME_NOT_READ", bodyId: MARANA }] },
      { entries: [{ status: "PASSED" }], heldGaps: [{ code: "OUTCOME_NOT_READ", bodyId: "ocd-division/country:us/state:az/place:mesa#governing" }] },
    ],
  });
  assert.deepEqual(stated, [{ bodyId: PIMA_BOARD, code: "AGENDA_NOT_HELD" }, { bodyId: MARANA, code: "OUTCOME_NOT_READ" }]);
});

/* ================================================================ end to end */

test("END TO END: a reader told Pima's September 22 agenda is not held is counted, the runner puts that gap first, the routine door promotes the record, and the same Ask answers from it", async () => {
  const store = observationStore();
  try {
    // 1 · The Ask names the unread sitting, and records one row per stated (body, gap).
    const first = await ask(QUESTION);
    assert.equal(first.subject?.id, PIMA_BOARD);
    assert.equal(first.mode, "GROUNDED_COMPOSED");
    assert.ok(first.gaps.some((g) => g.code === "AGENDA_NOT_HELD" && g.bodyId === PIMA_BOARD && /September 22nd, 2026/.test(g.statement)), JSON.stringify(first.gaps));
    const statedCodes = [...new Set(first.gaps.flatMap((g) => (g.code ? [g.code] : [])))].sort();
    let rows = await store.list();
    assert.deepEqual(rows.map((r) => r.id).sort(), statedCodes.map((code) => `${PIMA_BOARD}#${code}#${DAY}`).sort(), "one row per stated body and gap");
    const agendaId = askGapObservationId(PIMA_BOARD, "AGENDA_NOT_HELD", DAY);
    assert.deepEqual(rows.find((r) => r.id === agendaId)?.value, { bodyId: PIMA_BOARD, code: "AGENDA_NOT_HELD", recordClass: "MEETING", day: DAY, count: 1 });

    await ask(QUESTION);
    rows = await store.list();
    assert.equal(rows.length, statedCodes.length, "a second reader adds no row");
    assert.equal(rows.find((r) => r.id === agendaId)?.value.count, 2, "it raises the count");

    // 2 · The runner's provider: the told gap is reader impact now, and its evidence says how often readers met it.
    const observed = await readAskGapObservations(store);
    assert.ok(!("unreadable" in observed));
    const plain = enumerate(holdings());
    const told = enumerate(holdings(), observed);
    assert.deepEqual(told.units.map((u) => u.obligation.id).sort(), plain.units.map((u) => u.obligation.id).sort(), "an ask reorders held work; it invents no Pima row");
    const before = unitOf(plain, PIMA_BOARD, "AGENDA_NOT_HELD");
    const after = unitOf(told, PIMA_BOARD, "AGENDA_NOT_HELD");
    assert.equal(before.obligation.readerImpactAt, "2026-10-13T17:00:00-07:00", "without an ask: the next sitting is the deadline");
    assert.equal(after.obligation.readerImpactAt, "2026-09-24T00:00:00.000Z", "a reader was told it today: reader impact now");
    const scheduled = (u: typeof before) => {
      const s = scheduleObligation(u.obligation, NOW);
      assert.ok(isScheduled(s));
      return s;
    };
    assert.ok(scheduled(before).cadenceHours > 24 * 7, `before: ${scheduled(before).cadenceHours}h`);
    assert.equal(scheduled(after).cadenceHours, 0.25, "after: checked every fifteen minutes");
    assert.equal(scheduled(after).cadenceSource, "READER_IMPACT");
    assert.equal(after.route.open.kind, "ROUTINE_READ");
    if (after.route.open.kind === "ROUTINE_READ") {
      assert.match(after.route.open.reason, /Readers were told this 2 times on 1 day in the last 30 days, most recently 2026-09-24\./);
      assert.match(after.route.open.reason, /2026-09-22 \([\w-]+:pima:\d+; held/, "the evidence names the unread sitting");
      assert.deepEqual(after.route.open.contractIds, before.route.open.kind === "ROUTINE_READ" ? before.route.open.contractIds : [], "the same carrying read; an ask never adds a second clock");
    }
    const calendar = unitOf(told, PIMA_BOARD, "CALENDAR_STALE");
    assert.equal(unitOf(plain, PIMA_BOARD, "CALENDAR_STALE").obligation.readerImpactAt, null);
    assert.equal(calendar.obligation.readerImpactAt, "2026-09-24T00:00:00.000Z", "a told stale calendar gains a deadline it never had");
    assert.equal(decideExecutor({ routeId: after.route.routeId, descriptor: after.route, maturity: () => "UNGRADUATED" }).kind, "DETERMINISTIC", "never a model and never the paid lane");

    // 3 · The fixture acquisition, through the normal routine door, with its reader readback.
    const routine = new MemoryRoutineDataStore();
    const candidate = pimaLegistarOutcomesCandidate({
      snapshot: { ...outcomeSeed, sittings: [september22Sitting(), ...outcomeSeed.sittings] },
      acquisitions: [{
        source: "pima-legistar-outcomes",
        requestedUrl: "https://webapi.legistar.com/v1/pima/events?$top=1000",
        finalUrl: "https://webapi.legistar.com/v1/pima/events?$top=1000",
        httpStatus: 200,
        rawHash: "b".repeat(64),
        byteCount: 123,
      }],
      retrievedAt: "2026-09-24T12:04:00.000Z",
      sourceThrough: "2026-09-24T12:03:00.000Z",
    });
    const promoted = await processRegisteredRoutineCandidate(routine, "pima-legistar-outcomes", candidate, "2026-09-24T12:05:00.000Z");
    assert.equal(promoted.candidate.state, "PROMOTED");
    assert.equal(promoted.readerReadback?.status, "PASS");
    const read = await readOutcomeProjection({ store: routine, bypassCache: true });
    assert.equal(read.kind, "PROMOTED");
    if (read.kind !== "PROMOTED") return;

    // The runner, reading the promoted record: September 22 is no longer owed.
    const held = unitOf(enumerate(holdings({ sittings: read.value.sittings }), observed), PIMA_BOARD, "AGENDA_NOT_HELD");
    assert.ok(held.route.open.kind === "ROUTINE_READ" && !/2026-09-22/.test(held.route.open.reason), "the read holds September 22's agenda; only the upcoming sitting is still owed");

    // 4 · The same Ask, answered from the promoted record.
    useOutcomeSnapshotForTests(read.value);
    const again = await ask(QUESTION);
    assert.match(again.answer ?? "", /^On September 22nd, 2026, the Pima County Board Of Supervisors passed agenda item 18 \(File ID 20801\), "Moratorium on Data Center Development"/);
    assert.ok(!again.gaps.some((g) => /September 22nd/.test(g.statement)), "no reader is told September 22 is unread any more");
  } finally {
    useOutcomeSnapshotForTests(null);
    resetOutcomeSnapshotCache();
    installAskGapObservationSinkForTests("restore");
  }
});

test("CREATES: a body readers were told we hold no meeting of gets its own work, owned by engineering, and it retires once a meeting is held", async () => {
  const store = observationStore();
  try {
    const body = await ask("when does the marana town council meet next");
    assert.equal(body.subject?.id, MARANA);
    assert.ok(body.gaps.some((g) => g.code === "MEETINGS_NOT_HELD" && g.bodyId === MARANA && g.statement === "We don't have Marana's calendar yet."));
    const observed = await readAskGapObservations(store);
    assert.ok(!("unreadable" in observed));
    assert.deepEqual(observed.rows, [{ bodyId: MARANA, code: "MEETINGS_NOT_HELD", recordClass: "MEETING", day: DAY, count: 1 }]);

    assert.equal(enumerate(holdings()).units.some((u) => u.obligation.subjectId === MARANA), false, "the held reading alone never sees Marana");
    const pass = enumerate(holdings(), observed);
    const unit = unitOf(pass, MARANA, "MEETINGS_NOT_HELD");
    assert.equal(unit.obligation.recordClass, "ask-gap");
    assert.equal(unit.obligation.readerImpactAt, "2026-09-24T00:00:00.000Z");
    assert.equal(unit.route.open.kind, "NOT_MACHINE_EXECUTABLE", "no partition of Marana's own is registered, and a state's derived family is not taken as reading it");
    assert.equal(unit.route.awaitingAdapter, "Marana: meeting calendar route");
    assert.equal(unit.route.executorClass, "DETERMINISTIC");
    if (unit.route.open.kind === "NOT_MACHINE_EXECUTABLE") {
      assert.match(unit.route.open.reason, /we have not recorded any meetings for this body/);
      assert.match(unit.route.open.reason, /Readers were told this 1 time on 1 day in the last 30 days, most recently 2026-09-24\./);
    }

    // A meeting of Marana is held: the gap is closed, the telling does not reopen it, and the superseded path retires the row.
    const maranaMeeting: AskGapMeeting = { id: "civicclerk:marana:1", bodyId: MARANA, startsAt: "2026-10-06T18:00:00-07:00", timeZone: "America/Phoenix", agendaUrl: null, provenance: { collectedAt: "2026-09-24T11:00:00.000Z" } };
    const closed = enumerate(holdings({ meetings: [...seed.meetings, maranaMeeting] }), observed);
    assert.equal(closed.units.some((u) => u.obligation.id === unit.obligation.id), false);
    const plan = planSupersededRetirement({
      outside: [standing(unit.obligation, NOW_ISO)],
      corpus: closed.units.map((u) => ({ providerId: u.providerId, obligationId: u.obligation.id })),
      providers: closed.byProvider,
    });
    assert.deepEqual(plan.retire, [{ obligationId: unit.obligation.id, reason: supersededRetirementReason("ask-gaps") }]);

    // Observations that could not be read are a named read failure: nothing retires on that reading.
    const down = enumerate(holdings(), { unreadable: "connect timeout" });
    assert.match(down.byProvider[0]!.readFailure ?? "", /the Ask-gap observations could not be read \(connect timeout\)/);
    const held = planSupersededRetirement({
      outside: [standing(unit.obligation, NOW_ISO)],
      corpus: down.units.map((u) => ({ providerId: u.providerId, obligationId: u.obligation.id })),
      providers: down.byProvider,
    });
    assert.deepEqual(held.retire, []);
  } finally {
    installAskGapObservationSinkForTests("restore");
  }
});

/* ================================================================ Admin */

function sources(obligations: AssignmentSources["obligations"], askGapObservations: AssignmentSources["askGapObservations"]): AssignmentSources {
  return {
    nowIso: NOW_ISO, obligations, occurrences: [], workItems: [], routeTasks: [], attempts: [], debts: [], leases: [], dispositions: null,
    artifacts: [], costs: [], scoutResults: [], workerResults: [], pipeline: [], activation: readActivationGate(""), servedReader: null, pilotZips: ["85701"],
    ...(askGapObservations !== undefined ? { askGapObservations } : {}),
  };
}

test("ADMIN: Work states how often readers were told each open Ask gap — per body and gap — and every number it draws carries its denominator", () => {
  const rows: AskGapObservation[] = [
    { ...askGapObservation({ bodyId: PIMA_BOARD, code: "AGENDA_NOT_HELD" }, NOW_ISO), count: 3 },
    { ...askGapObservation({ bodyId: PIMA_BOARD, code: "AGENDA_NOT_HELD" }, "2026-09-20T12:00:00.000Z"), count: 1 },
    askGapObservation({ bodyId: MARANA, code: "MEETINGS_NOT_HELD" }, NOW_ISO),
  ];
  const pass = enumerate(holdings(), { rows, source: "fixture rows" });
  const obligations = pass.units.map((u) => standing(u.obligation, NOW_ISO));
  const view = buildAssignmentView(sources(obligations, rows));
  const counted = view.summary.askGaps;
  assert.ok(counted?.held);
  if (!counted?.held) return;
  assert.equal(counted.value.told?.gaps.value, 2, "two open gaps were told to a reader");
  assert.equal(counted.value.told?.gaps.denominator, counted.value.open);
  assert.deepEqual(counted.value.told?.mostTold.map((t) => [t.bodyId, t.code, t.asks.value, t.asks.denominator, t.lastDay]), [
    [PIMA_BOARD, "AGENDA_NOT_HELD", 4, 5, DAY],
    [MARANA, "MEETINGS_NOT_HELD", 1, 5, DAY],
  ]);
  const words = askGapCountWords(view);
  assert.match(words, /meetings not held 1\./);
  assert.match(words, /Readers were told 2 of them in the last 30 days; most told: Pima County — Governing, agenda not held — 4 of 5 tellings, latest 2026-09-24 · Marana — Governing, meetings not held — 1 of 5 tellings, latest 2026-09-24\.$/);
  assert.ok(auditRenderedNumbers(askGapRenderedNumbers(view)).ok);
  assert.ok(checkStatedEqualsRendered(assignmentCountClaims(view)).ok);

  // The row itself says it, in the obligation's own words.
  const row = buildAssignments(sources(obligations, rows)).find((r) => r.id === `freshness:ask-gap:${PIMA_BOARD}#AGENDA_NOT_HELD`);
  assert.match(row?.what.why.says ?? "", /Readers were told this 4 times on 2 days in the last 30 days, most recently 2026-09-24\.$/);
  const untold = buildAssignments(sources(obligations, rows)).find((r) => r.id === `freshness:ask-gap:${PIMA_BOARD}#CALENDAR_STALE`);
  assert.match(untold?.what.why.says ?? "", /No reader was told it in the last 30 days\.$/);

  // Not read is said as not read — never as nobody told.
  const unread = buildAssignmentView(sources(obligations, null));
  assert.match(askGapCountWords(unread), /How often readers were told them is not on this list: the Ask-gap observations were not read for it\./);
  assert.doesNotMatch(buildAssignments(sources(obligations, null)).find((r) => r.id === `freshness:ask-gap:${PIMA_BOARD}#AGENDA_NOT_HELD`)?.what.why.says ?? "", /Readers were told|No reader/);
});
