import { neon } from "@neondatabase/serverless";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../admin-auth.ts";
import { guardAdminRequest } from "../gateway/admin-guard.ts";
import { controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { ADMIN_V6_RELIABILITY_CONTRACT, readReliability, type AdminV6SourceReliability } from "./v6-reliability-read.ts";
import { validateV6Query } from "./v6-hunts-read.ts";

const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };
const MEMO_MS = 120_000;
let memo: { at: number; rows: readonly AdminV6SourceReliability[] } | null = null;

export async function v6ReliabilityGet(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const query = validateV6Query(request.nextUrl.searchParams);
  if (!query.ok) return NextResponse.json({ code: query.code }, { status: 400, headers: NO_STORE });
  const url = controlPlaneUrlFromEnv();
  if (!url) return NextResponse.json({ state: "UNREAD", says: "The control-plane database is not configured here, so source reliability was not read." }, { status: 503, headers: NO_STORE });
  const now = new Date().toISOString();
  try {
    if (!memo || Date.now() - memo.at > MEMO_MS) memo = { at: Date.now(), rows: await readReliability(neon(url)) };
  } catch {
    return NextResponse.json({ state: "UNREAD", says: "Source reliability could not be read just now, so it is unknown, not fine." }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json({ contract: ADMIN_V6_RELIABILITY_CONTRACT, scope: query.scopeKey, revision: `reliability:${memo.rows.map((r) => `${r.source}${r.consecutiveFailures}`).join("").length}:${memo.rows[0]?.lastAttemptAt ?? "none"}`,
    asOf: now, data: memo.rows, missingParts: [] }, { headers: NO_STORE });
}
