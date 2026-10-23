import { readerFactDb } from "../../facts/db.ts";
import { FLAG_CHOICES, raiseOwnerFlag, resolveOwnerFlag, type FlagChoice } from "../../facts/owner-flags.ts";
import { prepareProductionCivicDataWrite } from "../../civic-data/production-write.ts";
import { appendResearchIntent, buildResearchIntent } from "../research-view.ts";
import type { RegisteredAction } from "./registry.ts";
import { recordAuditCorrection } from "../live-audit-log.ts";

export const auditFlagAction: RegisteredAction = {
  definition: { type: "fact.flag.answer", label: "Answer a published fact flag", does: "Applies your choice to the published fact.",
    doesNot: "Changes no spending limit.", authority: "OWNER_DECISION_REQUIRED", subjectKind: "a flagged published fact", requiresStateVersion: false,
    refusals: ["INVALID_INPUT", "STALE_STATE", "DOWNSTREAM_REFUSED"] },
  validate(input) {
    const id = Number(input.id);
    if (!Number.isSafeInteger(id) || id <= 0 || !FLAG_CHOICES.includes(input.choice as FlagChoice)) return { ok: false, why: "Choose a flag and one of its four answers." };
    let values: unknown = input.values;
    if (typeof values === "string") { try { values = JSON.parse(values); } catch { return { ok: false, why: "Enter the right value." }; } }
    if (input.choice === "TYPED_VALUE" && (!values || typeof values !== "object" || Array.isArray(values))) return { ok: false, why: "Enter the right value." };
    const sourceUrl = typeof input.sourceUrl === "string" ? input.sourceUrl.trim() : "";
    if (sourceUrl && (!URL.canParse(sourceUrl) || !/^https?:\/\//i.test(sourceUrl))) return { ok: false, why: "Use a complete public source link, or leave it empty." };
    return { ok: true, value: { id,choice: input.choice,values,sourceUrl: sourceUrl || null } };
  },
  async execute(deps, context, input) {
    try {
      const db = readerFactDb(prepareProductionCivicDataWrite().connection);
      if (input.choice === "SEND_FLEET") {
        const [flag] = await db.query(`SELECT o.reason,o.reader_id,o.observed_value,f.entity_id,f.field FROM owner_flag o
          LEFT JOIN fact f ON f.id=o.fact_id WHERE o.id=$1 AND o.resolved IS NULL`, [input.id]);
        if (!flag) return { ok: false,refusal: "STALE_STATE",says: "This flag has already been answered. Refresh the list." };
        const value = flag.observed_value as Record<string,unknown> | null;
        const note = `Find the correct published value for ${flag.entity_id ?? value?.bodyId ?? flag.reader_id}, ${flag.field ?? "public information"}. ${flag.reason ?? "Check its source."}`;
        const sent = await appendResearchIntent(deps.repos,buildResearchIntent("DISPATCH",context.at,context.receiptId,note),context.at);
        if (!sent.ok) return { ok: false,refusal: "DOWNSTREAM_REFUSED",says: "The fleet instruction could not be saved. The flag remains open." };
      }
      const changed = await resolveOwnerFlag(db,{id: Number(input.id),choice: input.choice as FlagChoice,
        values: input.values as Record<string,unknown> | undefined,sourceUrl: input.sourceUrl as string | null},context.at);
      if (input.choice === "REMOVE" || input.choice === "TYPED_VALUE") await recordAuditCorrection(deps.repos,{
        factId:changed.factId === null ? `${changed.family}:${changed.readerId}` : `fact-store:${changed.factId}`,
        action:input.choice === "REMOVE" ? "PULLED" : "FIXED",at:context.at,
        summary:input.choice === "REMOVE" ? "Sean removed the published value." : "Sean entered the right value."});
      return { ok: true,outcome: input.choice === "SEND_FLEET" ? "QUEUED" : "DONE",subject: String(input.id),
        says: input.choice === "REMOVE" ? "You removed the published fact." : input.choice === "KEEP" ? "You kept the published fact." :
          input.choice === "SEND_FLEET" ? "The fleet will investigate the flagged value." : "Your correction is published.",
        openedWork: [],readBackAt: "/admin?view=queue",undo: null };
    } catch {
      return { ok: false,refusal: "DOWNSTREAM_REFUSED",says: "The answer could not be applied. Refresh the flag before trying again." };
    }
  },
};

export const auditFlagRaiseAction: RegisteredAction = {
  definition: { type: "fact.flag.raise", label: "Flag a published fact", does: "Puts the published fact in your flags to answer.",
    doesNot: "Removes nothing until you choose Remove it.", authority: "OWNER_DECISION_REQUIRED", subjectKind: "a published fact", requiresStateVersion: false,
    refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"] },
  validate(input) {
    const factId = Number(input.factId);
    return Number.isSafeInteger(factId) && factId > 0 ? { ok: true, value: { factId } } : { ok: false, why: "Choose a published fact to flag." };
  },
  async execute(_deps, _context, input) {
    try {
      const { created } = await raiseOwnerFlag(readerFactDb(prepareProductionCivicDataWrite().connection).query, Number(input.factId));
      return { ok: true, outcome: "DONE", subject: String(input.factId),
        says: created ? "Flagged. It is in your flags below." : "That fact is already flagged, or is no longer published.", openedWork: [], readBackAt: "/admin?view=queue", undo: null };
    } catch {
      return { ok: false, refusal: "DOWNSTREAM_REFUSED", says: "The flag could not be saved. Try again." };
    }
  },
};
