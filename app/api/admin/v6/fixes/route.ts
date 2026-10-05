import type { NextRequest } from "next/server";

import { openControlPlane, readDecisions } from "@/lib/control-plane/admin-data.ts";
import { FIXES_MISSING_HISTORY, v6FixesView } from "@/lib/control-plane/admin-view/v6-fixes-read.ts";
import { collapseDecisionLog } from "@/lib/control-plane/decision-log.ts";
import { fixQueueView } from "@/lib/control-plane/fix-queue.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "@/lib/control-plane/gateway/admin-config.ts";
import { fixItems } from "@/lib/control-plane/fix-list.ts";
import { adminGet } from "@/lib/control-plane/gateway/admin-get.ts";
import { fixesInTesting } from "@/lib/control-plane/fix-standing.ts";
import { readFixProofBar } from "@/lib/method/fix-status.ts";

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
    const held = await opened.repos.adminConfig.read(ADMIN_CONFIG_ID);
    const config = held && isAdminConfig(held.value) ? held.value : null;
    const list = config ? fixItems(config) : [];
    return {
      contract: "admin-v6/fixes@1",
      scope: request.nextUrl.searchParams.get("scope") ?? "united-states",
      revision: `fixes:${list.length}:${held?.revision ?? 0}:${queue.items.length}:${queue.counts.queued}:${queue.counts.sent}:${queue.counts.opened}:${queue.counts.refused}`,
      asOf: observedAt,
      // DP-26: fixes in Testing ride along, so the Queue lists them as rows.
      data: v6FixesView(queue, list, observedAt, { standings: fixesInTesting(config), bar: readFixProofBar(config) }),
      missingParts: list.some((i) => i.state === "FIXED") ? [] : [FIXES_MISSING_HISTORY],
    };
  });
}
