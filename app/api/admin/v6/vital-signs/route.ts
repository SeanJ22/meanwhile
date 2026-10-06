import type { NextRequest } from "next/server";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { adminGet } from "@/lib/control-plane/gateway/admin-get.ts";
import { readHourlyVitalSigns } from "@/lib/control-plane/admin-view/hourly-vital-signs.ts";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  return adminGet(request, async () => {
    const opened = await openControlPlane();
    if (!opened.ok) throw new Error("unread");
    return { row: await readHourlyVitalSigns(opened.repos) };
  });
}
