import type { NextRequest, NextResponse } from "next/server";
import { v6PublicationGet } from "@/lib/control-plane/admin-view/v6-publication-route.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** `admin-v6/publication@1`: published versus reader-visible, per routine contract. Read-only. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return v6PublicationGet(request);
}
