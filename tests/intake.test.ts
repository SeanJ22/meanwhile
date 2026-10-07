import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { FEDERAL_ROLLCALL_SCOPE, FEDERAL_VOTES_SOURCE_ID } from "../lib/votes/data-plane.ts";
import { readFederalRollCallsProjection } from "../lib/votes/snapshot.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";

/**
 * Every test asserts a mechanism refusing, quarantining or accepting. Threshold env vars are set low before
 * the route modules load (they read limits at first use).
 */

process.env.WTP_LIMIT_REACTIONS_PER_MINUTE = "5";
process.env.WTP_LIMIT_REACTIONS_SOFT_PER_MINUTE = "3";
process.env.WTP_LIMIT_REACTIONS_IP_PER_MINUTE = "100";
process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "5";
// No DATABASE_URL in tests: storage answers 202 (accepted, not stored) and
// the authoritative counters answer "unavailable" — both paths asserted.
delete process.env.DATABASE_URL;

// The promoted federal roll calls, carried as the Reader edge carries a proven
// pointer: the route's own refresh reads this copy (no database in tests).
const promotedVotes = provenEdgeEntry({
  recordClass: "FEDERAL_ROLL_CALL", scope: FEDERAL_ROLLCALL_SCOPE, sourceId: FEDERAL_VOTES_SOURCE_ID, versionId: "cv-intake-votes",
  value: { formatVersion: 1, snapshot: { congress: 119, session: 1, votes: [{ id: "house:119-1:1" }], positions: [] }, billSummaries: { summaries: {}, pending: [] } },
});
const votesEdge = { promoted: new Map([[`FEDERAL_ROLL_CALL:${FEDERAL_ROLLCALL_SCOPE}`, promotedVotes]]) };
await readFederalRollCallsProjection({ edge: promotedVotes });

const { classifySubmission, intakeLimits, isSameOriginSubmission } = await import(
  "../lib/signal/intake-limits.ts"
);
const { POST: postPromotedReaction } = await import("../app/api/reactions/route.ts");
const { withReaderAuthorityEdge } = await import("../lib/registry/runtime-edge.ts");
const postReaction = (request: Request) => withReaderAuthorityEdge(votesEdge, () => postPromotedReaction(request));
const { POST: postLog } = await import("../app/api/log/route.ts");
const { getVoteIds } = await import("../lib/votes/snapshot.ts");
const { analyzeStore } = await import(
  "../lib/signal/tripwire.ts"
);
const { aggregateReactions, rowsEligibleForAggregation } = await import(
  "../lib/signal/aggregate.ts"
);

const realVoteId = [...getVoteIds()][0];
assert.ok(realVoteId, "the votes snapshot must offer a real target");

/** A valid reaction request; overrides let each test break one thing. */
function reactionRequest(overrides: {
  reactionKey?: string;
  targetId?: string;
  origin?: string | null;
  ip?: string;
  body?: string;
}): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": overrides.ip ?? "203.0.113.7",
  };
  if (overrides.origin !== null) {
    headers.origin = overrides.origin ?? "http://localhost";
  }
  return new Request("http://localhost/api/reactions", {
    method: "POST",
    headers,
    body:
      overrides.body ??
      JSON.stringify({
        targetType: "FEDERAL_VOTE",
        targetId: overrides.targetId ?? realVoteId,
        reaction: "YES",
        reactionKey: overrides.reactionKey ?? "a".repeat(32),
      }),
  });
}

function logRequest(overrides: {
  origin?: string | null;
  ip?: string;
  detail?: Record<string, unknown>;
  body?: string;
}): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": overrides.ip ?? "203.0.113.8",
  };
  if (overrides.origin !== null) {
    headers.origin = overrides.origin ?? "http://localhost";
  }
  return new Request("http://localhost/api/log", {
    method: "POST",
    headers,
    body:
      overrides.body ??
      JSON.stringify({
        eventType: "SEARCH",
        ocdIds: [],
        detail: overrides.detail,
      }),
  });
}

test("classify: a human pace is allowed, velocity quarantines, the hard limit and the daily ceiling refuse", () => {
  const limits = {
    ...intakeLimits(),
    reactionsPerMinuteHard: 40,
    reactionsPerMinuteSoft: 20,
    reactionsPerDay: 400,
  };
  assert.deepEqual(
    classifySubmission({ minuteCount: 6, dayCount: 50 }, limits),
    { kind: "ALLOW" },
    "six taps in a minute is a person changing their mind",
  );
  assert.deepEqual(
    classifySubmission({ minuteCount: 21, dayCount: 50 }, limits),
    { kind: "QUARANTINE", reason: "VELOCITY" },
    "past the soft threshold the row lands but is quarantined",
  );
  assert.deepEqual(
    classifySubmission({ minuteCount: 41, dayCount: 50 }, limits),
    { kind: "REFUSE_RATE" },
    "past the hard limit the submission is refused",
  );
  assert.deepEqual(
    classifySubmission({ minuteCount: 2, dayCount: 401 }, limits),
    { kind: "REFUSE_DAILY" },
    "past the daily ceiling the submission is refused however slow it arrives",
  );
});

test("thresholds read their env vars — tuning needs no deploy of code", () => {
  // The test file set 5/3 before import; the defaults are 40/20.
  const limits = intakeLimits();
  assert.equal(limits.reactionsPerMinuteHard, 5);
  assert.equal(limits.reactionsPerMinuteSoft, 3);
});

test("same-origin: matching origin passes, missing and foreign origins fail", () => {
  assert.ok(isSameOriginSubmission(reactionRequest({})));
  assert.ok(!isSameOriginSubmission(reactionRequest({ origin: null })));
  assert.ok(
    !isSameOriginSubmission(reactionRequest({ origin: "https://attacker.example" })),
  );
});

test("a valid submission from a foreign origin is refused with a 403", async () => {
  const response = await postReaction(
    reactionRequest({ origin: "https://attacker.example", ip: "203.0.113.20" }),
  );
  assert.equal(response.status, 403);
});

test("an invented target id is refused — the registry is the gate", async () => {
  const response = await postReaction(
    reactionRequest({ targetId: "house:0-0:99999", ip: "203.0.113.21" }),
  );
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string };
  assert.equal(body.error, "unknown targetId");
});

test("a legitimate human-paced tap is accepted (202 without a database — never a fake 204)", async () => {
  const response = await postReaction(
    reactionRequest({ reactionKey: "b".repeat(32), ip: "203.0.113.22" }),
  );
  assert.equal(
    response.status,
    202,
    "accepted-not-stored is the honest no-database answer; with DATABASE_URL it is the 204 the production gate proves",
  );
});

test("a script-speed burst is refused by the in-memory window — and the refusal is a 429 with Retry-After", async () => {
  const key = "c".repeat(32);
  let refused: Response | null = null;
  for (let i = 0; i < 6; i++) {
    const response = await postReaction(
      reactionRequest({ reactionKey: key, ip: "203.0.113.23" }),
    );
    if (response.status === 429) {
      refused = response;
      break;
    }
    assert.equal(response.status, 202, `tap ${i + 1} under the limit must pass`);
  }
  assert.ok(refused, "the burst's sixth submission must be refused (limit 5/min)");
  assert.equal(refused.headers.get("Retry-After"), "60");
});

test("the per-IP window refuses a burst that rotates device keys", async () => {
  const ip = "203.0.113.99";
  // Fresh key each request, so only the per-IP window can trip.
  let refused = false;
  for (let i = 0; i < 101 && !refused; i++) {
    const response = await postReaction(
      reactionRequest({
        reactionKey: `d${String(i).padStart(3, "0")}`.padEnd(32, "x"),
        ip,
      }),
    );
    refused = response.status === 429;
  }
  assert.ok(refused, "a key-rotating burst from one IP must be refused");
});

test("ripcord.reactionIntake closed: both intakes refuse with 503, and the client renders the honest line on it", async () => {
  process.env.WTP_RIPCORD_REACTION_INTAKE = "pulled";
  try {
    const reaction = await postReaction(reactionRequest({ ip: "203.0.113.24" }));
    assert.equal(reaction.status, 503, "reactions intake must refuse while pulled");
    const log = await postLog(logRequest({ ip: "203.0.113.24" }));
    assert.equal(log.status, 503, "log intake must close with the same switch");
  } finally {
    delete process.env.WTP_RIPCORD_REACTION_INTAKE;
  }
  // And the reader's side of a 503 is the honest not-counted line:
  const { submitReaction } = await import("../lib/reactions/client.ts");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;
  try {
    const outcome = await submitReaction("FEDERAL_VOTE", realVoteId, "YES", null);
    assert.equal(outcome, "NOT_COUNTED", "a closed intake must never render as success");
  } finally {
    globalThis.fetch = realFetch;
  }
  // Restored: the same request is accepted again.
  const restored = await postReaction(reactionRequest({ ip: "203.0.113.25" }));
  assert.equal(restored.status, 202);
});

test("ripcord.rateLimits pulled: the protections stand down but validity never does", async () => {
  process.env.WTP_RIPCORD_RATE_LIMITS = "pulled";
  try {
    // Foreign origin passes while the family is off…
    const foreign = await postReaction(
      reactionRequest({ origin: "https://attacker.example", ip: "203.0.113.26" }),
    );
    assert.equal(foreign.status, 202);
    // …but an invented target is still refused. Validity has no flag.
    const invented = await postReaction(
      reactionRequest({ targetId: "house:0-0:99999", ip: "203.0.113.26" }),
    );
    assert.equal(invented.status, 400);
  } finally {
    delete process.env.WTP_RIPCORD_RATE_LIMITS;
  }
});

test("a quarantined row is excluded from aggregation unconditionally, and n counts only the clean pool", () => {
  const rows = [
    {
      targetType: "FEDERAL_VOTE" as const,
      targetId: realVoteId,
      reaction: "YES" as const,
      ocdIds: ["ocd-division/country:us/state:az"],
      verificationTier: "ANONYMOUS" as const,
      runClass: "ORGANIC" as const,
      suspectReason: null,
    },
    {
      targetType: "FEDERAL_VOTE" as const,
      targetId: realVoteId,
      reaction: "YES" as const,
      ocdIds: ["ocd-division/country:us/state:az"],
      verificationTier: "ANONYMOUS" as const,
      runClass: "ORGANIC" as const,
      suspectReason: "VELOCITY",
    },
    {
      targetType: "FEDERAL_VOTE" as const,
      targetId: realVoteId,
      reaction: "NO" as const,
      ocdIds: ["ocd-division/country:us/state:az"],
      verificationTier: "ANONYMOUS" as const,
      runClass: "ORGANIC" as const,
      suspectReason: "LIMITER_UNAVAILABLE",
    },
  ];
  assert.equal(
    rowsEligibleForAggregation(rows).length,
    1,
    "both quarantine reasons must exclude",
  );
  const tallies = aggregateReactions(rows);
  assert.equal(tallies.length, 1);
  assert.equal(tallies[0].n, 1, "the denominator counts the clean pool only");
  assert.equal(tallies[0].tiers.ANONYMOUS.YES, 1);
  assert.equal(tallies[0].tiers.ANONYMOUS.NO, 0, "the quarantined NO never lands in a total");
});

test("quarantine is sticky on overwrite and carries no identifier — the write path says so structurally", () => {
  const source = readFileSync(
    join(process.cwd(), "lib", "db", "reactions.ts"),
    "utf8",
  );
  assert.ok(
    source.includes("COALESCE(${reactions.suspectReason}, ${suspectReason})"),
    "an overwrite must never CLEAR a suspect mark — a burst would launder itself clean",
  );
  // The reason enum is a why, never a who.
  const schema = readFileSync(join(process.cwd(), "lib", "db", "schema.ts"), "utf8");
  assert.ok(schema.includes('enum: ["VELOCITY", "LIMITER_UNAVAILABLE"]'));
});

test("the limiter digest can never join the reaction store — different hash context, disjoint columns", async () => {
  const { hashLimiterKey } = await import("../lib/db/intake-limiter.ts");
  const { hashReactionKey } = await import("../lib/db/reactions.ts");
  const raw = "0123456789abcdef0123456789abcdef";
  assert.notEqual(
    hashLimiterKey(raw),
    hashReactionKey(raw),
    "the same browser key must produce different digests in the two tables",
  );

  const { getTableConfig } = await import("drizzle-orm/pg-core");
  const schema = await import("../lib/db/schema.ts");
  const limiterCols = getTableConfig(schema.intakeLimiter).columns.map((c) => c.name);
  const reactionCols = new Set(
    getTableConfig(schema.reactions).columns.map((c) => c.name),
  );
  const searchCols = new Set(
    getTableConfig(schema.searchLog).columns.map((c) => c.name),
  );
  for (const name of limiterCols) {
    assert.ok(
      !reactionCols.has(name) && !searchCols.has(name),
      `intake_limiter.${name} appears in a collection store — the limiter must share no column`,
    );
  }
  assert.equal(
    getTableConfig(schema.intakeLimiter).foreignKeys.length,
    0,
    "the limiter table references nothing",
  );
});

test("log intake: an over-cap detail string is refused — the server no longer trusts the client's cap", async () => {
  const response = await postLog(
    logRequest({
      ip: "203.0.113.30",
      detail: { topic: "NO_ROUTE", question: "x".repeat(501) },
    }),
  );
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string };
  assert.match(body.error, /cap/);
});

test("log intake: an oversized body is refused outright", async () => {
  const response = await postLog(
    logRequest({ ip: "203.0.113.31", body: "x".repeat(5000) }),
  );
  assert.equal(response.status, 413);
});

test("log intake: cross-origin submission is refused — text cannot be pumped in from scripts that never loaded the site", async () => {
  const response = await postLog(
    logRequest({ origin: "https://attacker.example", ip: "203.0.113.32" }),
  );
  assert.equal(response.status, 403);
});

test("log intake: a same-origin burst past the per-IP window is refused", async () => {
  const ip = "203.0.113.33";
  let refused: Response | null = null;
  for (let i = 0; i < 6; i++) {
    const response = await postLog(logRequest({ ip }));
    if (response.status === 429) {
      refused = response;
      break;
    }
    assert.equal(response.status, 202, `event ${i + 1} under the limit must pass`);
  }
  assert.ok(refused, "the sixth event from one IP must be refused (limit 5/min)");
});

test("tripwire: a volume spike far outside the trailing range is flagged, quiet days are not", () => {
  const quiet = Array.from({ length: 10 }, (_, i) => ({
    day: `2026-08-${String(i + 1).padStart(2, "0")}`,
    total: 5 + (i % 3),
    suspect: 0,
  }));
  assert.deepEqual(analyzeStore("reactions", quiet), [], "a quiet fortnight has no flags");

  const spiked = [...quiet, { day: "2026-08-11", total: 240, suspect: 0 }];
  const flags = analyzeStore("reactions", spiked);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].kind, "VOLUME_SPIKE");
  assert.equal(flags[0].day, "2026-08-11");
  assert.match(flags[0].detail, /240 rows/, "the flag states the count");
  assert.match(flags[0].detail, /trailing median/, "the flag states the denominator");
});

test("tripwire: a day where quarantined rows are a disproportionate share is flagged; a lone suspect tap is not", () => {
  const days = [
    { day: "2026-08-01", total: 20, suspect: 1 },
    { day: "2026-08-02", total: 20, suspect: 10 },
  ];
  const flags = analyzeStore("reactions", days);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].kind, "SUSPECT_SHARE");
  assert.equal(flags[0].day, "2026-08-02");
  assert.match(flags[0].detail, /10 of 20/, "count and denominator, always");
});

test("the standing runner records the tripwire in the control plane without a tracked report", () => {
  const runner = readFileSync(join(process.cwd(), "scripts", "pilot-runner.mts"), "utf8");
  const tripwire = readFileSync(join(process.cwd(), "scripts", "intake-tripwire.mts"), "utf8");
  assert.match(runner, /new IndependentRuntimeLaneScheduler\([\s\S]*run:\s*runIntakeRuntime/);
  assert.match(runner, /intakeRuntime: observation/);
  assert.match(tripwire, /INTAKE_RUNTIME_RECEIPT=/);
  assert.doesNotMatch(tripwire, /docs\/intake-report\.md|writeFile|git\s+(?:add|commit|push)|push-main/);
  assert.equal(existsSync(join(process.cwd(), ".github", "workflows", "intake-tripwire.yml")), false);
});
