import { adminRead } from "@/lib/control-plane/admin-read.ts";
import type { NextRequest, NextResponse } from "next/server";
import { v6WorkersGet } from "@/lib/control-plane/admin-view/v6-workers-read.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** `admin-v6/workers@1`: what the workers are doing in one place, from saved evidence. Read-only. */
async function get(request: NextRequest): Promise<NextResponse> {
  return v6WorkersGet(request);
}

export const GET = adminRead(get);
