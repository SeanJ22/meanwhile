import { addFixItem } from "../control-plane/fix-list.ts";
import { readSetting } from "../control-plane/settings.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../control-plane/gateway/admin-config.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { listDoors } from "../doors/registry.ts";
import {
  deadLinkFix, deadLinkReadings, deadLinkSurfaces, DEAD_LINKS_SURFACE_DEFAULT, DEAD_LINKS_SURFACE_SETTING,
  SLOW_SURFACE_SHARE_DEFAULT, SLOW_SURFACE_SHARE_SETTING, slowSurfaceFix, slowSurfaces, surfaceSpeeds,
} from "./surface-speed.ts";
import type { SpeedPass } from "./worst-case-speed.ts";

/**
 * A surface over its limit opens one fix-list item (the same gap reported
 * again is the same item). Called by the scheduled speed pass right after it
 * records its result.
 */
export async function openSurfaceFixes(
  repos: Pick<ControlPlaneRepositories, "adminConfig" | "doors">, pass: SpeedPass, at: string,
): Promise<{ readonly opened: readonly string[] }> {
  const held = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  const config = held && isAdminConfig(held.value) ? held.value : null;
  const share = readSetting(config, SLOW_SURFACE_SHARE_SETTING, SLOW_SURFACE_SHARE_DEFAULT);
  const deadLimit = readSetting(config, DEAD_LINKS_SURFACE_SETTING, DEAD_LINKS_SURFACE_DEFAULT);
  const fixes = [
    ...slowSurfaces(surfaceSpeeds(pass), share).map((s) => slowSurfaceFix(s, share)),
    ...deadLinkSurfaces(deadLinkReadings((await listDoors(repos.doors)).doors), deadLimit).map((r) => deadLinkFix(r, deadLimit)),
  ];
  const opened: string[] = [];
  for (const fix of fixes) opened.push(await addFixItem(repos, { ...fix, by: "The speed and link checks", at }));
  return { opened };
}
