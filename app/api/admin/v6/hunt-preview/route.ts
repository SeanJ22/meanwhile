import { adminRead } from "@/lib/control-plane/admin-read.ts";
import type { NextRequest, NextResponse } from "next/server";
import { huntPreviewGet } from "@/lib/hunt/preview-route.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** What sending agents to a place would hunt: held facts, open blanks by family and the estimated cost. Read-only. */
async function get(request: NextRequest): Promise<NextResponse> {
  return huntPreviewGet(request);
}

export const GET = adminRead(get);
