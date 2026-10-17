import {stateBallotContractId} from "../lib/civic-data/state-scopes.ts";
import { currentReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import assert from "node:assert/strict";
import test from "./helpers/playbooks.ts";
import { installAbsent, installFederalVotes, installPimaLocalFinance, installRegistryAuthority, installStateMoney } from "./helpers/promoted-fixtures.ts";
import { installMeetings, installPimaOutcomes } from "./helpers/reader-fixtures.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { AZ_OFFICIAL_ACTIONS_CONTRACT } from "../lib/outcomes/data-plane.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";

await installRegistryAuthority();
await installFederalVotes();
await installPimaOutcomes();
for (const state of ["AZ","NH","NJ"] as const) for(const family of ["ballot-contests","candidate-profiles","candidate-corpus"] as const) {
  const contract=requiredManualProductionContract(stateBallotContractId(family,state));
  installAbsent(contract.recordClass,contract.scope);
}
const statements=requiredManualProductionContract("officeholder-statements");
installAbsent(statements.recordClass,statements.scope);

for (const state of ["AZ", "NH", "NJ"] as const) await installStateMoney(state);
await installPimaLocalFinance();
installMeetings([]);
const funding = requiredRoutineContract("fec-funding");
installAbsent(funding.recordClass, funding.scope);
installAbsent(AZ_OFFICIAL_ACTIONS_CONTRACT.recordClass, AZ_OFFICIAL_ACTIONS_CONTRACT.scope);

import { codeBestReading, speculationVerdict, type ReadingOutcome } from "../lib/ask/speculative-reading.ts";
import { synthesizeWithLadder } from "../lib/ask/synthesize.ts";
import { ASK_FAST_WRITER_MODEL } from "../lib/ask/model.ts";
import type { EvidencePack } from "../lib/ask/evidence.ts";
import type { BindableEntity } from "../lib/routing/named-entity.ts";

const MESA = "ocd-division/country:us/state:az/place:mesa#governing";
const MESA_SCHOOLS = "ocd-division/country:us/state:az/school_district:mesa_unified_district#board";
const INVENTORY: BindableEntity[] = [
  { id: MESA, name: "Mesa", nameClass: "body", divisionType: "place", level: "BODY" } as BindableEntity,
  { id: MESA_SCHOOLS, name: "Mesa Unified School District Governing Board", nameClass: "body", divisionType: "school_district", level: "BODY" } as BindableEntity,
];
const PRIOR_MESA = [{ id: MESA, name: "Mesa", kind: "BODY" as const }];

test("the code's best reading: a guess from the reader's words, the page or the earlier turn — never for a question nothing binds", () => {
  const read = (question: string, priorSubjects: typeof PRIOR_MESA = [], activeSubjects: { id: string; name: string; kind: "BODY"; focused?: boolean }[] = []) => {
    const reading = codeBestReading({ question, inventory: INVENTORY, priorSubjects, activeSubjects });
    return reading && { intent: reading.interpretation.intent, temporal: reading.interpretation.temporal.kind, basis: reading.basis, subject: reading.subjectId, mentions: reading.interpretation.entityMentions.length, referent: reading.interpretation.referent };
  };
  assert.deepEqual(read("Who can I talk to at the Mesa City Council?"), { intent: "CONTACT", temporal: "NONE", basis: "WORDING", subject: MESA, mentions: 0, referent: null });

  assert.deepEqual(read("How do I contact the Mesa City Council?"), { intent: "CONTACT", temporal: "NONE", basis: "SHAPE", subject: MESA, mentions: 0, referent: null });

  assert.deepEqual(read("When does it meet next?", PRIOR_MESA), { intent: "MEETING_TIME", temporal: "NEXT", basis: "SHAPE", subject: MESA, mentions: 0, referent: null });
  assert.deepEqual(read("When do they meet next?", PRIOR_MESA), { intent: "MEETING_TIME", temporal: "NEXT", basis: "SHAPE", subject: MESA, mentions: 0, referent: "Mesa" });
  assert.deepEqual(read("How did they vote last time?", PRIOR_MESA), { intent: "PAST_MEETING", temporal: "LAST", basis: "SHAPE", subject: MESA, mentions: 0, referent: "Mesa" });
  assert.deepEqual(read("What's on their agenda?", PRIOR_MESA), { intent: "UPCOMING_AGENDA", temporal: "NEXT", basis: "SHAPE", subject: MESA, mentions: 0, referent: "Mesa" });
  assert.deepEqual(read("When do they meet next?", [], [{ id: MESA_SCHOOLS, name: "Mesa Unified School District Governing Board", kind: "BODY", focused: true }]), { intent: "MEETING_TIME", temporal: "NEXT", basis: "SHAPE", subject: MESA_SCHOOLS, mentions: 0, referent: "Mesa Unified School District Governing Board" }, "the focused card, when the page has one");

  assert.deepEqual(read("What did the Mesa City Council decide on September 14, 2026?"), { intent: "PAST_MEETING", temporal: "LAST", basis: "WORDING", subject: MESA, mentions: 0, referent: null });

  assert.equal(read("Who can I talk to?"), null, "no subject bound");
  assert.equal(read("When do they meet next?"), null, "a pronoun with no earlier turn binds nothing");
  assert.equal(read("When do they meet next?", [], [{ id: MESA, name: "Mesa", kind: "BODY" }, { id: MESA_SCHOOLS, name: "Mesa Unified School District Governing Board", kind: "BODY" }]), null, "two cards on the page, none focused: no guess");

  assert.deepEqual(read("Tell me something interesting about the Mesa City Council budget process"), { intent: "UNKNOWN", temporal: "NONE", basis: "WORDING", subject: MESA, mentions: 0, referent: null });
});

const AGREED: ReadingOutcome = { subjectId: MESA, bodyIds: [MESA], intent: "CONTACT", temporal: { kind: "NONE" }, selection: "ANY", writerInput: "key-1" };

test("the verdict keeps the speculative answer only on the same subject, body, question kind and writer input — and names the first difference", () => {
  assert.deepEqual(speculationVerdict(AGREED, { ...AGREED, bodyIds: [MESA, MESA] }), { keep: true, why: "same-subject-body-kind-and-writer-input" });
  assert.deepEqual(speculationVerdict(AGREED, { ...AGREED, subjectId: MESA_SCHOOLS, bodyIds: [MESA_SCHOOLS], writerInput: "key-2" }), { keep: false, why: "different-subject" });
  assert.deepEqual(speculationVerdict(AGREED, { ...AGREED, bodyIds: [MESA, MESA_SCHOOLS] }), { keep: false, why: "different-body" });

  assert.deepEqual(speculationVerdict(AGREED, { ...AGREED, intent: "PERSON_RECORD" }), { keep: true, why: "same-subject-body-kind-and-writer-input" });
  assert.deepEqual(speculationVerdict(AGREED, { ...AGREED, temporal: { kind: "NEXT" } }), { keep: false, why: "different-question-kind" });
  assert.deepEqual(speculationVerdict(AGREED, { ...AGREED, selection: "NEXT" }), { keep: false, why: "different-question-kind" });
  assert.deepEqual(speculationVerdict(AGREED, { ...AGREED, temporal: { kind: "RANGE", trailingMonths: 12 } }), { keep: false, why: "different-question-kind" });
  assert.deepEqual(speculationVerdict(AGREED, { ...AGREED, writerInput: "key-2" }), { keep: false, why: "different-writer-input" }, "identical readings with different evidence still discard");
  assert.deepEqual(speculationVerdict(AGREED, "MODEL_READING_UNAVAILABLE"), { keep: false, why: "model-reading-unavailable" });
  assert.deepEqual(speculationVerdict(AGREED, "MODEL_READING_NEEDS_NO_WRITER"), { keep: false, why: "model-reading-needs-no-writer" });
});

test("an abandoned writer stops, and the ladder never escalates past it", async () => {
  const pack: EvidencePack = { question: "q", intent: "CONTACT", temporal: { kind: "NONE" }, subject: null, records: [{ kind: "BODY", id: "b", text: "A body.", sourceUrl: "https://a.example/b" }], gaps: [], denominators: {}, today: "2026-09-25" };
  let made = 0;
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    made += 1;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 1_000);
      init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(Object.assign(new Error("aborted"), { name: "AbortError" })); }, { once: true });
    });
    throw new Error("an abandoned writer must not finish");
  }) as unknown as typeof fetch;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  const result = await synthesizeWithLadder(pack, { apiKey: "k", fetchImpl, signal: controller.signal, validate: () => ({ kind: "PASSED", checked: [] }) });
  assert.equal(made, 1, "the frontier writer was never asked");
  assert.deepEqual(result.attempts.map((attempt) => [attempt.role, attempt.result, attempt.detail]), [["FAST", "UNAVAILABLE", "error: AbortError"]]);
  assert.equal(result.escalation, null);
});

const READING_MS = 1_500;
const WRITING_MS = 1_900;

const AZ = "ocd-division/country:us/state:az";
const PIMA = "ocd-division/country:us/state:az/county:pima";
const VAIL = "ocd-division/country:us/state:az/school_district:vail_unified_district";
const QUESTION = "Who can I talk to at the Vail school board?";

interface Call { kind: "INTERPRET" | "SYNTHESIZE"; model: string; startedAt: number; endedAt?: number; aborted?: boolean }
const calls: Call[] = [];

let reading: Record<string, unknown> | "HTTP_500" = {};

interface Reply { answer: string; citedSources: unknown[] }
type Completion = (signal?: AbortSignal | null) => Promise<void>;
let writerQueue: { reply: Reply; complete: Completion }[] = [];
const PASSING = { answer: "The board's contacts are in the records below.", citedSources: [1] };

function waitForAbort(signal?: AbortSignal | null): Promise<void> {
  return new Promise((_, reject) => {
    const stop = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
  });
}

const delay = (ms: number): Completion => signal => new Promise((resolve, reject) => {
  const stop = () => { clearTimeout(timer); reject(Object.assign(new Error("aborted"), { name: "AbortError" })); };
  const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
  if (signal?.aborted) stop();
  else signal?.addEventListener("abort", stop, { once: true });
});

process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
process.env.ANTHROPIC_API_KEY = "test-stub-not-a-real-key";

process.env.WTP_ASK_HEDGE_MS = "off";
delete process.env.WTP_ASK_SPECULATION;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith("https://api.anthropic.com/")) throw new Error(`speculation test refused an outbound request: ${url}`);
  const body = JSON.parse(String(init?.body)) as { system: unknown; model: string; output_config?: { format?: { schema?: { properties?: Record<string, unknown> } } } };
  const synthesis = body.output_config?.format?.schema?.properties?.answer !== undefined;
  const call: Call = { kind: synthesis ? "SYNTHESIZE" : "INTERPRET", model: body.model, startedAt: performance.now() };
  calls.push(call);
  const queued = synthesis ? writerQueue.shift() : undefined;
  const planned = synthesis ? queued?.reply ?? PASSING : reading;
  try {
    await (queued?.complete ?? delay(synthesis ? WRITING_MS : READING_MS))(init?.signal);
  } catch (error) {
    call.aborted = init?.signal?.aborted;
    call.endedAt = performance.now();
    throw error;
  }
  call.endedAt = performance.now();
  if (planned === "HTTP_500") return new Response(JSON.stringify({ error: { type: "api_error" } }), { status: 500 });
  return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(planned) }], usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

const { POST } = await import("../app/api/ask/grounded/route.ts");
const { resetGroundedState } = await import("../lib/ask/grounded-state.ts");

interface Payload {
  mode: string;
  answer: string | null;
  subject: { id: string } | null;
  trace: {
    interpretation: { ran: boolean; why?: string };
    synthesis: { model?: string };
    speculation?: { ran: boolean; why: string; delivered: string; codeIntent?: string; writerStartedAtMs?: number; aborted?: boolean };
  };
}

async function timedAsk(question: string, extra: Record<string, unknown> = {}): Promise<{ payload: Payload; calls: Call[]; ms: number }> {
  resetGroundedState();
  const before = calls.length;
  const started = performance.now();
  const response = await withReaderAuthorityEdge({...currentReaderAuthorityEdge(),edgeOnly:true}, () => POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://wtp.test", host: "wtp.test", "x-wtp-synthetic-run": "ask-speculative-reading-test" },
    body: JSON.stringify({ question, ocdIds: [AZ, PIMA, VAIL], today: "2026-08-28", ...extra }),
  })));
  const ms = performance.now() - started;
  const text = await response.text();
  assert.equal(response.status, 200, text);

  await new Promise((resolve) => setTimeout(resolve, 50));
  return { payload: JSON.parse(text) as Payload, calls: calls.slice(before), ms };
}

const CONTACT_READING = { intent: "CONTACT", entityMentions: ["Vail school board"], normalizedMentions: ["Vail Unified School District Governing Board"], temporal: { kind: "NONE" }, referent: null };

function modelWindow(calls: readonly Call[]): number {
  return Math.max(...calls.map(call => call.endedAt!)) - Math.min(...calls.map(call => call.startedAt));
}

test("ROUTE: the reading and the writing overlap — the answer arrives in about the longer call, not the sum", { concurrency: false }, async () => {
  reading = CONTACT_READING;
  const on = await timedAsk(QUESTION);
  assert.deepEqual(on.calls.map((call) => call.kind), ["INTERPRET", "SYNTHESIZE"], "one reading, one answer");
  const [read, write] = on.calls;
  assert.ok(write.startedAt < read.endedAt!, "the writer started while the model was still reading");
  assert.equal(write.model, ASK_FAST_WRITER_MODEL);
  assert.equal(on.payload.mode, "GROUNDED_CLAUDE");
  assert.equal(on.payload.answer, PASSING.answer);
  assert.equal(on.payload.trace.interpretation.ran, true, "the model still read the question");
  assert.deepEqual([on.payload.trace.speculation?.ran, on.payload.trace.speculation?.delivered, on.payload.trace.speculation?.why, on.payload.trace.speculation?.codeIntent],
    [true, "SPECULATIVE_ANSWER", "same-subject-body-kind-and-writer-input", "CONTACT"]);

  const onWindow = modelWindow(on.calls);
  assert.ok(onWindow >= WRITING_MS && onWindow < READING_MS + WRITING_MS, `the model calls took ${onWindow.toFixed(0)} ms together: about the longer call, under the sum`);

  process.env.WTP_ASK_SPECULATION = "off";
  try {
    const off = await timedAsk(QUESTION);
    assert.deepEqual(off.calls.map((call) => call.kind), ["INTERPRET", "SYNTHESIZE"]);
    assert.ok(off.calls[1].startedAt >= off.calls[0].endedAt!, "switched off, the writer waits for the reading");
    assert.equal(off.payload.trace.speculation, undefined);
    assert.equal(off.payload.answer, on.payload.answer, "the same answer either way");
    const offWindow = modelWindow(off.calls);
    assert.ok(offWindow >= READING_MS + WRITING_MS, `sequential model calls took ${offWindow.toFixed(0)} ms: the sum`);
    assert.ok(offWindow - onWindow >= READING_MS - 300, `overlap saved ${(offWindow - onWindow).toFixed(0)} ms, about one reading`);
    console.log(`fake-transport totals (reading ${READING_MS} ms, writing ${WRITING_MS} ms): overlapped ${on.ms.toFixed(0)} ms, sequential ${off.ms.toFixed(0)} ms`);
  } finally {
    delete process.env.WTP_ASK_SPECULATION;
  }
});

test("ROUTE: a pronoun follow-up the code cannot read overlaps too, bound to the earlier turn's body", { concurrency: false }, async () => {

  reading = CONTACT_READING;
  const first = await timedAsk(QUESTION);
  const vail = first.payload.subject?.id;
  assert.ok(vail, "precondition: the earlier turn bound the Vail board");
  reading = { intent: "MEETING_TIME", entityMentions: [], normalizedMentions: [], temporal: { kind: "NEXT" }, referent: "Vail Unified School District Governing Board" };
  const followUp = await timedAsk("When do they meet next?", {
    priorSubjects: [{ id: vail, name: "Vail Unified School District Governing Board", kind: "BODY" }],
    priorTurns: [{ question: QUESTION, resolvedSubject: "Vail Unified School District Governing Board" }],
  });
  assert.equal(followUp.payload.subject?.id, vail);
  assert.deepEqual(followUp.calls.map((call) => call.kind), ["INTERPRET", "SYNTHESIZE"]);
  assert.ok(followUp.calls[1].startedAt < followUp.calls[0].endedAt!, "the writer started while the model was still reading");
  assert.equal(followUp.payload.trace.speculation?.delivered, "SPECULATIVE_ANSWER");
  const window = modelWindow(followUp.calls);
  assert.ok(window < READING_MS + WRITING_MS, `the overlapping model calls took ${window.toFixed(0)} ms, under the sum`);
});

test("ROUTE: a model reading that disagrees discards the speculative answer — its call is stopped and the answer is written from the model's reading", { concurrency: false }, async () => {
  reading = { ...CONTACT_READING, temporal: { kind: "LAST" } };
  const SPECULATIVE = { answer: "SPECULATIVE: the board's contacts are in the records below.", citedSources: [1] };
  const MODEL = { answer: "The board's members are in the records below.", citedSources: [1] };
  writerQueue = [{ reply: SPECULATIVE, complete: waitForAbort }, { reply: MODEL, complete: delay(WRITING_MS) }];
  try {
    const result = await timedAsk(QUESTION);
    assert.deepEqual(result.calls.map((call) => call.kind), ["INTERPRET", "SYNTHESIZE", "SYNTHESIZE"], "the speculative writer, then the writer on the model's reading — and no escalation of the stopped one");
    const [read, speculative, written] = result.calls;
    assert.equal(speculative.aborted, true, "the speculative call was stopped");
    assert.ok(speculative.startedAt < read.endedAt!, "it had started during the reading");
    assert.ok(written.startedAt >= read.endedAt!, "the answer that shipped was started from the model's reading");
    assert.equal(result.payload.answer, MODEL.answer, "the speculative answer never reaches the reader");
    assert.deepEqual([result.payload.trace.speculation?.ran, result.payload.trace.speculation?.delivered, result.payload.trace.speculation?.why, result.payload.trace.speculation?.aborted],
      [true, "MODEL_READING", "different-question-kind", true]);
    assert.ok(result.ms >= READING_MS + WRITING_MS, "a discarded guess costs the sequential time, never less correctness");
  } finally {
    writerQueue = [];
  }
});

test("ROUTE: a completed speculative answer is discarded when the model disagrees", { concurrency: false }, async () => {
  reading = { ...CONTACT_READING, temporal: { kind: "LAST" } };
  const SPECULATIVE = { answer: "SPECULATIVE: the board's contacts are in the records below.", citedSources: [1] };
  writerQueue = [{ reply: SPECULATIVE, complete: async () => {} }];
  try {
    const result = await timedAsk(QUESTION);
    assert.deepEqual(result.calls.map(call => call.kind), ["INTERPRET", "SYNTHESIZE", "SYNTHESIZE"]);
    assert.ok(result.calls[1].endedAt! <= result.calls[0].endedAt!);
    assert.notEqual(result.payload.answer, SPECULATIVE.answer);
    assert.equal(result.payload.trace.speculation?.delivered, "MODEL_READING");
    assert.equal(result.payload.trace.speculation?.why, "different-question-kind");
    assert.equal(result.payload.trace.speculation?.aborted, undefined);
  } finally {
    writerQueue = [];
  }
});

test("ROUTE: a model reading that never comes discards the speculative answer too; the route falls back exactly as before", { concurrency: false }, async () => {
  reading = "HTTP_500";
  const SPECULATIVE = { answer: "SPECULATIVE: the board's contacts are in the records below.", citedSources: [1] };
  writerQueue = [{ reply: SPECULATIVE, complete: waitForAbort }];
  try {
    const result = await timedAsk(QUESTION);
    assert.equal(result.payload.trace.interpretation.ran, false, "the deterministic reading stood in");
    assert.deepEqual([result.payload.trace.speculation?.delivered, result.payload.trace.speculation?.why], ["MODEL_READING", "model-reading-unavailable"]);
    assert.notEqual(result.payload.answer, SPECULATIVE.answer);
    assert.deepEqual(result.calls.map((call) => call.kind), ["INTERPRET", "SYNTHESIZE", "SYNTHESIZE"]);
    assert.equal(result.calls[1].aborted, true);
  } finally {
    writerQueue = [];
  }
});

test("ROUTE: nothing is started for a question the code reads itself, or where no model key is configured", { concurrency: false }, async () => {
  reading = CONTACT_READING;
  const lexical = await timedAsk("What does the Vail school board do?");
  assert.equal(lexical.payload.trace.interpretation.why, "lexical-reading");
  assert.deepEqual(lexical.calls.map((call) => call.kind), ["SYNTHESIZE"], "no reading call, one writer");
  assert.equal(lexical.payload.trace.speculation, undefined);

  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const keyless = await timedAsk(QUESTION);
    assert.deepEqual(keyless.calls, [], "no call of any kind");
    assert.equal(keyless.payload.trace.speculation, undefined);
    assert.equal(keyless.payload.answer, null);
  } finally {
    process.env.ANTHROPIC_API_KEY = key;
  }
});
