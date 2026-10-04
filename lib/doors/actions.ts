/**
 * THE DOOR REGISTRY'S GATEWAY ACTION (DB-09).
 *
 * Doors are written only here, so every change carries a receipt in the same
 * log as every other console action. The action keeps what was there in its
 * undo sentence. Registered into the closed list by one spread in
 * `lib/control-plane/gateway/registry.ts`.
 */

import type { ActionResult, RegisteredAction } from "../control-plane/gateway/registry.ts";
import { writeFailureSays } from "../control-plane/gateway/write-readback.ts";
import { applyManualEdit, checkDoorDraft, editableFieldsOf, isDoorRecord, type DoorRecord } from "./registry.ts";

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
];
