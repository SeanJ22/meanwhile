import { adminRead } from "@/lib/control-plane/admin-read.ts";
import type { NextRequest, NextResponse } from "next/server";
import { v6MoneySection } from "@/lib/control-plane/admin-view/v6-money-read.ts";
import { v6MoneyHuntsGet } from "@/lib/control-plane/admin-view/v6-money-hunts-route.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** `admin-v6/money@1`: account readings, limits in force and per-hunt other-service costs. Read-only. */
async function get(request: NextRequest): Promise<NextResponse> {
  return v6MoneyHuntsGet(request, { withSafety: true, project: v6MoneySection });
}

export const GET = adminRead(get);
