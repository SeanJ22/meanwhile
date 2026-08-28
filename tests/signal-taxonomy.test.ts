import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  classOf,
  isSentiment,
  notCollected,
  sameClass,
  SIGNAL_POINTS,
} from "../lib/signal/taxonomy.ts";
import { SEARCH_LOG_EVENT_TYPES } from "../lib/db/search-log.ts";

/**
 * **ATTENTION IS NOT SENTIMENT, and this is the mechanical form of it.**
 * (PR #212 follow-up, 2026-08-28.)
 *
 * The stores already do not JOIN — `tests/identity-boundary.test.ts` proves
 * that per column, by value space. What no store boundary can stop is a
 * SENTENCE: one number counted across two stores because both rows carry
 * `ocd_ids` and `occurred_at`, described to a buyer as engagement and read by
 * them as support.
 */

const ROOT = process.cwd();

test("TAXONOMY: opening a person's card is ATTENTION and can never be counted as a position", () => {
  /* The author's own example, as an assertion. */
  assert.equal(classOf("OFFICIAL_OPENED"), "ATTENTION");
  assert.equal(isSentiment("OFFICIAL_OPENED"), false);
  assert.equal(isSentiment("REACTION"), true);
  assert.equal(
    sameClass("OFFICIAL_OPENED", "REACTION"),
    false,
    "one number over these two is the collapse this file exists to refuse",
  );
});

test("TAXONOMY: reading a measure is not a position on the measure", () => {
  assert.equal(classOf("BODY_OPENED"), "ATTENTION");
  assert.equal(classOf("MEETING_OPENED"), "ATTENTION");
  assert.equal(sameClass("MEETING_OPENED", "SPEAK"), false);
  assert.equal(sameClass("BODY_OPENED", "MEETING_OPENED"), true, "two acts of looking do count together");
});

test("TAXONOMY: asking a question is DEMAND, never a position on what was asked about", () => {
  assert.equal(classOf("QUESTION_ASKED"), "INFORMATION_DEMAND");
  assert.equal(classOf("ASK"), "INFORMATION_DEMAND");
  assert.equal(isSentiment("ASK"), false);
  assert.equal(
    sameClass("ASK", "REACTION"),
    false,
    "a reader asking what a candidate has done has told us what they want to know and nothing about what they think",
  );
});

test("TAXONOMY: Speak Your Mind is sentiment and is NOT the same thing as a reaction", () => {
  /*
   * Both are EXPLICIT_SENTIMENT, so `sameClass` is true — they are the same
   * KIND of act. That is deliberate and it is not the same as being
   * interchangeable: RULING 141 gives Speak Your Mind its own PII handling,
   * moderation queue, disclosure, store, continuity namespace and export rules,
   * and the entry says so in the place an export path reads.
   */
  assert.equal(isSentiment("SPEAK"), true);
  assert.equal(sameClass("SPEAK", "REACTION"), true);

  const speak = SIGNAL_POINTS.find((p) => p.event === "SPEAK");
  assert.ok(speak);
  assert.match(speak!.neverMeans, /never folded into a reaction count/i);
  assert.match(speak!.neverMeans, /RULING 141/);
  assert.equal(speak!.store, "speak_your_mind", "its own store, and it stays that way");
});

test("TAXONOMY: an unknown event is never silently the same class as anything", () => {
  /*
   * The dangerous default. A predicate that answered `true` for an event it had
   * never heard of would wave through exactly the export nobody reviewed.
   */
  assert.equal(classOf("SOMETHING_NEW"), null);
  assert.equal(sameClass("SOMETHING_NEW", "SOMETHING_NEW"), false);
  assert.equal(isSentiment("SOMETHING_NEW"), false);
});

test("TAXONOMY: every live search-log event type is classified", () => {
  /*
   * The inventory has to stay an inventory. A new event type added to the
   * store and not to this file would be an unclassified collection point, and
   * an unclassified point is one nobody has said what it means.
   */
  const unclassified = SEARCH_LOG_EVENT_TYPES.filter((e) => classOf(e) === null);
  assert.deepEqual(
    unclassified,
    [],
    "a collection point exists that nobody has said the meaning of",
  );
});

test("TAXONOMY: what the product does NOT collect is NAMED, never implied", () => {
  /*
   * The author's taxonomy asks about action intent, source depth and meeting
   * joins. The honest answer is that the product records none of them — contact
   * links, citations and join links are ordinary anchors and no row is written.
   *
   * A taxonomy that simply omitted them would read as coverage, which is the
   * absence-as-assertion rule pointed inward.
   */
  const gaps = notCollected().map((p) => p.event);
  assert.ok(gaps.includes("CONTACT_CLICKED"), "action intent is a gap and says so");
  assert.ok(gaps.includes("SOURCE_OPENED"), "source depth is a gap and says so");
  assert.ok(gaps.includes("MEETING_JOIN"));
  for (const gap of notCollected()) {
    assert.equal(gap.store, "none");
    assert.match(gap.means, /nothing/i, "a gap's meaning is that nothing is recorded");
  }
});

test("TAXONOMY: there is no engagement score, and this is the guard rather than the intention", () => {
  /*
   * A single number over classes that mean different things requires exactly
   * the collapse `sameClass` refuses. This checks the repository as well as the
   * predicate: nothing may compute one.
   */
  for (const source of ["lib", "app", "components"]) {
    const hits = walk(join(ROOT, source)).filter((f) => /engagementScore|engagement_score/.test(readFileSync(f, "utf8")));
    assert.deepEqual(
      hits.map((h) => h.slice(ROOT.length + 1)),
      [],
      "an engagement score erases the difference between looking and agreeing",
    );
  }
});

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}
