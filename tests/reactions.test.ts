import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { aggregateReactions } from "../lib/signal/aggregate.ts";
import { SlidingWindowLimiter } from "../lib/signal/rate-limit.ts";
import {
  SCALE_BREAKS,
  SCALE_V1,
  SCALE_V2_FUNDING,
  VERIFICATION_TIERS,
  isPlausibleTargetId,
  isValidReactionKey,
  isValidReactionValue,
  isValidTargetType,
  isValueOnScaleFor,
  questionForTargetType,
  scaleForTargetType,
  valuesForScaleVersion,
} from "../lib/signal/reactions.ts";
import { hashReactionKey, writeReaction } from "../lib/db/reactions.ts";

test("aggregation: reactions in, per-division tier-split tallies out, n stated", () => {
  const rows = [
    {
      targetType: "FEDERAL_VOTE" as const,
      targetId: "house:119-2:283",
      reaction: "YES" as const,
      ocdIds: ["ocd-division/country:us/state:az", "ocd-division/country:us/state:az/cd:7"],
      verificationTier: "ANONYMOUS" as const,
      runClass: "ORGANIC" as const,
    },
    {
      targetType: "FEDERAL_VOTE" as const,
      targetId: "house:119-2:283",
      reaction: "NO" as const,
      ocdIds: ["ocd-division/country:us/state:az/cd:7"],
      verificationTier: "ANONYMOUS" as const,
      runClass: "ORGANIC" as const,
    },
    {
      targetType: "FEDERAL_VOTE" as const,
      targetId: "house:119-2:283",
      reaction: "UNSURE" as const,
      ocdIds: ["ocd-division/country:us/state:az/cd:7"],
      verificationTier: "LOCALITY_VERIFIED" as const,
      runClass: "ORGANIC" as const,
    },
  ];

  const tallies = aggregateReactions(rows);
  const cd7 = tallies.find((t) => t.ocdId.endsWith("cd:7"));
  const az = tallies.find((t) => t.ocdId.endsWith("state:az"));

  assert.ok(cd7, "cd:7 tally missing");
  assert.ok(az, "state tally missing");

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
      runClass: "ORGANIC" as const,
    },
  ]);
  assert.equal(tallies.length, 1);
  for (const tier of VERIFICATION_TIERS) {
    const t = tallies[0].tiers[tier];
    assert.ok(t, `tier ${tier} missing from the tally`);
    const sum = valuesForScaleVersion(tallies[0].scaleVersion).reduce(
      (acc, value) => acc + (t[value] ?? 0),
      0,
    );
    assert.equal(t.n, sum, `tier ${tier}: n is not the sum`);
  }
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
      runClass: "ORGANIC" as const,
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
      runClass: "ORGANIC" as const,
    },
  ]);
  const forbidden = /score|rank|rating|match|fit|grade|alignment|recommend|key|hash|user|device/;
  const walk = (value: unknown, path: string): void => {
    if (typeof value !== "object" || value === null) return;
    for (const [k, v] of Object.entries(value)) {
      // Tier names are enum keys; VOTER_MATCHED's "match" is not a fit score.
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

test("validation: enums are closed sets, keys are shaped, targets are capped", () => {
  assert.ok(isValidTargetType("FEDERAL_VOTE"));
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
  assert.ok(isPlausibleTargetId('ballot-az-pima:mine-inspector|Walter "Les" Presmyk'));
  assert.ok(!isPlausibleTargetId(""));
  assert.ok(!isPlausibleTargetId("x".repeat(129)));
});

test("the candidate reaction path carries no ranking vocabulary, and the ballot page never sorts by reactions", async () => {
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
      marker: { runClass: "SYNTHETIC", runId: "reactions-test" },
    });
    assert.equal(stored, false);
  } finally {
    if (saved !== undefined) process.env.DATABASE_URL = saved;
  }
});

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

test("submitReaction: 204 is COUNTED; 202, 500, and a network failure are NOT_COUNTED", async () => {
  const { submitReaction } = await import("../lib/reactions/client.ts");
  const realFetch = globalThis.fetch;
  const outcomes: Record<string, string> = {};
  try {
    for (const status of [204, 202, 429, 500, 503]) {
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
  assert.equal(outcomes["202"], "NOT_COUNTED");
  assert.equal(outcomes["429"], "NOT_COUNTED");
  assert.equal(outcomes["500"], "NOT_COUNTED");
  assert.equal(outcomes["503"], "NOT_COUNTED");
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
    assert.equal(getStoredReaction("FEDERAL_VOTE", "house:119-2:999"), "NO");
  } finally {
    globalThis.fetch = realFetch;
  }
});

/** The component decides when; `lib/reactions/pill.ts` decides what it wears. */
function controlSource(): string {
  return [
    readFileSync(
      join(process.cwd(), "components", "reactions", "reaction-control.tsx"),
      "utf8",
    ),
    readFileSync(join(process.cwd(), "lib", "reactions", "pill.ts"), "utf8"),
  ].join("\n");
}

test("the control renders the three outcomes honestly — counted, saving, not-counted", () => {
  const control = controlSource();
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

test("SOMEONE_ELSE is in the enum and restricted to one-candidate contests", async () => {
  const { REACTION_VALUES, CONTEXT_RESTRICTED_VALUES, isValidReactionValue } =
    await import("../lib/signal/reactions.ts");

  assert.ok(REACTION_VALUES.includes("SOMEONE_ELSE"));
  assert.ok(isValidReactionValue("SOMEONE_ELSE"));
  assert.equal(
    CONTEXT_RESTRICTED_VALUES.SOMEONE_ELSE,
    "SINGLE_CANDIDATE_CONTEST",
    "the value must declare the context it depends on",
  );
  for (const value of ["YES", "NO", "UNSURE"] as const) {
    assert.equal(CONTEXT_RESTRICTED_VALUES[value], undefined);
  }
});

test("the fourth button renders only where the answer is accepted", () => {
  const control = controlSource();
  assert.ok(
    control.includes('SOMEONE_ELSE: "Someone else"'),
    "the label must be the author's words",
  );
  assert.ok(
    control.includes("singleCandidateContest"),
    "the control must gate the fourth answer on the contest's shape",
  );
  const ballot = readFileSync(
    join(process.cwd(), "app", "ballot", "page.tsx"),
    "utf8",
  );
  assert.ok(
    ballot.includes("lineup.nominees.length === 1") &&
      ballot.includes("candidatesOf(set, contest).length === 1"),
    "both candidate surfaces must derive the flag by counting the contest",
  );

  assert.ok(
    control.includes('outcome === "NOT_COUNTED"') && control.includes("NOT_COUNTED_LINE"),
    "the not-counted rendering must still gate every answer",
  );
});

test("the funding scale is the funding scale, and nothing else is", () => {
  assert.deepEqual(SCALE_V2_FUNDING.values, [
    "LOVE",
    "LIKE",
    "DISLIKE",
    "HATE",
    "DONT_CARE",
  ]);
  assert.equal(
    SCALE_V2_FUNDING.question,
    "How do you feel about how this campaign is funded?",
  );

  // The scale is decided by the target, so a client cannot choose its own instrument.
  assert.equal(scaleForTargetType("FUNDING_TOTAL_REACTION").version, 2);
  assert.equal(scaleForTargetType("CONTRIBUTOR_REACTION").version, 3);
  assert.deepEqual(
    scaleForTargetType("CONTRIBUTOR_REACTION").values,
    SCALE_V2_FUNDING.values,
    "v3 is the same five answers — the break is about the QUESTION, not the values",
  );
  assert.equal(
    scaleForTargetType("CONTRIBUTOR_REACTION").question,
    "How do you feel about these contributions?",
    "the wording lives beside the version, per the ruling",
  );
  for (const type of ["FEDERAL_VOTE", "CANDIDATE"] as const) {
    assert.equal(scaleForTargetType(type).version, 1);
    assert.deepEqual(scaleForTargetType(type).values, SCALE_V1.values);
  }

  assert.equal(isValueOnScaleFor("FUNDING_TOTAL_REACTION", "LOVE"), true);
  assert.equal(isValueOnScaleFor("FUNDING_TOTAL_REACTION", "YES"), false);
  assert.equal(isValueOnScaleFor("FEDERAL_VOTE", "YES"), true);
  assert.equal(isValueOnScaleFor("FEDERAL_VOTE", "LOVE"), false);
  assert.equal(isValueOnScaleFor("CANDIDATE", "DONT_CARE"), false);

  const v1 = new Set(SCALE_V1.values);
  for (const value of SCALE_V2_FUNDING.values) {
    assert.ok(!v1.has(value), `${value} is on both scales`);
  }
});

test("aggregates never mix scales, and the break is dated", () => {
  const target = "H2AZ02360";
  const ocdIds = ["ocd-division/country:us/state:az/cd:6"];
  const base = {
    targetType: "FUNDING_TOTAL_REACTION" as const,
    targetId: target,
    ocdIds,
    verificationTier: "ANONYMOUS" as const,
    runClass: "ORGANIC" as const,
  };

  const tallies = aggregateReactions([
    { ...base, reaction: "YES" as const, scaleVersion: 1 as const },
    { ...base, reaction: "NO" as const, scaleVersion: 1 as const },
    { ...base, reaction: "LOVE" as const, scaleVersion: 2 as const },
    { ...base, reaction: "HATE" as const, scaleVersion: 2 as const },
    { ...base, reaction: "DONT_CARE" as const, scaleVersion: 2 as const },
  ]);

  assert.equal(tallies.length, 2, "two instruments collapsed into one tally");
  const v1 = tallies.find((t) => t.scaleVersion === 1);
  const v2 = tallies.find((t) => t.scaleVersion === 2);
  assert.ok(v1 && v2);
  assert.equal(v1.n, 2);
  assert.equal(v2.n, 3);

  assert.deepEqual(
    Object.keys(v1.tiers.ANONYMOUS).sort(),
    [...SCALE_V1.values, "n"].sort(),
  );
  assert.deepEqual(
    Object.keys(v2.tiers.ANONYMOUS).sort(),
    [...SCALE_V2_FUNDING.values, "n"].sort(),
  );
  assert.equal(v2.tiers.ANONYMOUS.LOVE, 1);
  assert.equal(v2.tiers.ANONYMOUS.LIKE, 0, "an unchosen column says 0");

  assert.equal(v2.question, SCALE_V2_FUNDING.question);
  assert.notEqual(v1.question, v2.question);

  const breaks = SCALE_BREAKS.filter((b) =>
    b.targetTypes.includes("FUNDING_TOTAL_REACTION"),
  );
  assert.equal(breaks.length, 1);
  assert.equal(breaks[0].date, "2026-08-15");
  assert.equal(breaks[0].from, 1);
  assert.equal(breaks[0].to, 2);
  assert.ok(breaks[0].why.length > 40, "a scale break without a reason is a mystery");

  // An absent version is 1, matching the column default.
  const legacy = aggregateReactions([{ ...base, reaction: "YES" as const }]);
  assert.equal(legacy[0].scaleVersion, 1);
});

test("the funding surfaces ask the author's question, and offer only its scale", () => {
  const section = readFileSync(
    join(process.cwd(), "components", "funding", "funding-section.tsx"),
    "utf8",
  );
  const asks = section.match(/prompt="([^"]+)"/g) ?? [];
  assert.equal(asks.length, 2, "both funding controls must carry a prompt");
  assert.equal(asks[0], 'prompt="How do you feel about how this campaign is funded?"');
  assert.equal(asks[1], 'prompt="How do you feel about these contributions?"');
  assert.equal(
    new Set(asks).size,
    2,
    "the two funding asks must not ask the same question twice",
  );
  assert.ok(!/Would you vote for someone whose campaign/.test(section));
  assert.ok(!/Would you vote for someone with these contributors/.test(section));

  const control = controlSource();
  assert.ok(control.includes("scaleForTargetType(targetType)"));
  for (const label of ["Love it", "Like it", "Don't like it", "Hate it", "Don't care"]) {
    assert.ok(control.includes(label), `the control is missing "${label}"`);
  }
});


test("every provision is a valid reaction target, and reactions attach to the PART", async () => {
  const { provisionsForContest, getProvisionTargetIds } = await import(
    "../lib/ballot/measure-provisions.ts"
  );
  const { azBallot } = await import("./helpers/ballot-district-fixtures.ts");
  const records = azBallot.measureRecords ?? [];
  const provisions = records.flatMap(record => provisionsForContest(record.contestId, records));
  const ids = getProvisionTargetIds(records);

  assert.ok(provisions.length > 0, "no provisions to react to");
  assert.equal(ids.size, provisions.length, "a provision lost its target id");

  // The id names both the measure and the part answered.
  for (const provision of provisions) {
    assert.ok(
      provision.id.startsWith(provision.contestId + "#"),
      `${provision.id} does not name its contest`,
    );
    assert.ok(provision.id.length > provision.contestId.length + 1);
  }

  const kinds = new Set(provisions.map((provision) => provision.kind));
  for (const kind of ["FUNDING", "PROGRAM", "OVERSIGHT", "SUNSET", "START"] as const) {
    assert.ok(kinds.has(kind), `no provision of kind ${kind} exists to react to`);
  }
});

test("the provision question asks about the part, never how to vote", () => {
  const question = scaleForTargetType("MEASURE_PROVISION").question;
  const asked = questionForTargetType("MEASURE_PROVISION");
  assert.notEqual(asked, question, "the provision question must be its own wording");
  assert.ok(asked.length > 0);
  assert.doesNotMatch(asked, /vote (yes|no)|should you|recommend/i);
});

test("the verbatim is optional, capped, and its shape is checked with no flag", async () => {
  const { isValidFreeText, normalizeFreeText, FREE_TEXT_MAX_CHARS } = await import(
    "../lib/signal/reactions.ts"
  );

  assert.equal(isValidFreeText(undefined), true);
  assert.equal(isValidFreeText(null), true);
  assert.equal(isValidFreeText("this is a real opinion"), true);
  assert.equal(isValidFreeText("x".repeat(FREE_TEXT_MAX_CHARS)), true);
  assert.equal(isValidFreeText("x".repeat(FREE_TEXT_MAX_CHARS + 1)), false);
  assert.equal(isValidFreeText(42), false);
  assert.equal(isValidFreeText({ text: "hi" }), false);

  assert.equal(normalizeFreeText("   \n  "), null);
  assert.equal(normalizeFreeText("  said something  "), "said something");
  assert.equal(normalizeFreeText(undefined), null);
});

test("the threat notice sits beside the field, and reserves rather than promises", async () => {
  const { FREE_TEXT_THREAT_NOTICE } = await import("../lib/signal/reactions.ts");

  assert.match(FREE_TEXT_THREAT_NOTICE, /may be reported/i);
  assert.doesNotMatch(FREE_TEXT_THREAT_NOTICE, /will be reported/i);
  assert.match(FREE_TEXT_THREAT_NOTICE, /threats of violence/i);

  const control = readFileSync(
    join(process.cwd(), "components/reactions/reaction-control.tsx"),
    "utf8",
  );
  assert.match(control, /FREE_TEXT_THREAT_NOTICE/);
  // The RENDERED reference, not the import at the top of the file.
  const noticeAt = control.indexOf("{FREE_TEXT_THREAT_NOTICE}");
  assert.ok(noticeAt > 0, "the notice is imported but never rendered");
  const textareaAt = control.indexOf("<textarea");
  assert.ok(textareaAt >= 0, "no free-text input in the control");
  assert.ok(
    noticeAt > textareaAt && noticeAt - textareaAt < 2000,
    "the threat notice is not adjacent to the field it warns about",
  );
});

test("a planted verbatim reaches no aggregate — the input type has no room for it", async () => {
  const { aggregateReactions, rowsEligibleForAggregation } = await import(
    "../lib/signal/aggregate.ts"
  );

  const planted = {
    targetType: "MEASURE_PROVISION",
    targetId: "ballot-az-pima:prop-141#no-mileage-tax",
    reaction: "YES",
    ocdIds: ["ocd-division/country:us/state:az"],
    verificationTier: "ANONYMOUS",
    runClass: "ORGANIC" as const,
    // The cast is required because the aggregation input has no verbatim field.
    freeText: "PLANTED-VERBATIM-SENTINEL-g19 my neighbour Dave said this",
  } as unknown as Parameters<typeof aggregateReactions>[0][number];

  const eligible = rowsEligibleForAggregation([planted]);
  assert.equal(eligible.length, 1, "the row itself must still be counted");

  const tallies = aggregateReactions([planted]);
  assert.equal(tallies.length, 1, "the binary must aggregate normally");
  assert.equal(tallies[0].n, 1);

  // The sentinel must appear NOWHERE in what a buyer would receive.
  const serialized = JSON.stringify(tallies);
  assert.doesNotMatch(serialized, /PLANTED-VERBATIM-SENTINEL-g19/);
  assert.doesNotMatch(serialized, /neighbour Dave/);
  assert.doesNotMatch(serialized, /freeText|free_text/);

  const aggregateSource = readFileSync(
    join(process.cwd(), "lib/signal/aggregate.ts"),
    "utf8",
  );
  const iface = aggregateSource.slice(
    aggregateSource.indexOf("export interface ReactionRowForAggregation"),
    aggregateSource.indexOf("export type AnswerCounts"),
  );
  assert.ok(iface.length > 0);
  assert.doesNotMatch(iface, /freeText|free_text|text\s*[?:]/);
});
