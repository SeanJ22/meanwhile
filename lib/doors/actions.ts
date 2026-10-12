/**
 * The door registry's gateway actions. Doors are written only here, so every
 * change carries a receipt and an undo sentence.
 */

import type { ActionResult, RegisteredAction } from "../control-plane/gateway/registry.ts";
import { writeFailureSays } from "../control-plane/gateway/write-readback.ts";
import { repairDoor } from "./repair.ts";
import { applyManualEdit, checkDoorDraft, editableFieldsOf, isDoorRecord, type DoorDraft, type DoorRecord } from "./registry.ts";

const bad = (why: string) => ({ ok: false as const, why });
const refuse = (says: string): ActionResult => ({ ok: false, refusal: "DOWNSTREAM_REFUSED", says });

function wordsFor(record: DoorRecord): string {
  const status = record.status === "OPEN" ? "open" : record.status === "SHUT" ? "shut" : "set aside";
  return `${record.doorId} (${record.kind}, ${status})`;
}

export const DOOR_ACTIONS: readonly RegisteredAction[] = [
  {
    definition: {
      type: "door.save",
      label: "Save a door",
      does: "Adds a door to the registry, or changes one: what reads it, which bodies and websites it covers, what it holds, how often it is checked, and whether it is open, shut or set aside.",
      doesNot: "Does not read the door right now unless you ask for that, does not store any secret (settings name a key and never hold one), and does not need a release to take effect.",
      authority: "REVERSIBLE_NONPRODUCTION",
      subjectKind: "a door",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const checked = checkDoorDraft(input);
      return checked.ok ? { ok: true, value: { ...checked.value } } : bad(checked.why);
    },
    async execute(deps, context, input) {
      const checked = checkDoorDraft(input);
      if (!checked.ok) return { ok: false, refusal: "INVALID_INPUT", says: `Nothing was saved: ${checked.why}.` };
      const at = context.at;
      const id = checked.value.doorId;
      let previous: DoorRecord | null = null;
      try {
        const existing = await deps.repos.doors.read(id);
        previous = existing !== null && isDoorRecord(existing.value) ? existing.value : null;
        if (existing !== null && previous === null) {
          return refuse(`The stored record for ${id} could not be read, so nothing was changed — saving over it would silently drop what it held.`);
        }
        const next = applyManualEdit(previous, checked.value, at);
        if (existing === null) await deps.repos.doors.put(id, next, at);
        else await deps.repos.doors.compareAndSet(id, existing.revision, next, at);
      } catch (error) {
        return refuse(writeFailureSays("your door change", error));
      }
      const saved = applyManualEdit(previous, checked.value, at);
      return {
        ok: true,
        outcome: "DONE",
        subject: id,
        says: previous === null ? `Added the door ${wordsFor(saved)}.` : `Changed the door ${wordsFor(saved)}. It takes effect on the next check, with no release.`,
        openedWork: [],
        readBackAt: "/admin/doors",
        undo:
          previous === null
            ? `Set ${id} aside; doors are never deleted, so its history stays.`
            : `Save ${id} again with its earlier fields: ${JSON.stringify(editableFieldsOf(previous))}.`,
      };
    },
  },
  {
    definition: {
      type: "door.update",
      label: "Repair a door",
      does: "Changes the fields you name on one door's record (for example the website it reads) and has it read at the next check. If the door is shut it stays shut until a read of the new record works; then it reopens and its repair is recorded.",
      doesNot: "Does not need a release, does not touch any field you leave out, and does not reopen a shut door by itself.",
      authority: "REVERSIBLE_NONPRODUCTION",
      subjectKind: "a door",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const id = typeof input.doorId === "string" ? input.doorId.trim() : "";
      if (id === "") return bad("name the door to repair");
      const why = typeof input.why === "string" ? input.why.trim() : "";
      if (why === "") return bad("say why the door is being changed");
      if (why.length > 2000) return bad("keep the note to 2,000 characters");
      const { doorId: _d, why: _w, ...changes } = input;
      const checked = checkDoorDraft({ kind: "x", ...changes, doorId: id });
      if (!checked.ok) return bad(checked.why);
      return { ok: true, value: { ...input, doorId: id, why } };
    },
    async execute(deps, context, input) {
      const { doorId, why, ...changes } = input as Record<string, unknown> & { doorId: string; why: string };
      let repaired;
      try {
        repaired = await repairDoor(deps.repos, doorId, changes as Partial<DoorDraft>, context.at);
      } catch (error) {
        return refuse(writeFailureSays("your door repair", error));
      }
      if (!repaired.ok) return refuse(repaired.says);
      return {
        ok: true,
        outcome: "DONE",
        subject: doorId,
        says: `Repaired ${wordsFor(repaired.next)}${repaired.changed.length > 0 ? ` (changed: ${repaired.changed.join(", ")})` : ""} because ${why}. It is read at the next check with no release.`,
        openedWork: [],
        readBackAt: "/admin/doors",
        undo: `Repair ${doorId} again with its earlier fields: ${JSON.stringify(editableFieldsOf(repaired.previous))}.`,
      };
    },
  },
];
