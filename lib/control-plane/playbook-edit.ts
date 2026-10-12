/** Gateway callers supply the receipt id and time; there is no direct production write path. */
import { createHash } from "node:crypto";
import { fieldManualEntryId, newFieldManualEntry, normalizeEntry, readFieldManual, type FieldManualRepos, type FieldManualRole, type FieldManualEntry } from "./field-manual.ts";
import { rolePlaybook } from "./playbooks.ts";
import { ConcurrentModification, IdentityCollision } from "./repository/types.ts";

export const EDITABLE_PLAYBOOK_ROLES = ["SCOUT", "DETECTIVE", "PARSER", "VALIDATOR", "AUDITOR", "ENGINEER"] as const;
export type EditablePlaybookRole = typeof EDITABLE_PLAYBOOK_ROLES[number];
export function isEditablePlaybookRole(role: unknown): role is EditablePlaybookRole {
  return typeof role === "string" && (EDITABLE_PLAYBOOK_ROLES as readonly string[]).includes(role);
}
export interface PlaybookChange {
  readonly id: string; readonly at: string; readonly before: string; readonly after: string;
  readonly why: string; readonly factory?: string; readonly undoOf?: string;
}
export interface PlaybookEdit {
  readonly role: EditablePlaybookRole; readonly text: string; readonly expectedVersion: string;
  readonly id: string; readonly at: string; readonly why: string; readonly factory?: string; readonly undoOf?: string;
}
type EditPayload = { text: string; history: readonly PlaybookChange[]; edited: true };
export function playbookHistory(entries: readonly FieldManualEntry[], role: FieldManualRole): readonly PlaybookChange[] {
  const history = entries.filter(e => e.kind === "PLAYBOOK" && e.role === role)
    .flatMap(e => (e.payload as Partial<EditPayload> | null)?.history ?? []);
  return [...new Map(history.map(change => [change.id, change])).values()].sort((a, b) => a.at.localeCompare(b.at));
}
export function playbookEditView(entries: readonly FieldManualEntry[], role: EditablePlaybookRole) {
  const book = rolePlaybook(entries, role);
  const history = playbookHistory(entries, role);
  const latest = history.at(-1);
  return { role, label: `${role.charAt(0)}${role.slice(1).toLowerCase()} instructions`, text: book.text, version: book.version,
    changedAt: latest?.at ?? null, history,
    undo: latest ? { id: latest.id, text: latest.before, expectedVersion: book.version } : null };
}

/** An edit replaces this role's runnable text while preserving every unrelated Bank entry and previous revision. */
export async function updateRolePlaybook(repos: FieldManualRepos, edit: PlaybookEdit): Promise<{ version: string; changed: boolean }> {
  if (!isEditablePlaybookRole(edit.role) || !edit.text.trim() || edit.text.length > 100_000 || !edit.id.trim() ||
      !Number.isFinite(Date.parse(edit.at))) throw new Error("Invalid playbook change");
  const id = fieldManualEntryId("role-playbook", edit.role);
  for (let attempt = 0; attempt < 4; attempt++) {
    const read = await readFieldManual(repos, { role: edit.role, kinds: ["PLAYBOOK"], everywhere: true });
    if (read.error) throw new Error(read.error);
    const held = await repos.fieldManual.read(id);
    const book = rolePlaybook(read.store.entries, edit.role);
    const history = playbookHistory(read.store.entries, edit.role);
    const replay = history.find(e => e.id === edit.id);
    if (replay) {
      if (replay.after !== edit.text || replay.undoOf !== edit.undoOf) throw new Error("Conflicting playbook change id");
      return { version: book.version, changed: false };
    }
    if (book.version !== edit.expectedVersion || (edit.undoOf && history.at(-1)?.id !== edit.undoOf)) {
      throw new Error("These instructions changed again; refresh before editing them");
    }
    if (edit.undoOf && edit.text !== history.at(-1)?.before) throw new Error("Undo must restore the previous instructions");
    const change: PlaybookChange = { id: edit.id, at: edit.at, before: book.text, after: edit.text, why: edit.why,
      ...(edit.factory ? { factory: edit.factory } : {}), ...(edit.undoOf ? { undoOf: edit.undoOf } : {}) };
    const entry = normalizeEntry(newFieldManualEntry("role-playbook", edit.role, { role: edit.role, kind: "PLAYBOOK",
      title: `${edit.role.toLowerCase()} playbook`, summary: "Current written instructions for this role", outcome: "REFERENCE",
      observedAt: edit.at, portable: true, payload: { text: edit.text, history: [...history, change], edited: true } satisfies EditPayload }));
    try {
      if (held) await repos.fieldManual.compareAndSet(id, held.revision, entry, edit.at);
      else await repos.fieldManual.put(id, entry, edit.at);
      return { version: createHash("sha256").update(edit.text).digest("hex"), changed: true };
    } catch (error) {
      if (!(error instanceof ConcurrentModification || error instanceof IdentityCollision) || attempt === 3) throw error;
    }
  }
  throw new Error("Instructions could not be saved after concurrent changes");
}
