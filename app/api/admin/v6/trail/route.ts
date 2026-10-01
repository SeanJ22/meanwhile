import type { NextRequest, NextResponse } from "next/server";
import { v6TrailGet } from "@/lib/control-plane/admin-view/v6-trail-route.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** `admin-v6/trail@1`: what a send reached, or one piece of work's evidence trail. On demand, read-only. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return v6TrailGet(request);
}
