import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";

import { unitOf } from "./helpers/ask-gap-unit.ts";
import {
  ASK_GAP_OBSERVATION_FIELDS,
  ASK_GAP_OBSERVATION_UPSERT,
  askGapObservation,
  askGapObservationId,
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
import { planSupersededRetirement, standing, supersededRetirementReason } from "../lib/control-plane/scheduler/durable.ts";
import { askGapCountWords, askGapRenderedNumbers, assignmentCountClaims, buildAssignments, buildAssignmentView, type AssignmentSources } from "../lib/control-plane/assignment-view.ts";
import { auditRenderedNumbers, checkStatedEqualsRendered } from "../lib/control-plane/owner-surface.ts";
import { enterReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import type { AgendaDocumentLike } from "../lib/routing/agenda-search.ts";
import type { OutcomeSnapshot } from "../lib/outcomes/types.ts";

delete process.env.ANTHROPIC_API_KEY;

const NOW_ISO = "2026-09-24T12:00:00.000Z";
const NOW = Date.parse(NOW_ISO);
const DAY = "2026-09-24";
const PIMA_BOARD = "ocd-division/country:us/state:az/county:pima#governing";
const MARANA = "ocd-division/country:us/state:az/place:marana#governing";

const seed = JSON.parse(readFileSync("tests/fixtures/ask-topic-timeline.json", "utf8")) as {
  meetings: AskGapMeeting[];
  agendaDocuments: AgendaDocumentLike[];
  sittings: OutcomeSnapshot["sittings"];
};

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
    source: "the fixture holdings",
    meetings: seed.meetings,
    documents: seed.agendaDocuments,
    sittings: seed.sittings,
    outcomesUnreadable: null,
    clockOf: onCadence,
    ...over,
  };
}

type Observed = Awaited<ReturnType<typeof readAskGapObservations>>;
const enumerate = (h: AskGapHoldings, observed?: Observed) =>
  buildRegistry([askGapsProvider({ holdings: () => h, ...(observed ? { observations: () => observed } : {}) })], { root: ".", nowIso: NOW_ISO });


/** Install an in-memory observation store for one test, on the pinned clock. */
function observationStore() {
  const repos = createMemoryRepositories();
  installAskGapObservationSinkForTests(repositoryAskGapObservationSink(repos.askGapObservations), { now: () => NOW_ISO });
  return repos.askGapObservations;
}

test("an observation is exactly a body, a gap code, its record class, a UTC day and a count — and the id says the same", () => {
  const one = askGapObservation({ bodyId: PIMA_BOARD, code: "AGENDA_NOT_HELD" }, "2026-09-24T23:59:59.000-07:00");
  assert.deepEqual(one, { bodyId: PIMA_BOARD, code: "AGENDA_NOT_HELD", recordClass: "MEETING", day: "2026-09-25", count: 1 }, "the UTC day of the instant, never the instant");
  assert.deepEqual(Object.keys(one).sort(), [...ASK_GAP_OBSERVATION_FIELDS].sort());
  const id = askGapObservationId(PIMA_BOARD, "AGENDA_NOT_HELD", "2026-09-25");
  assert.equal(id, `${PIMA_BOARD}#AGENDA_NOT_HELD#2026-09-25`);
  assert.deepEqual(parseAskGapObservationId(id), { bodyId: PIMA_BOARD, code: "AGENDA_NOT_HELD", day: "2026-09-25" }, "a body id may itself carry '#'");
  assert.equal(parseAskGapObservationId(`${PIMA_BOARD}#NOT_A_CODE#2026-09-25`), null);
  assert.equal(observationDayStart("2026-09-25"), "2026-09-25T00:00:00.000Z");

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

test("the Postgres sink sends one bounded atomic upsert per observation", async () => {
  const calls: { text: string; params: readonly unknown[] | undefined }[] = [];
  const sql = { query: async (text: string, params?: readonly unknown[]) => { calls.push({ text, params }); return [{ revision: 1 }]; } };
  const sink = pgAskGapObservationSink("postgres://never-contacted.invalid/db", { sql });
  const one = askGapObservation({ bodyId: MARANA, code: "MEETINGS_NOT_HELD" }, NOW_ISO);
  assert.equal(await sink.record([one]), 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.text, ASK_GAP_OBSERVATION_UPSERT);
  assert.match(ASK_GAP_OBSERVATION_UPSERT, /^INSERT INTO cp_ask_gap_observations .* ON CONFLICT \(id\) DO UPDATE SET revision = cp_ask_gap_observations\.revision \+ 1/);
  assert.match(ASK_GAP_OBSERVATION_UPSERT, /changed_at = now\(\)/, "an aggregate write stamps changed_at, so a changed-since read sees the count move");
  assert.deepEqual(calls[0]!.params?.slice(0, 2), [askGapObservationId(MARANA, "MEETINGS_NOT_HELD", DAY), "2026-09-24T00:00:00.000Z"]);
  assert.deepEqual(JSON.parse(calls[0]!.params![2] as string), one, "the stored value is the observation, and only it");
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

test("a synthetic run and an edge-only context record nothing — by name", async () => {
  const store = observationStore();
  try {
    const stated = [{ bodyId: PIMA_BOARD, code: "AGENDA_NOT_HELD" as const }];
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

test("a store that fails is named by its error, never its message", async () => {
  const failing: AskGapObservationSink = { describe: "a failing store", record: async () => { throw Object.assign(new Error("relation does not exist; postgres://user:secret@host/db"), { name: "NeonDbError", code: "42P01" }); } };
  installAskGapObservationSinkForTests(failing, { now: () => NOW_ISO });
  try {
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
    ],
    timelines: [
      { entries: [{ status: "OUTCOME_NOT_READ" }], heldGaps: [{ code: "OUTCOME_NOT_READ", bodyId: MARANA }] },
      { entries: [{ status: "PASSED" }], heldGaps: [{ code: "OUTCOME_NOT_READ", bodyId: "ocd-division/country:us/state:az/place:mesa#governing" }] },
    ],
  });
  assert.deepEqual(stated, [{ bodyId: PIMA_BOARD, code: "AGENDA_NOT_HELD" }, { bodyId: MARANA, code: "OUTCOME_NOT_READ" }]);
});

test("CREATES: a body readers were told we hold no meeting of gets its own work, owned by engineering, and it retires once a meeting is held", async () => {
  const store = observationStore();
  try {
    await repositoryAskGapObservationSink(store).record([askGapObservation({ bodyId: MARANA, code: "MEETINGS_NOT_HELD" }, NOW_ISO)]);
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

function sources(obligations: AssignmentSources["obligations"], askGapObservations: AssignmentSources["askGapObservations"]): AssignmentSources {
  return {
    nowIso: NOW_ISO, obligations, occurrences: [], workItems: [], routeTasks: [], attempts: [], debts: [], leases: [], dispositions: null,
    artifacts: [], costs: [], scoutResults: [], workerResults: [], pipeline: [], activation: null, servedReader: null, pilotZips: ["85701"],
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
