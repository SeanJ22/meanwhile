import type { NextRequest } from "next/server";

import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { scheduledView } from "@/lib/control-plane/admin-view/v6-scheduled-read.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "@/lib/control-plane/gateway/admin-config.ts";
import { adminGet } from "@/lib/control-plane/gateway/admin-get.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** Orders waiting to be sent, from the saved scheduled-order records. Read only. */
export async function GET(request: NextRequest) {
  return adminGet(request, async (observedAt) => {
    const opened = await openControlPlane();
    if (!opened.ok) throw new Error(opened.detail);
    const held = await opened.repos.adminConfig.read(ADMIN_CONFIG_ID);
    return scheduledView(held && isAdminConfig(held.value) ? held.value : null, observedAt);
  });
}
