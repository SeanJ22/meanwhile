import type { NextResponse, NextRequest } from "next/server";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { handleFleetOperationsRequest } from "@/lib/control-plane/fleet-operations-http.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/**
 * On-demand detail read. The existing /api/admin/live remains the polling path.
 *
 * The trusted READER receipt store is NOT mounted here yet: importing
 * `createFleetReceiptStore` pulls the promoter's filesystem module graph into this
 * served bundle and over-traces it (Turbopack traces ~2300 files, incl. tests/ and
 * data/ops), which `pnpm build`'s check-build-output refuses. `receiptLoading` is
 * therefore NOT_RECORDED on the live endpoint until the receipt store is made
 * trace-safe (extract its promoter constants to a leaf module) — see the handoff
 * doc. The UI and its loading behavior are exercised with an injected store in
 * tests/fleet-operations-page.test.ts and tests/fleet-receipt-admin.test.ts.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleFleetOperationsRequest(request, { open: openControlPlane, now: () => new Date().toISOString() });
}
