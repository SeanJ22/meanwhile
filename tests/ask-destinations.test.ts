import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  DESTINATION_ROUTES,
  ROUTABLE_CATEGORIES,
  matchDestination,
} from "../lib/routing/destinations.ts";
import { matchTopic } from "../lib/routing/match.ts";

/**
 * G05 rule 4d (2026-08-17): the router learns four in-app destinations, and
 * the copy may only promise what the router can route.
 *
 * The rule's real risk is not that a destination fails to match. It is that
 * extending the router QUIETLY BREAKS the answers it already gave — "ballot"
 * is a keyword of `elections-voting`, and a naive extension would re-route
 * "how do I register to vote" to a page listing contests. So the first block
 * below is a regression net over the old behaviour, and it comes first on
 * purpose.
 */

const ROOT = process.cwd();

// ── 1. The extension changed nothing that already worked ──────────────────

/**
 * Questions that routed to a topic before this change and must still route
 * to the SAME topic. Each is a real shape from the routes' own examples or
 * the refusal log entries recorded in `match.ts`.
 */
const UNCHANGED: ReadonlyArray<[string, string]> = [
  ["how do I register to vote", "elections-voting"],
  ["where is my polling place", "elections-voting"],
  ["there is a pothole on my street", "roads-local"],
  ["I want a bike lane", "roads-local"],
  ["my kids school", "schools-operations"],
  ["the school budget", "schools-policy"],
  ["they stopped building the library down the road", "libraries"],
  ["trash pickup was missed", "trash-recycling"],
  ["my water bill", "water-sewer"],
  ["snow plowing on my road", "snow-removal"],
  ["my property assessment", "property-taxes"],
  ["a warehouse development next door", "zoning-development"],
];

test("4d: every question that already routed still routes to the same topic", () => {
  for (const [question, topicId] of UNCHANGED) {
    const match = matchTopic(question);
    assert.ok(match, `"${question}" stopped matching any topic`);
    assert.equal(
      match.topicId,
      topicId,
      `"${question}" moved from ${topicId} to ${match.topicId}`,
    );
  }
});

test("4d: a bare topic word is never hijacked by a destination", () => {
  // The exact overlap that makes this rule delicate. A single word carries
  // an intent to ACT, not an intent to BE somewhere, and must fall through.
  for (const bare of [
    "vote",
    "voting",
    "ballot",
    "election",
    "meeting",
    "district",
    "contact",
  ]) {
    assert.equal(
      matchDestination(bare),
      null,
      `the bare word "${bare}" must not route to a destination — a single word is not an intent`,
    );
  }
});

// ── 2. The four destinations route, and only on real evidence ─────────────

test("4d: exactly the four categories the rule names, and no fifth", () => {
  const surfaces = DESTINATION_ROUTES.map((d) => d.surface).sort();
  assert.deepEqual(
    surfaces,
    ["BALLOT", "CONTACT", "DISTRICTS", "MEETINGS"],
    "a category that cannot be routed is not named in the copy — and one that is not named here may not exist",
  );
  assert.equal(
    new Set(DESTINATION_ROUTES.map((d) => d.id)).size,
    DESTINATION_ROUTES.length,
    "destination ids must be distinct",
  );
});

const ROUTES: ReadonlyArray<[string, string]> = [
  ["what's on my ballot", "ballot"],
  ["what is on my ballot this year", "ballot"],
  ["who is running for mayor", "ballot"],
  ["can I see a sample ballot", "ballot"],
  ["what am I voting on", "ballot"],
  ["when is the next meeting", "meetings"],
  ["are there any upcoming meetings", "meetings"],
  ["when does the council meet", "meetings"],
  ["is there a public hearing about this", "meetings"],
  ["what district am I in", "districts"],
  ["which district am I in for schools", "districts"],
  ["who represents me", "districts"],
  ["how do I contact the mayor", "contact"],
  ["phone number for the town clerk", "contact"],
  ["I need contact details", "contact"],
];

test("4d: each of the four routes on the phrases a reader actually types", () => {
  for (const [question, id] of ROUTES) {
    const match = matchDestination(question);
    assert.ok(match, `"${question}" routed nowhere`);
    assert.equal(match.destination.id, id, `"${question}" went to ${match.destination.id}`);
    assert.ok(
      match.matchedOn.length > 0,
      `"${question}" matched with no evidence — every match carries the phrase that carried it`,
    );
  }
});

test("4d: the longest phrase wins, so more evidence is never a tie", () => {
  // "who is on the ballot" contains "on the ballot"; the longer phrase must
  // decide rather than the two cancelling each other out.
  const match = matchDestination("who is on the ballot in november");
  assert.ok(match);
  assert.equal(match.destination.id, "ballot");
});

test("4d: a question with no destination refuses rather than guessing", () => {
  for (const question of [
    "",
    "   ",
    "why is the sky blue",
    "my neighbour's dog barks all night",
    "I disagree with the state budget",
  ]) {
    assert.equal(
      matchDestination(question),
      null,
      `"${question}" must refuse — a destination is never a fallback`,
    );
  }
});

// ── 3. The gate itself: the copy may only promise what routes ─────────────

test("4d: every destination points at a surface this app actually has", () => {
  /*
   * The rule one layer down. A destination naming a page that does not exist
   * would be the copy promising what the router cannot route, wearing a
   * different hat — and it would fail as a 404 in front of a reader rather
   * than here.
   */
  const appDir = join(ROOT, "app");
  const routes = new Set<string>();
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      if (entry.startsWith("_") || entry === "api") continue;
      const path = `${prefix}/${entry}`;
      routes.add(path);
      walk(full, path);
    }
  };
  walk(appDir, "");
  assert.ok(routes.size > 2, `expected the app's routes, found ${routes.size}`);

  for (const destination of DESTINATION_ROUTES) {
    if (destination.href === null) continue;
    assert.ok(
      routes.has(destination.href),
      `${destination.id} points at ${destination.href}, which is not a route in app/`,
    );
  }
});

test("4d: every destination carries a label and a level statement", () => {
  for (const destination of DESTINATION_ROUTES) {
    assert.ok(destination.label.trim().length > 0, `${destination.id} has no label`);
    assert.ok(
      destination.statement.trim().length > 20,
      `${destination.id}'s statement is too short to say anything`,
    );
    /*
     * The register rule: a destination statement is a CLAIM surface — it
     * describes what is on a page — so it stays level. And it may never
     * imply completeness, which is the one thing this product's coverage
     * gaps must never be smoothed into.
     */
    assert.ok(
      !/\b(all|every|complete|comprehensive|everything)\b/i.test(destination.statement),
      `${destination.id}'s statement claims completeness: "${destination.statement}"`,
    );
  }
});

test("4d: the promised categories are DERIVED from what routes, never written beside it", () => {
  // The gate expressed as code. If the copy ever hard-codes its own list,
  // this is the test that says the two have stopped being the same thing.
  assert.deepEqual(
    [...ROUTABLE_CATEGORIES].sort(),
    DESTINATION_ROUTES.map((d) => d.label).sort(),
  );

  const source = readFileSync(join(ROOT, "lib", "routing", "destinations.ts"), "utf8");
  assert.ok(
    /ROUTABLE_CATEGORIES[\s\S]{0,200}DESTINATION_ROUTES\.map/.test(source),
    "ROUTABLE_CATEGORIES must be derived from DESTINATION_ROUTES, not listed again",
  );
});

test("4d: destinations generate nothing — every phrase and sentence is committed", () => {
  const raw = readFileSync(join(ROOT, "lib", "routing", "destinations.ts"), "utf8");
  /*
   * Scanned with the comments stripped. The first version of this test read
   * the whole file and failed on the module's own sentence "It generates
   * nothing" — a guard firing on the documentation of the property it is
   * guarding. The claim is about the CODE, so the code is what it reads.
   */
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
  for (const forbidden of ["fetch(", "anthropic", "openai", "Math.random", "eval("]) {
    assert.ok(
      !code.toLowerCase().includes(forbidden.toLowerCase()),
      `destinations.ts must contain no "${forbidden}" — routing generates nothing (A07)`,
    );
  }
  // And the file is data plus one matcher: no imports at all, so nothing it
  // renders can arrive from anywhere but this file.
  assert.ok(
    !/^\s*import\s/m.test(code),
    "destinations.ts must import nothing — every phrase and sentence is committed here",
  );
});
