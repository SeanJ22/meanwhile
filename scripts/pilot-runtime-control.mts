import { readRuntimeAdminConfig } from "../lib/control-plane/runtime-admin-config.ts";
import { neon } from "@neondatabase/serverless";
import { getStore } from "@netlify/blobs";
import type { AppendOutcome, ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { ADMIN_CONFIG_ID } from "../lib/control-plane/gateway/admin-config.ts";
import { RESEARCH_INTENT_LOG_KEY, RESEARCH_STATE_ID } from "../lib/control-plane/scheduler/research-policy.ts";

type Delta<T> = { id: string; position: string; record: T };
type Query = (text: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

export const CONTROL_WAKE_POLL_MS = 1_000;

/** The optional hint carries no authority: controls still come from Postgres. */
export function runnerWakeReaderFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): (() => Promise<string | null>) | null {
  if (env.WTP_VAULT_PROVIDER !== "netlify" || !env.WTP_BLOBS_SITE_ID || !env.WTP_BLOBS_TOKEN) return null;
  const store = getStore({ name: env.WTP_VAULT_STORE ?? "meanwhile-evidence",
    siteID: env.WTP_BLOBS_SITE_ID, token: env.WTP_BLOBS_TOKEN, consistency: "strong",
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(1_500) }),
  });
  // HEAD reads the etag, not the receipt body or the retained vault contents.
  return async () => (await store.getMetadata("control/wake-hint.json"))?.etag ?? null;
}

/** Adjacent committed positions share one range; gaps stay eligible for late commits. */
function committedPositions<T>(rows: Map<string, Delta<T>>): string {
  const positions = [...new Set([...rows.values()].map(row => BigInt(row.position)))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const ranges: string[] = [];
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i];
    let end = start;
    while (i + 1 < positions.length && positions[i + 1] === end + BigInt(1)) end = positions[++i];
    ranges.push(`[${start},${end + BigInt(1)})`);
  }
  return `{${ranges.join(",")}}`;
}

/** Process-local cache. Only changed controls carry their payload across the wire. */
export function runnerControlReader(url: string, repos: ControlPlaneRepositories, options: {
  query?: Query; now?: () => number; refreshMs?: number;
  readWakeEtag?: (() => Promise<string | null>) | null;
} = {}) {
  const query: Query = options.query ?? ((text, params) => neon(url).query(text, params));
  const now = options.now ?? Date.now;
  const readWakeEtag = options.readWakeEtag === undefined ? runnerWakeReaderFromEnv() : options.readWakeEtag;
  const refreshMs = options.refreshMs ?? (readWakeEtag ? 15 * 60_000 : 60_000);
  let wakeEtag: string | null | undefined;
  let hintCheckedAt = -Infinity;
  let refreshedAt = -Infinity;
  let signatures: Record<string, string> = {};
  let research: Awaited<ReturnType<typeof repos.researchIntents.read>> = [];
  let windows: Awaited<ReturnType<typeof repos.windowIntents.read>> = [];
  const researchRows = new Map<string, Delta<typeof research[number]>>();
  const windowRows = new Map<string, Delta<typeof windows[number]>>();
  let researchPositions = "{}", windowPositions = "{}";
  let config: Awaited<ReturnType<typeof readRuntimeAdminConfig>> = null;
  let state: Awaited<ReturnType<typeof repos.researchState.readNarrowed>> = null;
  let pending: Promise<void> | null = null;
  let forceRequested = false;
  const merge = <T,>(held: Map<string, Delta<T>>, rows: Delta<T>[], current: readonly T[]): readonly T[] => {
    if (rows.length === 0) return current;
    for (const entry of rows) held.set(entry.id, entry);
    return [...held.values()].sort((a, b) => BigInt(a.position) < BigInt(b.position) ? -1 : BigInt(a.position) > BigInt(b.position) ? 1 : 0).map(entry => entry.record);
  };
  async function refresh() {
    const [row] = await query(`SELECT
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', record_id, 'position', position::text, 'record', record)), '[]'::jsonb)
       FROM cp_log_research_intents WHERE log_key = $1 AND NOT (position <@ $5::int8multirange)) AS research,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', record_id, 'position', position::text, 'record', record)), '[]'::jsonb)
       FROM cp_log_window_intents WHERE log_key = $2 AND NOT (position <@ $6::int8multirange)) AS windows,
      (SELECT revision::text FROM cp_admin_config WHERE id = $3) AS config,
      (SELECT md5(jsonb_build_object('expansion', value->'expansion', 'assignments', value->'assignments')::text)
       FROM cp_research_state WHERE id = $4) AS state`,
    [RESEARCH_INTENT_LOG_KEY, "nightly-window", ADMIN_CONFIG_ID, RESEARCH_STATE_ID,
      researchPositions, windowPositions]);
    if (!row) throw new Error("RUNNER_CONTROLS_UNREADABLE");
    if (!Array.isArray(row.research) || !Array.isArray(row.windows)) throw new Error("RUNNER_CONTROLS_UNREADABLE");
    const next = { config: String(row.config), state: String(row.state) };
    const updates = await Promise.all([
      signatures.config === next.config ? config : readRuntimeAdminConfig(repos),
      signatures.state === next.state ? state : repos.researchState.readNarrowed(RESEARCH_STATE_ID, { expansion: true, assignments: true }),
    ]);
    // Only positions actually returned are excluded. A MAX watermark would
    // hide a concurrent lower-position commit; compressed ranges leave its gap open.
    research = merge(researchRows, row.research as Delta<typeof research[number]>[], research);
    windows = merge(windowRows, row.windows as Delta<typeof windows[number]>[], windows);
    if (row.research.length) researchPositions = committedPositions(researchRows);
    if (row.windows.length) windowPositions = committedPositions(windowRows);
    [config, state] = updates;
    signatures = next;
    refreshedAt = now();
  }
  return {
    /** A committed local acknowledgment is already authoritative; do not wait for a remote hint. */
    rememberResearchAppend(outcome: AppendOutcome<typeof research[number]>) {
      research = merge(researchRows, [{ id: outcome.recordId, position: String(outcome.position), record: outcome.record }], research);
      researchPositions = committedPositions(researchRows);
    },
    async read(force = false) {
      forceRequested ||= force;
      pending ??= (async () => {
        let etag: string | null | undefined;
        if (readWakeEtag && (forceRequested || now() - hintCheckedAt >= CONTROL_WAKE_POLL_MS)) {
          hintCheckedAt = now();
          // Missing or failed hints never refuse an action or disable the slow read.
          try { etag = await readWakeEtag(); } catch { /* the slow clock remains */ }
        }
        const forced = forceRequested;
        forceRequested = false;
        if (forced || now() - refreshedAt >= refreshMs || (etag !== undefined && etag !== wakeEtag)) {
          await refresh();
          // A failed SQL read must not consume the wake that requested it.
          if (etag !== undefined) wakeEtag = etag;
        }
        // A cycle boundary that arrived during the SQL read still gets its refresh.
        while (forceRequested) { forceRequested = false; await refresh(); }
      })().finally(() => { pending = null; });
      await pending;
      return { research, windows, config, state };
    },
  };
}
