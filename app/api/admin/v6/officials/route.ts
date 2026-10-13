import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { PostgresRoutineDataStore } from "@/lib/civic-data/store.ts";
import { OFFICIALS_RESULTS_CONTRACT, readOfficialsResults } from "@/lib/control-plane/admin-view/officials-results.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };

export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 }) : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const params = request.nextUrl.searchParams;
  if ([...params.keys()].some(key => key !== "scope") || params.getAll("scope").length !== 1)
    return NextResponse.json({ says: "Choose one place." }, { status: 400, headers: NO_STORE });
  const scope = params.get("scope")!;
  const now = new Date().toISOString();
  if (scope === "us") return NextResponse.json({ contract: OFFICIALS_RESULTS_CONTRACT, scope, revision: `officials:${now}`, asOf: now, data: null, missingParts: [] }, { headers: NO_STORE });
  try {
    const opened = await openControlPlane();
    if (!opened.ok) return NextResponse.json({ says: "The officials check results could not be read." }, { status: 503, headers: NO_STORE });
    const result = await readOfficialsResults({ repos: opened.repos, store: new PostgresRoutineDataStore(), placeKey: scope });
    if ("says" in result) return NextResponse.json({ says: result.says }, { status: 503, headers: NO_STORE });
    return NextResponse.json({ contract: OFFICIALS_RESULTS_CONTRACT, scope, revision: `officials:${now}`, asOf: now, data: result, missingParts: [] }, { headers: NO_STORE });
  } catch { return NextResponse.json({ says: "The officials check results could not be read." }, { status: 503, headers: NO_STORE }); }
}
