import assert from "node:assert/strict";
import test from "node:test";
import { installFederalVotes, installRegistryAuthority } from "./helpers/promoted-fixtures.ts";

await installRegistryAuthority();
await installFederalVotes();
import { lengthOnlyRejection, settleRejectedModelAnswer } from "../lib/ask/length-fallback.ts";
import type { ValidationVerdict } from "../lib/ask/validate.ts";

/** The route test answers the model call from a stub: no request leaves the process. */

const PLAIN = "This summary restates only what the held records show and adds nothing to them";

/** Five sentences, 726 characters, no URL, no name, no advice: too long and nothing else. */
function modelAnswerOf726(): string {
  const four = Array.from({ length: 4 }, () => PLAIN).join(". ");
  const fifth = `${". "}Each record below keeps ${"its own public source link ".repeat(30)}`;
  const answer = `${`${four}${fifth}`.slice(0, 725)}.`;
  assert.equal(answer.length, 726);
  return answer;
}

const FAILED = (failed: string[]): Extract<ValidationVerdict, { kind: "FAILED" }> => ({ kind: "FAILED", failed, checked: [] });
const PASSED: ValidationVerdict = { kind: "PASSED", checked: ["within-length-budget"] };

test("R13: a length-only rejection is recognised, and any other failure beside it is not excused", () => {
  assert.equal(lengthOnlyRejection(FAILED(["too-long:726-characters-over-700"])), true);
  assert.equal(lengthOnlyRejection(FAILED(["too-long:6-sentences-over-5", "too-long:726-characters-over-700"])), true);
  assert.equal(lengthOnlyRejection(FAILED(["too-long:726-characters-over-700", "invented-source-url:https://example.test/x"])), false);
  assert.equal(lengthOnlyRejection(FAILED(["voting-advice"])), false);
  assert.equal(lengthOnlyRejection(PASSED), false);
});

test("R13: a length-only rejection falls back to the code-composed answer when the evidence composes one", () => {
  const composed = { answer: "The Board approved the item on September 9, 2026.", citedUrls: ["https://example.gov/agenda.pdf"] };
  const validated: string[] = [];
  const settled = settleRejectedModelAnswer({
    verdict: FAILED(["too-long:726-characters-over-700"]),
    composeFallback: () => composed,
    validate: (answer) => {
      validated.push(answer);
      return PASSED;
    },
    structuredMode: "STRUCTURED_GROUNDED",
  });
  assert.equal(settled.mode, "GROUNDED_COMPOSED");
  assert.equal(settled.answer, composed.answer);
  assert.deepEqual(validated, [composed.answer], "the composed prose faces the same validator");

  const refused = settleRejectedModelAnswer({
    verdict: FAILED(["too-long:726-characters-over-700"]),
    composeFallback: () => composed,
    validate: () => FAILED(["invented-source-url:https://example.gov/agenda.pdf"]),
    structuredMode: "STRUCTURED_GROUNDED",
  });
  assert.deepEqual([refused.mode, refused.answer], ["STRUCTURED_GROUNDED", null], "a composed answer that fails is not shipped either");

  const substantive = settleRejectedModelAnswer({
    verdict: FAILED(["too-long:726-characters-over-700", "answer-names-foreign-subject:Sunnyside"]),
    composeFallback: () => { throw new Error("a substantive rejection must not reach for a fallback"); },
    validate: () => PASSED,
    structuredMode: "STRUCTURED_GROUNDED",
  });
  assert.deepEqual([substantive.mode, substantive.answer], ["REJECTED_FELL_BACK", null]);
});

const ANTHROPIC = "https://api.anthropic.com/";

async function askWithModelAnswer(modelAnswer: { answer: string; citedSources: number[] }) {
  const priorKey = process.env.ANTHROPIC_API_KEY;
  const priorFetch = globalThis.fetch;
  let synthesisCalls = 0;
  process.env.ANTHROPIC_API_KEY = "test-stub-not-a-real-key";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(ANTHROPIC)) throw new Error(`R13 test refused an outbound request: ${url}`);
    const body = typeof init?.body === "string" ? init.body : "";
    if (body.includes("citedSources")) {
      synthesisCalls += 1;
      return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(modelAnswer) }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // The interpretation call: unavailable, so the deterministic reading runs.
    return new Response(JSON.stringify({ error: { type: "overloaded_error" } }), { status: 529 });
  }) as typeof fetch;
  try {
    const { POST } = await import("../app/api/ask/grounded/route.ts");
    const { resetGroundedState } = await import("../lib/ask/grounded-state.ts");
    resetGroundedState();
    const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://wtp.test", host: "wtp.test", "x-wtp-synthetic-run": "r13-length-fallback-test" },
      body: JSON.stringify({
        question: "What has Katie Hobbs done?",
        surface: "BALLOT",
        ocdIds: ["ocd-division/country:us/state:az", "ocd-division/country:us/state:az/county:pima"],
        today: "2026-08-28",
      }),
    }));
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      mode: string;
      answer: string | null;
      records: unknown[];
      trace: { answerMode: string; validation: { ran: boolean; passed?: boolean; failed?: string[] } };
    };
    return { payload, synthesisCalls };
  } finally {
    globalThis.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = priorKey;
  }
}

test("R13: a 726-character model answer that fails only on length is not reported as a rejection", { concurrency: false }, async () => {
  const { payload, synthesisCalls } = await askWithModelAnswer({ answer: modelAnswerOf726(), citedSources: [] });
  /* The fast writer's over-length answer fails validation, so the frontier writer is asked; the stub answers it the same. */
  assert.equal(synthesisCalls, 2, "the model path ran (from the stub), on both writers of the ladder");
  assert.equal(payload.trace.validation.ran, true);
  assert.deepEqual(payload.trace.validation.failed, ["too-long:726-characters-over-700"], "length is the only failure");
  assert.ok(payload.records.length > 0, "precondition: the records a reader sees are held");
  assert.notEqual(payload.mode, "REJECTED_FELL_BACK", "a too-long answer is not a grounding failure");
  assert.equal(payload.mode, "STRUCTURED_GROUNDED", "no composed prose applies to this question, so the records stand as the answer");
  assert.equal(payload.trace.answerMode, payload.mode);
  assert.equal(payload.answer, null, "the over-budget prose is never truncated into the reader's answer");
});

test("R13: the same answer with an invented source is still REJECTED_FELL_BACK", { concurrency: false }, async () => {
  const answer = modelAnswerOf726().replace(/^This summary/, "https://invented.example/page This summary").slice(0, 725) + ".";
  const { payload } = await askWithModelAnswer({ answer, citedSources: [99] });
  assert.ok(payload.trace.validation.failed?.some((reason) => reason.startsWith("invented-source-url:")));
  assert.equal(payload.mode, "REJECTED_FELL_BACK");
  assert.equal(payload.answer, null);
});
