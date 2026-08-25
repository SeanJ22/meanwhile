import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  calendarableSteps,
  isUpcoming,
  phoenixToday,
  windowOf,
} from "../lib/ballot/dated-events.ts";
import { googleCalendarUrl, icsDataHref } from "../lib/calendar/event-links.ts";
import { ELECTION_DATES } from "../lib/ballot/election-dates.ts";
import { PLACEHOLDER_ADDRESS } from "../lib/ballot/placeholder-address.ts";

import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";

/**
 * F01-continued session 2, items 15, 16 and 17 (2026-08-19). Three
 * reader-facing defects on the surface a voter uses to work out how to vote.
 */

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

/* ------------------------------------------- 16, the calendar affordance --- */

test("16: a window is a window, and a phrase is not a date", () => {
  assert.deepEqual(windowOf("2026-11-03"), { start: "2026-11-03", end: null });
  assert.deepEqual(windowOf("2026-10-24 – 2026-11-01"), {
    start: "2026-10-24",
    end: "2026-11-01",
  });
  // An authority's phrase yields nothing, and nothing means no affordance.
  // Inventing a date to make a button possible is the fabrication rule.
  assert.equal(windowOf("45 days before the election"), null);
});

test("16: a window stays actionable until its LAST day is past", () => {
  const w = { start: "2026-10-24", end: "2026-11-01" };
  assert.equal(isUpcoming(w, "2026-10-30"), true, "mid-window must stay offerable");
  assert.equal(isUpcoming(w, "2026-11-01"), true, "the final day is still actionable");
  assert.equal(isUpcoming(w, "2026-11-02"), false);
  // Judging by the FIRST day would remove it exactly when it is most useful.
  assert.equal(isUpcoming({ start: "2026-10-24", end: null }, "2026-10-30"), false);
});

/**
 * The UTC-slice defect, in a reader-facing comparison.
 *
 * `new Date().toISOString().slice(0, 10)` is a day AHEAD of Phoenix for the
 * seven hours after 5pm local, so an event dated today lost its affordance
 * every evening. Same family as item 0B, and worse: this one a reader sees.
 */
test("16: 'is it still ahead' is decided on the Phoenix wall clock", () => {
  const evening = new Date("2026-08-20T01:19:00Z"); // 18:19 on the 19th in Phoenix
  assert.equal(phoenixToday(evening), "2026-08-19");
  assert.equal(evening.toISOString().slice(0, 10), "2026-08-20");

  // The consequence, stated as the test: an event dated the 19th is still
  // ahead at 18:19 on the 19th.
  assert.equal(isUpcoming({ start: "2026-08-19", end: null }, phoenixToday(evening)), true);
  assert.equal(
    isUpcoming({ start: "2026-08-19", end: null }, evening.toISOString().slice(0, 10)),
    false,
    "this is the behaviour that was shipping",
  );

  // Comments are excluded: this page EXPLAINS the defect it fixed, and a
  // guard that flags its own explanation is a guard somebody switches off.
  //
  // A per-line `startsWith("//")` filter is NOT enough here and that is worth
  // recording — a JSX block comment's CONTINUATION lines carry no marker at
  // all, so the explanation of this very defect survived the line filter and
  // failed the check. Block comments are stripped whole first.
  const code = read("app", "ballot", "page.tsx")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  assert.ok(
    !/toISOString\(\)\.slice\(0, 10\)/.test(code),
    "the ballot page is deciding a reader-facing date in UTC again",
  );
});

/**
 * THE ILLUSTRATION, NOT THE SCOPE — but it is the one the author photographed,
 * and it is the one that straddles the end of Eastern daylight time.
 */
test("16: the NJ early-voting window produces a correct multi-day event", () => {
  const nj = ELECTION_DATES.find((d) => d.state === "NJ");
  assert.ok(nj, "New Jersey's dates are gone");
  const early = nj.steps.find((s) => /early voting/i.test(s.label));
  assert.ok(early, "the early-voting step is gone");

  const w = windowOf(early.date);
  assert.deepEqual(w, { start: "2026-10-24", end: "2026-11-01" });

  const event = {
    id: "test",
    title: "In-person early voting (NJ)",
    allDayDate: w!.start,
    allDayEndDate: w!.end ?? undefined,
  };

  // Google wants `START/END` with an EXCLUSIVE end.
  const google = googleCalendarUrl(event);
  assert.match(google, /dates=20261024%2F20261102/, `google url was ${google}`);

  // `.ics` the same, as DATE values — which is what makes the DST boundary a
  // non-event: a date-valued event sits in no timezone at all.
  const ics = decodeURIComponent(icsDataHref(event));
  assert.match(ics, /DTSTART;VALUE=DATE:20261024/);
  assert.match(ics, /DTEND;VALUE=DATE:20261102/);

  // The last day of the window is 11/01 — the transition day — and it must
  // not be shifted off it. DTEND is exclusive, so 11/02 IS "through 11/01".
  assert.ok(!ics.includes("20261101T"), "the window must not become a timed event");
});

test("16: Arizona and New Jersey produce the same stamps for the same dates", () => {
  // 85701 is Arizona, which never observes DST; 07866 is Eastern, which does.
  // An all-day event must be identical for both, and this is the check that
  // says so rather than the comment above it.
  const event = { id: "x", title: "t", allDayDate: "2026-11-01", allDayEndDate: "2026-11-01" };
  const ics = decodeURIComponent(icsDataHref(event));
  assert.match(ics, /DTSTART;VALUE=DATE:20261101/);
  assert.match(ics, /DTEND;VALUE=DATE:20261102/);
});

/**
 * The enumeration item 16 step 1 asks for, computed rather than described:
 * every dated voting event the product renders, and how many carry the
 * affordance.
 */
test("16: every dated voting event with a known date can be calendared", () => {
  let events = 0;
  let dated = 0;
  const phrases: string[] = [];

  for (const state of ELECTION_DATES) {
    for (const row of calendarableSteps(state.steps, "2026-08-19")) {
      events += 1;
      if (row.window) dated += 1;
      else phrases.push(`${state.state}: ${row.step.label} = "${row.step.date}"`);
    }
  }

  console.log(
    `dated voting events: ${events} rendered, ${dated} carry a date, ` +
      `${phrases.length} are an official phrase with no date in them`,
  );
  assert.ok(events > 10, `only ${events} steps — the dates file shrank`);
  assert.equal(
    dated + phrases.length,
    events,
    "every step is either datable or a phrase; there is no third kind",
  );
  // A phrase gets no button and that is correct — but it must be NAMED
  // rather than counted as covered.
  for (const p of phrases) assert.match(p, /: .+ = ".+"/);
});

/* ------------------------------------------ 15, where can I vote in-app --- */

test("15: the ballot's polling-place affordance opens the map's own panel", () => {
  const page = read("app", "ballot", "page.tsx");
  const where = read("components", "ballot", "where-to-vote.tsx");

  // The affordance is the shared component, and there is exactly one of it.
  //
  // AMENDED 2026-08-20 (F21, the author's ruling). This assertion read `2`,
  // with the message: "both polling-place affordances must use the shared
  // component — item 6 (2026-08-15) committed a guard requiring the pointer
  // in the dates header AND the checker box, so both render and both must be
  // the in-app one." Item 6's both-places rule was written when the two were
  // LINKS in different context; item 15 made both the same in-app pill, and a
  // repeated identical control makes a reader wonder which is the real one.
  // The ruling is once per page, in the dates header. What this guard was
  // always protecting — that the affordance is the SHARED component and never
  // a second implementation — is unchanged and is asserted below.
  assert.equal(
    (page.match(/<WhereToVote/g) ?? []).length,
    1,
    "the polling-place affordance renders once per page, in the dates header (F21)",
  );
  // …and neither is a bare external link any more.
  assert.ok(
    !/href=\{polls\.url\}/.test(page),
    "a polling-place link is leaving the app directly again",
  );

  // The shared path is the MAP's panel, not a second implementation.
  assert.match(
    where,
    /import \{ VotingSitesPanel \} from "@\/components\/map\/voting-sites-panel"/,
    "the ballot must render the same panel the map pill renders",
  );
  // The words match the map pill's, so one gesture is learned once.
  const mapEntry = read("components", "map", "map-entry.tsx");
  assert.ok(mapEntry.includes("Where can I vote?"), "the map pill lost its words");
  assert.ok(
    where.includes("Where can I vote?"),
    "the ballot pill must use the map pill's words verbatim — two surfaces " +
      "asking one question in two sentences is the same defect one layer up",
  );
});

/**
 * **AMENDED 2026-08-24 (BAL-2) — THE HANDOFF IS A BEHAVIOUR NOW, NOT A LINK.**
 *
 * Item 15 (2026-08-19) required the state's own tool to be OFFERED beside the
 * in-app answer and LABELLED as leaving. The author's 8/24 ruling deletes the
 * offer: *delete "or search Arizona Secretary of State's own tool" — the pill
 * below it is that.*
 *
 * Item 15's substance is untouched, and the distinction is what this guard now
 * holds. Its defect was that one product answered one question two ways on two
 * surfaces, and that a reader was sent AWAY from six sourced voting locations
 * we already held. Neither returns: the pill still opens the shared
 * `VotingSitesPanel`, `fallback` is still resolved and still handed to it, and
 * a jurisdiction we do not hold still reaches the authority through it. What
 * is gone is a second, redundant, outbound link sitting under the control that
 * already answers.
 *
 * A link that leaves must still say so — that rule is untouched and now has no
 * subject on this component, so it is asserted where the leaving link actually
 * lives: the registration pill on the ballot page, in `tests/ballot.test.ts`.
 */
test("BAL-2: the state's tool is reached through the pill, not offered beside it", () => {
  const where = read("components", "ballot", "where-to-vote.tsx");
  /*
   * Comments stripped before the check, and this is not a convenience: this
   * file's own note QUOTES the author's instruction — *delete "or search
   * ... own tool"* — so a guard reading the raw text would flag the record of
   * the fix as the defect. A sweep that cannot tell shipped copy from a
   * comment about shipped copy is reading the wrong thing (RULING 110).
   */
  const code = where.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  // No second outbound route beside the control that already answers.
  assert.doesNotMatch(
    code,
    /own tool/,
    "the redundant outbound link to the state's tool is back (BAL-2)",
  );
  assert.doesNotMatch(
    code,
    /<a\s/,
    "this component renders an outbound anchor again",
  );

  // But the handoff itself is intact: the fallback is still part of the
  // contract and still reaches the shared panel.
  assert.match(
    where,
    /fallback: \{ label: string; url: string; sourceOrg: string \} \| null;/,
    "the fallback left the contract — a jurisdiction we do not hold now reaches nothing",
  );
  assert.match(
    where,
    /<VotingSitesPanel/,
    "the pill no longer opens the shared voting-sites panel",
  );
});

/* --------------------------------------------- 17, the placeholder address --- */

/**
 * An ALLOWLIST OF ONE, not a blocklist of real addresses.
 *
 * A blocklist is unbounded and a blocklist that misses one reads as a pass.
 * This asserts equality, so a Phoenix address fails as surely as a Tucson one
 * whether or not anyone thought to ban Phoenix.
 */
test("17: the placeholder address is exactly the approved string", () => {
  assert.equal(PLACEHOLDER_ADDRESS, "123 Main St, Anywhere, USA");

  const panel = read("components", "map", "voting-sites-panel.tsx");
  assert.match(
    panel,
    /placeholder=\{PLACEHOLDER_ADDRESS\}/,
    "the placeholder must come from the constant, never a literal",
  );
  assert.ok(
    !/placeholder="[^"]*(Tucson|Phoenix|Newark|Morristown|Concord)[^"]*"/.test(panel),
    "a region-specific placeholder is back",
  );
});

test("17: no reader-facing placeholder carries a region-specific address", () => {
  // `git grep -a` — the non-skipping instrument (item 0A). A file carrying a
  // literal NUL is classified binary and SKIPPED by the default tool, and a
  // sweep that could not look prints the same thing as a sweep that found
  // nothing.
  const files = filesThatWouldBeCommitted({
    cwd: ROOT,
    paths: ["app", "components", "lib"],
  })
    .map((f) => f.trim())
    .filter((f) => /\.(ts|tsx)$/.test(f));

  assert.ok(files.length > 100, `only ${files.length} files swept — the corpus shrank`);

  const offenders: string[] = [];
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const m of text.matchAll(/placeholder="([^"]*)"/g)) {
      // A street-shaped example: a house number followed by a word and a
      // street suffix. "e.g. 808" is a bare house number and names no place,
      // so it is deliberately not in this class.
      if (/\d+\s+\w+.*\b(St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Way|Ln)\b/.test(m[1])) {
        offenders.push(`${file}: ${m[1]}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `an address-shaped placeholder outside the constant:\n${offenders.join("\n")}`,
  );
});

/**
 * It is a PLACEHOLDER, never a lookup. Structural rather than remembered: it
 * is an HTML placeholder attribute on a CONTROLLED input, so it is never the
 * value, and the submit handler reads state with a length guard.
 */
test("17: no code path can send the placeholder anywhere", () => {
  const panel = read("components", "map", "voting-sites-panel.tsx");
  assert.match(panel, /value=\{address\}/, "the input must be controlled");
  assert.match(panel, /const value = address\.trim\(\);/);
  assert.match(panel, /if \(value\.length < 3\) return;/);
  assert.ok(
    !/PLACEHOLDER_ADDRESS[\s\S]{0,200}(fetch|geocode|body:)/.test(panel),
    "the placeholder constant is near a request path",
  );
});
