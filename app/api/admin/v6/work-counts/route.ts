import { neon } from "@neondatabase/serverless";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { controlPlaneUrlFromEnv } from "@/lib/control-plane/repository/pg-store.ts";
import { workCounts } from "@/lib/core/work-counts.ts";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };

export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers });
  const state = request.nextUrl.searchParams.get("state");
  if ([...request.nextUrl.searchParams.keys()].some(key => key !== "state") || request.nextUrl.searchParams.getAll("state").length > 1)
    return NextResponse.json({ says: "Choose one state." }, { status: 400, headers });
  const url = controlPlaneUrlFromEnv();
  if (!url) return NextResponse.json({ says: "Work counts could not be read." }, { status: 503, headers });
  const sql = neon(url), at = new Date();
  try {
    const rows = await workCounts(async (text, params = []) => await sql.query(text, [...params]) as Record<string, unknown>[], state, at);
    return NextResponse.json({ rows, at: at.toISOString() }, { headers });
  } catch (error) {
    return NextResponse.json({ says: error instanceof Error && error.message === "WORK_INVALID_STATE" ? "Choose a state." : "Work counts could not be read." },
      { status: error instanceof Error && error.message === "WORK_INVALID_STATE" ? 400 : 503, headers });
  }
}
