import type { NextRequest } from "next/server";

import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { owedTable, OWED_TABLE_SETTING } from "@/lib/coverage/owed-table.ts";
import { readStateOwedCounts } from "@/lib/coverage/owed-read.ts";
import { factReader } from "@/lib/facts/db.ts";
import { projectSettings } from "@/lib/control-plane/admin-view/v6-settings-read.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "@/lib/control-plane/gateway/admin-config.ts";
import { adminGet } from "@/lib/control-plane/gateway/admin-get.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** The editable baseline and direct state counts from the place map, facts and blanks. */
export async function GET(request: NextRequest) {
  return adminGet(request, async (observedAt) => {
    const opened = await openControlPlane();
    if (!opened.ok) throw new Error(opened.detail);
    const row = await opened.repos.adminConfig.read(ADMIN_CONFIG_ID, { settingHistory: { where: { path: ["key"], value: OWED_TABLE_SETTING }, limit: 20 } });
    if (row && !isAdminConfig(row.value)) throw new Error("Settings could not be read");
    const config = row?.value ?? null;
    const query = factReader();
    const counts = query ? await readStateOwedCounts(query, config, observedAt) : null;
    const setting = projectSettings({ config, heartbeat: null, published: null, observedAt }).rows.find(row => row.key === OWED_TABLE_SETTING)!;
    return {
      contract: "admin-v6/owed@2",
      scope: request.nextUrl.searchParams.get("scope") ?? "united-states",
      revision: `owed:${row?.revision ?? "default"}:${observedAt}`,
      asOf: observedAt,
      data: { table: owedTable(config), setting, counts },
      missingParts: counts === null ? ["What readers have could not be read"] : [],
    };
  });
}
