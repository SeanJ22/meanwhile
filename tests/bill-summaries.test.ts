import assert from "node:assert/strict";
import { test } from "node:test";

import { allBillSummaries } from "../lib/votes/bill-summaries.ts";
import { initializeFederalVoteFirstSeed } from "./helpers/federal-vote-first-seed.ts";

await initializeFederalVoteFirstSeed();

test("every pending bill states its reason", () => {
  for (const p of allBillSummaries().pending) {
    assert.ok(p.reason.length > 30, `${p.billUrl}: a pending row needs its reason`);
  }
});

test("every summary cites its CRS basis with a date, in a neutral register", () => {
  const { summaries } = allBillSummaries();
  const banned = [
    "commonsense",
    "common-sense",
    "radical",
    "extreme",
    "disastrous",
    "landmark",
    "dangerous",
    "reckless",
    "vital",
    "crucial",
    "long overdue",
  ];
  for (const [url, s] of Object.entries(summaries)) {
    assert.match(
      s.basis,
      /Congressional Research Service summary.*\d{4}-\d{2}-\d{2}/,
      `${url}: the basis must name CRS and the version date`,
    );
    assert.ok(s.summary.length > 80, `${url}: a one-liner is not a summary`);
    const lower = s.summary.toLowerCase();
    for (const word of banned) {
      assert.ok(!lower.includes(word), `${url}: advocacy vocabulary ("${word}")`);
    }
  }
});
