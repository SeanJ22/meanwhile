import { adminRead } from "@/lib/control-plane/admin-read.ts";
import type { NextRequest, NextResponse } from "next/server";
import { v6StuckGet } from "@/lib/control-plane/admin-view/v6-stuck-route.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** `admin-v6/stuck@1`: the most urgent stuck items for a place, each with its cause in plain English. Read-only. */
async function get(request: NextRequest): Promise<NextResponse> {
  return v6StuckGet(request, "stuck");
}

export const GET = adminRead(get);
