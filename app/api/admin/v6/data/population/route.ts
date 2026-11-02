import { loadWebsiteSavedKeys } from "../../../../../../lib/core/keys-entry.ts";
import { adminRead } from "@/lib/control-plane/admin-read.ts";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { readPopulationLoadCounts } from "@/lib/reference/population-facts.ts";

export const dynamic = "force-dynamic";
async function get(request: NextRequest): Promise<NextResponse> {
  await loadWebsiteSavedKeys();
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  const headers = { "cache-control": "private, no-store" };
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404, headers })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers });
  return NextResponse.json({ counts: await readPopulationLoadCounts() }, { headers });
}

export const GET = adminRead(get);
