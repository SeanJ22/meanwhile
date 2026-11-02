import { neon } from "../db/client.ts";
import { savedKeysCache } from "./keys-cache.ts";
import { installSavedValues } from "./keys-values.ts";
import type { KeysQuery } from "./keys-store.ts";
import { BILLING_SECRET_NAMES } from "../control-plane/provider-billing.ts";

type Audience = "runner" | "website" | "build";
const RUNTIME = Symbol.for("meanwhile.saved-keys-runtime");
const host = globalThis as typeof globalThis & { [RUNTIME]?: { source: Audience; runtime: ReturnType<typeof savedKeysRuntime> } };
const billing = new Set<string>(BILLING_SECRET_NAMES);
const unavailable = "The saved keys could not be reached.";

/** One direct reader per process; only the runner's forced key pass records openings. A failed refresh keeps its last snapshot. */
export function savedKeysRuntime(query: KeysQuery, master: string | undefined, source: Audience,
  clock: () => number = Date.now, warn: (message: string) => void = console.error) {
  const cache = savedKeysCache(query, master, source === "runner" ? "runner" : "website",
    // Reporting keys are opened separately by the private collector and their health check.
    name => !billing.has(name) && (source !== "website" || name !== "WTP_PRODUCTION_DATABASE_URL_WRITE"));
  let loaded = false, lastAttempt = 0, pending: Promise<void> | undefined;
  return { refresh(force = false): Promise<void> {
    if (pending) return pending;
    if (!force && loaded && clock() - lastAttempt < 60_000) return Promise.resolve();
    lastAttempt = clock();
    pending = (async () => {
      try {
        const next = await cache.refresh();
        if (force && source === "runner" && next.openings?.length) await query(`UPDATE cp_keys held SET runner_read_at=opened.at
          FROM jsonb_to_recordset($1::jsonb) AS opened(name text,version text,at timestamptz)
          WHERE held.name=opened.name AND held.version=opened.version AND NOT held.deleted
            AND (held.runner_read_at IS NULL OR held.runner_read_at < opened.at)`, [JSON.stringify(next.openings)]);
        installSavedValues(next); loaded = true;
      } catch {
        warn("The saved keys could not be refreshed. Check the Keys box in Settings.");
        if (!loaded) throw new Error(unavailable);
      } finally { pending = undefined; }
    })();
    return pending;
  } };
}

/** Each runtime connects directly to the control plane; an Admin sign-in is irrelevant. */
export async function refreshSavedKeys(source: Audience, force = false): Promise<void> {
  let state = host[RUNTIME];
  if (!state) {
    try {
      const connection = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
      if (!connection) throw new Error(unavailable);
      const sql = neon(connection);
      state = host[RUNTIME] = { source, runtime: savedKeysRuntime(async (text, params) =>
        await sql.query(text, params ? [...params] : [], { fetchOptions: { signal: AbortSignal.timeout(2_000) } }) as Record<string, unknown>[],
      process.env.WTP_KEYS_ENCRYPTION_KEY, source) };
    } catch { throw new Error(unavailable); }
  }
  if (state.source !== source) throw new Error("The saved key runtime changed its source.");
  await state.runtime.refresh(force);
}
