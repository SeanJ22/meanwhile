import { settingsEdgeStore } from "@/lib/civic-data/reader-settings-publication.ts";
import { WORKER_SAFETY_FRAME } from "@/lib/control-plane/playbooks.ts";
import type { NextRequest } from "next/server";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { adminGet } from "@/lib/control-plane/gateway/admin-get.ts";
import { fieldManualEntryId } from "@/lib/control-plane/field-manual.ts";
import { EDITABLE_PLAYBOOK_ROLES, playbookEditView } from "@/lib/control-plane/playbook-edit.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return adminGet(request, async observedAt => {
    const opened = await openControlPlane();
    if (!opened.ok) throw new Error("Worker instructions are unavailable");
    const rows = await opened.repos.fieldManual.readMany(EDITABLE_PLAYBOOK_ROLES.map(role => fieldManualEntryId("role-playbook", role)));
    let published: Awaited<ReturnType<ReturnType<typeof settingsEdgeStore>["read"]>> = null;
    try { published = await settingsEdgeStore().read(); } catch { /* The waiting state remains visible below. */ }
    return { observedAt, safetyFrame: WORKER_SAFETY_FRAME, rows: EDITABLE_PLAYBOOK_ROLES.map(role => {
      const row = playbookEditView(rows.map(row => row.value), role);
      const waiting = (role === "ASK_READER" || role === "ASK_WRITER" || role === "ASK_FALLBACK") && published?.snapshot.playbooks?.[role]?.version !== row.version;
      return { ...row, stuck: row.stuck ?? (waiting ? "Ask is waiting for these instructions to reach the reader." : null) };
    }) };

  });
}
