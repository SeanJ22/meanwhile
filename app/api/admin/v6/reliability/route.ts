import type { NextRequest, NextResponse } from "next/server";
import { v6ReliabilityGet } from "@/lib/control-plane/admin-view/v6-reliability-route.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** `admin-v6/reliability@1`: each source's successes, failures, failures in a row and next retry. Read-only. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return v6ReliabilityGet(request);
}
