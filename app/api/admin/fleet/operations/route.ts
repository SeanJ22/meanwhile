import type { NextResponse, NextRequest } from "next/server";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { handleFleetOperationsRequest } from "@/lib/control-plane/fleet-operations-http.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/**
 * On-demand detail read. The existing /api/admin/live remains the polling path.
 *
 * Receipt readings arrive through the existing control-plane **owner snapshot**:
 * `readFleetOperations` reads `OwnerSnapshot.fleetReceipts` when no store is
 * injected (Fleet's `e174e219` transport). The trusted FILESYSTEM receipt store
 * is deliberately NOT mounted in this served bundle — mounting it was rebuilt and
 * MEASURED to refuse `pnpm build`: the store's request-time
 * `open(join(process.cwd(), ...RECEIPTS_DIR, "<receiptId>.json"))` read is the R23
 * over-trace shape (2214 files traced, ceiling 230), and Fleet's zero-import leaf
 * did not change that (the over-trace is the fs read, not the import graph).
 * Runtime archive files belong to the runner; this served bundle never opens them.
 * The optional `receiptStore?` seam is preserved for runner/isolated tests, so
 * initial load (`readFleetSeedState`) and Refresh here read the SAME snapshot —
 * populated/missing parity is verified in tests/fleet-operations-page.test.ts.
 * See docs/design/lumen-meanwhile-handoff.md and docs/fleet-receipt-snapshot-handoff.md.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleFleetOperationsRequest(request, { open: openControlPlane, now: () => new Date().toISOString() });
}
