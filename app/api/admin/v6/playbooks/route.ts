import type { NextRequest } from "next/server";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { adminGet } from "@/lib/control-plane/gateway/admin-get.ts";
import { readFieldManual } from "@/lib/control-plane/field-manual.ts";
import { EDITABLE_PLAYBOOK_ROLES, playbookEditView } from "@/lib/control-plane/playbook-edit.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return adminGet(request, async observedAt => {
    const opened = await openControlPlane();
    if (!opened.ok) throw new Error("Worker instructions are unavailable");
    const read = await readFieldManual(opened.repos, {});
    if (read.error) throw new Error("Worker instructions could not be read");
    return { observedAt, rows: EDITABLE_PLAYBOOK_ROLES.map(role => playbookEditView(read.store.entries, role)) };
  });
}
