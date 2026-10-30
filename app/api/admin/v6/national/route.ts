import { loadWebsiteSavedKeys } from "../../../../../lib/core/keys-entry.ts";
import { adminRead } from "@/lib/control-plane/admin-read.ts";
import type { NextRequest, NextResponse } from "next/server";
import { v6NationalGet } from "@/lib/control-plane/admin-view/v6-national-route.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** `admin-v6/national@1`: states, then a state's congressional districts, then a district's ZIPs, each with hunts, ZIPs worked, place score and stuck. Read-only. */
async function get(request: NextRequest): Promise<NextResponse> {
  await loadWebsiteSavedKeys();
  return v6NationalGet(request);
}

export const GET = adminRead(get);
