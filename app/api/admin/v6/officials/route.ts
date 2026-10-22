import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { PostgresRoutineDataStore } from "@/lib/civic-data/store.ts";
import { OFFICIALS_RESULTS_CONTRACT, readOfficialsResults } from "@/lib/control-plane/admin-view/officials-results.ts";
import { validateV6Query } from "@/lib/control-plane/admin-view/v6-hunts-read.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };

/** `admin-v6/officials@1`: the last officials check for a place, each people source's result, and the seats it changed. Read-only. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 }) : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const query = validateV6Query(request.nextUrl.searchParams);
  if (!query.ok) return NextResponse.json({ code: query.code }, { status: 400, headers: NO_STORE });
  const scope = query.scopeKey, now = new Date().toISOString();
  if (query.scope === null || query.scope.kind === "country") return NextResponse.json({ contract: OFFICIALS_RESULTS_CONTRACT, scope, revision: `officials:${scope}`, asOf: now, data: null, missingParts: [] }, { headers: NO_STORE });
  try {
    const opened = await openControlPlane();
    if (!opened.ok) return NextResponse.json({ says: "The officials check results could not be read." }, { status: 503, headers: NO_STORE });
    const result = await readOfficialsResults({ repos: opened.repos, store: new PostgresRoutineDataStore(), placeKey: scope });
    if ("says" in result) return NextResponse.json({ says: result.says }, { status: 503, headers: NO_STORE });
    const revision = `officials:${scope}:${result.requestedAt ?? "none"}:${result.feeds.map(feed => `${feed.state}@${feed.checkedAt ?? ""}`).join(",")}:${result.changes.length}`;
    return NextResponse.json({ contract: OFFICIALS_RESULTS_CONTRACT, scope, revision, asOf: now, data: result, missingParts: [] }, { headers: NO_STORE });
  } catch { return NextResponse.json({ says: "The officials check results could not be read." }, { status: 503, headers: NO_STORE }); }
}
