import { adminRead } from "@/lib/control-plane/admin-read.ts";
import type { NextRequest, NextResponse } from "next/server";
import { v6StuckGet } from "@/lib/control-plane/admin-view/v6-stuck-route.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** `admin-v6/sameCause@1`: every stuck row counted by cause, with one "send agents" for the whole group. Read-only. */
async function get(request: NextRequest): Promise<NextResponse> {
  return v6StuckGet(request, "sameCause");
}

export const GET = adminRead(get);
