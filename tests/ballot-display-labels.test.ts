import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PassedMark } from "../components/ballot/date-passed.tsx";
import { datePassed } from "../lib/ballot/dated-events.ts";
import { dateHeading } from "../lib/ballot/date-heading.ts";
import { stateToday } from "../lib/ballot/state-time-zone.ts";
import { statePartyName } from "../lib/ballot/party-codes.ts";
import { readerPartyLabel } from "../lib/text/reader-names.ts";

const page = readFileSync("app/ballot/page.tsx", "utf8");

test("a row is passed only when every date it names is before today in the place's own zone", () => {
  assert.equal(datePassed("2026-10-24", "2026-10-30"), true);
  assert.equal(datePassed("2026-10-22 – 2026-10-29", "2026-10-30"), true);
  assert.equal(datePassed("2026-10-17 – 2026-10-30", "2026-10-30"), false, "the last day is still ahead of the clock");
  assert.equal(datePassed("2026-10-19 – 2026-11-01 – 2026-10-27 – 2026-10-29", "2026-10-30"), false, "a later date anywhere in the row keeps it open");
  assert.equal(datePassed("", "2026-10-30"), false, "a rule with no date never passes");
  const instant = new Date("2026-11-01T05:30:00Z");
  assert.equal(stateToday("MD", instant), "2026-11-01");
  assert.equal(stateToday("CA", instant), "2026-10-31");
  assert.match(renderToStaticMarkup(PassedMark()), /data-date-passed[^>]*>Passed</);
  assert.equal((page.match(/<PassedMark \/>/g) ?? []).length, 4, "every dated list marks passed rows");
  assert.ok(!/calendarableSteps\((?:steps|dates\.steps)\)/.test(page), "calendar offers must judge today in the place's zone");
});

test("a row's heading follows what the row says", () => {
  assert.equal(dateHeading({ label: "Voter registration", detail: "On election day : go to the polling place assigned for your residence." }), "Election Day");
  assert.equal(dateHeading({ label: "Voter registration", detail: "during early voting : go to an early voting center in the county where you live." }), "Early voting");
  assert.equal(dateHeading({ label: "Voter registration", detail: "Oct. 15: In-person early voting begins; same-day registration available." }), "Early voting");
  assert.equal(dateHeading({ label: "Voter registration", detail: "Oct. 9: Voter registration deadline (5 p.m.).* Oct. 15: In-person early voting begins" }), "Voter registration");
  assert.equal(dateHeading({ label: "Voter registration", detail: "By mail, with a form postmarked by October 24" }), "Voter registration");
  assert.equal(dateHeading({ label: "Voter registration", detail: null }), "Voter registration");
  assert.equal(dateHeading({ label: "Early voting", detail: "Absentee Voting Begins: September 18, 2026" }), "Absentee voting");
  assert.equal(dateHeading({ label: "Early voting", detail: "Apply in person no earlier than 14 days before Election Day." }), "Absentee voting");
  assert.equal(dateHeading({ label: "Early voting", detail: "Early in-person, no excuse absentee voting will take place Thursday." }), "Early voting");
  assert.equal(dateHeading({ label: "Early voting", detail: "Early voting begins October 17 and concludes October 30." }), "Early voting");
  assert.equal(dateHeading({ label: "Mail-ballot request", detail: "Request Ballot By October 27, 2026 by 5pm." }), "Mail-ballot request");
});

test("a party code shows the name its own state publishes, and no code is guessed", () => {
  assert.equal(readerPartyLabel("WRI", "FL"), "Write-In");
  assert.equal(readerPartyLabel("LPF", "FL"), "Libertarian Party of Florida");
  assert.equal(readerPartyLabel("LPN", "NV"), "Libertarian Party of Nevada");
  assert.equal(readerPartyLabel("LPN", "FL"), "LPN", "a code means only what its own state says");
  assert.equal(readerPartyLabel("LPN"), "LPN");
  assert.equal(readerPartyLabel("GRE", "TX"), "GRE", "no published Texas expansion is held");
  assert.equal(readerPartyLabel("Libertarian Party of Nevada", "NV"), "Libertarian Party of Nevada");
  assert.equal(readerPartyLabel("DEM", "FL"), "Democratic");
  assert.equal(statePartyName("FL", "mgt"), null, "the source prints no name for this code");
  assert.match(page, /readerPartyLabel\(candidate\.partyLabel, set\?\.election\.state\)/);
});

test("no ballot party label is left as a half-cased code", () => {
  const dir = "data/ballot/2026-general/";
  const left = new Set<string>();
  for (const file of readdirSync(dir).filter(name => name.endsWith(".json"))) {
    const state = file.slice(0, 2).toUpperCase();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === "object") {
        const label = (node as { partyLabel?: unknown }).partyLabel;
        if (typeof label === "string") {
          const shown = readerPartyLabel(label, state)!;
          if (/^[A-Z][a-z]{1,3}$/.test(shown) && label === label.toUpperCase()) left.add(`${state}:${label}→${shown}`);
        }
        Object.values(node).forEach(walk);
      }
    };
    walk(JSON.parse(readFileSync(dir + file, "utf8")));
  }
  assert.deepEqual([...left], []);
});
