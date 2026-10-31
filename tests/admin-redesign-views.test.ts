import assert from "node:assert/strict";
import test from "node:test";

import { lateWords, sharedRead } from "@/app/(admin)/_mw/data/shared-read.ts";

/**
 * The honesty rules the Money and Fix list screens make, proven on their pure
 * models: an unread provider is never a number, a bill is never added to the
 * ledger, a state never borrows another state's counts, a fraction of a cent
 * never rounds to a free-looking $0.00, a zero-listing read is never counted
 * as a confirmation, and the marks order the list without dropping an item.
 */

test("a shared read loads once for every caller at once, serves a recent read while refreshing, and says so when it misses its deadline", async () => {
  let clock = 0;
  let loads = 0;
  type R = { readonly kind: "HELD"; readonly n: number } | { readonly kind: "UNREAD"; readonly detail: string };
  const reader = sharedRead<R>(
    { freshMs: 100, staleMs: 1_000, deadlineMs: 30, keep: (r) => r.kind === "HELD", late: (ms) => ({ kind: "UNREAD", detail: lateWords("The test read", ms) }) },
    () => clock,
  );
  const slow = (n: number, ms: number) => () => {
    loads += 1;
    return new Promise<R>((resolve) => setTimeout(() => resolve({ kind: "HELD", n }), ms));
  };

  // Three callers at once share one load.
  const three = await Promise.all([reader.read(slow(1, 5)), reader.read(slow(1, 5)), reader.read(slow(1, 5))]);
  assert.equal(loads, 1);
  assert.deepEqual(three.map((r) => (r.kind === "HELD" ? r.n : null)), [1, 1, 1]);

  // Fresh: no load at all.
  clock = 50;
  assert.deepEqual(await reader.read(slow(2, 5)), { kind: "HELD", n: 1 });
  assert.equal(loads, 1);

  // Recent: the held read is served at once and a fresh one runs behind it.
  clock = 500;
  assert.deepEqual(await reader.read(slow(2, 5)), { kind: "HELD", n: 1 });
  assert.equal(loads, 2);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(await reader.read(slow(3, 5)), { kind: "HELD", n: 2 }, "the refreshed read replaced the recent one");

  // Too old to serve, and slower than the deadline: named as not read, never a blank; the late answer is kept for the next caller.
  clock = 5_000;
  const late = await reader.read(slow(4, 80));
  assert.equal(late.kind, "UNREAD");
  assert.match(late.kind === "UNREAD" ? late.detail : "", /^The test read did not answer within 0 seconds, so it is not shown this time\. .*not the same as there being none\.$/);
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(await reader.read(slow(5, 5)), { kind: "HELD", n: 4 });

  // A failed read is never kept.
  reader.reset();
  const failed = await reader.read(async () => ({ kind: "UNREAD", detail: "down" }) as R);
  assert.equal(failed.kind, "UNREAD");
  assert.deepEqual(await reader.read(slow(6, 5)), { kind: "HELD", n: 6 }, "the next caller reads again");
});

