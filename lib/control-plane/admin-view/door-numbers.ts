/**
 * **DOOR NUMBERS ON THE SCOREBOARD (BR-32).** Five rows, each with the counts behind it and a sentence:
 * shut doors now (with how long each took to reopen), posted-to-live against the one-hour target inside the 7-day
 * window, overdue doors, time to repair, and repairs needing no code. PURE: readings in, rows out. A reading the caller
 * could not take arrives as null and its row says "—" and why; nothing is shown as a zero it did not count.
 */
import type { ScoreboardRow } from "../../../app/(admin)/_mw/admin-v6/model.ts";
import type { PostingToLiveRow } from "../../civic-data/posting-to-live.ts";
import type { OverdueDoor } from "../../doors/overdue.ts";
import { SHUT_DOOR_FIX_BY, hoursBetween } from "../../doors/shut-repair.ts";
import type { FixItem } from "../fix-list.ts";

export const POSTED_TARGET_MINUTES = 60;
export const WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

export interface DoorCounts { readonly shut: number; readonly open: number; readonly setAside: number; readonly unreadable: number }

export interface DoorNumberReadings {
  readonly now: string;
  readonly shutDoors: DoorCounts | null;
  /** Open doors whose last read is older than their check; null when the registry could not be read. */
  readonly overdue: readonly OverdueDoor[] | null;
  /** Meeting changes of the versions now live, with the four times kept apart; null when the store could not be read. */
  readonly posting: readonly PostingToLiveRow[] | null;
  /** The fix list, which is the one repair log; null when it could not be read. */
  readonly fixes: readonly FixItem[] | null;
}

const n = (k: number): string => k.toLocaleString("en-US");
const share = (k: number, of: number): string | null => (of > 0 ? `${Math.floor((k * 100) / of)}%` : null);
const row = (id: string, over: Partial<ScoreboardRow> & { says: string }): ScoreboardRow => ({ id, name: id, value: null, counts: null, notMeasured: null, ...over });
const unmeasured = (id: string, why: string): ScoreboardRow => row(id, { says: "Not measured yet.", notMeasured: why });

const hoursWords = (h: number): string => (h < 1 ? `${n(Math.round(h * 60))} minutes` : h === 1 ? "1 hour" : `${n(Math.round(h * 10) / 10)} hours`);
const minutesWords = (m: number): string => (m < 120 ? `${n(m)} minutes` : hoursWords(m / 60));
const median = (xs: readonly number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

/** Door repairs: the shut-door check's finished items, with hours from shutting to reopening. */
function repairs(fixes: readonly FixItem[]): { readonly done: readonly FixItem[]; readonly hours: readonly number[]; readonly openNow: number } {
  const mine = fixes.filter((f) => f.addedBy === SHUT_DOOR_FIX_BY);
  const done = mine.filter((f) => f.state === "FIXED" && f.fixedAt !== undefined);
  const hours = done.map((f) => hoursBetween(f.addedAt, f.fixedAt!)).filter((h): h is number => h !== null);
  return { done, hours, openNow: mine.filter((f) => f.state === "OPEN" || f.state === "FIXING" || f.state === "CAME_BACK").length };
}

function shutRow(r: DoorNumberReadings): ScoreboardRow {
  const id = "Shut doors";
  const d = r.shutDoors;
  if (d === null) return unmeasured(id, "The door registry could not be read just now, so no door is called shut.");
  const rep = r.fixes === null ? null : repairs(r.fixes);
  const reopen = rep === null ? " How long each took to reopen could not be read just now."
    : rep.hours.length === 0 ? " No shut door has reopened yet, so there is no reopening time."
    : ` Reopened ${n(rep.hours.length)} ${rep.hours.length === 1 ? "time" : "times"}, typically after ${hoursWords(median(rep.hours))} (longest ${hoursWords(Math.max(...rep.hours))}).`;
  return row(id, {
    value: n(d.shut),
    counts: `${n(d.shut)} shut · ${n(d.open)} open · ${n(d.setAside)} set aside${d.unreadable > 0 ? ` · ${n(d.unreadable)} unreadable` : ""}`,
    says: `How many ways in are shut right now.${reopen}`,
  });
}

function postedRow(r: DoorNumberReadings): ScoreboardRow {
  const id = "Posted to live";
  if (r.posting === null) return unmeasured(id, "The record of when each change went live could not be read just now.");
  const since = Date.parse(r.now) - WINDOW_DAYS * DAY_MS;
  const inWindow = r.posting.filter((p) => Date.parse(p.firstSeenAt) >= since);
  if (inWindow.length === 0) return unmeasured(id, `No posted change was first seen in the last ${WINDOW_DAYS} days.`);
  const live = inWindow.filter((p) => p.minutesToLive !== null);
  const within = live.filter((p) => p.minutesToLive! <= POSTED_TARGET_MINUTES).length;
  const fromPosted = live.filter((p) => p.basis === "POSTED").length;
  const slow = live.filter((p) => p.minutesToLive! > POSTED_TARGET_MINUTES).map((p) => p.minutesToLive!);
  return row(id, {
    value: share(within, inWindow.length),
    counts: `${n(within)} of ${n(inWindow.length)} changes live within an hour${inWindow.length - live.length > 0 ? ` · ${n(inWindow.length - live.length)} not live yet` : ""} · ${n(fromPosted)} timed from the body's own posting, ${n(live.length - fromPosted)} from when we first saw it`,
    says: `The target is an hour, over the last ${WINDOW_DAYS} days.${slow.length > 0 ? ` The slowest took ${minutesWords(Math.max(...slow))}.` : ""} A change with no posting time from the body is timed from when we first saw it, and says so.`,
  });
}

function overdueRow(r: DoorNumberReadings): ScoreboardRow {
  const id = "Overdue doors";
  if (r.overdue === null || r.shutDoors === null) return unmeasured(id, "The door registry could not be read just now, so no door is called late.");
  const late = r.overdue;
  const counted = late.filter((d) => d.liveFacts !== null);
  const facts = counted.reduce((a, d) => a + d.liveFacts!, 0);
  return row(id, {
    value: n(late.length),
    counts: `${n(late.length)} of ${n(r.shutDoors.open)} open doors are past their check${late.length > 0 ? ` · ${n(facts)} live facts behind ${n(counted.length)} of them${late.length - counted.length > 0 ? `, ${n(late.length - counted.length)} not counted yet` : ""}` : ""}`,
    says: late.length === 0 ? "Every open door was read within its check." : `The latest is ${minutesWords(late[0]!.overdueByMinutes)} past its check. A shut door is counted under Shut doors, not here.`,
  });
}

function repairTimeRow(r: DoorNumberReadings): ScoreboardRow {
  const id = "Time to repair";
  if (r.fixes === null) return unmeasured(id, "The repair log could not be read just now.");
  const rep = repairs(r.fixes);
  if (rep.hours.length === 0) return unmeasured(id, "No shut door has been repaired yet, so there is no repair time.");
  return row(id, {
    value: hoursWords(median(rep.hours)),
    counts: `Typical of ${n(rep.hours.length)} repaired ${rep.hours.length === 1 ? "door" : "doors"} · longest ${hoursWords(Math.max(...rep.hours))}${rep.openNow > 0 ? ` · ${n(rep.openNow)} still being repaired` : ""}`,
    says: "From the door shutting to it reading well again, for doors the shut-door check opened a repair for.",
  });
}

function noCodeRow(r: DoorNumberReadings): ScoreboardRow {
  const id = "Repairs without code";
  if (r.fixes === null) return unmeasured(id, "The repair log could not be read just now.");
  const { done } = repairs(r.fixes);
  if (done.length === 0) return unmeasured(id, "No shut door has been repaired yet, so there is nothing to count.");
  // A door repair is finished when a read of the door record succeeds; it is either an edit to the record or the source answering again. Neither is a release.
  const edited = done.filter((f) => f.changedBy === "A change to the door's record").length;
  const noCode = done.filter((f) => f.changedBy === "A change to the door's record" || f.changedBy === "The source itself").length;
  return row(id, {
    value: share(noCode, done.length),
    counts: `${n(noCode)} of ${n(done.length)} repairs needed no code · ${n(edited)} by editing the door's record, ${n(noCode - edited)} when the source answered again`,
    says: "A repair that changed the door's record or waited for the source needs no release.",
  });
}

/** The five door rows, keyed by the Scoreboard's names. */
export function doorRows(r: DoorNumberReadings): ReadonlyMap<string, ScoreboardRow> {
  const rows = [shutRow(r), postedRow(r), overdueRow(r), repairTimeRow(r), noCodeRow(r)];
  return new Map(rows.map((x) => [x.id, x]));
}
