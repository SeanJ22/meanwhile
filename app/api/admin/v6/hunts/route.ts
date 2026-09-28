import type { NextRequest, NextResponse } from "next/server";
import { v6HuntsSection } from "@/lib/control-plane/admin-view/v6-hunts-read.ts";
import { v6MoneyHuntsGet } from "@/lib/control-plane/admin-view/v6-money-hunts-route.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** `admin-v6/hunts@1`: saved lifetime hunts with exact receipt-linked accounting. Read-only. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return v6MoneyHuntsGet(request, { withSafety: false, project: v6HuntsSection });
}
