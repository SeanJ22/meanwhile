import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { readPopulationLoadCounts } from "@/lib/reference/population-facts.ts";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  const headers = { "cache-control": "private, no-store" };
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404, headers })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers });
  return NextResponse.json({ counts: await readPopulationLoadCounts() }, { headers });
}
