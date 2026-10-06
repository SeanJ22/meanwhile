import type { NextRequest } from "next/server";
import { adminGet } from "@/lib/control-plane/gateway/admin-get.ts";
import { readVitalSignsFromEnv } from "@/lib/control-plane/admin-view/hourly-vital-signs.ts";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  return adminGet(request, async at => {
    const rows = await readVitalSignsFromEnv(at, 2);
    if (!rows) throw new Error("unread");
    return rows;
  });
}
