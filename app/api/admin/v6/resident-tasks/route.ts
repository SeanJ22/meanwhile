import type { NextRequest } from "next/server";

import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { adminGet } from "@/lib/control-plane/gateway/admin-get.ts";
import { readLatestTaskPass } from "@/lib/control-plane/live-audit-log.ts";
import { residentTaskView } from "@/lib/health/resident-tasks.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** `admin-v6/resident-tasks@1` (FE-18): the latest resident-task pass on the live site, a pass or fail per task with its step-by-step screenshot strip. Read only. */
export async function GET(request: NextRequest) {
  return adminGet(request, async (observedAt) => {
    const opened = await openControlPlane();
    const pass = opened.ok ? await readLatestTaskPass(opened.repos, observedAt) : null;
    return {
      contract: "admin-v6/resident-tasks@1",
      asOf: observedAt,
      data: residentTaskView(pass, (key) => `/api/admin/v6/resident-tasks/shot/${key.replace(/^resident-tasks\//, "")}`),
      says: opened.ok ? (pass ? null : "No resident-task pass has run in the last two days.") : "The control plane could not be read just now.",
    };
  });
}
