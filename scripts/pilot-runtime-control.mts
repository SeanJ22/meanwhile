import { neon } from "@neondatabase/serverless";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { ADMIN_CONFIG_ID } from "../lib/control-plane/gateway/admin-config.ts";
import { RESEARCH_INTENT_LOG_KEY, RESEARCH_STATE_ID } from "../lib/control-plane/scheduler/research-policy.ts";

/** Process-local cache. Only changed controls carry their payload across the wire. */
export function runnerControlReader(url: string, repos: ControlPlaneRepositories) {
  const sql = neon(url);
  let signatures: Record<string, string> = {};
  let research: Awaited<ReturnType<typeof repos.researchIntents.read>> = [];
  let windows: Awaited<ReturnType<typeof repos.windowIntents.read>> = [];
  let config: Awaited<ReturnType<typeof repos.adminConfig.read>> = null;
  let state: Awaited<ReturnType<typeof repos.researchState.readNarrowed>> = null;
  let pending: Promise<void> | null = null;
  async function refresh() {
    const [row] = await sql.query(`SELECT
      (SELECT count(*)::text FROM cp_log_research_intents WHERE log_key = $1) AS research,
      (SELECT count(*)::text FROM cp_log_window_intents WHERE log_key = $2) AS windows,
      (SELECT revision::text FROM cp_admin_config WHERE id = $3) AS config,
      (SELECT revision::text FROM cp_research_state WHERE id = $4) AS state`,
    [RESEARCH_INTENT_LOG_KEY, "nightly-window", ADMIN_CONFIG_ID, RESEARCH_STATE_ID]);
    if (!row) throw new Error("RUNNER_CONTROLS_UNREADABLE");
    // Count observes committed inserts, including lower positions that were
    // allocated before a later row but committed after it. A MAX cursor loses them.
    const next = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value)]));
    const updates = await Promise.all([
      signatures.research === next.research ? research : repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY),
      signatures.windows === next.windows ? windows : repos.windowIntents.read("nightly-window"),
      signatures.config === next.config ? config : repos.adminConfig.read(ADMIN_CONFIG_ID),
      signatures.state === next.state ? state : repos.researchState.readNarrowed(RESEARCH_STATE_ID, { expansion: true, assignments: true }),
    ]);
    [research, windows, config, state] = updates;
    signatures = next;
  }
  return {
    async read() {
      pending ??= refresh().finally(() => { pending = null; });
      await pending;
      return { research, windows, config, state };
    },
  };
}
