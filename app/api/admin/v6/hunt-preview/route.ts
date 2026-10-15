import type { NextRequest, NextResponse } from "next/server";
import { huntPreviewGet } from "@/lib/hunt/preview-route.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** What sending agents to a place would hunt: held facts, open blanks by family and the estimated cost. Read-only. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return huntPreviewGet(request);
}
