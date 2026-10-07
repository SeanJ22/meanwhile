import { setActiveOwedOverlay } from "../../coverage/owed-overlay.ts";
import { openControlPlane } from "../admin-data.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../gateway/admin-config.ts";

/** A config that cannot be read leaves the overlay as it was and returns "unread": nothing is assumed added or declined. */
export async function refreshOwedOverlay(): Promise<string> {
  try {
    const opened = await openControlPlane();
    if (!opened.ok) return "unread";
    const row = await opened.repos.adminConfig.read(ADMIN_CONFIG_ID);
    return setActiveOwedOverlay(row !== null && isAdminConfig(row.value) ? row.value.owedOverlay : null).revision;
  } catch {
    return "unread";
  }
}
