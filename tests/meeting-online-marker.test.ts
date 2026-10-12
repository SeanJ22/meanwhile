/**
 * An online sitting is marked on every surface a reader meets it on, and the mark survives the colour being taken
 * away: each status pill carries its own mark and word, not only a background colour.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  hasPhysicalLocation,
  isOnlineOnly,
  isPlaceUnrecorded,
  joinLine,
  onlineAccessFor,
  ONLINE_MARK_WORD,
  ONLINE_ONLY_LINE,
} from "../lib/meetings/online.ts";
import {
  STATUS_MARK,
  STATUS_QUALIFIER,
  STATUS_WORD,
  type MeetingPillStatus,
} from "../lib/meetings/status-marks.ts";
import { groupByVenue } from "../lib/meetings/venues.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import type { Meeting } from "../lib/sources/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string): string => readFileSync(join(ROOT, p), "utf8");

const fixtures = JSON.parse(read("tests/fixtures/online-meetings.json")) as {
  online: Meeting[];
  physical: Meeting[];
};

/** Two adapters, two governments, two label vocabularies. */
const NAMED = fixtures.online.find((m) => m.id === "diligent:pcc:698")!;
const CONTROL = fixtures.online.find((m) => m.id === "clerksboards:3:2026-09-16")!;

/** Surfaces that must read online-ness from `lib/meetings/online.ts`. */
const ROUTED = [
  "components/map/list-overlay.tsx",
  "components/map/door-overlay.tsx",
  "lib/meetings/venues.ts",
  "components/ui/meeting-row.tsx",
];

/** Shared files that either still derive online-ness themselves or import the helper, never both. */
const RECONCILED_ELSEWHERE: { file: string; stillThere: RegExp; hunk: string }[] = [
  {
    file: "components/map/map-entry.tsx",
    stillThere: /there is no room to attend in person/,
    hunk: "meetingSubject()'s Where/How-to-join facts — import ONLINE_ONLY_LINE, onlineAccessFor and joinLine, and add a status badge for an online sitting",
  },
  {
    file: "components/ask/ask-box.tsx",
    stillThere: /m\.location === null/,
    hunk: "the meeting autocomplete row — import isOnlineOnly and render the online mark beside search-ac-meta",
  },
];

test("MTG-14: every routed surface asks the helper rather than re-deriving the predicate", () => {
  const offenders: string[] = [];
  for (const file of ROUTED) {
    const src = read(file);
    if (/meeting\.location\s*===\s*null/.test(src)) offenders.push(`${file} (inline predicate)`);
    if (!/from "(@\/lib\/meetings\/online|\.\/online\.ts)"/.test(src) && !(/from "@\/components\/ui\/meeting-(row|card)"/.test(src) && /<Meeting(Row|Card)/.test(src))) {
      offenders.push(`${file} (does not import the helper)`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these surfaces still decide online-ness for themselves — import isOnlineOnly / hasPhysicalLocation",
  );
});

test("MTG-14: the reader-facing sentence exists in exactly ONE place", () => {
  const sentence = "there is no room to attend in person";
  const carriers = [...ROUTED, "lib/meetings/online.ts"].filter((f) => read(f).includes(sentence));
  assert.deepEqual(
    carriers,
    ["lib/meetings/online.ts"],
    "the online-only sentence is written out somewhere other than its module",
  );
  assert.match(ONLINE_ONLY_LINE, /Online only/);
  assert.match(ONLINE_ONLY_LINE, /no room to attend in person/);
});

test("MTG-14: the shared files are in ONE of the two honest states, never half-way", () => {
  // A file that imports the helper AND still decides for itself answers the question two ways.
  const mixed: string[] = [];
  for (const pending of RECONCILED_ELSEWHERE) {
    const src = read(pending.file);
    const imports = /from "@\/lib\/meetings\/online"/.test(src);
    const derivesItself = pending.stillThere.test(src);
    if (imports && derivesItself) {
      mixed.push(`${pending.file} — half-applied: ${pending.hunk}`);
    }
  }
  assert.deepEqual(
    mixed,
    [],
    "these files ask the helper in one place and answer for themselves in another",
  );
});

test("MTG-14: both discovery surfaces this session owns render the online mark", () => {
  for (const file of ["components/map/list-overlay.tsx", "components/map/door-overlay.tsx"]) {
    const src = read(file);
    assert.match(src, /<MeetingRow/, `${file} must mount the shared row`);
    const shared = read("components/ui/meeting-row.tsx");
    assert.match(shared, /MeetingStatusPill/);
    assert.match(shared, /status="online"/);
    assert.match(shared, /onlineAccessFor\(meeting\)/);
  }
});

const STATUSES: MeetingPillStatus[] = ["concluded", "canceled", "online"];

test("MTG-14: stripped of colour, every status is still told apart by its MARK", () => {
  // `data-status` selects a background and nothing else, so the mark must differ too.
  const marks = STATUSES.map((s) => STATUS_MARK[s]);
  assert.equal(new Set(marks).size, STATUSES.length, `two statuses share a mark: ${marks.join(" ")}`);
  for (const status of STATUSES) {
    assert.ok(STATUS_MARK[status].length > 0, `${status} carries no mark`);
  }
});

test("MTG-14: stripped of colour, every status is still told apart by its WORD", () => {
  const words = STATUSES.map((s) => STATUS_WORD[s]);
  assert.equal(new Set(words).size, STATUSES.length, `two statuses share a word: ${words.join(" / ")}`);
  // The word carries the meaning, so it is never empty or a bare glyph.
  for (const word of words) assert.match(word, /[A-Za-z]{4}/);
});

test("MTG-14: the mark is decorative and the word carries the meaning", () => {
  // The status dot is `aria-hidden="true"` and the word is printed.
  const src = read("components/map/meeting-status-pill.tsx");
  assert.match(src, /aria-hidden="true"/, "the mark is not marked decorative");
  assert.match(src, /className="sr-only"/, "no screen-reader qualifier on the pill");
  for (const status of STATUSES) {
    assert.match(
      STATUS_QUALIFIER[status],
      /this sitting|no room to attend/,
      `${status}'s qualifier does not say what the state means`,
    );
  }
});

test("MTG-14: no marker prints a body's published label as a badge", () => {
  // Published labels are free text in inconsistent case; they reach the reader quoted in "How to join", not as a badge.
  const published = new Set(fixtures.online.map((m) => m.online?.label));
  assert.ok(published.size > 1, "the fixtures do not span more than one label vocabulary");
  for (const label of published) {
    assert.notEqual(STATUS_WORD.online, label, `the mark prints a published label: ${label}`);
  }
  assert.equal(STATUS_WORD.online, ONLINE_MARK_WORD);
  assert.match(ONLINE_MARK_WORD, /only/i, "the mark's word must carry that there is no room");
});

test("MTG-14: the named case and the unnamed control both read as online-only", () => {
  for (const meeting of [NAMED, CONTROL]) {
    assert.ok(isOnlineOnly(meeting), `${meeting.id} does not read as online-only`);
    assert.ok(!hasPhysicalLocation(meeting), `${meeting.id} claims a physical location`);
    const access = onlineAccessFor(meeting);
    assert.ok(access, `${meeting.id} has no published online access`);
    assert.equal(access.joinUrl, null, `${meeting.id} now publishes a join link — the fixture is stale`);
    assert.match(joinLine(access), /the body hasn't published a join link/);
    assert.ok(
      joinLine(access).startsWith(access.label),
      "the join line quotes what the body published before naming the gap",
    );
  }
  assert.notEqual(NAMED.online?.label, CONTROL.online?.label, "the two fixtures share a vocabulary");
});

test("MTG-14: a physical sitting is untouched by any of it", () => {
  for (const meeting of fixtures.physical) {
    assert.ok(!isOnlineOnly(meeting), `${meeting.id} reads as online`);
    assert.ok(hasPhysicalLocation(meeting));
    assert.equal(onlineAccessFor(meeting), null, `${meeting.id} produced online access from a room`);
  }
});

test("MTG-14: an online sitting never becomes a map pin, and a physical one always does", () => {
  // `lib/meetings/venues.ts` holds the one gate that decides what becomes a pin.
  const venues = groupByVenue([...fixtures.online, ...fixtures.physical]);
  const pinned = new Set(venues.flatMap((v) => v.meetings.map((m) => m.id)));
  for (const meeting of fixtures.online) {
    assert.ok(!pinned.has(meeting.id), `${meeting.id} was given a pin`);
  }
  for (const meeting of fixtures.physical) {
    assert.ok(pinned.has(meeting.id), `${meeting.id} lost its pin`);
  }
});

test("MTG-14: location === null and online !== undefined agree, both sides computed", () => {
  // Nothing mechanical holds the two halves together, so the pair is measured.
  const meetings = [...fixtures.online, ...fixtures.physical];

  const byLocation = meetings.filter((m) => isOnlineOnly(m));
  const byOnline = meetings.filter((m) => m.online !== undefined && m.online !== null);

  const count = floored(
    "meetings whose two online halves agree",
    "tests/fixtures/online-meetings.json",
    meetings.length,
    meetings.filter((m) => isOnlineOnly(m) === (m.online !== undefined && m.online !== null)).length,
  );
  assert.equal(count.outcome, "MEASURED");
  assert.equal(
    count.matched,
    count.denominator,
    `${count.denominator - count.matched} meeting(s) break the pair invariant`,
  );

  // Stated as a set difference too, so a failure names the rows.
  const onlyOnline = byOnline.filter((m) => !byLocation.includes(m)).map((m) => m.id);
  assert.deepEqual(onlyOnline, [], "these have a room AND online access");

  // A no-room sitting is exactly one of online-only or place-not-recorded.
  const noRoom = meetings.filter((m) => !hasPhysicalLocation(m));
  const partitioned = noRoom.filter((m) => isOnlineOnly(m) !== isPlaceUnrecorded(m));
  assert.equal(partitioned.length, noRoom.length, "a no-room sitting is neither or both of online / place-not-recorded");
});

test("MTG-14: the fixture still contains online sittings for the marker to be about", () => {
  // If every online meeting were dropped, every behaviour assertion above would pass over an empty set.
  const meetings = [...fixtures.online, ...fixtures.physical];
  const count = floored(
    "online-only sittings",
    "tests/fixtures/online-meetings.json",
    meetings.length,
    meetings.filter((m) => isOnlineOnly(m)).length,
  );
  assert.equal(count.outcome, "MEASURED");
  assert.ok(
    count.matched > 0,
    "no online sitting is in the fixture at all — the marker is unreachable, and that is a finding",
  );
});
