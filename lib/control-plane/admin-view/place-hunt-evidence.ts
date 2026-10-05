import { isTerminalState, type WorkItem } from "../work-item.ts";
import type { HuntEvidence } from "../../coverage/place-statuses.ts";

/**
 * **WHAT THE HUNT IS DOING ABOUT EACH SUBJECT**, from work items already held.
 * A work item counts for its canonical subject and for the body its publication
 * names. An open item is in progress; a finished one is an attempt. It reads
 * nothing new and creates no work.
 *
 * PURE.
 */
export function huntEvidenceFromWorkItems(items: readonly Pick<WorkItem, "subject" | "state" | "autonomousPlan">[]): ReadonlyMap<string, HuntEvidence> {
  const out = new Map<string, { inProgress: boolean; attempts: number }>();
  for (const item of items) {
    const ids = new Set([item.subject, item.autonomousPlan?.publication?.bodyId].filter((id): id is string => typeof id === "string" && id !== ""));
    for (const id of ids) {
      const entry = out.get(id) ?? { inProgress: false, attempts: 0 };
      if (isTerminalState(item.state)) entry.attempts += 1; else entry.inProgress = true;
      out.set(id, entry);
    }
  }
  return out;
}
