import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { EvidencePack } from "../lib/ask/evidence.ts";
import {
  callUsd,
  shownPromptDigest,
  synthesizeForComparison,
} from "../lib/ask/model-comparison.ts";
import {
  ASK_CHALLENGER_MODEL,
  ASK_INCUMBENT_MODEL,
  challengerQuestionsNotHolding,
  switchVerdict,
} from "../lib/ask/model-economics.ts";
import {
  ASK_SYNTHESIS_MODEL,
  synthesisRequestBody,
  synthesizeAnswer,
} from "../lib/ask/synthesize.ts";

/**
 * **THE COMPARISON SEAM'S WALLS, ASSERTED RATHER THAN DESCRIBED.**
 * (Session C, lane H2, 2026-08-31.)
 *
 * H2 had to call the synthesis contract on a second model. The dangerous way to
 * do that is an `options.model` on the function every reader request goes
 * through: today's route would not pass one, every test would stay green, and
 * the law *one model for all Ask traffic* would survive only as a habit. The
 * first request header that wanted a cheaper model would break it silently, and
 * because caches are MODEL-SCOPED the first thing anyone would notice is a
 * collapsed hit rate with no cause attached.
 *
 * So the walls are here, and each one is a thing a future edit would have to
 * defeat on purpose:
 *
 * 1. the production path emits `ASK_SYNTHESIS_MODEL` even when handed an
 *    options object carrying a `model` key;
 * 2. nothing under `app/` imports the comparison seam;
 * 3. the comparison request carries no cache marker ANYWHERE;
 * 4. the production request and the comparison request are the SAME contract —
 *    identical but for the model and that marker;
 * 5. a model with no published rate is never costed at zero.
 *
 * No live call is made by anything in this file. The API is a double.
 */

const VAIL = "ocd-division/country:us/state:az/place:vail#governing";

function pack(): EvidencePack {
  return {
    question: "When does the Vail school board meet next?",
    intent: "MEETING_TIME",
    temporal: { kind: "NEXT" },
    subject: { kind: "BODY", id: VAIL, name: "Vail Unified School District Governing Board" },
    records: [
      {
        kind: "MEETING",
        id: "m1",
        text: "Governing Board Meeting on 2026-09-09 at 6:00 PM.",
        sourceUrl: "https://vail.example.gov/agenda/2026-09-09",
        sourceOrg: "Vail Unified School District",
        retrievedAt: "2026-08-31T00:00:00.000Z",
        bodyId: VAIL,
        occurredAt: "2026-09-09T01:00:00.000Z",
      },
    ],
    gaps: [],
    denominators: { meetings: 1 },
    today: "2026-08-31",
  } as unknown as EvidencePack;
}

/** A double that records the request it was given and answers the contract. */
function recorder(): { calls: string[]; impl: typeof fetch } {
  const calls: string[] = [];
  const impl = (async (_url: string, init: { body: string }) => {
    calls.push(init.body);
    return {
      ok: true,
      json: async () => ({
        content: [
          { type: "text", text: JSON.stringify({ answer: "The board meets on 9 September.", citedUrls: [] }) },
        ],
        usage: { input_tokens: 900, output_tokens: 40 },
      }),
    };
  }) as unknown as typeof fetch;
  return { calls, impl };
}

/* ── 1. the production path cannot be told which model to use ────────────── */

test("the production synthesis path emits the one Ask model, whatever it is handed", async () => {
  const { calls, impl } = recorder();
  /*
   * The options object carries a `model` key AND the challenger's id. It is
   * cast because `SynthesizeOptions` does not declare the field — which is
   * itself the point: this asserts that the field is inert at RUNTIME too, so
   * a caller reaching the route through untyped JSON cannot select a model
   * either.
   */
  const outcome = await synthesizeAnswer(pack(), {
    fetchImpl: impl,
    apiKey: "test-key-not-a-credential",
    model: ASK_CHALLENGER_MODEL,
  } as unknown as Parameters<typeof synthesizeAnswer>[1]);

  assert.equal(outcome.kind, "WROTE");
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0]) as { model: string };
  assert.equal(
    body.model,
    ASK_SYNTHESIS_MODEL,
    "a model on the production path's options must be inert; one model for all Ask traffic",
  );
  assert.equal(ASK_INCUMBENT_MODEL, ASK_SYNTHESIS_MODEL);
});

/* ── 2. the seam is outside the production request path ──────────────────── */

test("nothing under app/ imports the comparison seam", () => {
  const root = process.cwd();
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mts|js|mjs)$/.test(entry)) continue;
      const source = readFileSync(full, "utf8");
      /* The import, not the word: a doc block naming the module is a
         reference, and a guard that reads its own documentation as the defect
         is a guard that gets loosened. */
      if (/from\s+["'][^"']*ask\/model-comparison(?:\.ts)?["']/.test(source)) {
        offenders.push(full.slice(root.length + 1));
      }
    }
  };
  walk(join(root, "app"));
  assert.deepEqual(
    offenders,
    [],
    "the comparison seam may never be reachable from a reader request path",
  );
});

/* ── 3 & 4. the same contract, cold, on a named model ────────────────────── */

test("the comparison request is the production request with the model named and no cache marker", async () => {
  const p = pack();
  const production = synthesisRequestBody(p, { model: ASK_SYNTHESIS_MODEL, cached: true });
  const comparison = synthesisRequestBody(p, { model: ASK_CHALLENGER_MODEL, cached: false });

  /* The whole request, minus the two things that are SUPPOSED to differ. */
  const strip = (body: Record<string, unknown>) =>
    JSON.stringify(body).replace(/"model":"[^"]+",/, "").replace(/,"cache_control":\{[^}]*\}/, "");
  assert.equal(
    strip(production),
    strip(comparison),
    "the two arms must be one contract; a drifted copy grades a prompt the product does not ship",
  );

  assert.equal(production.model, ASK_SYNTHESIS_MODEL);
  assert.equal(comparison.model, ASK_CHALLENGER_MODEL);

  /* The marker is present on production and ABSENT — not falsy, not null — on
     the comparison arm. Absent is what makes the call take no part in caching
     at all, so it cannot read production's prefixes and cannot write one. */
  assert.ok(JSON.stringify(production).includes("cache_control"));
  assert.ok(
    !JSON.stringify(comparison).includes("cache_control"),
    "a comparison arm that caches prices one model by arrival order rather than by rate",
  );
});

test("the seam sends no cache marker on a real call, and reports the model it was given", async () => {
  const { calls, impl } = recorder();
  const outcome = await synthesizeForComparison(pack(), ASK_CHALLENGER_MODEL, {
    fetchImpl: impl,
    apiKey: "test-key-not-a-credential",
  });
  assert.equal(outcome.kind, "WROTE");
  if (outcome.kind !== "WROTE") return;
  assert.equal(outcome.model, ASK_CHALLENGER_MODEL);
  assert.equal(outcome.outputTokens, 40);
  assert.equal(outcome.usage.cacheReadInputTokens, 0);
  assert.equal(outcome.usage.cacheCreationInputTokens, 0);
  assert.ok(!calls[0].includes("cache_control"));
});

test("an empty pack is refused on the comparison seam exactly as it is on the reader path", async () => {
  const empty = { ...pack(), records: [] } as EvidencePack;
  const { calls, impl } = recorder();
  const outcome = await synthesizeForComparison(empty, ASK_CHALLENGER_MODEL, {
    fetchImpl: impl,
    apiKey: "test-key-not-a-credential",
  });
  assert.equal(outcome.kind, "UNAVAILABLE");
  if (outcome.kind !== "UNAVAILABLE") return;
  assert.equal(outcome.why, "no-evidence");
  assert.equal(calls.length, 0, "an empty pack must never reach the network on either arm");
});

/* ── the same-pack instrument, and the price that is never guessed ───────── */

test("the shown-prompt digest ignores the model and moves with the evidence", () => {
  const p = pack();
  assert.equal(shownPromptDigest(p), shownPromptDigest(pack()));
  const changed = { ...p, records: [{ ...p.records[0], text: "A different sitting." }] };
  assert.notEqual(shownPromptDigest(p), shownPromptDigest(changed as EvidencePack));
});

test("RULING 230: the criterion is absolute, and the ONE verdict derives it", () => {
  /*
   * **THE CASE THE 2026-08-31 MEASUREMENT ACTUALLY LANDED IN**, and the place
   * the two rules USED to disagree.
   *
   * Q3 and Q5 failed on BOTH models over the ASK-19 length budget. The
   * superseded relative rule derived SWITCH from that, because nothing
   * DEGRADED; the owner's absolute criterion derived RETAIN. This file used to
   * assert the absolute one while `tests/ask-model-economics.test.ts` asserted
   * the relative one, and the run record then wrote both down and contradicted
   * itself.
   *
   * RULING 230 (2026-09-01) collapses them: `switchVerdict` IS the absolute
   * rule, `challengerQuestionsNotHolding` is the helper it reads, and the two
   * can no longer disagree because there is no longer a second rule. Asserted
   * here BOTH ways — the helper's list, and the verdict derived over the same
   * runs — because the defect was never in either function alone.
   */
  const incumbent = [
    { questionId: "Q3", model: ASK_INCUMBENT_MODEL, held: false, ms: 1, usd: 0.01 },
    { questionId: "Q4", model: ASK_INCUMBENT_MODEL, held: true, ms: 1, usd: 0.01 },
    { questionId: "Q5", model: ASK_INCUMBENT_MODEL, held: false, ms: 1, usd: 0.01 },
    { questionId: "Q7", model: ASK_INCUMBENT_MODEL, held: true, ms: 1, usd: 0.01 },
  ];
  const challenger = [
    { questionId: "Q3", model: ASK_CHALLENGER_MODEL, held: false, ms: 1, usd: 0.01 },
    { questionId: "Q4", model: ASK_CHALLENGER_MODEL, held: true, ms: 1, usd: 0.01 },
    { questionId: "Q5", model: ASK_CHALLENGER_MODEL, held: false, ms: 1, usd: 0.01 },
    { questionId: "Q7", model: ASK_CHALLENGER_MODEL, held: true, ms: 1, usd: 0.01 },
  ];
  assert.deepEqual([...challengerQuestionsNotHolding(challenger)], ["Q3", "Q5"]);

  /* THE ONE VERDICT, over the same runs. Same answer, no second rule. */
  const verdict = switchVerdict(incumbent, challenger, "the 2026-08-31 shape");
  assert.equal(verdict.kind, "HOLD");
  assert.notEqual(verdict.kind, "SWITCH");
  assert.deepEqual(verdict.kind === "HOLD" ? [...verdict.notHolding] : [], ["Q3", "Q5"]);

  /* A never-ran question is not a hold either — an unmeasured question can
     never be counted toward "every question holds". */
  assert.deepEqual(
    [...challengerQuestionsNotHolding([
      { questionId: "Q2", model: ASK_CHALLENGER_MODEL, held: null, ms: null, usd: null },
    ])],
    ["Q2"],
  );
  assert.deepEqual([...challengerQuestionsNotHolding([])], []);
});

test("a model with no published rate is null, never free", () => {
  const usage = { inputTokens: 1_000_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  assert.equal(callUsd("claude-opus-5", usage, 0), 5);
  assert.equal(callUsd("claude-sonnet-5", usage, 0), 2);
  assert.equal(
    callUsd("some-model-nobody-priced", usage, 0),
    null,
    "an unpriced model must not print a dollar figure nothing measured",
  );
});
