import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { CHECKLIST_DEFINITION_PAGE_SIZE, ChecklistDefinitionQueryError,
  searchChecklistDefinitions } from "@/lib/control-plane/admin-view/checklist-definition-search.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };

/** Fixed adopted definitions only. Scoped instance reads need a separately bounded index. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value, checkOrigin: false,
    nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const params = request.nextUrl.searchParams;
  if ([...params.keys()].some(key => !["q", "group", "id", "limit", "cursor", "scope"].includes(key)) ||
      ["q", "group", "id", "limit", "cursor", "scope"].some(key => params.getAll(key).length > 1) ||
      (params.has("scope") && !["", "all"].includes(params.get("scope") ?? "")))
    return NextResponse.json({ code: "INVALID_QUERY", says: "This endpoint searches the national adopted definitions. Scoped civic instances are a separate, unmeasured read." },
      { status: 400, headers: NO_STORE });
  const limitText = params.get("limit");
  const limit = limitText === null ? CHECKLIST_DEFINITION_PAGE_SIZE : /^\d{1,2}$/.test(limitText) ? Number(limitText) : NaN;
  try {
    const page = searchChecklistDefinitions({ q: params.get("q") ?? "", group: params.get("group"),
      id: params.get("id"), limit, cursor: params.get("cursor") });
    return NextResponse.json(page, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ChecklistDefinitionQueryError)
      return NextResponse.json({ code: error.code, says: error.message }, { status: 400, headers: NO_STORE });
    return NextResponse.json({ code: "DEFINITIONS_UNAVAILABLE", says: "The adopted checklist wording could not be read safely just now." },
      { status: 503, headers: NO_STORE });
  }
}
