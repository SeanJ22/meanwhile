import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { allBillSummaries } from "../lib/votes/bill-summaries.ts";
import { initializeFederalVoteFirstSeed } from "./helpers/federal-vote-first-seed.ts";

await initializeFederalVoteFirstSeed();

/**
 * The curated bill summaries (item 4, 2026-08-16) — the measure-summaries
 * discipline applied to the vote window:
 * - completeness both directions: every bill in the votes snapshot is
 *   either summarized or honestly pending with a reason, and every
 *   summary/pending key points at a bill that exists in the snapshot;
 * - every summary states the CRS basis it paraphrases, with its date;
 * - the register stays neutral — no advocacy vocabulary.
 */

function snapshotBillUrls(): Set<string> {
  const snapshot = JSON.parse(
    readFileSync(join(process.cwd(), "data", "votes", "votes-snapshot.json"), "utf8"),
  ) as { votes: { billUrl: string | null }[] };
  return new Set(
    snapshot.votes.flatMap((v) => (v.billUrl ? [v.billUrl] : [])),
  );
}

test("every bill in the vote window is summarized or honestly pending", () => {
  const { summaries, pending } = allBillSummaries();
  const urls = snapshotBillUrls();

  // Denominator printed by the fetch: 14 distinct bills carry a billUrl.
  assert.ok(urls.size >= 10, `expected a substantive window, got ${urls.size}`);

  for (const url of urls) {
    assert.ok(
      url in summaries || pending.some((p) => p.billUrl === url),
      `${url}: neither summarized nor recorded pending — the coming state must be deliberate`,
    );
  }
  for (const url of Object.keys(summaries)) {
    assert.ok(urls.has(url), `${url}: summary keys to no bill in the snapshot`);
  }
  for (const p of pending) {
    assert.ok(urls.has(p.billUrl), `${p.billUrl}: pending row keys to no bill`);
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
