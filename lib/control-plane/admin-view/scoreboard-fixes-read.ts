import type { FixItem } from "../fix-list.ts";
import { ADMIN_CONFIG_ID } from "../gateway/admin-config.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { placeReadConnection } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";

/** The Scoreboard needs repair clocks and states, while the Queue reads each fix's details. */
export async function readScoreboardFixes(repos: ControlPlaneRepositories): Promise<readonly FixItem[]> {
  const sql = placeReadConnection(repos);
  if (!sql) return (await repos.adminConfig.read(ADMIN_CONFIG_ID, { fixList: { activeAndRecent: 500 } }))?.value.fixList ?? [];
  const [row] = await boundedQuery(sql, { operation: "admin.scoreboard-repairs", callClass: "PAGE" },
    `SELECT coalesce(jsonb_agg(jsonb_build_array(value->'id',value->'state',value->'addedBy',value->'addedAt',
      value->'fixedAt',value->'changedBy') ORDER BY ordinal),'[]'::jsonb) AS fixes
     FROM cp_admin_fix_list WHERE config_id=$1 AND (value->>'state'!='FIXED' OR id IN (
       SELECT id FROM cp_admin_fix_list WHERE config_id=$1 AND value->>'state'='FIXED' ORDER BY ordinal DESC LIMIT 500))`,
    [ADMIN_CONFIG_ID]) as { fixes: readonly [string, FixItem["state"], string, string, string | null, string | null][] }[];
  if (!row || !Array.isArray(row.fixes)) throw new Error("Repair counts could not be read");
  return row.fixes.map(([id, state, addedBy, addedAt, fixedAt, changedBy]) => ({ id, state, addedBy, addedAt,
    ...(fixedAt === null ? {} : { fixedAt }), ...(changedBy === null ? {} : { changedBy }) } as FixItem));
}
