import { neon } from "@neondatabase/serverless";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { CHECKLIST_INSTANCE_PAGE_SIZE, ChecklistInstanceIndexError,
  readIndexedChecklistInstances, validateChecklistInstanceIndexQuery } from "@/lib/control-plane/admin-view/checklist-instance-index-read.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { controlPlaneUrlFromEnv } from "@/lib/control-plane/repository/pg-store.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };

/** Exact indexed current-snapshot instances, never a scan of snapshot JSON. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value, checkOrigin: false,
    nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const params = request.nextUrl.searchParams;
  if ([...params.keys()].some(key => !["scopeId", "instructionReceipt", "definitionId", "limit", "cursor"].includes(key)) ||
    ["scopeId", "instructionReceipt", "definitionId"].some(key => params.getAll(key).length !== 1) ||
    ["limit", "cursor"].some(key => params.getAll(key).length > 1))
    return NextResponse.json({ code: "INVALID_QUERY" }, { status: 400, headers: NO_STORE });
  const limitText = params.get("limit");
  const limit = limitText === null ? CHECKLIST_INSTANCE_PAGE_SIZE : /^\d{1,2}$/.test(limitText) ? Number(limitText) : NaN;
  const query = { scopeId: params.get("scopeId") ?? "", instructionReceipt: params.get("instructionReceipt") ?? "",
    definitionId: params.get("definitionId") ?? "", limit, cursor: params.get("cursor") };
  try { validateChecklistInstanceIndexQuery(query); }
  catch (error) { return NextResponse.json({ code: error instanceof ChecklistInstanceIndexError ? error.code : "INVALID_QUERY" },
    { status: 400, headers: NO_STORE }); }
  const url = controlPlaneUrlFromEnv();
  if (!url) return NextResponse.json({ state: "UNREAD", says: "The control-plane store is not configured here; scoped instances were not read." },
    { status: 503, headers: NO_STORE });
  try {
    const read = await readIndexedChecklistInstances(neon(url), query);
    return NextResponse.json(read, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ChecklistInstanceIndexError && error.code === "STALE_CURSOR")
      return NextResponse.json({ code: error.code, says: "The indexed scope revision changed. Start paging again." },
        { status: 409, headers: NO_STORE });
    return NextResponse.json({ state: "UNREAD", says: "The exact indexed scope could not be read safely. Its instance count is unknown." },
      { status: 503, headers: NO_STORE });
  }
}
