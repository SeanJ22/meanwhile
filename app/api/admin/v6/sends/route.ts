import type { NextRequest, NextResponse } from "next/server";
import { v6SendsGet } from "@/lib/control-plane/admin-view/v6-sends-route.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** `admin-v6/sends@1`: the instructions sent to the fleet and where each stands, so any can be taken back. Read-only. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return v6SendsGet(request);
}
