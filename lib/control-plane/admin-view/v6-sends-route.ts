import { neon } from "@neondatabase/serverless";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../admin-auth.ts";
import { guardAdminRequest } from "../gateway/admin-guard.ts";
import { controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { ADMIN_V6_SENDS_CONTRACT, readSends } from "./v6-sends-read.ts";
import { validateV6Query } from "./v6-hunts-read.ts";

const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };

export async function v6SendsGet(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const query = validateV6Query(request.nextUrl.searchParams);
  if (!query.ok) return NextResponse.json({ code: query.code }, { status: 400, headers: NO_STORE });
  const url = controlPlaneUrlFromEnv();
  if (!url) return NextResponse.json({ state: "UNREAD", says: "The control-plane database is not configured here, so sent instructions were not read." }, { status: 503, headers: NO_STORE });
  const now = new Date().toISOString();
  try {
    const data = await readSends(neon(url));
    return NextResponse.json({ contract: ADMIN_V6_SENDS_CONTRACT, scope: query.scopeKey, revision: `sends:${data[0]?.id ?? "none"}:${data.map((s) => s.state[0]).join("")}`, asOf: now, data, missingParts: [] }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ state: "UNREAD", says: "The sent instructions could not be read just now, so which are still running is unknown, not none." }, { status: 503, headers: NO_STORE });
  }
}
