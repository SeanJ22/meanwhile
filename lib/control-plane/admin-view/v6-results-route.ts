import { neon } from "@neondatabase/serverless";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../admin-auth.ts";
import { guardAdminRequest } from "../gateway/admin-guard.ts";
import { controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { readPlaceOwed, resolvePlaceKey, type PlaceOwedRead, type PlaceOwedRefusal } from "./place-owed-read.ts";
import { validateV6Query } from "./v6-hunts-read.ts";
import { ADMIN_V6_RESULTS_CONTRACT, owedResults, pipelineResults, readPipeline, readZipWitnesses, type AdminV6Result, type PipelineRead, type PipelineUnread, type ZipWitnessRow } from "./v6-results-read.ts";

const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };
const MEMO_MS = 60_000;
let memo: { at: number; read: PipelineRead } | null = null;

async function pipeline(nowIso: string): Promise<PipelineRead | PipelineUnread | null> {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.read;
  const url = controlPlaneUrlFromEnv();
  if (!url) return null;
  const read = await readPipeline(neon(url), nowIso);
  if (read.state === "READ") memo = { at: Date.now(), read };
  return read;
}

async function witnessesFor(zip: string): Promise<readonly ZipWitnessRow[] | null> {
  const url = controlPlaneUrlFromEnv();
  if (!url) return null;
  try { return await readZipWitnesses(neon(url), zip); } catch { return null; }
}

const unread = (says: string) => NextResponse.json({ state: "UNREAD", says }, { status: 503, headers: NO_STORE });

/** `data` is null for a scope with no results read: the page shows "—", never "none". */
export async function v6ResultsGet(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const query = validateV6Query(request.nextUrl.searchParams);
  if (!query.ok) return NextResponse.json({ code: query.code }, { status: 400, headers: NO_STORE });
  const now = new Date().toISOString();
  const scope = query.scope;
  const base = { contract: ADMIN_V6_RESULTS_CONTRACT, scope: query.scopeKey };

  if (scope !== null && (scope.kind === "country" || scope.kind === "state")) {
    let read: PipelineRead | PipelineUnread | null;
    try { read = await pipeline(now); }
    catch { return unread("The published snapshot could not be read just now."); }
    if (read === null) return unread("The control-plane database is not configured here.");
    if (read.state === "UNREAD") return unread(read.says);
    const data: readonly AdminV6Result[] = pipelineResults(read, query.scopeKey, scope);
    return NextResponse.json({ ...base, revision: `results:${read.revision ?? "unrevised"}:${query.scopeKey}`, asOf: read.publishedAt ?? now, data, missingParts: [] }, { headers: NO_STORE });
  }

  const place = resolvePlaceKey(query.scopeKey);
  if ("says" in place) {
    return NextResponse.json({ ...base, revision: `results:${query.scopeKey}:not-read`, asOf: now, data: null, missingParts: [] }, { headers: NO_STORE });
  }
  const owed: PlaceOwedRead | PlaceOwedRefusal = await readPlaceOwed(query.scopeKey);
  if (owed.state === "REFUSED") return NextResponse.json({ code: owed.code, says: owed.says }, { status: 503, headers: NO_STORE });
  const witnesses = place.kind === "zip" ? await witnessesFor(place.zip) : null;
  const data = owedResults({ placeKey: owed.placeKey, rows: owed.rows, zip: place.kind === "zip" ? place.zip : null, witnesses });
  return NextResponse.json({ ...base, revision: `results:${owed.placeKey}:${owed.observedAt}`, asOf: owed.observedAt, data,
    missingParts: place.kind === "zip" && witnesses === null ? ["The public ballot page checks could not be read."] : [] }, { headers: NO_STORE });
}
