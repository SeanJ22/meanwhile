import type { NextRequest } from "next/server";

import { adminGet } from "@/lib/control-plane/gateway/admin-get.ts";
import { readReaderDemand } from "@/lib/control-plane/reader-demand.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** What readers looked up and asked for, organic traffic, aggregate only. Read only. */
export async function GET(request: NextRequest) {
  return adminGet(request, (observedAt) => readReaderDemand(observedAt));
}
