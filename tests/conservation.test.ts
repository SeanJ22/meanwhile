import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  ConservationError,
  ZeroRowExtractionError,
  accountedNormalize,
  conserve,
  isZeroRowExtraction,
  totalDropped,
} from "../lib/sources/normalize-account.ts";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));

test("100 in, 0 out, 1 recorded drop is a FAILURE, not an accounted run", () => {
  assert.throws(
    () =>
      accountedNormalize("adversarial", rows(100), {
        meetings: [],
        drops: { malformed: 1 },
      }, { logicalInput: 100 }),
    (error: unknown) => {
      assert.ok(error instanceof ConservationError, "the wrong error type — this must name the terms");
      assert.match(error.message, /99 logical record\(s\) have NO disposition/);
      assert.match(error.message, /produced 0/);
      assert.match(error.message, /dropped 1/);
      return true;
    },
  );
});

test("the gap's SIGN is stated, because it says which way to look", () => {
  assert.throws(
    () => conserve("s", { logicalInput: 10, produced: 3, dropped: 1, outOfWindow: 0, duplicates: 0, unretrieved: 0 }),
    /6 logical record\(s\) have NO disposition/,
  );
  // Over: something is counted twice, which is a different bug entirely.
  assert.throws(
    () => conserve("s", { logicalInput: 4, produced: 3, dropped: 3, outOfWindow: 0, duplicates: 0, unretrieved: 0 }),
    /2 more disposition\(s\) than records/,
  );
});

test("every one of the four dispositions counts toward the sum", () => {
  const r = conserve("s", {
    logicalInput: 14,
    produced: 4,
    dropped: 3,
    outOfWindow: 5,
    duplicates: 2,
    unretrieved: 0,
  });
  assert.equal(r.outcome, "CONSERVED");
  assert.equal(r.accountedFor, 14);
});

// `unretrieved` counts documents and `logicalInput` counts events; a refused feed is already absent from `logicalInput`, so adding them double-counts.
test("unretrieved DOCUMENTS are reported but never summed with logical records", () => {
  const r = conserve("ical", {
    logicalInput: 1357,
    produced: 26,
    dropped: 1290,
    outOfWindow: 41,
    duplicates: 0,
    unretrieved: 1,
  });
  assert.equal(r.outcome, "CONSERVED", "the refused feed must not make this fail");
  assert.equal(r.accountedFor, 1357);
  assert.equal(r.unretrieved, 1, "and it is still carried, because the report needs it");
});

test("a fractional or negative counter is refused before the sum is trusted", () => {
  assert.throws(
    () => conserve("s", { logicalInput: 5, produced: -1, dropped: 6, outOfWindow: 0, duplicates: 0, unretrieved: 0 }),
    /produced is -1, which is not a count/,
  );
  assert.throws(
    () => conserve("s", { logicalInput: 5, produced: 2.5, dropped: 2.5, outOfWindow: 0, duplicates: 0, unretrieved: 0 }),
    /produced is 2.5, which is not a count/,
  );
});

// The unit is the logical record: one .ics document is one raw row and many meetings.
test("one document expanding into twenty events conserves", () => {
  const r = accountedNormalize(
    "ical",
    rows(1), // ONE document
    { meetings: Array.from({ length: 18 }, () => ({}) as never), drops: { unknownVenue: 1 } },
    { logicalInput: 20, outOfWindow: 1 },
  );
  assert.equal(r.accounting.outcome, "CONSERVED");
  assert.equal(r.accounting.logicalInput, 20);
});

test("a pass that cannot count records COULD_NOT_ASSERT — never a silent pass", () => {
  const r = accountedNormalize("legacy", rows(3), {
    meetings: [{} as never],
    drops: { unknownVenue: 1 },
  });
  assert.equal(r.accounting.outcome, "COULD_NOT_ASSERT");
  assert.equal(r.accounting.logicalInput, null);
  assert.equal(r.accounting.accountedFor, 2, "the dispositions are still counted and reported");
});

test("COULD_NOT_ASSERT is not CONSERVED, and nothing may read them alike", () => {
  const cannot = conserve("a", {
    logicalInput: null,
    produced: 1,
    dropped: 0,
    outOfWindow: 0,
    duplicates: 0,
    unretrieved: 0,
  });
  const did = conserve("b", {
    logicalInput: 1,
    produced: 1,
    dropped: 0,
    outOfWindow: 0,
    duplicates: 0,
    unretrieved: 0,
  });
  assert.notEqual(cannot.outcome, did.outcome);
  assert.equal(cannot.outcome, "COULD_NOT_ASSERT");
  assert.equal(did.outcome, "CONSERVED");
});

test("totalDropped sums the counters rather than asking whether any is set", () => {
  assert.equal(totalDropped({ a: 1, b: 2, c: 0 }), 3);
  assert.equal(totalDropped({}), 0);
  // Non-numeric members are ignored rather than coerced: `legistar` carries an
  // `agendasRead` count alongside its drops in the same result object.
  assert.equal(totalDropped({ a: 1, note: "x" as unknown as number }), 1);
});

test("the zero-row predicate has ONE implementation and both callers use it", () => {
  assert.equal(
    isZeroRowExtraction({ documentsInHand: 3, produced: 0, dropped: 0, outOfWindow: 0 }),
    true,
    "three documents in hand, nothing out, nothing dropped — RULING 43",
  );
  assert.equal(
    isZeroRowExtraction({ documentsInHand: 3, produced: 0, dropped: 3, outOfWindow: 0 }),
    false,
    "a source that dropped everything already said why",
  );
  assert.equal(
    isZeroRowExtraction({ documentsInHand: 0, produced: 0, dropped: 0, outOfWindow: 0 }),
    false,
    "nothing fetched is an empty upstream, judged at the fetch layer",
  );
});

test("documents in hand and nothing out still throws", () => {
  assert.throws(
    () => accountedNormalize("ical", rows(3), { meetings: [], drops: {} }, { logicalInput: 0 }),
    ZeroRowExtractionError,
  );
});

test("legistar's composite wrapper conserves, and agrees with the adapter EXACTLY", async () => {
  const { normalizeWithDrops } = await import("../lib/sources/legistar/index.ts");
  const { CAPABILITIES, wiringForSourceName } = await import("../lib/sources/composite/wiring.ts");

  const events = JSON.parse(
    readFileSync(join(import.meta.dirname, "fixtures", "legistar-pima-events.json"), "utf8"),
  ) as Record<string, unknown>[];
  const raw = events.map((event) => ({
    event,
    slug: "pima",
    collectedAt: "2026-08-25",
    items: [],
  })) as unknown as Parameters<typeof normalizeWithDrops>[0];
  const now = new Date("2026-08-25T12:00:00Z");

  const direct = normalizeWithDrops(raw, now);
  assert.equal(direct.accounting.outcome, "CONSERVED", "the adapter itself must conserve");
  assert.ok(
    direct.drops.placeless > 0,
    "the fixture must still carry a placeless meeting, or this guard proves nothing (RULING 110)",
  );

  const cap = CAPABILITIES.find((c) => c.name === "legistar");
  assert.ok(cap, "the legistar capability must be registered");
  const child = cap.make(wiringForSourceName("legistar"));
  assert.ok(child.normalizeWithDrops, "the legistar child must report its drops");
  const wrapped = child.normalizeWithDrops(raw as never, now) as unknown as {
    accounting: Record<string, unknown>;
  };

  assert.deepEqual(
    { ...wrapped.accounting },
    { ...(direct.accounting as unknown as Record<string, unknown>) },
    "the composite wrapper must report the adapter's own accounting, never a second one",
  );
});
