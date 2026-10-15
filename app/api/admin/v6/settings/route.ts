import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane, RUNNER_ID } from "@/lib/control-plane/admin-data.ts";
import { projectSettings, SETTINGS_LOG_SHOWN } from "@/lib/control-plane/admin-view/v6-settings-read.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "@/lib/control-plane/gateway/admin-config.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { settingsEdgeStore } from "@/lib/civic-data/reader-settings-publication.ts";
import type { SettingValue } from "@/lib/control-plane/settings.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };
const UNREAD = "The settings could not be read just now, so they are unknown, not changed.";

/** What readers have now; null when the reader edge cannot be read quickly. Never holds up the view. */
async function publishedValues(): Promise<Readonly<Record<string, SettingValue>> | null> {
  try {
    const read = settingsEdgeStore().read().then((held) => held?.snapshot.values ?? {});
    return await Promise.race([read, new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_500))]);
  } catch {
    return null;
  }
}

/** Every registered setting with its value, when it changed, its log, its undo and whether it is in force. Read-only. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  try {
    const opened = await openControlPlane();
    if (!opened.ok) return NextResponse.json({ says: UNREAD }, { status: 503, headers: NO_STORE });
    const [row, beat, published] = await Promise.all([
      opened.repos.adminConfig.read(ADMIN_CONFIG_ID, { settingHistory: { latestPerKey: SETTINGS_LOG_SHOWN } }),
      opened.repos.runnerHeartbeat.read(RUNNER_ID).catch(() => null),
      publishedValues(),
    ]);
    if (row !== null && !isAdminConfig(row.value)) return NextResponse.json({ says: UNREAD }, { status: 503, headers: NO_STORE });
    return NextResponse.json(projectSettings({ config: row?.value ?? null, heartbeat: beat?.value ?? null, published,
      observedAt: new Date().toISOString() }), { headers: NO_STORE });
  } catch {
    return NextResponse.json({ says: UNREAD }, { status: 503, headers: NO_STORE });
  }
}
