/**
 * The fix queue: a gap the owner queues to be fixed. A queued gap is an owner
 * decision, so it lives in the decision log:
 *
 * ```
 *   fix:<hash>    "Add this to the queue": one gap, identified by where it was
 *                 reported and what it says, so queuing it twice is one item
 *   fix-queue     "Go fix these": the owner's dispatch of everything queued
 * ```
 *
 * Pure: rows in, view out.
 */
import { isResolutionRecord } from "./decision-log.ts";
import type { OwnerDecisionIntent } from "./owner-surface.ts";

export const FIX_SUBJECT_PREFIX = "fix:";
export const FIX_QUEUE_SUBJECT = "fix-queue";
export const ADD_TO_QUEUE_OPTION = "Add this to the queue";
export const GO_FIX_OPTION = "Go fix these";
/** The separator between where a gap was seen and what it said, in `consequenceShown`. */
export const WHERE_SEPARATOR = " — ";

/** FNV-1a over the text, as eight hex digits. Deterministic, dependency-free, no crypto needed for an id. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The subject id for one gap. The same gap on the same surface queues to the same id. */
export function fixSubjectId(where: string, says: string): string {
  return `${FIX_SUBJECT_PREFIX}${fnv1a(`${where.trim()}|${says.trim()}`)}`;
}

/** What the queue button records as the consequence: where, then what. */
export function fixConsequence(where: string, says: string): string {
  return `${where.trim()}${WHERE_SEPARATOR}${says.trim()}`;
}

/**
 * The queue button carries one `value="where — says"` (a `<form>` inside
 * phrasing content is invalid HTML), and the decision route derives the
 * subject and consequence from it here.
 */
export function parseFixField(value: string): { readonly where: string; readonly says: string; readonly subjectId: string; readonly consequenceShown: string } | null {
  const text = value.trim();
  if (text === "") return null;
  const at = text.indexOf(WHERE_SEPARATOR);
  const where = at < 0 ? "the control centre" : text.slice(0, at).trim();
  const says = at < 0 ? text : text.slice(at + WHERE_SEPARATOR.length).trim();
  if (says === "") return null;
  return { where, says, subjectId: fixSubjectId(where, says), consequenceShown: fixConsequence(where, says) };
}

export function isFixIntent(intent: Pick<OwnerDecisionIntent, "subjectId">): boolean {
  return intent.subjectId.startsWith(FIX_SUBJECT_PREFIX);
}

export function isGoFixIntent(intent: Pick<OwnerDecisionIntent, "subjectId">): boolean {
  return intent.subjectId === FIX_QUEUE_SUBJECT;
}

/** A decision about a tracker row: neither a queued gap nor a dispatch of the queue. */
export function isRowDecision(intent: Pick<OwnerDecisionIntent, "subjectId">): boolean {
  return !isFixIntent(intent) && !isGoFixIntent(intent);
}

export type FixQueueState = "QUEUED" | "SENT" | "OPENED" | "REFUSED";

export interface FixQueueItem {
  readonly subjectId: string;
  readonly intentId: string;
  /** The surface the gap was reported on, as the button recorded it. */
  readonly where: string;
  /** The gap sentence the owner read. */
  readonly says: string;
  readonly queuedAt: string;
  readonly state: FixQueueState;
  /** The tracker row opened for it, once one is recorded. */
  readonly openedWork: readonly { readonly id: string; readonly title: string }[];
  readonly refusedReason: string | null;
}

export interface FixQueueView {
  readonly items: readonly FixQueueItem[];
  /** The newest "Go fix these", or null when the owner has never sent one. */
  readonly lastGo: OwnerDecisionIntent | null;
  readonly counts: { readonly queued: number; readonly sent: number; readonly opened: number; readonly refused: number };
}

function splitConsequence(consequence: string): { where: string; says: string } {
  const at = consequence.indexOf(WHERE_SEPARATOR);
  if (at < 0) return { where: "the control centre", says: consequence };
  return { where: consequence.slice(0, at), says: consequence.slice(at + WHERE_SEPARATOR.length) };
}

/**
 * Fold the collapsed decision log (`collapseDecisionLog`) into the queue.
 *
 * A gap's state:
 *   OPENED   work was recorded as opened for it (`openedWork` set, or state CANONICALIZED)
 *   REFUSED  the gates refused it (REJECTED_BY_GATES), with the reason
 *   SENT     a "Go fix these" was recorded after it was queued, not yet reported back
 *   QUEUED   waiting for the owner to send the queue
 */
export function fixQueueView(collapsed: readonly OwnerDecisionIntent[]): FixQueueView {
  const rows = collapsed.filter((r) => !isResolutionRecord(r));
  const goes = rows.filter(isGoFixIntent).sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1));
  const lastGo = goes[0] ?? null;

  const bySubject = new Map<string, OwnerDecisionIntent>();
  for (const row of rows.filter(isFixIntent)) {
    const held = bySubject.get(row.subjectId);
    // The newest queueing of a gap is the one shown; an older one is the same gap.
    if (!held || held.decidedAt < row.decidedAt) bySubject.set(row.subjectId, row);
  }

  const items = [...bySubject.values()]
    .map((row): FixQueueItem => {
      const { where, says } = splitConsequence(row.consequenceShown);
      const opened = row.openedWork ?? [];
      const state: FixQueueState =
        row.state === "REJECTED_BY_GATES"
          ? "REFUSED"
          : row.state === "CANONICALIZED" || opened.length > 0
            ? "OPENED"
            : lastGo !== null && lastGo.decidedAt >= row.decidedAt
              ? "SENT"
              : "QUEUED";
      return {
        subjectId: row.subjectId,
        intentId: row.intentId,
        where,
        says,
        queuedAt: row.decidedAt,
        state,
        openedWork: opened,
        refusedReason: row.refusedReason,
      };
    })
    .sort((a, b) => (a.queuedAt < b.queuedAt ? 1 : a.queuedAt > b.queuedAt ? -1 : a.subjectId.localeCompare(b.subjectId)));

  const count = (s: FixQueueState) => items.filter((i) => i.state === s).length;
  return {
    items,
    lastGo,
    counts: { queued: count("QUEUED"), sent: count("SENT"), opened: count("OPENED"), refused: count("REFUSED") },
  };
}
