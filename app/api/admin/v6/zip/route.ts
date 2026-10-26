import { adminRead } from "@/lib/control-plane/admin-read.ts";
import type { NextRequest, NextResponse } from "next/server";
import { v6ZipGet } from "@/lib/control-plane/admin-view/v6-zip-route.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** The state a typed ZIP belongs to, from the national ZIP index. Read-only. */
async function get(request: NextRequest): Promise<NextResponse> {
  return v6ZipGet(request);
}

export const GET = adminRead(get);
