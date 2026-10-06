/**
 * **MTG-14 — AN ONLINE SITTING IS MARKED ON EVERY SURFACE A READER MEETS IT
 * ON, AND THE MARK SURVIVES THE COLOUR BEING TAKEN AWAY.** (2026-08-28.)
 *
 * ## What was actually wrong, which is narrower than "there is no marker"
 *
 * There was one. `components/map/list-overlay.tsx` has rendered an Online pill
 * since D18. Three things were wrong around it:
 *
 * 1. **Two discovery surfaces did not mark online at all** — the door
 *    overlay's "Next meeting" line and the Ask autocomplete. A reader met a
 *    sitting there, saw a body and a time, and learned there was no room to
 *    turn up at only if they happened to open the card.
 * 2. **The three status pills were distinguished only by BACKGROUND COLOUR.**
 *    Same shape, same size, same uppercase type, no icon, no screen-reader
 *    qualifier. `docs/DESIGN.md` is explicit that this is not stylistic:
 *    roughly one reader in twelve cannot separate the green from the red, and
 *    a build is checked by stripping colour and asking whether the answer is
 *    still legible.
 * 3. **The predicate had thirteen copies and no name**, and the sentence a
 *    reader is shown was written out twice.
 *
 * ## Why the fixtures rather than the snapshot
 *
 * `data/meetings-snapshot.json` is rewritten by a scheduled refresh — it moved
 * under this very session — and a government reschedules things. A test that
 * asserted "these 61 meetings" or "this meeting is online" against it would be
 * asserting a fact about a moving data file rather than about our code, and
 * would go red for a reason nobody could act on.
 *
 * So the BEHAVIOUR is asserted against recorded fixtures, and the INVARIANT is
 * asserted against the live snapshot with **both sides computed and neither
 * hard-coded**, over a floored denominator (RULING 159).
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

/** The named case, and the unnamed control, from the brief. */
const NAMED = fixtures.online.find((m) => m.id === "diligent:pcc:698")!;
const CONTROL = fixtures.online.find((m) => m.id === "clerksboards:3:2026-09-16")!;

/* ========================================================================== */
/* The helper is the one derivation                                           */
/* ========================================================================== */

/** Surfaces routed through `lib/meetings/online.ts` by this change. */
const ROUTED = [
  "components/map/list-overlay.tsx",
  "components/map/door-overlay.tsx",
  "components/map/popup/meeting-popup.tsx",
  "lib/meetings/venues.ts",
  "components/ui/meeting-row.tsx",
];

/**
 * Shared files this session may not edit (RULING 191 — the integration owner
 * reconciles them once). The exact hunks are reported with the work; they are
 * named here rather than left silent, because an unlisted exception is how a
 * sweep quietly stops covering the thing it was written for.
 */
const RECONCILED_ELSEWHERE: { file: string; stillThere: RegExp; hunk: string }[] = [
  {
    file: "components/map/map-entry.tsx",
    // The second written-out copy of the reader-facing sentence.
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
  /*
   * It was written out twice, in the popup and in map-entry. Two copies of one
   * claim about a government's meeting is one copy that will be edited and one
   * that will not.
   */
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
  /*
   * Not an exemption, and not a ratchet that needs a second edit to clear.
   *
   * Each of these is either **unreconciled** — it still carries its own
   * derivation and does not import the helper, which is exactly true today —
   * or **reconciled**, importing the helper and carrying no inline derivation
   * of its own. What is a defect is the state in between: a file that imports
   * the helper AND still decides for itself somewhere, which is how a
   * half-applied hunk leaves one surface answering the question two ways.
   *
   * So this passes before the reported hunks land and after, and goes red on
   * the only case that is actually wrong.
   */
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

/* ========================================================================== */
/* Every discovery surface marks it                                           */
/* ========================================================================== */

test("MTG-14: both discovery surfaces this session owns render the online mark", () => {
  /*
   * The list overlay always did. The door overlay's "Next meeting" line did
   * not, and it is the defect: it is one of the three places a reader FIRST
   * meets a sitting.
   */
  for (const file of ["components/map/list-overlay.tsx", "components/map/door-overlay.tsx"]) {
    const src = read(file);
    assert.match(src, /<MeetingRow/, `${file} must mount the shared row`);
    const shared = read("components/ui/meeting-row.tsx");
    assert.match(shared, /MeetingStatusPill/);
    assert.match(shared, /status="online"/);
    assert.match(shared, /onlineAccessFor\(meeting\)/);

  }
});

/* ========================================================================== */
/* The colour-stripping test                                                  */
/* ========================================================================== */

const STATUSES: MeetingPillStatus[] = ["concluded", "canceled", "online"];

test("MTG-14: stripped of colour, every status is still told apart by its MARK", () => {
  /*
   * The design doc's own check, as an assertion. `data-status` selects a
   * background and nothing else, so a pill whose only difference is that
   * attribute is a pill one reader in twelve cannot read.
   */
  const marks = STATUSES.map((s) => STATUS_MARK[s]);
  assert.equal(new Set(marks).size, STATUSES.length, `two statuses share a mark: ${marks.join(" ")}`);
  for (const status of STATUSES) {
    assert.ok(STATUS_MARK[status].length > 0, `${status} carries no mark`);
  }
});

test("MTG-14: stripped of colour, every status is still told apart by its WORD", () => {
  const words = STATUSES.map((s) => STATUS_WORD[s]);
  assert.equal(new Set(words).size, STATUSES.length, `two statuses share a word: ${words.join(" / ")}`);
  // The word is what carries the meaning under the house pattern, so it may
  // never be the empty string or a bare glyph.
  for (const word of words) assert.match(word, /[A-Za-z]{4}/);
});

test("MTG-14: the mark is decorative and the word carries the meaning", () => {
  /*
   * `components/map/meeting-panel.tsx` sets the pattern: the status dot is
   * `aria-hidden="true"` and the word is printed. A mark that a screen reader
   * announces as a glyph is noise; a mark it announces INSTEAD of the word is a
   * fact withheld.
   */
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
  /*
   * The published strings are free text in inconsistent case — "VIRTUAL
   * MEETING" beside "via Zoom" — and a badge that printed them would shout in
   * one row and murmur in the next. The label still reaches the reader in the
   * "How to join" row, quoted, which is where it belongs.
   */
  const published = new Set(fixtures.online.map((m) => m.online?.label));
  assert.ok(published.size > 1, "the fixtures do not span more than one label vocabulary");
  for (const label of published) {
    assert.notEqual(STATUS_WORD.online, label, `the mark prints a published label: ${label}`);
  }
  assert.equal(STATUS_WORD.online, ONLINE_MARK_WORD);
  assert.match(ONLINE_MARK_WORD, /only/i, "the mark's word must carry that there is no room");
});

/* ========================================================================== */
/* Behaviour, against recorded fixtures                                       */
/* ========================================================================== */

test("MTG-14: the named case and the unnamed control both read as online-only", () => {
  /*
   * Two adapters, two governments, two label vocabularies. `diligent:pcc:698`
   * is Pima Community College's Finance and Audit Committee, published as
   * "VIRTUAL MEETING"; `clerksboards:3:2026-09-16` is the City of Tucson's
   * Commission on Disability Issues, published as "Microsoft Teams (Virtual)".
   * A repair that only worked on one of them would be a repair to a string.
   */
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
  /*
   * `lib/meetings/venues.ts` holds the ONE gate that decides this, and it is
   * correct. A helper that made it easy to give an online sitting a coordinate
   * would put a marker on a building nobody is going to.
   */
  const venues = groupByVenue([...fixtures.online, ...fixtures.physical]);
  const pinned = new Set(venues.flatMap((v) => v.meetings.map((m) => m.id)));
  for (const meeting of fixtures.online) {
    assert.ok(!pinned.has(meeting.id), `${meeting.id} was given a pin`);
  }
  for (const meeting of fixtures.physical) {
    assert.ok(pinned.has(meeting.id), `${meeting.id} lost its pin`);
  }
});

/* ========================================================================== */
/* The invariant, over whatever the snapshot currently holds                  */
/* ========================================================================== */

test("MTG-14: location === null and online !== undefined agree, both sides computed", () => {
  /*
   * **NOTHING HERE IS TYPED IN.** The snapshot is rewritten by a scheduled
   * refresh; a count written into this file would be a claim about a moving
   * data file. What does not move is that the two halves are a PAIR — and
   * nothing mechanical holds them together: no discriminated union, no boolean
   * on the row, no check constraint on `online_label` / `online_join_url`. It
   * is held by prose and by adapter tests, which is exactly why it is worth
   * measuring here.
   */
  const snapshot = JSON.parse(read("data/meetings-snapshot.json")) as { meetings: Meeting[] };
  const meetings = snapshot.meetings;

  const byLocation = meetings.filter((m) => isOnlineOnly(m));
  const byOnline = meetings.filter((m) => m.online !== undefined && m.online !== null);

  const count = floored(
    "meetings whose two online halves agree",
    "data/meetings-snapshot.json",
    meetings.length,
    meetings.filter((m) => isOnlineOnly(m) === (m.online !== undefined && m.online !== null)).length,
  );
  assert.equal(count.outcome, "MEASURED");
  assert.equal(
    count.matched,
    count.denominator,
    `${count.denominator - count.matched} meeting(s) break the pair invariant`,
  );

  // Stated as a set difference too, so a failure names the rows rather than a
  // number: "some meeting somewhere" is not an actionable finding.
  const onlyOnline = byOnline.filter((m) => !byLocation.includes(m)).map((m) => m.id);
  assert.deepEqual(onlyOnline, [], "these have a room AND online access");

  /*
   * 2026-09-23 (the owner's Tucson Unified directive): a sitting with no room
   * AND no published online access is no longer a broken pair read as "online
   * only" — that sentence claimed there was no room, which nothing
   * established. It is its own named state, `isPlaceUnrecorded`, and it stays
   * listed. So the no-room rows must PARTITION exactly into online and
   * place-not-recorded, each computed, neither typed in.
   */
  const noRoom = meetings.filter((m) => !hasPhysicalLocation(m));
  const partitioned = noRoom.filter((m) => isOnlineOnly(m) !== isPlaceUnrecorded(m));
  assert.equal(partitioned.length, noRoom.length, "a no-room sitting is neither or both of online / place-not-recorded");
});

test("MTG-14: the snapshot still contains online sittings for the marker to be about", () => {
  /*
   * The floor, and it is the half that a passing suite hides. If a refresh
   * dropped every online meeting, every assertion above about behaviour would
   * still pass over an empty set — which is RULING 159's whole subject.
   */
  const snapshot = JSON.parse(read("data/meetings-snapshot.json")) as { meetings: Meeting[] };
  const count = floored(
    "online-only sittings",
    "data/meetings-snapshot.json",
    snapshot.meetings.length,
    snapshot.meetings.filter((m) => isOnlineOnly(m)).length,
  );
  assert.equal(count.outcome, "MEASURED");
  assert.ok(
    count.matched > 0,
    "no online sitting is in the snapshot at all — the marker is unreachable, and that is a finding",
  );
});
