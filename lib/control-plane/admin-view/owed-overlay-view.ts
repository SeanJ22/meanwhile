/**
 * **WHAT WAS ADDED TO, OR DECLINED FROM, WHAT PLACES ARE OWED — FOR ADMIN (SC-14, BR-33).** The overlay's log in plain words and
 * Eastern time, newest first, each entry with whether it can still be undone. PURE: the record in, the view out.
 */
import { CHECKLIST_FAMILIES } from "../../coverage/checklist-map.ts";
import type { OwedOverlayRecord } from "../../coverage/owed-overlay.ts";
import { formatEastern } from "../eastern-time.ts";

export interface OwedLogLine {
  /** What Undo names; never shown. */
  readonly changeId: string;
  readonly kind: "add" | "decline" | "undo";
  readonly when: string;
  readonly says: string;
  /** The reason Sean gave, when the change carries one. */
  readonly reason: string | null;
  /** Only an addition or a decline that is still in force can be undone. */
  readonly canUndo: boolean;
}

export interface OwedOverlayView {
  readonly added: number;
  readonly declined: number;
  readonly log: readonly OwedLogLine[];
  readonly observedAt: string;
}

export function owedOverlayView(record: OwedOverlayRecord | null | undefined, observedAt: string): OwedOverlayView {
  const r = record ?? { additions: [], declines: [], log: [], updatedAt: "" };
  const undone = new Set(r.log.filter((e) => e.kind === "undo" && e.undoOf !== undefined).map((e) => e.undoOf as string));
  const reasonOf = (changeId: string): string | null =>
    r.additions.find((a) => a.changeId === changeId)?.reason ?? r.declines.find((d) => d.changeId.replace(/#\d+$/, "") === changeId)?.reason ?? null;
  const family = (changeId: string): string | null => {
    const a = r.additions.find((x) => x.changeId === changeId);
    return a ? CHECKLIST_FAMILIES[a.group]?.name ?? null : null;
  };
  return {
    added: r.additions.filter((a) => a.undone === null).length,
    declined: r.declines.filter((d) => d.undone === null).length,
    observedAt,
    log: [...r.log].reverse().map((e) => ({
      changeId: e.changeId, kind: e.kind, when: formatEastern(e.at),
      says: family(e.changeId) ? `${e.says} (${family(e.changeId)})` : e.says,
      reason: e.kind === "undo" ? null : reasonOf(e.changeId),
      canUndo: e.kind !== "undo" && !undone.has(e.changeId),
    })),
  };
}
