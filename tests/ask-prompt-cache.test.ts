import { fixturePlaybooks } from "./helpers/playbooks.ts";
import { WORKER_SAFETY_FRAME } from "../lib/control-plane/playbooks.ts";
import assert from "node:assert/strict";
import test from "./helpers/playbooks.ts";

import type { EvidencePack } from "../lib/ask/evidence.ts";
import {
  ASK_CALLER_KEYS,
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  SYNTHESIS_CACHE_TTL,
  askCallerKey,
  cacheCallLine,
  cacheHitRates,
  cacheSavings,
  emptyCacheLedger,
  readCacheUsage,
  recordCacheUsage,
  type AskCallerKey,
} from "../lib/ask/prompt-cache.ts";
import {
  SYNTHESIS_CONTEXT_FIELDS,
  SYNTHESIS_QUESTION_FIELDS,
  synthesisContextPayload,
  synthesisPayload,
  synthesisPrompt,
  synthesisQuestionPayload,
  synthesizeAnswer,
  synthesisRequestBody,
} from "../lib/ask/synthesize.ts";

/** A test double for prompt caching's documented rules: prefix match, minimum size, TTL, and no marker means no cache. It can miss. */

const VAIL = "ocd-division/country:us/state:az/school_district:vail_unified_district";
const PIMA = "ocd-division/country:us/state:az/county:pima";

/** A pack big enough to clear the 512-token minimum, so the test cannot pass for the wrong reason. */
function zipPack(over: Partial<EvidencePack> = {}): EvidencePack {
  return {
    question: "what is on the agenda",
    intent: "UPCOMING_AGENDA",
    temporal: { kind: "NEXT" },
    subject: { kind: "BODY", id: VAIL, name: "Vail Unified District" },
    records: Array.from({ length: 12 }, (_, i) => ({
      kind: "AGENDA_ITEM" as const,
      id: `m1#${i}`,
      bodyId: VAIL,
      text:
        `Item ${i}. Consideration and possible approval of the governing board's ` +
        `capital improvement schedule, including the transportation replacement ` +
        `plan and the associated intergovernmental agreement.`,
      occurredAt: "2026-09-09T02:00:00.000Z",
      sourceUrl: `https://example.gov/agenda-${i}.pdf`,
      sourceOrg: "Vail Unified District",
      retrievedAt: "2026-08-31T00:00:00.000Z",
    })),
    gaps: [{ whose: "OURS", statement: "We have not recorded the minutes for that sitting." }],
    denominators: { agendasRead: 9, meetingsInScope: 3 },
    today: "2026-08-31",
    ...over,
  };
}

/** Claude Opus 5's documented minimum cacheable prefix. Under this: no entry. */
const OPUS_5_MIN_CACHEABLE_TOKENS = 512;

interface FakeClock {
  now: number;
}

interface CacheEntry {
  expiresAt: number;
  tokens: number;
}

interface SeenCall {
  callerPrefix: string;
  cacheRead: number;
  cacheCreation: number;
  /** The request body as sent, so a test can assert its shape. */
  body: Record<string, unknown>;
}

/**
 * The rendered cache key: everything the API hashes, up to and including the
 * block that carries the breakpoint. Deliberately built from the REQUEST BODY
 * rather than from our own helpers, so a change in `synthesize.ts` that moves
 * the question back into the prefix shows up here as a changed key.
 */
function renderedPrefix(body: Record<string, unknown>): string | null {
  const messages = body.messages as
    | { role: string; content: string | { type: string; text?: string; cache_control?: unknown }[] }[]
    | undefined;
  if (!messages) return null;

  /* The system field is a string with caching off and an array of text blocks with it on. */
  const system = Array.isArray(body.system)
    ? (body.system as { text?: string }[]).map((b) => b.text ?? "").join("")
    : String(body.system ?? "");
  const parts: string[] = [String(body.model), "\u0000", system, "\u0000"];
  let sawBreakpoint = false;
  for (const message of messages) {
    if (typeof message.content === "string") {
      parts.push(message.content);
      continue;
    }
    for (const block of message.content) {
      parts.push(block.text ?? "");
      if (block.cache_control) {
        sawBreakpoint = true;
        break;
      }
    }
    if (sawBreakpoint) break;
  }
  return sawBreakpoint ? parts.join("") : null;
}

function ttlMsOf(body: Record<string, unknown>): number {
  const raw = JSON.stringify(body);
  return raw.includes('"ttl":"1h"') ? 60 * 60 * 1000 : 5 * 60 * 1000;
}

/**
 * A fetch that behaves like the Messages API WITH prompt caching, including
 * every way it declines to cache.
 */
function anthropicWithCache(clock: FakeClock, seen: SeenCall[]): typeof fetch {
  const store = new Map<string, CacheEntry>();
  return (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    const prefix = renderedPrefix(body);

    let cacheRead = 0;
    let cacheCreation = 0;
    if (prefix !== null) {
      const tokens = Math.ceil(prefix.length / 4);
      if (tokens >= OPUS_5_MIN_CACHEABLE_TOKENS) {
        const hit = store.get(prefix);
        if (hit && clock.now < hit.expiresAt) {
          cacheRead = hit.tokens;
          /* A read refreshes the timer at no cost. */
          store.set(prefix, { expiresAt: clock.now + ttlMsOf(body), tokens: hit.tokens });
        } else {
          cacheCreation = tokens;
          store.set(prefix, { expiresAt: clock.now + ttlMsOf(body), tokens });
        }
      }
    }

    seen.push({ callerPrefix: prefix ?? "", cacheRead, cacheCreation, body });

    return {
      ok: true,
      json: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              answer: "The board meets on September 8.",
              citedSources: [1],
            }),
          },
        ],
        usage: {
          input_tokens: 40,
          cache_creation_input_tokens: cacheCreation,
          cache_read_input_tokens: cacheRead,
        },
      }),
    };
  }) as unknown as typeof fetch;
}

test("H1: a second same-ZIP call inside the TTL reads the cached prefix", async () => {
  /* A second same-ZIP call inside the TTL must report cache-read tokens. */
  const clock: FakeClock = { now: 0 };
  const seen: SeenCall[] = [];
  const fetchImpl = anthropicWithCache(clock, seen);

  const first = await synthesizeAnswer(zipPack({ question: "when does the board next meet" }), {
    apiKey: "unused-by-the-double",
    fetchImpl,
    callerKey: "synthetic-run",
  });
  assert.equal(first.kind, "WROTE");

  /* 30 seconds later — a reader's next question, same ZIP, same evidence. */
  clock.now += 30_000;
  const second = await synthesizeAnswer(zipPack({ question: "who sits on the board" }), {
    apiKey: "unused-by-the-double",
    fetchImpl,
    callerKey: "synthetic-run",
  });
  assert.equal(second.kind, "WROTE");

  assert.equal(seen.length, 2);
  assert.ok(
    seen[0].cacheCreation > 0,
    `the first call must WRITE the prefix; it reported ${seen[0].cacheCreation}`,
  );
  assert.ok(
    seen[1].cacheRead > 0,
    "a second same-ZIP call inside the TTL reported ZERO cache-read tokens — " +
      "the stable prefix is not stable, or the breakpoint is missing",
  );
  assert.equal(
    seen[1].cacheCreation,
    0,
    "the second call re-wrote the prefix instead of reading it",
  );

  /* And the usage reached the caller, because a number nobody can read is not
     a measurement. */
  assert.ok(second.kind === "WROTE" && second.usage.cacheReadInputTokens > 0);
});

test("H1: past the TTL the same call misses, so the double is capable of missing", async () => {
  const clock: FakeClock = { now: 0 };
  const seen: SeenCall[] = [];
  const fetchImpl = anthropicWithCache(clock, seen);

  await synthesizeAnswer(zipPack(), { apiKey: "k", fetchImpl, callerKey: "synthetic-run" });
  clock.now += SYNTHESIS_CACHE_TTL.milliseconds + 1_000;
  await synthesizeAnswer(zipPack(), { apiKey: "k", fetchImpl, callerKey: "synthetic-run" });

  assert.equal(seen[1].cacheRead, 0, "an expired entry must not read");
  assert.ok(seen[1].cacheCreation > 0, "an expired entry must be rewritten");
});

test("H1: a different ZIP's civic context is a different prefix and misses", async () => {
  const clock: FakeClock = { now: 0 };
  const seen: SeenCall[] = [];
  const fetchImpl = anthropicWithCache(clock, seen);

  await synthesizeAnswer(zipPack(), { apiKey: "k", fetchImpl, callerKey: "synthetic-run" });
  clock.now += 5_000;
  await synthesizeAnswer(
    zipPack({ subject: { kind: "BODY", id: PIMA, name: "Pima County Board of Supervisors" } }),
    { apiKey: "k", fetchImpl, callerKey: "synthetic-run" },
  );

  assert.equal(
    seen[1].cacheRead,
    0,
    "another government's context must never read this one's cached prefix",
  );
});

test("H1: the QUESTION is outside the cached prefix", async () => {
  /*
   * The structural claim the whole design rests on. Two different questions
   * over one ZIP must render the SAME prefix bytes — if the question is inside
   * the prefix, these two strings differ and every question is a cold miss.
   */
  const clock: FakeClock = { now: 0 };
  const seen: SeenCall[] = [];
  const fetchImpl = anthropicWithCache(clock, seen);

  await synthesizeAnswer(zipPack({ question: "when do they meet" }), {
    apiKey: "k",
    fetchImpl,
    callerKey: "synthetic-run",
  });
  clock.now += 1_000;
  await synthesizeAnswer(zipPack({ question: "what did they decide about the budget instead" }), {
    apiKey: "k",
    fetchImpl,
    callerKey: "synthetic-run",
  });

  assert.equal(
    seen[0].callerPrefix,
    seen[1].callerPrefix,
    "the rendered prefix changed with the question — the question is inside the cached prefix",
  );
  assert.ok(
    !seen[0].callerPrefix.includes("when do they meet"),
    "the reader's question appears inside the cached prefix",
  );
});

test("H1: the cached prefix carries the system rules AND the ZIP civic context", async () => {
  const clock: FakeClock = { now: 0 };
  const seen: SeenCall[] = [];
  await synthesizeAnswer(zipPack(), {
    apiKey: "k",
    fetchImpl: anthropicWithCache(clock, seen),
    callerKey: "synthetic-run",
  });

  const prefix = seen[0].callerPrefix;
  assert.match(prefix, /ONLY the records supplied/, "the system rules are not in the prefix");
  assert.match(prefix, /Never tell the reader how to vote/);
  assert.match(prefix, /Vail Unified District/, "the ZIP civic context is not in the prefix");
  assert.match(prefix, /capital improvement schedule/, "the records are not in the prefix");
  assert.match(prefix, /agendasRead/, "the denominators are not in the prefix");
});

test("H1: the prefix clears Claude Opus 5's 512-token cacheable minimum", () => {
  const pack = zipPack();
  const contextChars =
    JSON.stringify({ subject: pack.subject, records: pack.records }, null, 1).length;
  assert.ok(
    Math.ceil((1503 + contextChars) / 4) >= OPUS_5_MIN_CACHEABLE_TOKENS,
    "the cached prefix is below the model's minimum and would silently never cache",
  );
});

test("H1: the two payloads are a PARTITION of the pre-caching payload", () => {
  const p = zipPack();
  const legacy = JSON.parse(synthesisPayload(p)) as Record<string, unknown>;
  const context = JSON.parse(synthesisContextPayload(p)) as Record<string, unknown>;
  const question = JSON.parse(synthesisQuestionPayload(p)) as Record<string, unknown>;

  const contextKeys = Object.keys(context);
  const questionKeys = Object.keys(question);

  /* Disjoint: no field is sent twice. */
  assert.deepEqual(
    contextKeys.filter((k) => questionKeys.includes(k)),
    [],
    "a field is on BOTH sides of the split",
  );

  /* Exhaustive: no field was dropped, none was invented. */
  assert.deepEqual(
    [...contextKeys, ...questionKeys].sort(),
    Object.keys(legacy).sort(),
    "the split is not a partition — a field was added or dropped from the prompt",
  );

  /* Value-preserving: every field survives unchanged. */
  for (const key of Object.keys(legacy)) {
    assert.deepEqual(
      key in context ? context[key] : question[key],
      legacy[key],
      `the value of ${key} changed in the split`,
    );
  }

  /* And the partition is the one the design says it is. */
  assert.deepEqual(contextKeys.sort(), [...SYNTHESIS_CONTEXT_FIELDS].sort());
  assert.deepEqual(questionKeys.sort(), [...SYNTHESIS_QUESTION_FIELDS].sort());
});

test("H1: the system prompt contains the current row and the fixed safety frame", () => {
  const prompt = synthesisPrompt(zipPack({ intent: "CIVICS" }));
  assert.equal(typeof prompt, "string");
  assert.match(prompt, /ONLY the records supplied/);
  assert.match(prompt, /Never tell the reader how to vote/);
  assert.doesNotMatch(prompt, /Today is/, "the date is no longer in the system prompt");
  assert.match(prompt, /LEAD WITH THE PLAIN DEFINITION/, "the definition-first contract is in the prompt");
  assert.equal(prompt, `${WORKER_SAFETY_FRAME}\n\nASK_WRITER PLAYBOOK\n${(fixturePlaybooks(["ASK_WRITER"])[0].payload as {text:string}).text}`);
});

test("PC-5 (2026-09-06): the request carries TWO breakpoints — the system block and the civic context — and the date and the question sit after both", async () => {
  const seen: SeenCall[] = [];
  const clock: FakeClock = { now: 0 };
  await synthesizeAnswer(zipPack(), { apiKey: "k", fetchImpl: anthropicWithCache(clock, seen), callerKey: "synthetic-run" });
  const body = seen[0].body as { system: { type: string; text: string; cache_control?: unknown }[]; messages: { content: { type: string; text: string; cache_control?: unknown }[] }[] };
  assert.ok(Array.isArray(body.system) && body.system.length === 1, "the system prefix is one text block");
  assert.deepEqual(body.system[0].cache_control, { type: "ephemeral" }, "the first breakpoint is on the system block");
  assert.equal(body.system[0].text, synthesisPrompt(zipPack()));
  const blocks = body.messages[0].content;
  assert.equal(blocks.length, 3, "context, date, question");
  assert.deepEqual(blocks[0].cache_control, { type: "ephemeral" }, "the second breakpoint is at the end of the civic context");
  assert.equal(blocks[1].text, "Today is 2026-08-31.");
  assert.equal(blocks[1].cache_control, undefined);
  assert.equal(blocks[2].cache_control, undefined);
  assert.match(blocks[2].text, /what is on the agenda/);
  /* The records carry their own retrieval stamps, which are evidence; the DATE SENTENCE is what must not sit before the last breakpoint. */
  assert.doesNotMatch(body.system[0].text + blocks[0].text, /Today is/, "no date sentence before the last breakpoint");
  /* With caching off (the comparison seam) the system field is the plain string and nothing is marked. */
  const cold = synthesisRequestBody(zipPack(), { model: "claude-opus-5-5", cached: false, effort: "medium" });
  assert.equal(typeof cold.system, "string");
  assert.ok(!JSON.stringify(cold).includes("cache_control"));
});

test("H1: hit rates are reported PER CALLER KEY and never pooled", () => {
  let ledger = emptyCacheLedger();
  /* prod-ask: 3 calls, 2 of them read. local-dev: 2 calls, neither reads. */
  ledger = recordCacheUsage(ledger, "prod-ask", { inputTokens: 10, cacheCreationInputTokens: 900, cacheReadInputTokens: 0 });
  ledger = recordCacheUsage(ledger, "prod-ask", { inputTokens: 10, cacheCreationInputTokens: 0, cacheReadInputTokens: 900 });
  ledger = recordCacheUsage(ledger, "prod-ask", { inputTokens: 10, cacheCreationInputTokens: 0, cacheReadInputTokens: 900 });
  ledger = recordCacheUsage(ledger, "local-dev", { inputTokens: 10, cacheCreationInputTokens: 900, cacheReadInputTokens: 0 });
  ledger = recordCacheUsage(ledger, "local-dev", { inputTokens: 10, cacheCreationInputTokens: 900, cacheReadInputTokens: 0 });

  const rates = cacheHitRates(ledger);
  const prod = rates.find((r) => r.callerKey === "prod-ask");
  const local = rates.find((r) => r.callerKey === "local-dev");

  assert.ok(prod && local, "both caller keys must be reported");
  assert.equal(prod.calls, 3);
  assert.equal(prod.callsWithCacheRead, 2);
  assert.equal(prod.hitRate, 2 / 3);
  assert.equal(local.calls, 2);
  assert.equal(local.callsWithCacheRead, 0);
  assert.equal(local.hitRate, 0);

  /* A pooled rate would be 2/5. Nothing may report that number. */
  assert.ok(
    !rates.some((r) => r.calls === 5),
    "caller keys were pooled into one rate — prod-ask and local-dev are separate keys",
  );
});

test("H1: the caller-key vocabulary is CLOSED and carries no reader identifier", () => {
  /*
   * The caller key names a DEPLOYMENT, never a reader. A free-form key would
   * be the one place in this pipeline a session id or an address could reach a
   * third party, so the vocabulary is a fixed list and this test is the wall.
   */
  assert.deepEqual([...ASK_CALLER_KEYS].sort(), ["local-dev", "prod-ask", "synthetic-run"]);
  for (const key of ASK_CALLER_KEYS) {
    assert.match(key as string, /^[a-z-]+$/, `${key} is not a plain deployment label`);
  }
});

test("H1: the console line carries token counts and NO reader fact", () => {
  const line = cacheCallLine("prod-ask", {
    inputTokens: 40,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 1200,
  });
  assert.equal(line, "ask:cache · prod-ask · read=1200 write=0 uncached=40");
  /* A log line is the easiest place for a reader fact to escape into a durable
     store nobody audits. The fields are fixed, and this is the wall. */
  for (const forbidden of ["question", "zip", "ocd-division", "address", "session"]) {
    assert.ok(!line.includes(forbidden), `the console line leaks ${forbidden}`);
  }
});

test("H1: usage is read from the API's own usage block, absent fields as zero", () => {
  assert.deepEqual(
    readCacheUsage({
      usage: { input_tokens: 12, cache_creation_input_tokens: 34, cache_read_input_tokens: 56 },
    }),
    { inputTokens: 12, cacheCreationInputTokens: 34, cacheReadInputTokens: 56 },
  );
  /* A response with no usage block is zero measured, never an assumed hit. */
  assert.deepEqual(readCacheUsage({}), {
    inputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  });
});

test("H1: the chosen TTL is declared with its reasoning, in one place", () => {
  assert.equal(SYNTHESIS_CACHE_TTL.ttl, "5m");
  assert.equal(SYNTHESIS_CACHE_TTL.milliseconds, 5 * 60 * 1000);
  /* The wire form: a 5-minute TTL is the DEFAULT and is sent as a bare
     ephemeral marker. Sending `ttl: "5m"` explicitly is not the documented
     wire value and would be a guess. */
  assert.deepEqual(SYNTHESIS_CACHE_TTL.cacheControl, { type: "ephemeral" });
  assert.ok(SYNTHESIS_CACHE_TTL.why.length > 200, "the TTL choice must carry its reasoning");
});

test("H1: a caller key is derived from the environment, never from a reader", () => {
  const keys: AskCallerKey[] = [...ASK_CALLER_KEYS];
  assert.ok(keys.length === 3);
});

test("H1: a LOCAL PRODUCTION BUILD's harness traffic is never pooled with production readers", () => {
  /* NODE_ENV=production also runs local walks and checks, so a declared automated run gets its own key. */
  assert.equal(
    askCallerKey({ NODE_ENV: "production" } as NodeJS.ProcessEnv, "SYNTHETIC"),
    "synthetic-run",
  );
  assert.equal(askCallerKey({ NODE_ENV: "production" } as NodeJS.ProcessEnv, "ORGANIC"), "prod-ask");
  assert.equal(
    askCallerKey({ NODE_ENV: "development" } as NodeJS.ProcessEnv, "ORGANIC"),
    "local-dev",
  );
  /* A synthetic run against PRODUCTION is its own key too — pooling it with
     readers is the same defect wearing a different deployment. */
  assert.notEqual(
    askCallerKey({ NODE_ENV: "production" } as NodeJS.ProcessEnv, "SYNTHETIC"),
    askCallerKey({ NODE_ENV: "production" } as NodeJS.ProcessEnv, "ORGANIC"),
  );
});

test("H1: an unrecognised WTP_ASK_CALLER falls back rather than reaching the wire", () => {
  assert.equal(
    askCallerKey({ NODE_ENV: "production", WTP_ASK_CALLER: "../etc/passwd" } as NodeJS.ProcessEnv),
    "prod-ask",
  );
  assert.equal(
    askCallerKey({ NODE_ENV: "production", WTP_ASK_CALLER: "prod-ask" } as NodeJS.ProcessEnv),
    "prod-ask",
  );
});

test("H1: the saving is computed from the published multipliers, and one read repays the write", () => {
  /*
   * The arithmetic that decides whether a breakpoint is worth having at all:
   * a five-minute write bills 1.25x and a read bills 0.1x, so two passes over
   * one prefix bill 1.35x against 2.0x uncached. The break-even is the SECOND
   * request, and it is asserted here rather than remembered.
   */
  assert.equal(CACHE_WRITE_MULTIPLIER, 1.25);
  assert.equal(CACHE_READ_MULTIPLIER, 0.1);
  assert.ok(
    CACHE_WRITE_MULTIPLIER + CACHE_READ_MULTIPLIER < 2,
    "if one read did not repay the write premium the breakpoint would be a surcharge",
  );

  /* A production reading: 15,731 read, 9,662 written, 583 uncached, at a $5/M input rate. */
  const measured = cacheSavings(
    {
      callerKey: "synthetic-run",
      calls: 7,
      callsWithCacheRead: 4,
      hitRate: 4 / 7,
      cacheReadInputTokens: 15_731,
      cacheCreationInputTokens: 9_662,
      uncachedInputTokens: 583,
    },
    5,
  );
  const total = 15_731 + 9_662 + 583;
  assert.ok(Math.abs(measured.uncachedBaselineUsd - (total * 5) / 1_000_000) < 1e-12);
  assert.ok(measured.savedUsd > 0, "a run with reads must save something");
  assert.ok(
    measured.savedFraction > 0.4 && measured.savedFraction < 0.5,
    `the 2026-09-01 production reading saved ${(measured.savedFraction * 100).toFixed(1)}%`,
  );
  assert.ok(
    measured.cachedShareOfInput > 0.97,
    "almost the whole prompt is inside the cached prefix; the question tail is a few dozen tokens",
  );
});

test("H1: a run with no cache activity saves nothing and is never negative", () => {
  /* A zero is a MEASURED zero here — the caller made calls and none cached —
     and it must not come out as a negative saving or a divide-by-zero. */
  const cold = cacheSavings(
    {
      callerKey: "local-dev",
      calls: 3,
      callsWithCacheRead: 0,
      hitRate: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      uncachedInputTokens: 4_000,
    },
    5,
  );
  assert.equal(cold.savedUsd, 0);
  assert.equal(cold.savedFraction, 0);
  assert.equal(cold.cachedShareOfInput, 0);

  const nothing = cacheSavings(
    {
      callerKey: "local-dev",
      calls: 0,
      callsWithCacheRead: 0,
      hitRate: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      uncachedInputTokens: 0,
    },
    5,
  );
  assert.equal(nothing.savedFraction, 0);
  assert.equal(nothing.cachedShareOfInput, 0);
});
