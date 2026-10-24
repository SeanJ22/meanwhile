import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { placeMapCounts } from "@/lib/place-map/counts.ts";
import { factReader } from "@/lib/facts/db.ts";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest): Promise<NextResponse> {
  const headers = { "cache-control": "private, no-store" };
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404, headers })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers });
  const query = factReader();
  try { return NextResponse.json({ counts: query ? await placeMapCounts(query) : null }, { headers }); }
  catch { return NextResponse.json({ counts: null }, { headers }); }
}
