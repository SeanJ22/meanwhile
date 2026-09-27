import "server-only";

import { neon } from "@neondatabase/serverless";
import { controlPlaneUrlFromEnv } from "@/lib/control-plane/repository/pg-store.ts";
import { SCOPE_WORK_QUERY, type ScopeWorkObligation } from "@/lib/control-plane/admin-view/scope-work.ts";
import { sharedRead } from "./shared-read.ts";

type ScopeWorkRead =
  | { readonly kind: "HELD"; readonly readAt: string; readonly obligations: readonly ScopeWorkObligation[] }
  | { readonly kind: "UNREAD"; readonly detail: string };

const shared = sharedRead<ScopeWorkRead>({
  freshMs: 60_000, staleMs: 300_000, deadlineMs: 1_500,
  keep: value => value.kind === "HELD",
  late: () => ({ kind: "UNREAD", detail: "Standing work did not answer in time. Its scope is unverified in this preview; that does not mean there is no work." }),
});

/** Cached server-side read only. Work creation remains the normal Send path. */
export function loadScopeWork(): Promise<ScopeWorkRead> {
  return shared.read(async () => {
    const url = controlPlaneUrlFromEnv();
    if (!url) return { kind: "UNREAD", detail: "The control-plane connection is not configured; standing scope is unverified." };
    try {
      const sql = neon(url);
      const [rows] = await sql.transaction([sql.query(SCOPE_WORK_QUERY)], { readOnly: true, fetchOptions: { signal: AbortSignal.timeout(1_500) } });
      return { kind: "HELD", readAt: new Date().toISOString(), obligations: rows.map(row => row.obligation as ScopeWorkObligation) };
    } catch {
      return { kind: "UNREAD", detail: "The standing-work read failed. Applicability and remaining work could not be measured." };
    }
  });
}
