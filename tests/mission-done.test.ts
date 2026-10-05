/**
 * CH-19: a mission is done when its map is full and its doors refresh. Done is read from the mission map and the
 * doors' next reads, never from registry obligations alone; it changes no record, and a new owed row reopens it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { PlaceOwedItem } from "../lib/coverage/place-owed.ts";
import { evaluateMissionDone, isUnfilledRow, missionDoneWords, missionMapCount, type MemberRecord } from "../lib/control-plane/assignment-completion.ts";

const key = "scope:az.county.04003";
const at = "2026-10-05T12:00:00Z";
const member = (id: string, nextDueAt: string | null): MemberRecord => ({ id, lastWorkedAt: at, nextDueAt,
  assignments: [{ assignmentKey: key, relation: "CREATED", at }] });
function row(state: PlaceOwedItem["state"], statuses: Partial<PlaceOwedItem["statuses"]> = {}): PlaceOwedItem {
  return { id: `r${Math.random()}`, checklistId: "MTG-07", requirement: "", label: "", held: [], state,
    subject: { id: "s", kind: "division", divisionIds: [], label: "" },
    statuses: { applies: "applies", due: "due", found: "nothing-yet", published: "not-known", fresh: "not-captured", seen: "not-checked",
      nextCheck: null, waitingWords: null, hasProducer: true, noProducerWords: null, ...statuses } } as PlaceOwedItem;
}
const noDebt = () => null;

test("a row is unfilled when it is due and neither held fresh nor waiting on the government", () => {
  assert.equal(isUnfilledRow(row("missing")), true);
  assert.equal(isUnfilledRow(row("stale")), true);
  assert.equal(isUnfilledRow(row("missing", { due: "unresolved" })), true, "an unclear due date stays owed");
  assert.equal(isUnfilledRow(row("missing", { found: "in-progress" })), true, "being worked is not filled");
  assert.equal(isUnfilledRow(row("published")), false);
  assert.equal(isUnfilledRow(row("unpublished")), false, "verified not published by the government is resolved");
  assert.equal(isUnfilledRow(row("missing", { published: "awaiting-publication" })), false, "awaiting publication is resolved");
  assert.equal(isUnfilledRow(row("missing", { found: "checked-not-posted" })), false);
  assert.equal(isUnfilledRow(row("missing", { due: "not-yet-due" })), false);
});

test("Done when the map is full and every door has a next read, with before-and-after counts", () => {
  const full = missionMapCount([row("published"), row("unpublished"), row("missing", { published: "awaiting-publication" })], 7);
  const done = evaluateMissionDone({ assignmentKey: key, obligations: [member("o1", "2026-10-06T00:00:00Z")], debtFor: noDebt, map: full });
  assert.equal(done.kind, "COMPLETE");
  assert.deepEqual(done.kind === "COMPLETE" ? done.map : null, { owed: 3, unfilled: 0, stale: 0, before: 7 });
  assert.match(missionDoneWords(done), /^Done: every one of 3 owed .* \(7 were open when the map was first read\)/);
  const failing = evaluateMissionDone({ assignmentKey: key, obligations: [member("o1", "2026-10-06T00:00:00Z")], map: full,
    debtFor: () => ({ consecutiveFailures: 2, detail: "timeout", retryAt: "2026-10-06T00:00:00Z" }) });
  assert.equal(failing.kind, "COMPLETE", "the map decides; a door that still refreshes on schedule does not hold it open");
});

test("not Done while a row is open or a door has no next read", () => {
  const open = evaluateMissionDone({ assignmentKey: key, obligations: [member("o1", "2026-10-06T00:00:00Z")], debtFor: noDebt,
    map: missionMapCount([row("published"), row("stale")], null) });
  assert.equal(open.kind, "NOT_COMPLETE");
  if (open.kind === "NOT_COMPLETE") {
    assert.equal(open.unsettledCount, 1);
    assert.deepEqual(open.map, { owed: 2, unfilled: 1, stale: 1, before: 1 });
  }
  assert.match(missionDoneWords(open), /^Not done: 1 of 2 owed still open/);
  const noRefresh = evaluateMissionDone({ assignmentKey: key, obligations: [member("o1", "2026-10-06T00:00:00Z"), member("o2", null)], debtFor: noDebt,
    map: missionMapCount([row("published")], null) });
  assert.equal(noRefresh.kind, "NOT_COMPLETE");
  if (noRefresh.kind === "NOT_COMPLETE") {
    assert.deepEqual(noRefresh.exceptions.map((e) => [e.obligationId, e.says]), [["o2", "no next read is scheduled for this door"]]);
    assert.equal(noRefresh.settled, 1);
  }
});

test("a newly found owed row reopens a Done mission, and an unread map is never Done", () => {
  const doors = [member("o1", "2026-10-06T00:00:00Z")];
  const first = evaluateMissionDone({ assignmentKey: key, obligations: doors, debtFor: noDebt, map: missionMapCount([row("published")], 4) });
  assert.equal(first.kind, "COMPLETE");
  const reopened = evaluateMissionDone({ assignmentKey: key, obligations: doors, debtFor: noDebt,
    map: missionMapCount([row("published"), row("missing")], first.kind === "COMPLETE" ? first.map!.before : null) });
  assert.equal(reopened.kind, "NOT_COMPLETE", "a new body's rows reopen the mission");
  const unread = evaluateMissionDone({ assignmentKey: key, obligations: doors, debtFor: noDebt, map: { unreadable: "held capture timed out" } });
  assert.equal(unread.kind, "NOT_COMPLETE");
  const nothing = evaluateMissionDone({ assignmentKey: key, obligations: [], debtFor: noDebt, map: missionMapCount([], null) });
  assert.equal(nothing.kind, "NO_MEMBERS", "an empty map is not evidence that the work is done");
});
