import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../admin-auth.ts";
import { guardAdminRequest } from "../gateway/admin-guard.ts";
import { openControlPlane } from "../admin-data.ts";
import { ADMIN_V6_SPEND_CONTRACT } from "./v6-spend-read.ts";
import { validateV6Query } from "./v6-hunts-read.ts";
import { readSpendSummary } from "./spend-summary.ts";

const NO_STORE = { "cache-control": "private, no-store, no-cache, must-revalidate" };
/** Read-only. The runner maintains this small summary; opening Money never reads raw ledger tables or provider APIs. */
export async function v6SpendGet(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const query = validateV6Query(request.nextUrl.searchParams);
  if (!query.ok) return NextResponse.json({ code: query.code }, { status: 400, headers: NO_STORE });
  try {
    const opened=await openControlPlane();
    if(!opened.ok)return NextResponse.json({state:"UNREAD",says:"The saved spending summary could not be read."},{status:503,headers:NO_STORE});
    const summary=await readSpendSummary(opened.repos);
    if(!summary)return NextResponse.json({state:"UNREAD",says:"The runner has not published the spending summary yet."},{status:503,headers:NO_STORE});
    return NextResponse.json({contract:ADMIN_V6_SPEND_CONTRACT,scope:query.scopeKey,revision:`spend:${summary.readAt}`,asOf:summary.readAt,data:summary.spend,
      missingParts:summary.spend.neonProjects==null?["Transfer by database project has not been read."]:[]},{headers:NO_STORE});
  } catch {
    return NextResponse.json({state:"UNREAD",says:"The saved spending summary could not be read, so spend is unknown."},{status:503,headers:NO_STORE});
  }
}
