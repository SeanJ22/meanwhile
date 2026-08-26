/**
 * THE DESCENT — RULING 169's guards.
 * (2026-08-26, the descent session, Items 3 and 11.)
 *
 * Two things are worth guarding without a network, and they are the two that
 * cost this session real time when they were wrong:
 *
 *   1. **The arithmetic.** A ledger whose numbers do not conserve is a walk
 *      asserted rather than counted, which is what RULING 169 was adopted over.
 *   2. **The detector.** The first live New Jersey walk counted **214 calendar
 *      day numbers as governing bodies** because the slug fallback read the
 *      HOSTNAME, and `rockawaytownship.org` contains "township". The count
 *      looked like the descent working. Only opening the file could tell.
 *
 * The second is planted here verbatim (RULING 110): an instrument that cannot
 * find the defect it was written for is an instrument reporting green about
 * nothing.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertLevel,
  assertRun,
  darkTiers,
  TIERS,
  TIER_IDS,
  tierRank,
  totalNewCandidates,
  walkVerdict,
  type DescentLevel,
  type DescentRun,
} from "../lib/hunt/descent.ts";
import { checkStateDescent, oldestLevelAgeDays } from "../lib/hunt/descent-gate.ts";
import { controlHolds, extractLinks, isGovernmentHost, isWalkable, looksLikeBody } from "../lib/hunt/descent-walk.ts";
import { seedsFor, DESCENT_SEEDS } from "../lib/hunt/descent-seeds.ts";

const level = (over: Partial<DescentLevel> = {}): DescentLevel => ({
  state: "nj",
  tier: "county",
  vocabulary: [],
  found: 10,
  followed: 8,
  yielded: 5,
  barren: 3,
  declined: [
    { url: "https://a.gov/1", reason: "DISALLOWED" },
    { url: "https://a.gov/2", reason: "DEPTH_LIMIT" },
  ],
  catalogued: 5,
  candidatesNew: 4,
  candidatesKnown: 1,
  pass: 1,
  walkedOn: "2026-08-26",
  ...over,
});

const run = (levels: DescentLevel[], over: Partial<DescentRun> = {}): DescentRun => ({
  state: "nj",
  levels,
  passes: 2,
  finalPassNewLinks: 0,
  startedOn: "2026-08-26",
  ...over,
});

test("the tiers are seven, in descent order, and the order is the rule", () => {
  assert.equal(TIERS.length, 7, "the tier list changed size — was that a decision, and is it a finding?");
  assert.deepEqual(
    TIERS.map((t) => t.rank),
    [1, 2, 3, 4, 5, 6, 7],
    "descent order is not sequential — a tier walked out of order is a tier walked before the one that publishes it",
  );
  assert.equal(tierRank("state"), 1);
  assert.equal(tierRank("other"), 7);
  assert.ok(TIER_IDS.includes("special-district"), "the special-district tier is the one a reader most needs");
});

test("a level conserves: every followed link has exactly one disposition", () => {
  assert.doesNotThrow(() => assertLevel(level()));

  assert.throws(
    () => assertLevel(level({ yielded: 5, barren: 2 })),
    /yielded \+ .* barren !== .* followed/,
    "5 + 2 !== 8 must fail — a followed link with no disposition vanished (RULING 128)",
  );
  assert.throws(
    () => assertLevel(level({ followed: 20 })),
    /exceeds found/,
    "a link cannot be walked before it is seen",
  );
  assert.throws(
    () => assertLevel(level({ declined: [] })),
    /followed \+ .* declined !== .* found/,
    "a link that was neither walked nor declined is a link the walk lost track of",
  );
});

test("a level that found links and walked none is a walk that did not run", () => {
  assert.throws(
    () => assertLevel(level({ found: 12, followed: 0, yielded: 0, barren: 0, declined: [] })),
    /the walk did not run/,
    "RULING 159 — zero is a result that must be EARNED",
  );
});

test("a level with no read date reads as stale rather than fresh", () => {
  assert.throws(() => assertLevel(level({ walkedOn: "" })), /is not a date/);
  assert.throws(() => assertLevel(level({ walkedOn: "yesterday" })), /is not a date/);
});

test("zero counties in a US state is a broken walk, never a finding", () => {
  assert.throws(
    () => assertRun(run([level({ tier: "state" })])),
    /no walk at tier "county"/,
    "every US state has counties, so their absence is the walk being broken",
  );
  assert.throws(
    () =>
      assertRun(
        run([level({ tier: "state" }), level({ tier: "county", candidatesNew: 0, candidatesKnown: 0 })]),
      ),
    /returned zero bodies/,
    "RULING 159 — earn the zero or fix the walk",
  );
  assert.throws(() => assertRun(run([])), /walked zero levels/);
  assert.doesNotThrow(() => assertRun(run([level({ tier: "state" }), level({ tier: "county" })])));
});

test("a walk whose final pass was still producing STOPPED, and says so", () => {
  const stopped = walkVerdict(run([level()], { finalPassNewLinks: 1885 }));
  assert.equal(stopped.finished, false);
  assert.match(stopped.reason, /STOPPED/, "finished and stopped call for different responses");
  assert.match(stopped.reason, /1885/, "the number of unfollowed links IS the next session's resume point");

  const finished = walkVerdict(run([level()], { finalPassNewLinks: 0 }));
  assert.equal(finished.finished, true);
});

test("dark tiers are the map of what is missing", () => {
  const r = run([level({ tier: "state" }), level({ tier: "county" })]);
  const dark = darkTiers(r);
  assert.ok(dark.includes("special-district"), "a tier with no candidate at all is dark and is named");
  assert.ok(!dark.includes("county"));
  assert.equal(totalNewCandidates(r), 8);
});

/* ------------------------------------------------------------------ *
 * The detector, and the defect it was written for.
 * ------------------------------------------------------------------ */

test("PLANTED — a calendar day number on a township's own host is NOT a body", () => {
  /* The literal shape from the first live NJ walk, kept verbatim. The host
   * carries "township"; the link is the 22nd of the month. */
  const day = {
    url: "https://rockawaytownship.org/calendar.aspx?view=list&year=2026&month=8&day=22&CID=14",
    text: "22",
  };
  assert.equal(
    looksLikeBody(day).isBody,
    false,
    "214 of one tier's candidates were calendar days under a total that looked healthy (RULING 100)",
  );

  /* And the fix must not have been made by deleting the fallback: a genuinely
   * short link text over a body PATH still speaks. */
  assert.equal(looksLikeBody({ url: "https://x.gov/planning-board", text: "»" }).isBody, true);
});

test("the detector catches the twigs RULING 57 exists for", () => {
  for (const text of [
    "Cemetery Trustees",
    "Ashuelot Pond Dam Precinct",
    "Board of Selectmen",
    "Lake Todd Village District",
    "Morris County Improvement Authority",
    "Sanitary District No. 1",
    "Library Board of Trustees",
  ]) {
    assert.equal(looksLikeBody({ url: "https://x.gov/a", text }).isBody, true, `"${text}" must be caught`);
  }
});

test("a page ABOUT a body is not a body", () => {
  for (const text of [
    "Latest news from the Township Council",
    "Board of Education job openings",
    "NJ Municipalities Magazine",
    "Follow the council on Facebook",
  ]) {
    assert.equal(looksLikeBody({ url: "https://x.gov/a", text }).isBody, false, `"${text}" must be excluded`);
  }
});

test("links are extracted absolute, de-duplicated, and without fragments", () => {
  const html = `
    <a href="/a">Planning Board</a>
    <a href='/a#top'>Planning Board again</a>
    <a href="https://other.gov/b">Zoning Board</a>
    <a href="mailto:x@y.gov">Email</a>
    <a href="#skip">Skip</a>
  `;
  const links = extractLinks(html, "https://town.gov/index.html");
  assert.deepEqual(
    links.map((l) => l.url),
    ["https://town.gov/a", "https://other.gov/b"],
    "a fragment is the same document, and mailto/# are not documents at all",
  );
  assert.equal(links[0].text, "Planning Board");
});

test("extraction does not die on a malformed href", () => {
  /* `decodeURIComponent` throws `URI malformed` on a stray %, and government
   * sites emit them constantly. A walk that died here would report every level
   * after it as zero — a broken walk wearing a clean number. */
  const links = extractLinks('<a href="/a%zz">Township Council</a>', "https://town.gov/");
  assert.equal(links.length, 1);
  assert.doesNotThrow(() => looksLikeBody(links[0]));
});

test("assets are not documents, and government hosts are typed not listed", () => {
  assert.equal(isWalkable("https://x.gov/minutes.pdf").ok, false);
  assert.equal(isWalkable("ftp://x.gov/file.txt").ok, false, "the walk reads web pages");
  assert.equal(isWalkable("https://x.gov/board").ok, true);

  assert.equal(isGovernmentHost("https://www.pima.gov/394"), true);
  assert.equal(isGovernmentHost("https://newbury.nh.us/"), true, "RFC 1480's .us locality space");
  assert.equal(isGovernmentHost("https://njsba.org/"), false, "an association is a compilation, never a body");
});

test("a control string is mandatory, because a 200 can be a Page not found", () => {
  /* RULING 93's live case: `nj.gov/nj/gov/county/` answers HTTP 200 with a
   * styled "Page not found". */
  assert.equal(controlHolds("<h1>Page not found</h1>", "Rockaway"), false);
  assert.equal(controlHolds("<td>Rockaway Township</td>", "Rockaway"), true);
});

/* ------------------------------------------------------------------ *
 * The seeds and the gate.
 * ------------------------------------------------------------------ */

test("every seed declares the tier it is ABOUT, a publisher, a control and a reason", () => {
  const states = Object.keys(DESCENT_SEEDS);
  assert.ok(states.length >= 3, "the three pilot states carry seeds");
  let seen = 0;
  for (const s of states) {
    for (const seed of seedsFor(s)) {
      seen += 1;
      assert.ok(TIER_IDS.includes(seed.tier), `${seed.url} names a tier that does not exist`);
      assert.ok(seed.control.length > 0, `${seed.url} has no control string — a 200 is not a document (RULING 93)`);
      assert.ok(seed.why.length > 20, `${seed.url} does not say why it is the right door`);
      assert.ok(seed.publisher.length > 0, `${seed.url} does not say who publishes it`);
      assert.doesNotThrow(() => new URL(seed.url), `${seed.url} is not a URL`);
    }
  }
  assert.ok(seen > 0, "RULING 159 — a sweep of zero seeds is a sweep that did not run");
});

test("the descent gate refuses a state nobody has descended, and says what to run", () => {
  const missing = checkStateDescent("wy", process.cwd(), "2026-08-26");
  assert.equal(missing.verdict, "NO_LEDGER");
  assert.match(missing.reason, /pnpm descent --state wy/, "a refusal that does not say what to do is a dead end");

  assert.equal(checkStateDescent("zz", process.cwd(), "2026-08-26").verdict, "NOT_A_STATE");
});

test("DERIVED CASE (RULING 157) — the gate refuses a ledger it was not built from", () => {
  /* The gate was written against the real NJ walk. This is a hand-built ledger
   * for a state the walk has never touched, whose arithmetic does not conserve
   * — proving the gate re-derives rather than trusting the file's own summary.
   * A gate verified only against the case that produced it proves the code does
   * what the code does. */
  const root = mkdtempSync(join(tmpdir(), "wtp-descent-"));
  mkdirSync(join(root, "states", "mt"), { recursive: true });

  const lying = run([level({ state: "mt", tier: "state" }), level({ state: "mt", tier: "county", yielded: 99 })], {
    state: "mt",
  });
  writeFileSync(join(root, "states", "mt", "descent.json"), JSON.stringify(lying), "utf8");
  const bad = checkStateDescent("mt", root, "2026-08-26");
  assert.equal(bad.verdict, "INCOHERENT", "a ledger claiming a walk it cannot substantiate is worse than none");

  const honest = run([level({ state: "mt", tier: "state" }), level({ state: "mt", tier: "county" })], { state: "mt" });
  writeFileSync(join(root, "states", "mt", "descent.json"), JSON.stringify(honest), "utf8");
  const good = checkStateDescent("mt", root, "2026-08-26");
  assert.equal(good.verdict, "WALKED");
  assert.equal(good.levels, 2);

  writeFileSync(join(root, "states", "mt", "descent.json"), "{not json", "utf8");
  assert.equal(checkStateDescent("mt", root, "2026-08-26").verdict, "UNREADABLE");

  writeFileSync(join(root, "states", "mt", "descent.json"), JSON.stringify({ state: "mt", levels: [] }), "utf8");
  assert.equal(checkStateDescent("mt", root, "2026-08-26").verdict, "EMPTY_LEDGER");
});

test("staleness is measured, never guessed, and a missing stamp is not today", () => {
  const r = run([level({ walkedOn: "2026-08-12" }), level({ walkedOn: "2026-08-26" })]);
  assert.equal(oldestLevelAgeDays(r, "2026-08-26"), 14, "the OLDEST level decides, not the newest");
  assert.equal(oldestLevelAgeDays(run([]), "2026-08-26"), null, "unknown is not zero");
});
