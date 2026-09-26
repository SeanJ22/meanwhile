/**
 * **WHAT A GEOGRAPHY HOLDS, BEFORE YOU SEND IT.** (Admin redesign,
 * 2026-09-23 — the composer's "geographic scope you are about to send" and
 * "what already exists here".)
 *
 * GET ?type=<county|congressional_district|cbsa|state_leg_upper|state_leg_lower>&geoid=<digits>
 *
 * Read-only. Answers, for one Census container: its codes (ZCTAs) from the
 * published lookup, wholly or partly inside; for each code the registered
 * bodies that reach it (the reader's own ZIP index) and whether each has a
 * way in; the distinct bodies over the whole geography; and how many of them
 * we already read on the standing clock. A code outside the index is named
 * as such, never counted as empty.
 *
 * And, per state the geography reaches (2026-09-25), what a Send would create
 * there: the reviewed registry's name, or — for a state with none — how many
 * governments its promoted registration places here, by the runner's own rule
 * (`send`; `lib/control-plane/expansion/send-preview.ts`).
 */
import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { containerStanding, indexBodies } from "@/lib/control-plane/admin-view/coverage.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import type { GeographyType } from "@/lib/census-geography/contract.ts";

import { DISPATCH_WORK_TARGET_CAP } from "@/lib/control-plane/expansion/dispatch-work-bounds.ts";
import { stateSendPreviewSentence } from "@/lib/control-plane/expansion/send-preview.ts";

import { loadContainer, loadZcta } from "../../../(admin)/_mw/data/geography.ts";
import { loadWatchedStandings } from "../../../(admin)/_mw/data/load-bodies.ts";
import { readerQuery } from "../../../(admin)/_mw/data/reader-query.ts";
import { loadRegistryBodies } from "../../../(admin)/_mw/data/registry.ts";
import { sendPreviewFor } from "../../../(admin)/_mw/data/send-preview.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TYPES: readonly GeographyType[] = ["county", "congressional_district", "cbsa", "state_leg_upper", "state_leg_lower"];

export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({
    headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!guard.ok) return new NextResponse(guard.status === 404 ? null : JSON.stringify({ error: guard.says }), { status: guard.status });

  const type = request.nextUrl.searchParams.get("type") ?? "";
  const geoid = request.nextUrl.searchParams.get("geoid") ?? "";
  if ((type !== "zcta" && !(TYPES as readonly string[]).includes(type)) || !/^[0-9A-Za-z]{2,16}$/.test(geoid)) {
    return NextResponse.json({ error: "Name a county, district, metro area or legislative district by its type and Census id." }, { status: 400 });
  }
  const nowIso = new Date().toISOString();
  const [container, registry, bodies] = await Promise.all([type === "zcta" ? loadZcta(geoid) : loadContainer(type as GeographyType, geoid), loadRegistryBodies(), loadWatchedStandings(nowIso)]);
  if (container.kind === "UNREAD") return NextResponse.json({ ok: false, says: container.detail }, { status: 200 });
  const g = container.value.geography;
  const stateCode = g.stateAbbr.toLowerCase();
  /* How many governments a Send here creates work for, per state, and whether a reviewed registry or registration names them (2026-09-25). */
  const query = readerQuery();
  const sendStates = await Promise.all(
    [...new Set([g.stateAbbr, ...g.memberStates].map((s) => s.toUpperCase()))].sort().map((st) => sendPreviewFor(st, container.value.zctas, query)),
  );
  const send = { states: sendStates, says: sendStates.map((p) => stateSendPreviewSentence(p, DISPATCH_WORK_TARGET_CAP)) };
  if (registry.kind === "UNREAD") {
    return NextResponse.json({
      ok: true,
      geography: { type: g.type, geoid: g.geoid, version: g.version, label: g.label, stateAbbr: g.stateAbbr },
      codes: container.value.zctas.map((z) => ({ zcta5: z.zcta5, whole: z.whole, fraction: z.fraction, indexed: z.indexed, counts: null })),
      totals: null,
      totalsGap: registry.detail,
      send,
      lookup: { source: container.source, versionId: container.versionId },
    });
  }
  const watched = bodies.kind === "HELD" ? bodies.views : [];
  const index = indexBodies(registry.bodies.filter((b) => b.stateCode === stateCode || g.memberStates.map((m) => m.toLowerCase()).includes(b.stateCode ?? "")));
  const standing = containerStanding(container.value.zctas, index, watched);
  const readerVisible = watched
    .filter((v) => v.ocdId !== null && container.value.zctas.some((z) => z.divisions.includes(v.ocdId!)))
    .reduce((n, v) => n + (v.readerVisible ?? 0), 0);
  return NextResponse.json({
    ok: true,
    geography: { type: g.type, geoid: g.geoid, version: g.version, label: g.label, stateAbbr: g.stateAbbr },
    codes: standing.perCode.map((c) => ({ zcta5: c.zcta5, whole: c.whole, fraction: c.fraction, indexed: c.indexed, counts: c.counts })),
    totals: {
      ...standing.counts,
      codes: standing.codes,
      wholeCodes: standing.wholeCodes,
      indexedCodes: standing.indexedCodes,
      readerVisibleRecords: bodies.kind === "HELD" ? readerVisible : null,
    },
    totalsGap: bodies.kind === "HELD" ? null : bodies.detail,
    send,
    lookup: { source: container.source, versionId: container.versionId },
  });
}
