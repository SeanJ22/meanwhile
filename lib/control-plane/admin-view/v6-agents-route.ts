import { databaseReadOnlySql } from "../../reader/database.ts";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../admin-auth.ts";
import { guardAdminRequest } from "../gateway/admin-guard.ts";
import { controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { ADMIN_V6_AGENTS_CONTRACT, readAgentRuns, type AdminV6AgentRun } from "./v6-agents-read.ts";
import { parseV6PlaceKey, validateV6Query } from "./v6-hunts-read.ts";

const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };

export async function v6AgentsGet(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const query = validateV6Query(request.nextUrl.searchParams);
  if (!query.ok) return NextResponse.json({ code: query.code }, { status: 400, headers: NO_STORE });
  const url = controlPlaneUrlFromEnv();
  if (!url) return NextResponse.json({ state: "UNREAD", says: "The control-plane database is not configured here, so agent runs were not read." }, { status: 503, headers: NO_STORE });
  const now = new Date().toISOString();
  let current: readonly AdminV6AgentRun[];
  try {
    current=await readAgentRuns(databaseReadOnlySql(url),now);
  } catch {
    return NextResponse.json({ state: "UNREAD", says: "The agent records could not be read just now, so what agents did is unknown, not nothing." }, { status: 503, headers: NO_STORE });
  }
  const scope = parseV6PlaceKey(query.scopeKey);
  const state = scope !== null && scope.kind !== "country" ? scope.state : null;
  const runs = state === null ? current : current.filter((r) => r.placeKey === `st:${state}` || r.placeKey === "us");
  return NextResponse.json({ contract: ADMIN_V6_AGENTS_CONTRACT, scope: query.scopeKey, revision: `agents:${current[0]?.startedAt ?? "none"}:${current.length}:${query.scopeKey}`, asOf: now,
    data: runs, missingParts: [] }, { headers: NO_STORE });
}
