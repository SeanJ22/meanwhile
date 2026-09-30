import type { NextRequest, NextResponse } from "next/server";
import { v6AgentsGet } from "@/lib/control-plane/admin-view/v6-agents-route.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** `admin-v6/agents@1`: the most recent agent runs: role, model tier, cost, what each found, and the saved source page. Read-only. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return v6AgentsGet(request);
}
