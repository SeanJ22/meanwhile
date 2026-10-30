import { loadWebsiteSavedKeys } from "../../../../../lib/core/keys-entry.ts";
import { adminRead } from "@/lib/control-plane/admin-read.ts";
import type { NextRequest, NextResponse } from "next/server";
import { v6AgentsGet } from "@/lib/control-plane/admin-view/v6-agents-route.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** `admin-v6/agents@1`: the most recent agent runs: role, model tier, cost, what each found, and the saved source page. Read-only. */
async function get(request: NextRequest): Promise<NextResponse> {
  await loadWebsiteSavedKeys();
  return v6AgentsGet(request);
}

export const GET = adminRead(get);
