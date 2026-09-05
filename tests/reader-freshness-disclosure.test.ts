/**
 * **RLC-1 (2026-09-05) — the final rendered Reader proof requires the footer's
 * failed-refresh disclosure from the one contract the footer renders, never
 * from a copy of the prose.**
 *
 * Refresh run #25 (2026-09-05T20:08Z, head 742993c7) refused two genuine
 * holding changes — `data/meetings-snapshot.json` and `data/fec/fec-2026.json`
 * — because `scripts/reader-last-mile-final-render.mts` asserted its own
 * sentence, `older than that: we last reached them`, while the refreshed
 * snapshot's 104 carried rows disagreed on a day and the footer rightly said
 * `each one says when we last reached it`. Both are product forms; the proof
 * had pinned one. Now `lib/meetings/freshness.ts` states the disclosure once,
 * `components/map/data-freshness.tsx` renders it, and the proof checks the
 * page against it through `scripts/lib/reader-freshness-disclosure.ts`.
 * These guards hold the two sides to that one contract, prove the check is
 * not vacuous, and keep the prose from growing a second copy.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  carriedListingsDisclosure,
  freshnessDisclosure,
  type SnapshotStatus,
} from "../lib/meetings/freshness.ts";
import { freshnessDisclosureProblems } from "../scripts/lib/reader-freshness-disclosure.ts";

const ROOT = process.cwd();

const sources = (failed: string[]): SnapshotStatus["sources"] =>
  ["legistar", "schedulepage", "ical"].map((source) => ({ source, ok: !failed.includes(source), error: failed.includes(source) ? "unreachable" : null }));

/** Run #25's served status: two sources down, carried rows spanning more than one day. */
const RUN_25: SnapshotStatus = {
  generatedAt: "2026-09-05T20:10:15.000Z",
  sources: sources(["schedulepage", "ical"]),
  failed: [{ source: "schedulepage", ocdIds: [] }, { source: "ical", ocdIds: [] }],
  carried: { count: 104, lastFreshAt: null },
};
/** The committed 2026-09-04 snapshot's shape: every carried row from one day. */
const ONE_DAY: SnapshotStatus = {
  generatedAt: "2026-09-04T13:31:02.496Z",
  sources: sources(["ical"]),
  failed: [{ source: "ical", ocdIds: [] }],
  carried: { count: 74, lastFreshAt: new Date(Date.now() - 3 * 86_400_000).toISOString() },
};
const ONE_ROW: SnapshotStatus = { ...ONE_DAY, carried: { count: 1, lastFreshAt: ONE_DAY.carried!.lastFreshAt } };
/** A refresh that reached everything: the footer has nothing to disclose past its age. */
const CLEAN: SnapshotStatus = { generatedAt: "2026-09-05T12:00:00.000Z", sources: sources([]), failed: [] };

/** The footer, rendered by React for real (the repo's established pattern: node + tsx + react-dom/server). */
function renderFooter(statuses: SnapshotStatus[]): string[] {
  const output = execFileSync(process.execPath, ["--import", "data:text/javascript,process.geteuid=()=>0", "--import", "tsx", "--input-type=module", "-e", `
    import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { DataFreshness } from './components/map/data-freshness.tsx';
    const statuses = ${JSON.stringify(statuses)};
    console.log(JSON.stringify(statuses.map((snapshot) => renderToStaticMarkup(h(DataFreshness, { snapshot })))));
  `], { cwd: ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(output.trim()) as string[];
}
/** What a browser's innerText would carry: tags gone, entities decoded. */
const innerText = (markup: string): string =>
  markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

test("RLC-1: the actual footer satisfies the proof's check in every form the snapshot can take — one contract on both sides", () => {
  const statuses = [RUN_25, ONE_DAY, ONE_ROW, CLEAN];
  const rendered = renderFooter(statuses).map(innerText);
  for (const [index, status] of statuses.entries()) {
    const check = freshnessDisclosureProblems(rendered[index], status);
    assert.deepEqual(check.problems, [], `${JSON.stringify(status.carried ?? null)}: ${rendered[index]}`);
    assert.deepEqual(check.required, freshnessDisclosure(status));
  }
  // The forms are the product's two sentences, chosen by the rows, not by the proof.
  assert.equal(carriedListingsDisclosure(RUN_25.carried!).form, "EACH_ON_ITS_OWN");
  assert.equal(carriedListingsDisclosure(ONE_DAY.carried!).form, "REACHED_TOGETHER");
  assert.match(rendered[0], /104 calendar listings are older than that: each one says when we last reached it/);
  assert.match(rendered[1], /74 calendar listings are older than that: we last reached them\s+3 days ago/);
  assert.match(rendered[2], /1 calendar listing is older than that: we last reached it\s+3 days ago/);
  assert.match(rendered[0], /couldn't reach schedulepage, ical — some calendars may be missing/);
  // A clean refresh says its age and nothing else — no sentence is required and none rendered.
  assert.equal(freshnessDisclosureProblems(rendered[3], CLEAN).required.carried, null);
  assert.doesNotMatch(rendered[3], /older than that|couldn't reach/);
});

test("RLC-1 NEGATIVE: a page missing the disclosure, or carrying the form the rows do not support, is refused by name", () => {
  const [honest] = renderFooter([RUN_25]).map(innerText);
  assert.deepEqual(freshnessDisclosureProblems(honest, RUN_25).problems, []);

  const withoutCarried = honest.replace(/104 calendar listings are older than that: each one says when we last reached it/, "");
  assert.deepEqual(freshnessDisclosureProblems(withoutCarried, RUN_25).problems, [
    "the footer does not say: 104 calendar listings are older than that: each one says when we last reached it",
  ]);

  const withoutUnreachable = honest.replace(/couldn't reach schedulepage, ical — some calendars may be missing/, "");
  assert.deepEqual(freshnessDisclosureProblems(withoutUnreachable, RUN_25).problems, [
    "the footer does not say: couldn't reach schedulepage, ical — some calendars may be missing",
  ]);

  // The other form: one date spoken for rows that disagree. A claim, refused.
  const wrongForm = honest.replace(/each one says when we last reached it/, "we last reached them 3 days ago");
  assert.deepEqual(freshnessDisclosureProblems(wrongForm, RUN_25).problems, [
    "the footer does not say: 104 calendar listings are older than that: each one says when we last reached it",
    'the footer says "104 calendar listings are older than that: we last reached them", which the carried rows do not support',
  ]);

  // And the mirror image: a per-row deferral when one date IS true of all.
  const [agreed] = renderFooter([ONE_DAY]).map(innerText);
  const deferred = agreed.replace(/we last reached them\s+3 days ago/, "each one says when we last reached it");
  assert.deepEqual(freshnessDisclosureProblems(deferred, ONE_DAY).problems, [
    "the footer does not say: 74 calendar listings are older than that: we last reached them",
    'the footer says "74 calendar listings are older than that: each one says when we last reached it", which the carried rows do not support',
  ]);

  // "we last reached them" with no time after it is a sentence with its claim missing.
  const noWhen = agreed.replace(/we last reached them\s+3 days ago/, "we last reached them ·");
  assert.deepEqual(freshnessDisclosureProblems(noWhen, ONE_DAY).problems, [
    `"we last reached them" is not followed by when (${ONE_DAY.carried!.lastFreshAt})`,
  ]);

  // Blank page: every required sentence is named, nothing is waved through.
  assert.equal(freshnessDisclosureProblems("", RUN_25).problems.length, 2);
});

test("RLC-1 SEEDED run #25: the old proof's own sentence refused the honest footer; the contract check passes it and refuses the stale claim", () => {
  const [honest] = renderFooter([RUN_25]).map(innerText);
  // The assertion run #25 died on, verbatim: true of the 2026-09-04 snapshot,
  // false of the 2026-09-05 one — a copy of prose, not a contract.
  const stale = /older than that: we last reached them/i;
  assert.doesNotMatch(honest, stale, "the honest footer for run #25's snapshot never said this");
  assert.deepEqual(freshnessDisclosureProblems(honest, RUN_25).problems, []);
});

test("RLC-1: neither the footer nor the proof keeps a second copy of the disclosure prose", () => {
  const phrases = ["older than that", "we last reached", "each one says when", "some calendars may be missing"];
  const contract = readFileSync(join(ROOT, "lib/meetings/freshness.ts"), "utf8");
  for (const phrase of phrases) assert.ok(contract.includes(phrase), `the contract states: ${phrase}`);
  for (const file of ["components/map/data-freshness.tsx", "scripts/reader-last-mile-final-render.mts", "scripts/lib/reader-freshness-disclosure.ts"]) {
    const source = readFileSync(join(ROOT, file), "utf8");
    for (const phrase of phrases) assert.ok(!source.includes(phrase), `${file} carries its own copy of "${phrase}"`);
  }
  const footer = readFileSync(join(ROOT, "components/map/data-freshness.tsx"), "utf8");
  assert.match(footer, /freshnessDisclosure\(snapshot\)/, "the footer renders the contract");
  assert.match(footer, /carriedListingsDisclosure\(carried\)/, "the carried line renders the contract");
  const proof = readFileSync(join(ROOT, "scripts/reader-last-mile-final-render.mts"), "utf8");
  assert.match(proof, /freshnessDisclosureProblems\(pageText, served\.snapshot\)/, "the proof checks the served status against the contract");
  assert.ok(!/assert\.match\(pageText/.test(proof), "the proof no longer matches the page against a sentence of its own");
});
