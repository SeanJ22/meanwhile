import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { aggregateReactions } from "../lib/signal/aggregate.ts";
import { SlidingWindowLimiter } from "../lib/signal/rate-limit.ts";
import {
  VERIFICATION_TIERS,
  isPlausibleTargetId,
  isValidReactionKey,
  isValidReactionValue,
  isValidTargetType,
} from "../lib/signal/reactions.ts";
import { hashReactionKey, writeReaction } from "../lib/db/reactions.ts";
import { getVoteIds } from "../lib/votes/snapshot.ts";

/**
 * Reaction capture (P03) — the first user-writable surface, tested at the
 * layers that must be launch-grade from day one even while collection is
 * demo-grade: the aggregation contract, the identity-free write path, the
 * fail-closed validation, and the disclosure coupling.
 */

// ── The aggregation contract — the function the data business sells ──────

test("aggregation: reactions in, per-division tier-split tallies out, n stated", () => {
  const rows = [
    // Two readers (distinct browsers) in overlapping divisions.
    {
      targetType: "FEDERAL_VOTE" as const,
      targetId: "house:119-2:283",
      reaction: "YES" as const,
      ocdIds: ["ocd-division/country:us/state:az", "ocd-division/country:us/state:az/cd:7"],
      verificationTier: "ANONYMOUS" as const,
    },
    {
      targetType: "FEDERAL_VOTE" as const,
      targetId: "house:119-2:283",
      reaction: "NO" as const,
      ocdIds: ["ocd-division/country:us/state:az/cd:7"],
      verificationTier: "ANONYMOUS" as const,
    },
    {
      targetType: "FEDERAL_VOTE" as const,
      targetId: "house:119-2:283",
      reaction: "UNSURE" as const,
      ocdIds: ["ocd-division/country:us/state:az/cd:7"],
      verificationTier: "LOCALITY_VERIFIED" as const,
    },
  ];

  const tallies = aggregateReactions(rows);
  const cd7 = tallies.find((t) => t.ocdId.endsWith("cd:7"));
  const az = tallies.find((t) => t.ocdId.endsWith("state:az"));

  assert.ok(cd7, "cd:7 tally missing");
  assert.ok(az, "state tally missing");

  // The denominators are stated and correct at both levels.
  assert.equal(cd7.n, 3);
  assert.equal(az.n, 1);
  assert.equal(cd7.tiers.ANONYMOUS.YES, 1);
  assert.equal(cd7.tiers.ANONYMOUS.NO, 1);
  assert.equal(cd7.tiers.ANONYMOUS.n, 2);
  assert.equal(cd7.tiers.LOCALITY_VERIFIED.UNSURE, 1);
  assert.equal(cd7.tiers.LOCALITY_VERIFIED.n, 1);
});

test("aggregation: every tier appears in every tally — the confidence mix is visible, never blended", () => {
  const tallies = aggregateReactions([
    {
      targetType: "FEDERAL_VOTE",
      targetId: "senate:119-2:231",
      reaction: "YES",
      ocdIds: ["ocd-division/country:us/state:nh"],
      verificationTier: "ANONYMOUS",
    },
  ]);
  assert.equal(tallies.length, 1);
  for (const tier of VERIFICATION_TIERS) {
    const t = tallies[0].tiers[tier];
    assert.ok(t, `tier ${tier} missing from the tally`);
    assert.equal(t.n, t.YES + t.NO + t.UNSURE, `tier ${tier}: n is not the sum`);
  }
  // A tier with no rows says 0 — it does not disappear.
  assert.equal(tallies[0].tiers.VOTER_MATCHED.n, 0);
});

test("aggregation: duplicate division ids on one row never double-count", () => {
  const tallies = aggregateReactions([
    {
      targetType: "FEDERAL_VOTE",
      targetId: "house:119-2:283",
      reaction: "YES",
      ocdIds: ["ocd-division/country:us/state:az", "ocd-division/country:us/state:az"],
      verificationTier: "ANONYMOUS",
    },
  ]);
  assert.equal(tallies.length, 1);
  assert.equal(tallies[0].n, 1);
});

test("aggregation output carries no ranking vocabulary and no identifier", () => {
  const tallies = aggregateReactions([
    {
      targetType: "FEDERAL_VOTE",
      targetId: "house:119-2:283",
      reaction: "YES",
      ocdIds: ["ocd-division/country:us/state:az"],
      verificationTier: "ANONYMOUS",
    },
  ]);
  const forbidden = /score|rank|rating|match|fit|grade|alignment|recommend|key|hash|user|device/;
  const walk = (value: unknown, path: string): void => {
    if (typeof value !== "object" || value === null) return;
    for (const [k, v] of Object.entries(value)) {
      // Tier names are enum values used as record keys — VOTER_MATCHED's
      // "match" names a future verification method, not a fit score.
      if (!(VERIFICATION_TIERS as string[]).includes(k)) {
        assert.ok(
          !forbidden.test(k.toLowerCase()),
          `aggregate key "${path}.${k}" matches forbidden vocabulary`,
        );
      }
      walk(v, `${path}.${k}`);
    }
  };
  walk(tallies, "$");
});

// ── Validation fails closed ──────────────────────────────────────────────

test("validation: enums are closed sets, keys are shaped, targets are capped", () => {
  assert.ok(isValidTargetType("FEDERAL_VOTE"));
  // CANDIDATE joined the closed set 2026-08-16 (3d); MEASURE has not yet.
  assert.ok(isValidTargetType("CANDIDATE"));
  assert.ok(!isValidTargetType("MEASURE"));
  assert.ok(!isValidTargetType(""));

  assert.ok(isValidReactionValue("UNSURE"));
  assert.ok(!isValidReactionValue("MAYBE"));

  assert.ok(isValidReactionKey("a".repeat(32)));
  assert.ok(!isValidReactionKey("short"));
  assert.ok(!isValidReactionKey("a".repeat(65)));
  assert.ok(!isValidReactionKey("has spaces here!".padEnd(20, "x")));
  assert.ok(!isValidReactionKey(42));

  assert.ok(isPlausibleTargetId("house:119-2:283"));
  // Lineup-nominee keys run longer than roll-call ids; the cap moved to 128
  // with the CANDIDATE class (3d).
  assert.ok(isPlausibleTargetId('ballot-az-pima:mine-inspector|Walter "Les" Presmyk'));
  assert.ok(!isPlausibleTargetId(""));
  assert.ok(!isPlausibleTargetId("x".repeat(129)));
});

test("CANDIDATE reactions validate against the ballot files, and nothing ranks from them", async () => {
  const { getCandidateTargetIds } = await import("../lib/ballot/candidate-targets.ts");
  const ids = getCandidateTargetIds();
  // Denominator: 15 NJ + 41+6 NH candidacies + 29 AZ lineup nominee keys.
  assert.ok(ids.size >= 85, `expected the full candidate universe, got ${ids.size}`);
  assert.ok(ids.has("ballot-nj-morris:us-senate:booker"));
  assert.ok(ids.has("ballot-nh-merrimack:executive-council-2:liot-hill-karen"));
  assert.ok(ids.has("ballot-az-pima:governor|Katie Hobbs"));
  assert.ok(!ids.has("ballot-az-pima:governor|Nobody Realname"));

  // The neutrality guard extends over the fourth class (3d): the candidate-
  // reaction path may never grow ranking vocabulary, and the ballot page
  // must not order candidates by reactions — its only sorts are the filed
  // ballot order and surname.
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  for (const file of [
    "lib/ballot/candidate-targets.ts",
    "lib/signal/reactions.ts",
    "lib/signal/aggregate.ts",
  ]) {
    const source = readFileSync(join(process.cwd(), file), "utf8").toLowerCase();
    for (const banned of ['"score"', '"rank"', '"rating"', '"match"', '"fit"', '"grade"', '"alignment"', '"recommendation"']) {
      assert.ok(!source.includes(banned), `${file} must not carry ${banned}`);
    }
  }
  const ballotPage = readFileSync(
    join(process.cwd(), "app", "ballot", "page.tsx"),
    "utf8",
  );
  assert.ok(
    !/sort\([^)]*reaction/i.test(ballotPage),
    "the ballot page must never order candidates by reactions",
  );
});

test("reaction targets are validated against the committed votes snapshot", () => {
  const ids = getVoteIds();
  // The denominator: the snapshot window is 20 rolls per chamber.
  assert.ok(ids.size >= 20, `expected a real snapshot, found ${ids.size} vote ids`);
  for (const id of ids) {
    assert.match(id, /^(house|senate):\d+-\d+:\d+$/);
  }
  assert.ok(!ids.has("house:0-0:99999"), "an invented roll must not validate");
});

// ── The write path stays identity-free and honest without a database ─────

test("the continuity key is stored only as a hash", () => {
  const raw = "0123456789abcdef0123456789abcdef";
  const hash = hashReactionKey(raw);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, raw);
  assert.equal(hash, hashReactionKey(raw), "hashing must be deterministic for upsert continuity");
});

test("a missing database is a quiet false, never a throw or a fake success", async () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const stored = await writeReaction({
      targetType: "FEDERAL_VOTE",
      targetId: "house:119-2:283",
      reaction: "YES",
      reactionKey: "0123456789abcdef0123456789abcdef",
      ocdIds: [],
    });
    assert.equal(stored, false);
  } finally {
    if (saved !== undefined) process.env.DATABASE_URL = saved;
  }
});

// ── Rate limiting (demo-grade by decision; the mechanism still proves out) ─

test("rate limiter: a burst beyond the limit is rejected, and the window recovers", () => {
  const limiter = new SlidingWindowLimiter(5, 60_000);
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) {
    assert.ok(limiter.allow("k", t0 + i), `tap ${i + 1} of 5 should pass`);
  }
  assert.ok(!limiter.allow("k", t0 + 10), "the burst's 6th tap must be rejected");
  // Another key is unaffected — per-key isolation.
  assert.ok(limiter.allow("other", t0 + 10));
  // After the window slides, the key recovers.
  assert.ok(limiter.allow("k", t0 + 60_001 + 1));
});

// ── The honest outcome — success is earned by the 204, nothing else ──────
// (Session brief 1, wall clock 2026-08-14, the author's decided option two:
// any non-204 — 202, 500, network failure — renders the honest not-counted
// line; the device-local record still writes either way.)

test("submitReaction: 204 is COUNTED; 202, 500, and a network failure are NOT_COUNTED", async () => {
  const { submitReaction } = await import("../lib/reactions/client.ts");
  const realFetch = globalThis.fetch;
  const outcomes: Record<string, string> = {};
  try {
    for (const status of [204, 202, 500]) {
      globalThis.fetch = (async () => new Response(null, { status })) as typeof fetch;
      outcomes[String(status)] = await submitReaction(
        "FEDERAL_VOTE",
        "house:119-2:283",
        "YES",
        null,
      );
    }
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    outcomes.network = await submitReaction(
      "FEDERAL_VOTE",
      "house:119-2:283",
      "YES",
      null,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(outcomes["204"], "COUNTED", "the 204 earns the success rendering");
  // 202 is a never-happens state now that the store is live — if it ever
  // reappears it must render as failure, never as quiet success.
  assert.equal(outcomes["202"], "NOT_COUNTED");
  assert.equal(outcomes["500"], "NOT_COUNTED");
  assert.equal(outcomes.network, "NOT_COUNTED");
});

test("submitReaction: the device-local record writes even when the server is unreachable", async () => {
  const { submitReaction, getStoredReaction } = await import(
    "../lib/reactions/client.ts"
  );
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  try {
    const outcome = await submitReaction(
      "FEDERAL_VOTE",
      "house:119-2:999",
      "NO",
      null,
    );
    assert.equal(outcome, "NOT_COUNTED");
    // The device's own memory is the reader's, always — the failed network
    // half never costs them their tap.
    assert.equal(getStoredReaction("FEDERAL_VOTE", "house:119-2:999"), "NO");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the control renders the three outcomes honestly — counted, saving, not-counted", () => {
  const control = readFileSync(
    join(process.cwd(), "components", "reactions", "reaction-control.tsx"),
    "utf8",
  );
  // The honest line renders exactly on NOT_COUNTED…
  assert.ok(
    control.includes('outcome === "NOT_COUNTED" && ('),
    "anything short of a 204 must render the honest not-counted line",
  );
  assert.ok(
    control.includes("NOT_COUNTED_LINE"),
    "the control must render the shared honest line, not a local paraphrase",
  );
  // …the success styling is gated on the outcome, not on the tap…
  assert.ok(
    control.includes('outcome === "SAVING"'),
    "an in-flight write must render as saving, not as success",
  );
  // …and the control awaits the real outcome from submitReaction.
  assert.ok(
    control.includes("await submitReaction"),
    "the control must await the server's answer — success is earned, not assumed",
  );
});

test("the honest line says both truths: saved on this device, not counted", async () => {
  const { NOT_COUNTED_LINE } = await import("../lib/reactions/client.ts");
  assert.ok(NOT_COUNTED_LINE.includes("saved on this device"));
  assert.ok(NOT_COUNTED_LINE.includes("wasn't counted"));
  assert.ok(NOT_COUNTED_LINE.toLowerCase().includes("couldn't reach the totals"));
});

// ── The disclosure coupling — the 5a⇔5b rule extended to reactions ───────

test("the capture point and the transparency page disclose together", () => {
  // The control (3c, 2026-08-16, author-approved TOS pattern): the first-ever
  // tap surfaces a one-time notice that must be acknowledged BEFORE the
  // answer records, with the approved sentence and the transparency link.
  // The notice gates capture — the pending tap applies only on acknowledge.
  const control = readFileSync(
    join(process.cwd(), "components", "reactions", "reaction-control.tsx"),
    "utf8",
  );
  assert.ok(
    control.includes("Your answer joins anonymous local totals. We never know who you"),
    "the one-time notice must carry the approved sentence",
  );
  assert.ok(
    control.includes("How we use this"),
    "the notice must link the full explanation",
  );
  assert.ok(
    control.includes('href="/transparency"'),
    "the notice's link must open the transparency page",
  );
  assert.ok(
    control.includes("disclosureAcknowledged()") &&
      control.includes("setPendingValue(value)"),
    "an unacknowledged tap must park, never record",
  );

  // The transparency page: reactions, the hashed continuity key, and the
  // tier split are all disclosed in the same terms the schema enforces.
  const page = readFileSync(
    join(process.cwd(), "app", "transparency", "page.tsx"),
    "utf8",
  ).toLowerCase();
  // 1b (2026-08-17): "sell" retired from reader surfaces — the commercial
  // fact stays, stated as "may be licensed". The page must still state it.
  for (const claim of ["reaction", "hashed", "verification tier", "licensed"]) {
    assert.ok(page.includes(claim), `the transparency page must mention "${claim}"`);
  }
  assert.ok(
    !/\bsold\b|\bsell\b/.test(page),
    'reader wording: "sell/sold" retired in favor of "licensed" (1b)',
  );
  // 1d: the OFFICIAL_OPENED event ships with its disclosure line.
  assert.ok(
    page.includes("official"),
    "the transparency page must disclose that opening an official's card is logged",
  );
});
