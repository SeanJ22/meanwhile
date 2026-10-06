"use client";

/** The Queue's rows from the sections already loaded plus the two small readings it needs (shut doors, scheduled orders). Shared by the Queue and Now. */
import type { DecisionOrdersView } from "@/lib/control-plane/decision-cards.ts";
import type { DoorsView } from "@/lib/control-plane/admin-view/v6-doors-read.ts";
import type { ScheduledView } from "@/lib/control-plane/admin-view/v6-scheduled-read.ts";

import { useV6 } from "./context.tsx";
import { buildQueue, type QueueRow } from "./queue.ts";
import { useReading } from "./use-reading.ts";

export function useQueueRows(): { readonly rows: readonly QueueRow[]; readonly unread: readonly string[] } {
  const v = useV6();
  const doors = useReading<DoorsView>("/api/admin/v6/doors", 60_000).reading;
  const scheduled = useReading<ScheduledView>("/api/admin/v6/scheduled", 60_000).reading;
  const decisions=useReading<DecisionOrdersView>("/api/admin/v6/decisions",60_000).reading;
  const problems=useReading<{rows:readonly QueueRow[];unread:boolean}>("/api/admin/v6/reader-problems",60_000).reading;
  const rows = buildQueue({
    decisions:decisions.kind==="ready"?decisions.data.cards:null,
    readerProblems:problems.kind==="ready"?problems.data.rows:null,
    receipts: v.data.history.data,
    sends: v.data.sends.data,
    hunts: v.data.hunts.data,
    stuck: v.data.stuck.data,
    fixes: v.data.fixes.data,
    doors: doors.kind === "ready" ? doors.data.rows.filter((d) => d.status === "Shut") : null,
    scheduled: scheduled.kind === "ready" ? scheduled.data.rows : null,
  });
  const unread = ([
    ["decisions",decisions.kind!=="ready"], ["reader problems",problems.kind!=="ready" || problems.data.unread], ["orders", v.data.history.data === null], ["instructions sent to the fleet", v.data.sends.data === null], ["hunts", v.data.hunts.data === null],
    ["stuck cases", v.data.stuck.data === null], ["fixes", v.data.fixes.data === null], ["shut doors", doors.kind !== "ready"], ["scheduled orders", scheduled.kind !== "ready"],
  ] as const).filter(([, missing]) => missing).map(([name]) => name);
  return { rows, unread };
}
