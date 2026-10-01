import { neon } from "@neondatabase/serverless";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { CHECKLIST_INSTANCE_PAGE_SIZE, ChecklistInstanceIndexError,
  readIndexedChecklistAllDefinitions, readIndexedChecklistInstances, validateChecklistAllDefinitionsQuery,
  validateChecklistInstanceIndexQuery } from "@/lib/control-plane/admin-view/checklist-instance-index-read.ts";
import { v6ChecklistAllDefinitionsSection, v6ChecklistSection } from "@/lib/control-plane/admin-view/v6-checklist-section.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { controlPlaneUrlFromEnv } from "@/lib/control-plane/repository/pg-store.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };

/**
 * The captured checklist instances of one exact saved instruction scope and
 * receipt. A place (ZIP, county or state) is read at `/api/admin/v6/place`,
 * which scores what the place is owed and needs no saved hunt.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value, checkOrigin: false,
    nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const params = request.nextUrl.searchParams;
  const hasDefinition = params.has("definitionId");
  if ([...params.keys()].some(key => !["scope", "instructionReceipt", "definitionId", "limit", "cursor"].includes(key)) ||
    params.getAll("definitionId").length > 1 ||
    ["scope", "instructionReceipt"].some(key => params.getAll(key).length !== 1) ||
    ["limit", "cursor"].some(key => params.getAll(key).length > 1))
    return NextResponse.json({ code: "INVALID_QUERY" }, { status: 400, headers: NO_STORE });
  const limitText = params.get("limit");
  const limit = limitText === null ? hasDefinition ? CHECKLIST_INSTANCE_PAGE_SIZE : 50 : /^\d{1,2}$/.test(limitText) ? Number(limitText) : NaN;
  const query = { scopeId: params.get("scope") ?? "", instructionReceipt: params.get("instructionReceipt") ?? "",
    definitionId: params.get("definitionId") ?? "", limit, cursor: params.get("cursor") };
  if (!/^(?:zcta|county|cd|cbsa|sldu|sldl):[0-9]{2,4}\/[0-9A-Za-z]{2,12}$/.test(query.scopeId))
    return NextResponse.json({ code: "SCOPE_BINDING_NOT_CONNECTED",
      says: "This section accepts an exact saved instruction scope. A place is read at /api/admin/v6/place." },
    { status: 409, headers: NO_STORE });
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    return NextResponse.json({ code: "INVALID_QUERY" }, { status: 400, headers: NO_STORE });
  if (params.has("cursor") && !/^[A-Za-z0-9_-]{1,2000}$/.test(params.get("cursor") ?? ""))
    return NextResponse.json({ code: "INVALID_CURSOR" }, { status: 400, headers: NO_STORE });
  if (hasDefinition) try { validateChecklistInstanceIndexQuery(query); }
  catch (error) { return NextResponse.json({ code: error instanceof ChecklistInstanceIndexError ? error.code : "INVALID_QUERY" },
    { status: 400, headers: NO_STORE }); }
  const url = controlPlaneUrlFromEnv();
  if (!url) return NextResponse.json({ state: "UNREAD", says: "The control-plane index is not configured here; checklist instances were not read." },
    { status: 503, headers: NO_STORE });
  try {
    const sql = neon(url);
    if (hasDefinition) {
      const read = await readIndexedChecklistInstances(sql, query);
      return NextResponse.json(v6ChecklistSection({ scope: query.scopeId, read, readAt: new Date().toISOString() }), { headers: NO_STORE });
    }
    const allQuery = { scopeId: query.scopeId, instructionReceipt: query.instructionReceipt, limit: query.limit, cursor: query.cursor };
    validateChecklistAllDefinitionsQuery(allQuery);
    const read = await readIndexedChecklistAllDefinitions(sql, allQuery);
    return NextResponse.json(v6ChecklistAllDefinitionsSection({ scope: query.scopeId, read, readAt: new Date().toISOString() }), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ChecklistInstanceIndexError) {
      if (error.code === "STALE_CURSOR")
        return NextResponse.json({ code: error.code, says: "The indexed scope revision changed. Start paging again." },
          { status: 409, headers: NO_STORE });
      if (error.code === "INVALID_QUERY" || error.code === "INVALID_CURSOR")
        return NextResponse.json({ code: error.code }, { status: 400, headers: NO_STORE });
    }
    return NextResponse.json({ state: "UNREAD", says: "The indexed checklist section could not be read safely; captured instance totals are unknown." },
      { status: 503, headers: NO_STORE });
  }
}
