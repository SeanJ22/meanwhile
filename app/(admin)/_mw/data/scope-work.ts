import "server-only";

import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import type { FreshnessObligation } from "@/lib/control-plane/scheduler/obligation.ts";
import { sharedRead } from "./shared-read.ts";

type ScopeWorkRead =
  | { readonly kind: "HELD"; readonly readAt: string; readonly obligations: readonly FreshnessObligation[] }
  | { readonly kind: "UNREAD"; readonly detail: string };

const shared = sharedRead<ScopeWorkRead>({
  freshMs: 60_000, staleMs: 300_000, deadlineMs: 1_500,
  keep: value => value.kind === "HELD",
  late: () => ({ kind: "UNREAD", detail: "Standing work did not answer in time. Its scope is unverified in this preview; that does not mean there is no work." }),
});

/** Cached server-side read only. Work creation remains the normal Send path. */
export function loadScopeWork(): Promise<ScopeWorkRead> {
  return shared.read(async () => {
    const opened = await openControlPlane();
    if (!opened.ok) return { kind: "UNREAD", detail: opened.detail };
    try {
      const rows = await opened.repos.obligations.list();
      return { kind: "HELD", readAt: new Date().toISOString(), obligations: rows.map(row => row.value) };
    } catch {
      return { kind: "UNREAD", detail: "The standing-work read failed. Applicability and remaining work could not be measured." };
    }
  });
}
