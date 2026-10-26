import { adminRead } from "@/lib/control-plane/admin-read.ts";
import type { NextRequest, NextResponse } from "next/server";
import { v6SpendGet } from "@/lib/control-plane/admin-view/v6-spend-route.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** `admin-v6/spend@1`: Anthropic by model tier and by day, search, and the database's daily transfer. Read-only. */
async function get(request: NextRequest): Promise<NextResponse> {
  return v6SpendGet(request);
}

export const GET = adminRead(get);
