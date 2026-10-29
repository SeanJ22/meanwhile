"use client";

/** The Queue's rows from the sections already loaded plus the two small readings it needs (shut doors, scheduled orders). Shared by the Queue and Now. */
import type { QueueDoorsView } from "@/lib/control-plane/admin-view/v6-doors-read.ts";
import { createElement, Fragment, type ReactNode } from "react";
import type { ScheduledView } from "@/lib/control-plane/admin-view/v6-scheduled-read.ts";

import { useV6 } from "./context.tsx";
import { buildQueue, type QueueRow } from "./queue.ts";
import { useReading } from "./use-reading.ts";
import { stateKeyOf } from "./places.ts";

export function useQueueRows(): { readonly rows: readonly QueueRow[]; readonly unread: readonly string[]; readonly status: ReactNode } {
  const v = useV6();
  const doorRead = useReading<QueueDoorsView>("/api/admin/v6/doors?reading=queue", "Shut doors");
  const scheduledRead = useReading<ScheduledView>("/api/admin/v6/scheduled", "Scheduled orders");
  const problemRead = useReading<{rows:readonly QueueRow[];unread:boolean}>("/api/admin/v6/reader-problems", "Reader problems");
  const doors = doorRead.reading;
  const scheduled = scheduledRead.reading;
  const problems = problemRead.reading;
  const rows = buildQueue({
    readerProblems:problems.kind==="ready"?problems.data.rows:null,
    receipts: v.data.history.data,
    sends: v.data.sends.data,
    hunts: v.data.hunts.data,
    stuck: v.data.stuck.data,
    fixes: v.data.fixes.data,
    doors: doors.kind === "ready" ? doors.data.rows : null,
    scheduled: scheduled.kind === "ready" ? scheduled.data.rows : null,
  });
  const unread = ([
    ["reader problems",problems.kind!=="ready" || problems.data.unread], ["orders", v.data.history.data === null], ["instructions sent to the fleet", v.data.sends.data === null], ["hunts", v.data.hunts.data === null],
    ["stuck cases", v.data.stuck.data === null], ["fixes", v.data.fixes.data === null], ["shut doors", doors.kind !== "ready"], ["scheduled orders", scheduled.kind !== "ready"],
  ] as const).filter(([, missing]) => missing).map(([name]) => name);
  const state=stateKeyOf(v.scopeKey)?.slice(3).toUpperCase();
  const included=new Set([undefined,state]);
  return { rows:state?rows.filter(row=>included.has(row.stateCode)):rows, unread,
    status: createElement(Fragment, null, doorRead.status, scheduledRead.status, problemRead.status) };
}
