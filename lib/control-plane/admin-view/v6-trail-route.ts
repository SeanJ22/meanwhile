import { neon } from "@neondatabase/serverless";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../admin-auth.ts";
import { openControlPlane } from "../admin-data.ts";
import { guardAdminRequest } from "../gateway/admin-guard.ts";
import { controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { ADMIN_V6_TRAIL_CONTRACT, TRAIL_ID, readReached, readTrail } from "./v6-trail-read.ts";

const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };

export function validateTrailQuery(params: URLSearchParams): { readonly ok: true; readonly send: string | null; readonly item: string | null }
  | { readonly ok: false; readonly code: string } {
  if ([...params.keys()].some((key) => key !== "scope" && key !== "send" && key !== "item")) return { ok: false, code: "UNKNOWN_PARAMETER" };
  const send = params.getAll("send"), item = params.getAll("item");
  if (params.getAll("scope").length > 1 || send.length + item.length !== 1) return { ok: false, code: "DUPLICATE_OR_MISSING_PARAMETER" };
  const value = send[0] ?? item[0];
  if (!TRAIL_ID.test(value)) return { ok: false, code: "INVALID_ID" };
  return { ok: true, send: send[0] ?? null, item: item[0] ?? null };
}

/** Read-only. Opened by a click, never refreshed on a timer: a trail is dozens of point reads. */
export async function v6TrailGet(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const query = validateTrailQuery(request.nextUrl.searchParams);
  if (!query.ok) return NextResponse.json({ code: query.code }, { status: 400, headers: NO_STORE });
  const now = new Date().toISOString();
  try {
    if (query.send !== null) {
      const url = controlPlaneUrlFromEnv();
      if (!url) return NextResponse.json({ state: "UNREAD", says: "The control-plane database is not configured here, so nothing was read." }, { status: 503, headers: NO_STORE });
      const data = await readReached(neon(url), query.send);
      return NextResponse.json({ contract: ADMIN_V6_TRAIL_CONTRACT, mode: "reached", id: query.send, asOf: now, data }, { headers: NO_STORE });
    }
    const opened = await openControlPlane();
    if (!opened.ok) return NextResponse.json({ state: "UNREAD", says: opened.detail }, { status: 503, headers: NO_STORE });
    const read = await readTrail(opened.repos, query.item!, now);
    if (read.kind !== "HELD") return NextResponse.json({ state: read.kind, says: read.detail }, { status: read.kind === "NOT_RECORDED" ? 404 : 503, headers: NO_STORE });
    return NextResponse.json({ contract: ADMIN_V6_TRAIL_CONTRACT, mode: "trail", id: query.item, asOf: now, data: read.trail }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ state: "UNREAD", says: "This could not be read just now, so it is unknown, not empty." }, { status: 503, headers: NO_STORE });
  }
}
