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
import { readLatestLookPasses } from "@/lib/control-plane/live-audit-log.ts";
import { lookShotsByFix, lookView } from "@/lib/frontend/look-pass.ts";

/** Look-check screenshots are served by the signed-in screenshot route, never the public portrait route. */
const shotUrl = (key: string): string => `/api/admin/v6/resident-tasks/shot/${key.replace(/^resident-tasks\//, "")}`;

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
    // FE-21: the last few deploys' look checks, so a red flag's fix item keeps its screenshot after the next deploy.
    const looks = await readLatestLookPasses(opened.repos, 5).catch(() => null);
    return {
      contract: "admin-v6/fixes@1",
      scope: request.nextUrl.searchParams.get("scope") ?? "united-states",
      revision: `fixes:${list.length}:${held?.revision ?? 0}:${queue.items.length}:${queue.counts.queued}:${queue.counts.sent}:${queue.counts.opened}:${queue.counts.refused}`,
      asOf: observedAt,
      // DP-26: fixes in Testing ride along, so the Queue lists them as rows.
      data: v6FixesView(queue, list, observedAt, { standings: fixesInTesting(config), bar: readFixProofBar(config) },
        looks === null ? undefined : { view: lookView(looks[0] ?? null, shotUrl), shots: lookShotsByFix(looks, shotUrl) }),
      missingParts: list.some((i) => i.state === "FIXED") ? [] : [FIXES_MISSING_HISTORY],
    };
  });
}
