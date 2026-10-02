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
import type { FixView, OpenFix } from "../../../app/(admin)/_mw/admin-v6/model.ts";
import type { FixQueueItem, FixQueueView } from "../fix-queue.ts";
import { formatEastern } from "../eastern-time.ts";

export const FIXES_MISSING_HISTORY = "Fixed and checked, and Came back: —";

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

export function v6FixesView(queue: FixQueueView): FixView {
  return { open: queue.items.map(openFix), closed: [], returned: [] };
}
