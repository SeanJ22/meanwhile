/**
 * **`admin-v6/fixes@1` — THE FIX LIST VIEW'S READING, FROM THE FIX QUEUE.** (S11;
 * replaces the old Fix list page and its hand-written list, rulings §0.)
 *
 * The fix queue is the one durable path from a gap to engineering work: the owner
 * (or the chat) adds a gap, "Go fix these" sends what is waiting, and the next
 * decision sync opens a tracker row for each. This reads that queue and states
 * only what it holds:
 *
 * ```
 *   QUEUED, REFUSED   Needs attention   waiting on "Go fix these", or refused by the gates
 *   SENT, OPENED      Being fixed       sent for engineering; OPENED names the tracker row
 * ```
 *
 * The queue records no completion, so "Fixed and checked" and "Came back" are
 * empty and say so (`missingParts`) rather than looking like "nothing was ever
 * fixed". PURE: queue in, view out.
 */
import type { ClosedFix, FixShot, FixView, LookView, OpenFix, TestingFix } from "../../../app/(admin)/_mw/admin-v6/model.ts";
import type { FixProofBar, MethodStanding } from "../../method/fix-status.ts";
import { brokeSince } from "../fix-standing.ts";
import type { FixQueueItem, FixQueueView } from "../fix-queue.ts";
import { formatEastern } from "../eastern-time.ts";

const formatEasternDay = (iso: string): string => new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
import type { FixItem } from "../fix-list.ts";
import { fixEpisodes, fixHistoryLine, type FixItemWithHistory } from "../fix-history.ts";

export const FIXES_MISSING_HISTORY = "Fixed and checked, and Came back: only fixes recorded on the fix list";

const FIRST_SENTENCE = /^[^.!?]*[.!?]?/;

function titleOf(says: string): string {
  const first = (FIRST_SENTENCE.exec(says.trim())?.[0] ?? says).trim();
  return first.length > 120 ? `${first.slice(0, 117)}…` : first;
}

function openFix(item: FixQueueItem): OpenFix {
  const row = item.openedWork[0] ?? null;
  const placeInLine: Record<FixQueueItem["state"], string> = {
    QUEUED: `Queued ${formatEastern(item.queuedAt)}`,
    SENT: "Sent",
    OPENED: row ? `Work row open (${row.id})` : "Work row open",
    REFUSED: item.refusedReason ? `Refused: ${item.refusedReason}` : "Refused",
  };
  return {
    id: item.subjectId,
    title: titleOf(item.says),
    tab: item.state === "QUEUED" || item.state === "REFUSED" ? "attention" : "fixing",
    owner: "Engineering",
    problem: item.says,
    helps: item.where,
    placeInLine: placeInLine[item.state],
    resourcesNow: "—",
    taskStage: item.state === "OPENED" ? 0 : null,
    taskId: row ? row.id : null,
    linkedStuck: [],
    origin: "engineering",
    technical: `Fix queue item ${item.subjectId}, intent ${item.intentId}, state ${item.state}, queued ${item.queuedAt}.`,
  };
}

function listOpen(item: FixItem): OpenFix {
  return {
    id: item.id,
    title: titleOf(item.says),
    tab: item.state === "OPEN" ? "attention" : "fixing",
    owner: "Engineering",
    problem: item.says,
    helps: item.where,
    placeInLine: item.state === "OPEN" ? `Added ${formatEastern(item.addedAt)}` : `Started ${formatEastern(item.startedAt ?? item.addedAt)}`,
    resourcesNow: "—",
    taskStage: null,
    taskId: null,
    linkedStuck: [],
    origin: item.addedBy === "owner" ? "engineering" : "automatic",
    technical: `Fix list item ${item.id}, state ${item.state}, added ${item.addedAt}.`,
  };
}

function listClosed(item: FixItemWithHistory, now: string): ClosedFix {
  const cameBack = item.state === "CAME_BACK";
  // DP-30: every episode the item has had, so a door that broke twice reads as two, with how long each fix held.
  const episodes = fixEpisodes(item, now);
  const holding = episodes.at(-1)?.stillHolding ? episodes.at(-1)!.heldHours : null;
  return {
    id: item.id,
    title: titleOf(item.says),
    changed: item.whatChanged ?? "—",
    places: item.where,
    fixedAt: item.fixedAt ?? item.addedAt,
    origin: item.addedBy === "owner" ? "Engineering fix" : "Automatic repair",
    whatChanged: `Before: ${item.before ?? "—"}. After: ${item.after ?? "—"}. Changed by ${item.changedBy ?? "—"}.${item.undo ? " It can be undone." : ""}`,
    readerRecheck: "—",
    since: cameBack && item.cameBackAt ? `Came back ${formatEastern(item.cameBackAt)}` : holding !== null ? `Holding for ${holding < 48 ? `${Math.round(holding)} hours` : `${Math.round(holding / 24)} days`}` : "—",
    history: fixHistoryLine(item, now),
    saved: "—",
    usedBy: "—",
    ...(cameBack && item.cameBackAt ? { returnedDetail: formatEastern(item.cameBackAt) } : {}),
    technical: `Fix list item ${item.id}, state ${item.state}.`,
  };
}

/**
 * The Fix list view: the control-plane fix list (Open, Being fixed, Fixed and
 * checked, Came back), plus any older queued gap still waiting in the decision
 * log. Items the list already holds are not shown twice.
 */
/** DP-26: a fix in Testing, in plain words: how far it has got against the proof bar. */
export function testingFix(s: MethodStanding, bar: FixProofBar): TestingFix {
  const p = (k: number) => `${k.toLocaleString("en-US")} place${k === 1 ? "" : "s"}`;
  const broke = brokeSince(s);
  return {
    id: s.methodId, title: s.title, works: s.works, tried: s.tried, needPlaces: bar.places, since: s.since,
    brokeSince: broke === null ? null : formatEasternDay(broke),
    next: `Works in ${p(s.works)} of ${p(s.tried)} tried. Proven once it works in ${p(bar.places)} across more than one district or state, with at least ${Math.round(bar.successShare * 100)}% of tried places working.`,
  };
}

export function v6FixesView(queue: FixQueueView, list: readonly FixItem[] = [], now: string = new Date().toISOString(),
  testing?: { readonly standings: readonly MethodStanding[]; readonly bar: FixProofBar },
  look?: { readonly view: LookView | null; readonly shots: ReadonlyMap<string, readonly FixShot[]> }): FixView {
  const withShots = <T extends OpenFix | ClosedFix>(f: T): T => (look?.shots.has(f.id) ? { ...f, shots: look.shots.get(f.id)! } : f);
  const held = new Set(list.map((i) => i.id));
  const legacy = queue.items.filter((i) => !held.has(i.subjectId)).map(openFix);
  const open = list.filter((i) => i.state === "OPEN" || i.state === "FIXING").map(listOpen);
  const fixed = list.filter((i) => i.state === "FIXED").sort((a, b) => (b.fixedAt ?? "").localeCompare(a.fixedAt ?? "")).map((i) => listClosed(i, now));
  // A came-back item is also open work again: it reads in both places.
  const returned = list.filter((i) => i.state === "CAME_BACK");
  return { open: [...open, ...returned.map(listOpen), ...legacy].map(withShots), closed: fixed.map(withShots), returned: returned.map((i) => withShots(listClosed(i, now))),
    ...(testing ? { testing: testing.standings.filter((s) => s.status === "TESTING").map((s) => testingFix(s, testing.bar)) } : {}),
    ...(look ? { look: look.view } : {}) };
}
