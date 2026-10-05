import type { NextRequest } from "next/server";

import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { updatesFromChanges, updatesView } from "@/lib/control-plane/admin-view/updates-read.ts";
import { readChanges } from "@/lib/control-plane/changes/source.ts";
import { adminGet } from "@/lib/control-plane/gateway/admin-get.ts";
import { addUpdates, takeUnshownUpdates } from "@/lib/control-plane/updates.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/**
 * What changed that Now has not shown yet, each with its label. Reading marks them shown, so an update appears
 * once. Merged-and-live changes from the Changes feed are folded in first; when GitHub cannot be read they are skipped
 * and the fix completions still show.
 */
export async function GET(request: NextRequest) {
  return adminGet(request, async (observedAt) => {
    const opened = await openControlPlane();
    if (!opened.ok) throw new Error(opened.detail);
    try {
      const changes = await readChanges();
      if (changes.kind === "OBSERVED") await addUpdates(opened.repos, updatesFromChanges(changes.rows, Date.parse(observedAt)), observedAt);
    } catch { /* the Changes feed is one source among several */ }
    const fresh = await takeUnshownUpdates(opened.repos, observedAt);
    return {
      contract: "admin-v6/updates@1",
      scope: request.nextUrl.searchParams.get("scope") ?? "united-states",
      revision: `updates:${fresh.length}:${observedAt}`,
      asOf: observedAt,
      data: updatesView(fresh, observedAt),
      missingParts: [],
    };
  });
}
