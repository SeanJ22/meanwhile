import { publishAskPlaybooks, ASK_PLAYBOOK_ROLES } from "../../civic-data/reader-settings-publication.ts";
import { isEditablePlaybookRole, updateRolePlaybook, type EditablePlaybookRole } from "../playbook-edit.ts";
import type { RegisteredAction } from "./registry.ts";

export const playbookUpdateAction: RegisteredAction = {
  definition: { type: "playbook.update", label: "Change worker instructions",
    does: "Saves the instructions for the next worker, with their previous version and an undo.", doesNot: "Changes no budget or pause.",
    authority: "OWNER_DECISION_REQUIRED", subjectKind: "worker instructions", requiresStateVersion: false,
    refusals: ["INVALID_INPUT", "STALE_STATE", "DOWNSTREAM_REFUSED"] },
  validate(input) {
    if (!isEditablePlaybookRole(input.role) || typeof input.text !== "string" || (!input.text.trim() && input.undoOf === undefined) || input.text.length > 100_000 ||
        typeof input.expectedVersion !== "string" || !/^[a-f0-9]{64}$/.test(input.expectedVersion) ||
        (input.why !== undefined && (typeof input.why !== "string" || input.why.length > 2000)) ||
        (input.undoOf !== undefined && (typeof input.undoOf !== "string" || !input.undoOf))) {
      return { ok: false, why: "Choose a worker and instructions, and refresh their current version before saving." };
    }
    return { ok: true, value: { ...input, why: input.why ?? "" } };
  },
  async execute(deps, context, input) {
    try {
      await updateRolePlaybook(deps.repos, { role: input.role as EditablePlaybookRole, text: String(input.text), expectedVersion: String(input.expectedVersion),
        id: context.receiptId, at: context.at, why: String(input.why), ...(input.undoOf ? { undoOf: String(input.undoOf) } : {}) });
      let published = true;
      if ((ASK_PLAYBOOK_ROLES as readonly string[]).includes(String(input.role))) {
        try { published = await publishAskPlaybooks(deps.repos); } catch { published = false; }
      }
      return { ok: true, outcome: published ? "DONE" : "QUEUED", subject: String(input.role), says: published ? "Instructions saved for the next worker." : "Instructions saved; Ask is waiting for publication.",
        openedWork: [], readBackAt: "/admin?view=settings", undo: "Restore the previous instructions from their history." };
    } catch (error) {
      const stale = error instanceof Error && error.message.includes("refresh before");
      return { ok: false, refusal: stale ? "STALE_STATE" : "DOWNSTREAM_REFUSED",
        says: stale ? "These instructions changed again. Refresh before saving." : "The instructions could not be saved. Refresh and try again." };
    }
  },
};
