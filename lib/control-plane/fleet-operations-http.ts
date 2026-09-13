import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "./admin-auth.ts";
import type { openControlPlane } from "./admin-data.ts";
import { FLEET_OPERATIONS_VERSION, readFleetOperations } from "./fleet-operations.ts";
import type { FleetReceiptStore } from "./fleet-receipt-store.ts";
import { guardAdminRequest } from "./gateway/admin-guard.ts";

const headers = { "cache-control": "no-store, no-cache, must-revalidate" };

/** The real Admin boundary, with server-owned resources injectable for isolated compatibility checks. */
export async function handleFleetOperationsRequest(request: NextRequest, dependencies: {
  readonly open: typeof openControlPlane;
  readonly receiptStore: FleetReceiptStore;
  readonly now: () => string;
}): Promise<NextResponse> {
  const observedAt = dependencies.now();
  const guard = await guardAdminRequest({ headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.parse(observedAt) / 1000) });
  if (!guard.ok) return guard.status === 404
    ? new NextResponse(null, { status: 404, headers })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers });
  const opened = await dependencies.open();
  if (!opened.ok) return NextResponse.json({ formatVersion: FLEET_OPERATIONS_VERSION,
    observedAt, error: { code: "CONTROL_PLANE_UNAVAILABLE", detail: opened.detail } }, { status: 503, headers });
  const report = await readFleetOperations(opened.repos, { observedAt, receiptStore: dependencies.receiptStore });
  return NextResponse.json(report, { status: report.operations.kind === "STORE_UNREACHABLE" ? 503 : 200, headers });
}
