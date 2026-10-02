import type { NextRequest, NextResponse } from "next/server";
import { v6ResultsGet } from "@/lib/control-plane/admin-view/v6-results-route.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** `admin-v6/results@1`: what readers can see for a place, with the six stages from source to reader. Read-only. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return v6ResultsGet(request);
}
