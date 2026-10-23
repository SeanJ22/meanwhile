import { neon } from "@neondatabase/serverless";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../admin-auth.ts";
import { guardAdminRequest } from "../gateway/admin-guard.ts";
import { controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { netlifyEvidenceStoreFromEnv } from "../evidence/netlify-store.ts";
import { readSavedSamQuota } from "../../federal-money/sam-quota.ts";
import { ADMIN_V6_RELIABILITY_CONTRACT, readReliability, withSamQuota, type AdminV6SourceReliability } from "./v6-reliability-read.ts";
import { sectionRevision, validateV6Query } from "./v6-hunts-read.ts";

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
  const quota = (async () => {
    const vault = netlifyEvidenceStoreFromEnv();
    if (!vault) throw new Error("Shared source status is unavailable.");
    return readSavedSamQuota({ get: key => vault.get(key, AbortSignal.timeout(2_000)) });
  })();
  const savedQuota = quota.then(hold => ({ hold, missing: false }), () => ({ hold: null, missing: true }));
  try {
    if (!memo || Date.now() - memo.at > MEMO_MS) memo = { at: Date.now(), rows: await readReliability(neon(url)) };
  } catch {
    return NextResponse.json({ state: "UNREAD", says: "Source reliability could not be read just now, so it is unknown, not fine." }, { status: 503, headers: NO_STORE });
  }
  const status = await savedQuota;
  const rows = withSamQuota(memo.rows, status.hold, now);
  return NextResponse.json({ contract: ADMIN_V6_RELIABILITY_CONTRACT, scope: query.scopeKey, revision: sectionRevision("reliability", rows),
    asOf: now, data: rows, missingParts: status.missing ? ["SAM.gov's saved daily reset time could not be read."] : [] }, { headers: NO_STORE });
}
