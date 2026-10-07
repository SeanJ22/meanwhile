import { EMPTY_OWED_OVERLAY, withOwedAddition, withOwedDecline, withOwedUndo, type OwedOverlayRecord } from "../../coverage/owed-overlay.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig, isAdminConfig, type AdminConfig } from "./admin-config.ts";
import type { ActionResult, GatewayDeps, RegisteredAction, ValidatedInput } from "./registry.ts";
import { writeFailureSays } from "./write-readback.ts";

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const bad = (why: string) => ({ ok: false as const, why });
const refuse = (says: string): ActionResult => ({ ok: false, refusal: "INVALID_INPUT", says });

const OWNER = "admin";
const ROW_ID = /^\["[^"]{1,300}","[A-Z]{2,4}-[A-Za-z0-9]{1,6}"\]$/;
export const DECLINE_MOST_ROWS = 100;

type Change = (record: OwedOverlayRecord) => OwedOverlayRecord | { readonly ok: false; readonly says: string };

/** Read the config, apply one change to the overlay record, write it back (one retry on a lost race). */
async function change(deps: GatewayDeps, at: string, apply: Change): Promise<{ ok: true } | { ok: false; says: string }> {
  try {
    for (let attempt = 0; ; attempt++) {
      const held = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID);
      const current: AdminConfig = held && isAdminConfig(held.value) ? held.value : defaultAdminConfig(at);
      const made = apply(current.owedOverlay ?? EMPTY_OWED_OVERLAY);
      if ("ok" in made) return made;
      if (made === (current.owedOverlay ?? EMPTY_OWED_OVERLAY)) return { ok: true };
      const next: AdminConfig = { ...current, owedOverlay: made, updatedAt: at };
      try {
        if (held) await deps.repos.adminConfig.compareAndSet(ADMIN_CONFIG_ID, held.revision, next, at);
        else await deps.repos.adminConfig.put(ADMIN_CONFIG_ID, next, at);
        return { ok: true };
      } catch (error) { if (attempt >= 1) throw error; }
    }
  } catch (error) { return { ok: false, says: writeFailureSays("what is owed", error) }; }
}

export const OWED_ACTIONS: readonly RegisteredAction[] = [
  {
    definition: {
      type: "owed.add",
      label: "Add to what is owed",
      does: "Adds one item to a family of the checklist, owed wherever that family applies, with the reason it is owed, so the next read of every place counts it.",
      doesNot: "Does not start any work, and never holds back publishing.",
      authority: "OWNER_DECISION_REQUIRED", subjectKind: "a checklist family", requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const group = text(input.group), requirement = text(input.requirement), why = text(input.why);
      if (!/^[A-Z]{2,4}$/.test(group)) return bad("choose a family");
      if (requirement.length < 4 || requirement.length > 200) return bad("say what is owed in 4 to 200 characters");
      if (why === "" || why.length > 2000) return bad("give the reason it is owed, up to 2,000 characters");
      return { ok: true, value: { group, requirement, why } };
    },
    async execute(deps, context, input: ValidatedInput) {
      const done = await change(deps, context.at, (record) => withOwedAddition(record, { changeId: context.receiptId, group: String(input.group), requirement: String(input.requirement), reason: String(input.why), at: context.at, addedBy: OWNER }));
      if (!done.ok) return refuse(done.says);
      return { ok: true, outcome: "DONE", subject: context.receiptId, says: `“${String(input.requirement)}” is now owed. It shows on a place's list on its next read.`, readBackAt: "/admin?view=checklist", undo: "Undo it from the log and it is no longer owed." };
    },
  },
  {
    definition: {
      type: "owed.decline",
      label: "Decline what was added to a place's list",
      does: "Removes the named items from what that place is owed, with the reason, so they are no longer counted.",
      doesNot: "Does not delete anything we hold, and never holds back publishing. Additions stay automatic.",
      authority: "OWNER_DECISION_REQUIRED", subjectKind: "a place's owed items", requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const placeKey = text(input.placeKey), why = text(input.why);
      const rows = Array.isArray(input.rows) ? input.rows : null;
      if (!/^(?:geo:[a-z]{2}\.[a-z_]+\.[0-9A-Za-z]+|st:[a-z]{2})$/.test(placeKey)) return bad("choose a place");
      if (rows === null || rows.length === 0 || rows.length > DECLINE_MOST_ROWS) return bad(`choose between 1 and ${DECLINE_MOST_ROWS} items`);
      if (why === "" || why.length > 2000) return bad("give the reason it is declined, up to 2,000 characters");
      const checked: { rowId: string; subjectLabel: string; requirement: string }[] = [];
      for (const row of rows as unknown[]) {
        const r = row as { rowId?: unknown; subjectLabel?: unknown; requirement?: unknown };
        if (typeof r?.rowId !== "string" || !ROW_ID.test(r.rowId)) return bad("choose items from the owed list");
        checked.push({ rowId: r.rowId, subjectLabel: text(r.subjectLabel).slice(0, 200), requirement: text(r.requirement).slice(0, 300) });
      }
      return { ok: true, value: { placeKey, rows: checked, why } };
    },
    async execute(deps, context, input: ValidatedInput) {
      const placeKey = String(input.placeKey);
      const rows = input.rows as readonly { rowId: string; subjectLabel: string; requirement: string }[];
      const done = await change(deps, context.at, (record) => withOwedDecline(record, { changeId: context.receiptId, declines: rows.map((r) => ({ ...r, placeKey })), reason: String(input.why), at: context.at, declinedBy: OWNER }));
      if (!done.ok) return refuse(done.says);
      return { ok: true, outcome: "DONE", subject: placeKey, says: `Declined ${rows.length} ${rows.length === 1 ? "item" : "items"}. They are no longer owed there, and the log keeps your reason.`, readBackAt: "/admin?view=checklist", undo: "Undo it from the log and they are owed again." };
    },
  },
  {
    definition: {
      type: "owed.undo",
      label: "Undo a change to what is owed",
      does: "Reverses one earlier addition or decline, so the next read counts it as it was before.",
      doesNot: "Does not touch any other change.",
      authority: "OWNER_DECISION_REQUIRED", subjectKind: "a change to what is owed", requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const id = text(input.undoChangeId);
      return id === "" || id.length > 200 ? bad("choose the change to undo") : { ok: true, value: { undoChangeId: id } };
    },
    async execute(deps, context, input: ValidatedInput) {
      const done = await change(deps, context.at, (record) => withOwedUndo(record, { undoChangeId: String(input.undoChangeId), changeId: context.receiptId, at: context.at }));
      if (!done.ok) return refuse(done.says);
      return { ok: true, outcome: "DONE", subject: String(input.undoChangeId), says: "The change is undone. The next read counts what is owed as it was before.", readBackAt: "/admin?view=checklist", undo: null };
    },
  },
];
