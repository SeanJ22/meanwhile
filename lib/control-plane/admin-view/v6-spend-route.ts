import { neon } from "@neondatabase/serverless";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../admin-auth.ts";
import { readDailyDatabaseTransfer, type DailyDatabaseTransferRead } from "../../db/transfer.ts";
import { guardAdminRequest } from "../gateway/admin-guard.ts";
import { controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { ADMIN_V6_SPEND_CONTRACT, SPEND_DAYS, readSpend } from "./v6-spend-read.ts";
import { validateV6Query } from "./v6-hunts-read.ts";

const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };

/** Read-only. Spend is whole-system: the ledger is not split by place, so every scope reads the same figures and says so. */
export async function v6SpendGet(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const query = validateV6Query(request.nextUrl.searchParams);
  if (!query.ok) return NextResponse.json({ code: query.code }, { status: 400, headers: NO_STORE });
  const url = controlPlaneUrlFromEnv();
  if (!url) return NextResponse.json({ state: "UNREAD", says: "The control-plane database is not configured here, so spend was not read." }, { status: 503, headers: NO_STORE });
  const now = new Date().toISOString();
  let transfer: DailyDatabaseTransferRead | null = null;
  try { transfer = await readDailyDatabaseTransfer(SPEND_DAYS); } catch { transfer = null; }
  try {
    const data = await readSpend(neon(url), transfer);
    return NextResponse.json({ contract: ADMIN_V6_SPEND_CONTRACT, scope: query.scopeKey, revision: `spend:${now.slice(0, 16)}`, asOf: now, data,
      missingParts: data.neon.kind === "not-recorded" ? [`Neon: ${data.neon.detail ?? "not recorded yet"}`] : [] }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ state: "UNREAD", says: "The cost ledger could not be read just now, so spend is unknown, not zero." }, { status: 503, headers: NO_STORE });
  }
}
