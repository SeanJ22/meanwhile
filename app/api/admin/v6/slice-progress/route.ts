import { adminRead } from "@/lib/control-plane/admin-read.ts";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { factReader } from "@/lib/facts/db.ts";
import { sliceProgress } from "@/lib/reader/slice-progress.ts";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };

/** How many places have their slices. Two counts; no slice is opened. */
async function get(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers });
  try {
    const query = factReader();
    if (!query) throw new Error("no reader database");
    return NextResponse.json({ ...await sliceProgress(query), at: new Date().toISOString() }, { headers });
  } catch {
    return NextResponse.json({ says: "How many places have their slices could not be read just now, so it is unknown, not zero." }, { status: 503, headers });
  }
}

export const GET = adminRead(get);
