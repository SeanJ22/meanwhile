import { neon } from "@neondatabase/serverless";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../admin-auth.ts";
import { readDailyDatabaseTransfer, readRunnerDatabaseTransfer, type DailyDatabaseTransferRead } from "../../db/transfer.ts";
import { guardAdminRequest } from "../gateway/admin-guard.ts";
import { controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { openControlPlane } from "../admin-data.ts";
import { resolveRollingCeiling } from "../fleet-safety.ts";
import { huntersTheDialBuys } from "../scheduler/research-policy.ts";
import { fleetSpendCeilingOverrideUsd, type AdminConfig } from "../gateway/admin-config.ts";
import { ADMIN_V6_SPEND_CONTRACT, SPEND_DAYS, readSpend, type AdminV6SpendView } from "./v6-spend-read.ts";
import { readV6Sources } from "./v6-money-hunts-route.ts";
import { validateV6Query } from "./v6-hunts-read.ts";

const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };
const MEMO_MS = 90_000;
let memo: { at: number; data: AdminV6SpendView } | null = null;

const UNREAD = { setAsideUsd: null, dailyLimitUsd: null, huntersNow: null, worstCaseCharges: null } as const;

async function limitsAndHolds(readAt: string): Promise<Pick<AdminV6SpendView, "setAsideUsd" | "dailyLimitUsd" | "huntersNow" | "worstCaseCharges">> {
  try {
    const opened = await openControlPlane();
    if (!opened.ok) return UNREAD;
    const sources = await readV6Sources(opened.repos, readAt, true);
    const hunts = sources.attribution?.hunts ?? null;
    const held = hunts === null || hunts.some((h) => h.reservedUsd === null) ? null : hunts.reduce((n, h) => n + (h.reservedUsd ?? 0), 0);
    const dailyLimitUsd = sources.adminConfig === null ? null : resolveRollingCeiling(fleetSpendCeilingOverrideUsd(sources.adminConfig as AdminConfig)).rollingCeilingUsd;
    const rolling = sources.fleetSafety?.rolling24Hours ?? null;
    return {
      setAsideUsd: held === null ? null : Math.round(held * 10_000) / 10_000,
      dailyLimitUsd,
      huntersNow: huntersTheDialBuys({ dailyLimitUsd, spentLast24hUsd: rolling?.modelUsd ?? null }),
      worstCaseCharges: rolling === null ? null : rolling.worstCaseCharges ?? 0,
    };
  } catch { return UNREAD; }
}

export async function v6SpendGet(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const parameters = new URLSearchParams(request.nextUrl.searchParams);
  const runnerHour = parameters.get("runnerHour");
  parameters.delete("runnerHour");
  const query = validateV6Query(parameters);
  if (!query.ok) return NextResponse.json({ code: query.code }, { status: 400, headers: NO_STORE });
  const url = controlPlaneUrlFromEnv();
  if (!url) return NextResponse.json({ state: "UNREAD", says: "The control-plane database is not configured here, so spend was not read." }, { status: 503, headers: NO_STORE });
  const now = new Date().toISOString();
  try {
    if (runnerHour !== null) {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/.test(runnerHour) || !Number.isFinite(Date.parse(runnerHour)))
        return NextResponse.json({ says: "Choose a recorded hour." }, { status: 400, headers: NO_STORE });
      return NextResponse.json(await readRunnerDatabaseTransfer(runnerHour), { headers: NO_STORE });
    }
    if (!memo || Date.now() - memo.at > MEMO_MS) {
      let transfer: DailyDatabaseTransferRead | null = null;
      try { transfer = await readDailyDatabaseTransfer(SPEND_DAYS); } catch { transfer = null; }
      const [spend, held] = await Promise.all([readSpend(neon(url), transfer), limitsAndHolds(now)]);
      memo = { at: Date.now(), data: { ...spend, ...held } };
    }
    const data = memo.data;
    return NextResponse.json({ contract: ADMIN_V6_SPEND_CONTRACT, scope: query.scopeKey, revision: `spend:${now.slice(0, 16)}`, asOf: now, data,
      missingParts: data.neon.kind === "not-recorded" ? [`Neon: ${data.neon.detail ?? "not recorded yet"}`] : [] }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ state: "UNREAD", says: "The cost ledger could not be read just now, so spend is unknown, not zero." }, { status: 503, headers: NO_STORE });
  }
}
