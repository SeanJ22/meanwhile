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

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

test("16: a window is a window, and a phrase is not a date", () => {
  assert.deepEqual(windowOf("2026-11-03"), { start: "2026-11-03", end: null });
  assert.deepEqual(windowOf("2026-10-24 – 2026-11-01"), {
    start: "2026-10-24",
    end: "2026-11-01",
  });
  assert.equal(windowOf("45 days before the election"), null);
});

test("16: a window stays actionable until its LAST day is past", () => {
  const w = { start: "2026-10-24", end: "2026-11-01" };
  assert.equal(isUpcoming(w, "2026-10-30"), true, "mid-window must stay offerable");
  assert.equal(isUpcoming(w, "2026-11-01"), true, "the final day is still actionable");
  assert.equal(isUpcoming(w, "2026-11-02"), false);
  assert.equal(isUpcoming({ start: "2026-10-24", end: null }, "2026-10-30"), false);
});

test("16: 'is it still ahead' is decided on the Phoenix wall clock", () => {
  const evening = new Date("2026-08-20T01:19:00Z"); // 18:19 on the 19th in Phoenix
  assert.equal(phoenixToday(evening), "2026-08-19");
  assert.equal(evening.toISOString().slice(0, 10), "2026-08-20");

  assert.equal(isUpcoming({ start: "2026-08-19", end: null }, phoenixToday(evening)), true);
  assert.equal(
    isUpcoming({ start: "2026-08-19", end: null }, evening.toISOString().slice(0, 10)),
    false,
    "this is the behaviour that was shipping",
  );

  // Block comments are stripped whole first: a JSX block comment's continuation lines carry no marker.
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

  // DATE values carry no timezone, so a DST boundary cannot shift them.
  const ics = decodeURIComponent(icsDataHref(event));
  assert.match(ics, /DTSTART;VALUE=DATE:20261024/);
  assert.match(ics, /DTEND;VALUE=DATE:20261102/);

  // DTEND is exclusive, so 11/02 means through 11/01.
  assert.ok(!ics.includes("20261101T"), "the window must not become a timed event");
});

test("16: Arizona and New Jersey produce the same stamps for the same dates", () => {
  const event = { id: "x", title: "t", allDayDate: "2026-11-01", allDayEndDate: "2026-11-01" };
  const ics = decodeURIComponent(icsDataHref(event));
  assert.match(ics, /DTSTART;VALUE=DATE:20261101/);
  assert.match(ics, /DTEND;VALUE=DATE:20261102/);
});

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
  for (const p of phrases) assert.match(p, /: .+ = ".+"/);
});

test("15: the ballot's polling-place affordance opens the map's own panel", () => {
  const page = read("app", "ballot", "page.tsx");
  const where = read("components", "ballot", "where-to-vote.tsx");

  assert.equal(
    (page.match(/<WhereToVote/g) ?? []).length,
    1,
    "the polling-place affordance renders once per page, in the dates header (F21)",
  );
  assert.ok(
    !/href=\{polls\.url\}/.test(page),
    "a polling-place link is leaving the app directly again",
  );

  assert.match(
    where,
    /import \{ VotingSitesPanel \} from "@\/components\/map\/voting-sites-panel"/,
    "the ballot must render the same panel the map pill renders",
  );
  const mapEntry = read("components", "map", "map-entry.tsx");
  assert.ok(mapEntry.includes("Where can I vote?"), "the map pill lost its words");
  assert.ok(
    where.includes("Where can I vote?"),
    "the ballot pill must use the map pill's words verbatim — two surfaces " +
      "asking one question in two sentences is the same defect one layer up",
  );
});

test("VS-01: the voting pill answers in-page without an outbound polling lookup", () => {
  const where = read("components", "ballot", "where-to-vote.tsx");
  // Comments are stripped so a note quoting old copy is not read as the copy.
  const code = where.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

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

  assert.doesNotMatch(read("components", "map", "voting-sites-panel.tsx"), /PollingLookupFallback/);
  assert.match(
    where,
    /<VotingSitesPanel/,
    "the pill no longer opens the shared voting-sites panel",
  );
});

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
      // A bare house number such as "e.g. 808" names no place and is not matched.
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
