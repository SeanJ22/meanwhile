import { neon } from "@neondatabase/serverless";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { ADMIN_CONFIG_ID } from "../lib/control-plane/gateway/admin-config.ts";
import { RESEARCH_INTENT_LOG_KEY, RESEARCH_STATE_ID } from "../lib/control-plane/scheduler/research-policy.ts";

type Delta<T> = { id: string; position: string; record: T };
type Query = (text: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

/** Process-local cache. Only changed controls carry their payload across the wire. */
export function runnerControlReader(url: string, repos: ControlPlaneRepositories, options: {
  query?: Query; now?: () => number; refreshMs?: number;
} = {}) {
  const query: Query = options.query ?? ((text, params) => neon(url).query(text, params));
  const now = options.now ?? Date.now;
  let refreshedAt = -Infinity;
  let signatures: Record<string, string> = {};
  let research: Awaited<ReturnType<typeof repos.researchIntents.read>> = [];
  let windows: Awaited<ReturnType<typeof repos.windowIntents.read>> = [];
  const researchRows = new Map<string, Delta<typeof research[number]>>();
  const windowRows = new Map<string, Delta<typeof windows[number]>>();
  let config: Awaited<ReturnType<typeof repos.adminConfig.read>> = null;
  let state: Awaited<ReturnType<typeof repos.researchState.readNarrowed>> = null;
  let pending: Promise<void> | null = null;
  async function refresh() {
    const [row] = await query(`SELECT
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', record_id, 'position', position::text, 'record', record)), '[]'::jsonb)
       FROM cp_log_research_intents WHERE log_key = $1 AND NOT (record_id = ANY($5::text[]))) AS research,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', record_id, 'position', position::text, 'record', record)), '[]'::jsonb)
       FROM cp_log_window_intents WHERE log_key = $2 AND NOT (record_id = ANY($6::text[]))) AS windows,
      (SELECT revision::text FROM cp_admin_config WHERE id = $3) AS config,
      (SELECT md5(jsonb_build_object('expansion', value->'expansion', 'assignments', value->'assignments')::text)
       FROM cp_research_state WHERE id = $4) AS state`,
    [RESEARCH_INTENT_LOG_KEY, "nightly-window", ADMIN_CONFIG_ID, RESEARCH_STATE_ID,
      [...researchRows.keys()], [...windowRows.keys()]]);
    if (!row) throw new Error("RUNNER_CONTROLS_UNREADABLE");
    if (!Array.isArray(row.research) || !Array.isArray(row.windows)) throw new Error("RUNNER_CONTROLS_UNREADABLE");
    const next = { config: String(row.config), state: String(row.state) };
    const updates = await Promise.all([
      signatures.config === next.config ? config : repos.adminConfig.read(ADMIN_CONFIG_ID),
      signatures.state === next.state ? state : repos.researchState.readNarrowed(RESEARCH_STATE_ID, { expansion: true, assignments: true }),
    ]);
    // Remember committed IDs, not a MAX position: a concurrent lower position
    // can commit later. Keep original position order for the existing folds.
    const merge = <T,>(held: Map<string, Delta<T>>, rows: Delta<T>[], current: readonly T[]): readonly T[] => {
      if (rows.length === 0) return current;
      for (const entry of rows) held.set(entry.id, entry);
      return [...held.values()].sort((a, b) => BigInt(a.position) < BigInt(b.position) ? -1 : BigInt(a.position) > BigInt(b.position) ? 1 : 0).map(entry => entry.record);
    };
    research = merge(researchRows, row.research as Delta<typeof research[number]>[], research);
    windows = merge(windowRows, row.windows as Delta<typeof windows[number]>[], windows);
    [config, state] = updates;
    signatures = next;
    refreshedAt = now();
  }
  return {
    async read(force = false) {
      if (force || now() - refreshedAt >= (options.refreshMs ?? 60_000)) {
        pending ??= refresh().finally(() => { pending = null; });
      }
      await pending;
      return { research, windows, config, state };
    },
  };
}
