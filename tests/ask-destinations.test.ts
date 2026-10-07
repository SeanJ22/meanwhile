import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  DESTINATION_ROUTES,
  ROUTABLE_CATEGORIES,
  matchDestination,
} from "../lib/routing/destinations.ts";
import {
  STRONG_MATCH_MIN_HITS,
  matchTopic,
  weakTopicMatch,
} from "../lib/routing/match.ts";

const ROOT = process.cwd();

const UNCHANGED: ReadonlyArray<[string, string]> = [
  ["how do I register to vote", "elections-voting"],
  ["where is my polling place", "elections-voting"],
  ["there is a pothole on my street", "roads-local"],
  ["I want a bike lane", "roads-local"],
  ["my kids school", "schools-operations"],
  ["the school budget", "schools-policy"],
  ["they stopped building the library down the road", "libraries"],
  ["trash pickup was missed", "trash-recycling"],
  ["snow plowing on my road", "snow-removal"],
  ["a warehouse development next door", "zoning-development"],
];

const WEAK_BY_DESIGN: ReadonlyArray<[string, string]> = [
  ["my water bill", "water-sewer"],
  ["my property assessment", "property-taxes"],
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
    assert.ok(
      match.matchedOn.length >= STRONG_MATCH_MIN_HITS,
      `"${question}" is in the unchanged net but carries only ${match.matchedOn.length} hit(s)`,
    );
  }
});

test("the ruling's cost is named: the weak-by-design questions decline, and say what they had", () => {
  for (const [question, topicId] of WEAK_BY_DESIGN) {
    assert.equal(
      matchTopic(question),
      null,
      `"${question}" must decline at the keyword layer under the strong-match rule`,
    );
    const weak = weakTopicMatch(question);
    assert.ok(weak, `"${question}" should still have a sub-threshold winner`);
    assert.equal(weak.topicId, topicId);
    assert.equal(weak.matchedOn.length, 1);
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

test("4d: every destination points at a surface this app actually has", () => {
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
    assert.ok(
      !/\b(all|every|complete|comprehensive|everything)\b/i.test(destination.statement),
      `${destination.id}'s statement claims completeness: "${destination.statement}"`,
    );
  }
});

test("4d: the promised categories are DERIVED from what routes, never written beside it", () => {
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

test("ASK-1: every destination can actually be opened", () => {
  for (const d of DESTINATION_ROUTES) {
    const reachable = d.href !== null || d.action !== null;
    assert.ok(
      reachable,
      `${d.id} has neither an href nor an in-place action — it is a heading with nothing to tap`,
    );
    // Exactly one. Two ways in is two things to keep in step.
    assert.ok(
      !(d.href !== null && d.action !== null),
      `${d.id} carries both an href and an in-place action — one of them will drift`,
    );
  }
});

test("ASK-1: the ask box renders a control for both kinds of destination", async () => {
  const { readFileSync: read } = await import("node:fs");
  const { join: j } = await import("node:path");
  const box = read(j(process.cwd(), "components", "ask", "ask-box.tsx"), "utf8");

  // Both branches present, and both marked so a walk can find them.
  const marks = box.match(/data-ask-destination-go/g) ?? [];
  assert.equal(marks.length, 2, "the ask box no longer renders both destination branches");

  assert.ok(
    box.includes("min-h-11"),
    "the destination control lost its 44px tap target",
  );
  assert.match(box, /dispatch\(\{\s*type: "list\/open",\s*open: true,/, "the meetings door is no longer opened");
  assert.match(box, /dispatch\(\{ type: "door\/open", door: action\.door \}\)/, "the in-place doors are no longer opened");
});
