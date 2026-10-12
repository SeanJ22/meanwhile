import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { owedStatesOf } from "@/lib/control-plane/admin-view/place-scorecard.ts";
import { readPlaceOwed } from "@/lib/control-plane/admin-view/place-owed-read.ts";
import { PLACE_ITEM_PAGE, v6PlaceNotMeasured, v6PlaceSection } from "@/lib/control-plane/admin-view/v6-place-section.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { ADMIN_CONFIG_ID, isAdminConfig, placeTargetOf } from "@/lib/control-plane/gateway/admin-config.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { readPlaceHistory } from "@/lib/control-plane/admin-view/place-history-read.ts";
import type { PlaceHistoryPoint } from "@/lib/coverage/place-history.ts";
import { controlPlaneUrlFromEnv } from "@/lib/control-plane/repository/pg-store.ts";
import { neon } from "@neondatabase/serverless";
import { missionStartOf } from "@/lib/control-plane/admin-view/mission-start.ts";
import { owedKindUpdates } from "@/lib/control-plane/admin-view/updates-read.ts";
import { addUpdates } from "@/lib/control-plane/updates.ts";
import type { ControlPlaneRepositories } from "@/lib/control-plane/repository/types.ts";

/** The saved owner config and what the place's own settings say: its target and when its mission started. A config that cannot be read is no target and no start, never a made-up one. */
async function configFor(placeKey: string): Promise<{ target: { goalPercent: number; setAt: string } | null; missionStart: string | null; repos: ControlPlaneRepositories | null }> {
  try {
    const opened = await openControlPlane();
    if (!opened.ok) return { target: null, missionStart: null, repos: null };
    const row = await opened.repos.adminConfig.read(ADMIN_CONFIG_ID);
    const config = row !== null && isAdminConfig(row.value) ? row.value : null;
    const t = config ? placeTargetOf(config, placeKey) : null;
    return { target: t ? { goalPercent: t.goalPercent, setAt: t.setAt } : null, missionStart: missionStartOf(config, placeKey), repos: opened.repos };
  } catch { return { target: null, missionStart: null, repos: null }; }
}

/** The place's daily points from the published snapshot. A history that cannot be read is no trend, never an invented one. */
async function historyFor(placeKey: string): Promise<readonly PlaceHistoryPoint[]> {
  try {
    const url = controlPlaneUrlFromEnv();
    return url ? await readPlaceHistory(neon(url), placeKey) : [];
  } catch { return []; }
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };
const PARAMS = new Set(["scope", "group", "status", "q", "cursor", "limit", "fresh"]);

/**
 * `admin-v6/checklist@1` for any ZIP, county or state: the capture score overall and by group, and one
 * window of the owed list behind it. Read-only; it never starts an agent and never gates publishing.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const params = request.nextUrl.searchParams;
  if ([...params.keys()].some((k) => !PARAMS.has(k)) || [...PARAMS].some((k) => params.getAll(k).length > 1) || params.getAll("scope").length !== 1)
    return NextResponse.json({ code: "INVALID_QUERY" }, { status: 400, headers: NO_STORE });
  const limitText = params.get("limit");
  const limit = limitText === null ? PLACE_ITEM_PAGE : /^\d{1,3}$/.test(limitText) ? Number(limitText) : NaN;
  const cursor = params.get("cursor");
  const offset = cursor === null ? 0 : /^\d{1,7}$/.test(cursor) ? Number(cursor) : NaN;
  const statusParam = params.get("status");
  const status = statusParam === "all" ? null : statusParam;
  const group = params.get("group");
  const q = params.get("q");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || (status !== null && owedStatesOf(status) === null) ||
    (group !== null && !/^[A-Z]{2,4}$/.test(group)) || (q !== null && q.length > 80))
    return NextResponse.json({ code: "INVALID_QUERY" }, { status: 400, headers: NO_STORE });
  const read = await readPlaceOwed(params.get("scope")!, undefined, { fresh: params.get("fresh") === "1" });
  if (read.state === "REFUSED") {
    if (read.code === "NOT_A_PLACE" || read.code === "UNSUPPORTED_PLACE") return NextResponse.json(v6PlaceNotMeasured(params.get("scope")!, read.says, new Date().toISOString()), { headers: NO_STORE });
    return NextResponse.json({ code: read.code, says: read.says }, { status: 503, headers: NO_STORE });
  }
  const { target, missionStart, repos } = await configFor(read.placeKey);
  // New kinds of things found for a sent place join the updates feed, once each. A feed that cannot be written never fails the read.
  if (repos !== null) {
    try { await addUpdates(repos, owedKindUpdates({ placeKey: read.placeKey, placeLabel: read.label, rows: read.rows, missionStart }), read.observedAt); } catch { /* the feed is retried on the next read */ }
  }
  return NextResponse.json(v6PlaceSection(read, { group, states: status === null ? null : owedStatesOf(status), q, offset, limit }, target, await historyFor(read.placeKey), missionStart), { headers: NO_STORE });
}
