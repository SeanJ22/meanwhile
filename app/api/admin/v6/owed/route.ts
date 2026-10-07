import type { NextRequest } from "next/server";

import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { owedOverlayView } from "@/lib/control-plane/admin-view/owed-overlay-view.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "@/lib/control-plane/gateway/admin-config.ts";
import { adminGet } from "@/lib/control-plane/gateway/admin-get.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** What was added to, or declined from, what places are owed, with the log and what can be undone. Read only; the same for every place. */
export async function GET(request: NextRequest) {
  return adminGet(request, async (observedAt) => {
    const opened = await openControlPlane();
    if (!opened.ok) throw new Error(opened.detail);
    const row = await opened.repos.adminConfig.read(ADMIN_CONFIG_ID);
    const overlay = row !== null && isAdminConfig(row.value) ? row.value.owedOverlay : undefined;
    return {
      contract: "admin-v6/owed@1",
      scope: request.nextUrl.searchParams.get("scope") ?? "united-states",
      revision: `owed:${overlay?.updatedAt ?? "none"}`,
      asOf: observedAt,
      data: owedOverlayView(overlay, observedAt),
      missingParts: [],
    };
  });
}
