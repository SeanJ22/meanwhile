import { neon } from "@neondatabase/serverless";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { controlPlaneUrlFromEnv } from "@/lib/control-plane/repository/pg-store.ts";
import { readSourceChecks } from "@/lib/control-plane/admin-view/v6-source-checks-read.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };

export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const state = request.nextUrl.searchParams.get("state") ?? "US";
  const after = request.nextUrl.searchParams.get("after") ?? "";
  const view = request.nextUrl.searchParams.get("view") ?? "registered";
  if (!/^US(?:-[A-Z]{2})?$/.test(state) || !["registered", "responses"].includes(view) || after.length > 4096 ||
    !(view === "registered" ? /^(?:r:[A-Za-z0-9_-]+)?$/ : /^(?:[a-f0-9]{64})?$/).test(after)) {
    return NextResponse.json({ says: "Choose a place and a page of sources." }, { status: 400, headers: NO_STORE });
  }
  try {
    const url = controlPlaneUrlFromEnv();
    if (!url) throw new Error("SOURCE_CHECK_STORE_UNAVAILABLE");
    const sql = neon(url);
    const result = await readSourceChecks(async (text, params) => await sql.query(text, [...params]) as Record<string, unknown>[],
      state, after, new Date().toISOString(), view as "registered" | "responses");
    return NextResponse.json(result, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ says: "Source checks could not be read just now." }, { status: 503, headers: NO_STORE });
  }
}
