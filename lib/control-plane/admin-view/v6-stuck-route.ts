import { databaseHttpReadOnlySql } from "../../reader/database.ts";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../admin-auth.ts";
import { guardAdminRequest } from "../gateway/admin-guard.ts";
import { controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { ADMIN_V6_SAME_CAUSE_CONTRACT, ADMIN_V6_STUCK_CONTRACT, STUCK_ITEM_LIMIT, stuckViews } from "./v6-stuck-read.ts";
import { readShutDoorRecords, shutDoorItems } from "./v6-stuck-doors.ts";
import { validateV6Query } from "./v6-hunts-read.ts";
import { readSurfaceItems } from "./v6-stuck-surfaces.ts";
import { readDoorCountsFromSql } from "./door-queries.ts";

const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };
import { population } from "./v6-stuck-population.ts";
export { population } from "./v6-stuck-population.ts";

export async function v6StuckGet(request: NextRequest, which: "stuck" | "sameCause"): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const query = validateV6Query(request.nextUrl.searchParams);
  if (!query.ok) return NextResponse.json({ code: query.code }, { status: 400, headers: NO_STORE });
  const now = new Date().toISOString();
  let doorsUnread = false;
  const shutRead = (async () => {
    const url = controlPlaneUrlFromEnv();
    try {
      if (!url) throw new Error("Door database unavailable");
      const sql = databaseHttpReadOnlySql(url);
      const [rows, counts] = await Promise.all([readShutDoorRecords(sql), readDoorCountsFromSql(sql)]);
      return { items: shutDoorItems(rows, now), total: counts.shut };
    } catch { doorsUnread = true; return { items: [], total: 0 }; }
  })();
  const [populationRead,shut,surfaces] = await Promise.all([population(query.scopeKey).then(value=>({value}),()=>({value:null,error:true})),shutRead,readSurfaceItems(now)]);
  if ("error" in populationRead) return NextResponse.json({ state: "UNREAD", says: "The published work index could not be read just now, so stuck items are unknown, not zero." }, { status: 503, headers: NO_STORE });
  const read=populationRead.value;
  if (read === null) return NextResponse.json({ state: "UNREAD", says: "The control-plane database is not configured here, so stuck items were not read." }, { status: 503, headers: NO_STORE });
  const views = stuckViews(read.rows, query.scopeKey, now, [...shut.items, ...surfaces.items],read.summary,shut.total+surfaces.items.length);
  const base = { scope: query.scopeKey, revision: `${which}:${read.publishedAt ?? "unpublished"}:${query.scopeKey}`, asOf: read.publishedAt ?? now };
  const capped = views.total > STUCK_ITEM_LIMIT;
  const missingParts = [
    "These counts come from the work index the runner last published, not from a live read of every worker.",
    ...(surfaces.unread ? ["The speed and dead-link checks could not be read just now, so slow pages are not shown here; that is unknown, not zero."] : []),
    ...(doorsUnread ? ["The door list could not be read just now, so shut doors are not shown here; that is unknown, not zero."] : []),
    ...(capped && which === "stuck" ? [`Only the ${STUCK_ITEM_LIMIT} most urgent of ${views.total} stuck items are listed; the cause groups count all ${views.total}.`] : []),
  ];
  return NextResponse.json(which === "stuck"
    ? { contract: ADMIN_V6_STUCK_CONTRACT, ...base, data: views.items, missingParts }
    : { contract: ADMIN_V6_SAME_CAUSE_CONTRACT, ...base, data: views.sameCause, missingParts }, { headers: NO_STORE });
}
