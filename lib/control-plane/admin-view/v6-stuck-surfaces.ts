import { readSetting, type SettingValue } from "../settings.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../gateway/admin-config.ts";
import { openControlPlane } from "../admin-data.ts";
import { readLatestSpeedPass } from "../live-audit-log.ts";
import { listDoors } from "../../doors/registry.ts";
import {
  deadLinkItems, deadLinkReadings, DEAD_LINKS_SURFACE_DEFAULT, DEAD_LINKS_SURFACE_SETTING, SLOW_SURFACE_SHARE_DEFAULT, SLOW_SURFACE_SHARE_SETTING, slowSurfaceItems,
} from "../../health/surface-speed.ts";
import type { AdminV6StuckItem } from "./v6-stuck-read.ts";

/** A reading that cannot be taken says `unread`, never an empty list passed off as "all well". */
export async function readSurfaceItems(nowIso: string): Promise<{ readonly items: readonly AdminV6StuckItem[]; readonly unread: boolean }> {
  const opened = await openControlPlane().catch(() => null);
  if (opened === null || !opened.ok) return { items: [], unread: true };
  const repos = opened.repos;
  let unread = false;
  const config = await repos.adminConfig.read(ADMIN_CONFIG_ID).then((r) => (r !== null && r !== undefined && isAdminConfig(r.value) ? r.value : null), () => null);
  const limit = <T extends SettingValue>(key: string, fallback: T): T => readSetting(config, key, fallback);
  const [pass, links] = await Promise.all([
    readLatestSpeedPass(repos, nowIso).catch(() => { unread = true; return null; }),
    listDoors(repos.doors).then((l) => deadLinkReadings(l.doors), () => { unread = true; return []; }),
  ]);
  return {
    items: [
      ...slowSurfaceItems(pass, limit(SLOW_SURFACE_SHARE_SETTING, SLOW_SURFACE_SHARE_DEFAULT), nowIso),
      ...deadLinkItems(links, limit(DEAD_LINKS_SURFACE_SETTING, DEAD_LINKS_SURFACE_DEFAULT), nowIso),
    ],
    unread,
  };
}
