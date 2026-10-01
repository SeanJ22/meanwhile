import type { NextRequest } from "next/server";

import { openControlPlane, readDecisions } from "@/lib/control-plane/admin-data.ts";
import { FIXES_MISSING_HISTORY, v6FixesView } from "@/lib/control-plane/admin-view/v6-fixes-read.ts";
import { collapseDecisionLog } from "@/lib/control-plane/decision-log.ts";
import { fixQueueView } from "@/lib/control-plane/fix-queue.ts";
import { adminGet } from "@/lib/control-plane/gateway/admin-get.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** `admin-v6/fixes@1`: what is on the fix queue and how far each item has got. Read only; the same for every place. */
export async function GET(request: NextRequest) {
  return adminGet(request, async (observedAt) => {
    const opened = await openControlPlane();
    if (!opened.ok) throw new Error(opened.detail);
    const decisions = await readDecisions(opened.repos);
    if (decisions.kind !== "HELD") throw new Error(decisions.detail);
    const queue = fixQueueView(collapseDecisionLog(decisions.value));
    return {
      contract: "admin-v6/fixes@1",
      scope: request.nextUrl.searchParams.get("scope") ?? "united-states",
      revision: `fixes:${queue.items.length}:${queue.counts.queued}:${queue.counts.sent}:${queue.counts.opened}:${queue.counts.refused}`,
      asOf: observedAt,
      data: v6FixesView(queue),
      missingParts: [FIXES_MISSING_HISTORY],
    };
  });
}
