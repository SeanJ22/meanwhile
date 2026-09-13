import type { NextResponse, NextRequest } from "next/server";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { handleFleetOperationsRequest } from "@/lib/control-plane/fleet-operations-http.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/**
 * On-demand detail read. The existing /api/admin/live remains the polling path.
 *
 * The trusted READER receipt store is deliberately NOT mounted in this served
 * bundle, and the reason is now MEASURED rather than assumed. Fleet's `e1140c78`
 * isolated the historical receipt contract into a zero-import leaf, which shrank
 * the store's IMPORT closure (esbuild 44 → 3 inputs). Mounting the store here was
 * then rebuilt and verified to STILL refuse `pnpm build`: the store reads
 * `open(join(process.cwd(), ...RECEIPTS_DIR, "<receiptId>.json"))` at request
 * time, and that runtime filesystem read — resolvable base `process.cwd()`, an
 * unbounded runtime-named receipt file — is the R23 over-trace shape. Measured on
 * the mounted build: Turbopack traced 2214 repo files into this route (ceiling
 * 230), including data/control-plane, tests/fixtures and docs/evidence, failing
 * BOTH check-build-output and deploy-paths. The leaf does not change that (the
 * trace is driven by the fs read, not the import graph), and the two sanctioned
 * fixes — a static literal-path map (lib/sources/ballot-curated) and
 * `outputFileTracingIncludes` — both need a finite, build-time-known file set,
 * which runner-populated receipts are not.
 *
 * So `receiptLoading` is NOT_RECORDED on this live endpoint. Making a served
 * surface report it is a remaining integration dependency: adapt the read to a
 * trace-safe shape, or have the runner write receipt-loading STATUS to the
 * control plane and read it here like every other admin surface — see the handoff
 * doc. The dependency injection seam is kept (handleFleetOperationsRequest takes
 * an OPTIONAL receiptStore), so initial load and Refresh stay equivalent — both
 * read without a store today — and the receipt-loading UI, retained timestamps and
 * failure states are exercised with an INJECTED store over a temporary root in
 * tests/fleet-operations-page.test.ts and tests/fleet-receipt-admin.test.ts.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleFleetOperationsRequest(request, { open: openControlPlane, now: () => new Date().toISOString() });
}
