import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { meetingHeadline, meetingSubline } from "../lib/map/format.ts";
import { meetingCalendarEvent } from "../lib/calendar/event-links.ts";
import type { Meeting } from "../lib/sources/types.ts";

/**
 * A sub-line must not repeat words the headline already carries; the question is not whether `bodyName !== title`
 * but whether the headline already contains what is about to be printed under it.
 */

function meeting(over: Partial<Meeting>): Meeting {
  return {
    id: "m1",
    bodyName: "Board of County Commissioners",
    title: "Board of County Commissioners – Work Session",
    jurisdiction: "Morris County, NJ",
    ocdId: "ocd-division/country:us/state:nj/county:morris",
    startsAt: "2026-08-26T21:00:00.000Z",
    status: "SCHEDULED",
    location: {
      name: "Administration and Records Building, Knox Room 525",
      address: "10 Court Street, Morristown, NJ 07960",
      lat: 40.797,
      lng: -74.481,
    },
    ...over,
  } as Meeting;
}

test("MTG-2: the subline never repeats what the headline already said", () => {
  const m = meeting({});
  const headline = meetingHeadline(m);
  const sub = meetingSubline(m);
  assert.equal(headline, "Morris County, NJ — Board of County Commissioners");
  assert.equal(sub, "Work Session");
  assert.ok(
    !headline.toLowerCase().includes(sub.toLowerCase()),
    `the subline "${sub}" is already inside the headline "${headline}"`,
  );
});

test("MTG-2: the three ways a source writes the body name into the title", () => {
  const cases: Array<[Partial<Meeting>, string]> = [
    // Prefix with a separator.
    [{ title: "Board of County Commissioners – Regular Meeting" }, "Regular Meeting"],
    // Plain prefix.
    [
      {
        bodyName: "Township Council",
        title: "Township Council Regular Meeting",
        jurisdiction: "Rockaway Township, NJ",
      },
      "Regular Meeting",
    ],
    // Suffix — "Regular Meeting of the Governing Board".
    [
      {
        bodyName: "Governing Board",
        title: "Regular Meeting of the Governing Board",
        jurisdiction: "Tucson Unified School District",
      },
      "Regular Meeting",
    ],
  ];
  for (const [over, expected] of cases) {
    assert.equal(meetingSubline(meeting(over)), expected, JSON.stringify(over));
  }
});

test("MTG-2: a bare generic noun is not a fact, and renders as nothing", () => {
  // A reduction to "Meeting" tells a reader nothing; an empty string means the caller renders no line.
  const m = meeting({
    bodyName: "Board of Adjustment",
    title: "Board of Adjustment Meeting",
    jurisdiction: "Rockaway Township, NJ",
  });
  assert.equal(meetingSubline(m), "");
});

test("MTG-2: the jurisdiction renders below only where the headline left it out", () => {
  // `meetingHeadline` prepends the jurisdiction unless the body name already contains it; both branches are checked.
  const absorbed = meeting({
    bodyName: "Vail Unified School District Governing Board",
    title: "Vail Unified School District Governing Board Meeting",
    jurisdiction: "Vail Unified School District",
  });
  assert.equal(meetingHeadline(absorbed), "Vail Unified School District Governing Board");
  assert.equal(meetingSubline(absorbed), "", "the headline already says it");

  const led = meeting({
    bodyName: "Governing Board",
    title: "Governing Board Meeting",
    jurisdiction: "Vail Unified School District",
  });
  assert.equal(meetingHeadline(led), "Vail Unified School District — Governing Board");
  assert.equal(meetingSubline(led), "", "and here too — nothing is left over");
});

test("MTG-2: no surface builds the old bodyName-plus-jurisdiction line", () => {
  // The same template string is the obvious thing to write on the next list surface.
  const offenders: string[] = [];
  for (const file of [
    "components/map/list-overlay.tsx",
    "components/map/meeting-panel.tsx",
  ]) {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    if (/\$\{meeting\.bodyName\}\s*·\s*\$\{meeting\.jurisdiction\}/.test(src)) {
      offenders.push(file);
    }
    if (/meeting\.bodyName\s*!==\s*meeting\.title/.test(src)) offenders.push(`${file} (old guard)`);
  }
  assert.deepEqual(
    offenders,
    [],
    "these surfaces still build the second line the old way — use meetingSubline, " +
      "which asks whether the HEADLINE already carries the words",
  );
});

test("MTG-4: a created event carries the venue in its location field", () => {
  const event = meetingCalendarEvent(meeting({}), {});
  assert.equal(
    event.location,
    "Administration and Records Building, Knox Room 525 · 10 Court Street, Morristown, NJ 07960",
  );
  assert.ok(event.startsAtIso, "and the date and time it always carried");
});

test("MTG-4: a source publishing the ADDRESS as the venue name does not double it", () => {
  // The calendar builder routes through `locationLine`, so an address published as the venue name is not doubled.
  const event = meetingCalendarEvent(
    meeting({
      location: {
        name: "65 Mount Hope Road, Rockaway Township, NJ 07866",
        address: "65 Mount Hope Road, Rockaway Township, NJ 07866",
        lat: 40.9,
        lng: -74.5,
      },
    }),
    {},
  );
  assert.equal(event.location, "65 Mount Hope Road, Rockaway Township, NJ 07866");
});

test("MTG-4: an online meeting's event still carries no invented address", () => {
  const event = meetingCalendarEvent(
    meeting({
      location: null,
      online: { label: "Virtual Meeting", joinUrl: "https://example.gov/join" },
    } as Partial<Meeting>),
    {},
  );
  assert.equal(event.location, "Virtual Meeting — https://example.gov/join");
});
