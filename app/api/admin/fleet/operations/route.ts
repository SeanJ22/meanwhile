import type { NextResponse, NextRequest } from "next/server";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { handleFleetOperationsRequest } from "@/lib/control-plane/fleet-operations-http.ts";
import { createFleetReceiptStore } from "@/lib/control-plane/fleet-receipt-store.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// Only this server's existing READER receipt directory is trusted by default.
// A runner-local SHADOW path in a window record never grants filesystem access.
const receiptStore = createFleetReceiptStore({ targets: [{ kind: "READER", root: process.cwd() }] });

/** On-demand detail read. The existing /api/admin/live remains the polling path. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleFleetOperationsRequest(request, { open: openControlPlane, receiptStore, now: () => new Date().toISOString() });
}
