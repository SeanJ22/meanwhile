import { ADMIN_CONFIG_ID, defaultAdminConfig, isAdminConfig, withExpansionScopes, fleetSpendCeilingOverrideUsd } from "./admin-config.ts";
import { resolveRollingCeiling } from "../fleet-safety.ts";
import {
  expansionScopesOf,
  validateScopeBudget,
  validateScopeGeography,
  validateScopeKey,
  validateScopeNote,
  validateScopePriority,
  scopeKeyOf,
  withScopeSet,
  SCOPE_NOTE_MAX_CHARS,
  type ExpansionScopeDecision,
  type ExpansionScopeGeography,
} from "../expansion/scopes.ts";
import { huntPlaceKey } from "../admin-view/v6-hunts-read.ts";
import type { ActionResult, RegisteredAction, Validation } from "./registry.ts";
import { writeFailureSays } from "./write-readback.ts";

/** A hunt is named by its scope key (`zcta:2020/<zip>`) or by its place key (`geo:<state>.zcta.<zip>`). */
const PLACE_KEY = /^(?:geo:[a-z]{2}.[a-z_]+.[0-9A-Za-z]{2,12}|st:[a-z]{2})$/;

/** The most ZIPs one send takes. A bigger list is a file to split, not one click. */
export const BULK_SEND_MAX_ITEMS = 5000;
const ZCTA_VERSION = "zcta:2020";

const bad = (why: string): Validation => ({ ok: false, why });
const refuse = (says: string): ActionResult => ({ ok: false, refusal: "DOWNSTREAM_REFUSED", says });
const money = (usd: number): string => `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface BulkItem {
  readonly geography: ExpansionScopeGeography;
  readonly budgetUsd: number;
  readonly group: string | null;
}

/** The items as the action accepts them; any bad item refuses the whole send with its number. */
function validateItems(raw: unknown): { readonly ok: true; readonly items: readonly BulkItem[] } | { readonly ok: false; readonly why: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, why: "there is nothing in this send" };
  if (raw.length > BULK_SEND_MAX_ITEMS) return { ok: false, why: `one send takes at most ${BULK_SEND_MAX_ITEMS.toLocaleString("en-US")} ZIPs` };
  const seen = new Set<string>();
  const items: BulkItem[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const r = raw[i];
    if (r === null || typeof r !== "object") return { ok: false, why: `item ${i + 1} is not a ZIP or a mission` };
    const o = r as Readonly<Record<string, unknown>>;
    const mission = o.geography !== null && typeof o.geography === "object";
    const zip = typeof o.zip === "string" ? o.zip.trim() : "";
    const geography = mission
      ? validateScopeGeography(o.geography as Readonly<Record<string, unknown>>)
      : validateScopeGeography({ type: "zcta", geoid: zip, version: ZCTA_VERSION, label: `ZIP ${zip} (Census ZCTA)`, stateAbbr: o.stateAbbr });
    const name = mission ? (geography.ok ? geography.value.label : "a mission") : zip || "no ZIP";
    if (!geography.ok) return { ok: false, why: `item ${i + 1} (${name}): ${geography.why}` };
    const identity = scopeKeyOf(geography.value);
    if (seen.has(identity)) return { ok: false, why: `${name} is in the send twice` };
    seen.add(identity);
    const budget = validateScopeBudget(o.budgetUsd);
    if (!budget.ok) return { ok: false, why: `item ${i + 1} (${name}): ${budget.why}` };
    const group = typeof o.group === "string" && o.group.trim() !== "" ? o.group.trim().replace(/\s+/g, " ").slice(0, 120) : null;
    items.push({ geography: geography.value, budgetUsd: budget.value, group });
  }
  return { ok: true, items };
}

export const BULK_ACTIONS: readonly RegisteredAction[] = [
  {
    definition: {
      type: "expansion.scope.setMany",
      label: "Send many hunts",
      does:
        "Records a hunt for each ZIP in the list, each with its own budget for paid work there, in one step, and keeps them across a restart. " +
        "When research is enabled the standing runner wakes promptly, then creates the work the registry defines for each place in its own steady batches until all of it exists.",
      doesNot:
        "Does not open the paid lane, add a government no registry defines, or raise any spending limit. Each budget can only hold paid work back, and the Fleet ceiling still binds first.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "a list of places you want worked",
      // The config row's compare-and-set is the version check, as for every expansion write.
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const items = validateItems(input.items);
      if (!items.ok) return bad(items.why);
      const priority = validateScopePriority(input.priority === undefined ? 1 : input.priority);
      if (!priority.ok) return bad(priority.why);
      const note = validateScopeNote(input.note);
      if (!note.ok) return bad(note.why);
      if (input.huntBudget !== undefined && typeof input.huntBudget !== "boolean") return bad("Choose a budget for each hunt or a rolling budget.");
      return {
        ok: true,
        value: { items: items.items, priority: priority.value, note: note.value, huntBudget: input.huntBudget !== false },
      };
    },
    async execute(deps, context, input) {
      const items = input.items as readonly BulkItem[];
      const at = context.at;
      let created = 0;
      let updated = 0;
      let ceilingUsd: number;
      try {
        const existing = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID);
        const current = existing !== null && isAdminConfig(existing.value) ? existing.value : defaultAdminConfig(at);
        const held = expansionScopesOf(current);
        if (held.malformed > 0) {
          return refuse(
            `${held.malformed} stored scope entr${held.malformed === 1 ? "y" : "ies"} on your policy row could not be read, so nothing was changed — writing over them would silently drop a budget you set.`,
          );
        }
        ceilingUsd = resolveRollingCeiling(fleetSpendCeilingOverrideUsd(current)).rollingCeilingUsd;
        let scopes: readonly ExpansionScopeDecision[] = held.scopes;
        for (const item of items) {
          const note = [input.note === null ? null : String(input.note), item.group].filter((n): n is string => n !== null).join(" · ");
          const next = withScopeSet(scopes, {
            geography: item.geography,
            priority: Number(input.priority),
            budgetUsd: item.budgetUsd,
            huntBudget: input.huntBudget === true,
            newHunt: false,
            note: note === "" ? null : note.slice(0, SCOPE_NOTE_MAX_CHARS),
            questions: [],
            decidedAt: at,
            decidedBy: context.request.actorRef,
            receiptId: context.receiptId,
          });
          if (next.previous === null) created += 1;
          else updated += 1;
          scopes = next.scopes;
        }
        const written = withExpansionScopes(current, { scopes, decidedAt: at });
        await deps.repos.adminConfig.save(existing, written, at);
      } catch (error) {
        return refuse(writeFailureSays("your list of hunts", error));
      }
      const total = items.reduce((sum, i) => sum + Math.round(i.budgetUsd * 100), 0) / 100;
      const groups = new Set(items.map((i) => i.group).filter((g) => g !== null)).size;
      return {
        ok: true,
        outcome: "DONE",
        subject: `${items.length} hunts`,
        says:
          `Recorded ${items.length.toLocaleString("en-US")} hunt${items.length === 1 ? "" : "s"}` +
          (groups > 0 ? ` across ${groups.toLocaleString("en-US")} group${groups === 1 ? "" : "s"}` : "") +
          ` (${created.toLocaleString("en-US")} new, ${updated.toLocaleString("en-US")} already on the list), ${money(total)} of paid-work budget in all. ` +
          "Recording them makes no model call. If research is enabled, the runner wakes promptly and creates the work the registry defines for each place in steady batches until it all exists; " +
          `Work that needs a model waits: the paid lane stays as it is and the Fleet ceiling of ${money(ceilingUsd)} still binds first.`,
        openedWork: [],
        readBackAt: "/admin/work",
        undo: "Stop each hunt from its own card, or send the list again with different budgets.",
      };
    },
  },

  {
    definition: {
      type: "expansion.scope.budget",
      label: "Change a hunt's budget",
      does:
        "Sets a new budget for one hunt that is already on your list, pauses its paid work ($0 holds it), or resumes it at the budget it had before the pause. The hunt keeps its place, its notes and its accounting start.",
      doesNot: "Does not stop free plain-code work, cancel calls already running, or change the Fleet ceiling.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "one hunt's budget",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const placeKey = typeof input.placeKey === "string" ? input.placeKey.trim() : "";
      const key = placeKey !== "" ? (PLACE_KEY.test(placeKey) ? { ok: true as const, value: placeKey } : { ok: false as const, why: "say which hunt, by its place" }) : validateScopeKey(input.key);
      if (!key.ok) return bad(key.why);
      const change = typeof input.change === "string" ? input.change : "";
      if (change !== "set" && change !== "pause" && change !== "resume") return bad("say whether to set a new budget, pause or resume");
      if (change !== "set") return { ok: true, value: { key: key.value, change } };
      const budget = validateScopeBudget(input.budgetUsd);
      return budget.ok ? { ok: true, value: { key: key.value, change, budgetUsd: budget.value } } : bad(budget.why);
    },
    async execute(deps, context, input) {
      const key = String(input.key);
      const change = String(input.change);
      const at = context.at;
      let from = 0;
      let to = 0;
      let label = key;
      let savedKey = key;
      try {
        const existing = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID);
        const current = existing !== null && isAdminConfig(existing.value) ? existing.value : null;
        if (existing === null || current === null) return refuse("There is no list of hunts yet, so there is nothing to change.");
        const held = expansionScopesOf(current);
        if (held.malformed > 0) {
          return refuse(`${held.malformed} stored scope entr${held.malformed === 1 ? "y" : "ies"} could not be read, so nothing was changed.`);
        }
        const scope = held.scopes.find((s) => s.key === key || huntPlaceKey(s) === key);
        if (scope === undefined) return refuse("That hunt is not on your list, so nothing was changed.");
        label = scope.geography.label;
        savedKey = scope.key;
        from = scope.budgetUsd;
        if (change === "pause") to = 0;
        else if (change === "set") to = Number(input.budgetUsd);
        else {
          const before = scope.previous?.budgetUsd ?? 0;
          if (scope.budgetUsd > 0 || before <= 0) {
            return refuse(`${label} is not paused at $0 with an earlier budget on record, so there is nothing to resume. Set a budget instead.`);
          }
          to = before;
        }
        const next = withScopeSet(held.scopes, {
          geography: scope.geography,
          priority: scope.priority,
          budgetUsd: to,
          huntBudget: scope.budgetStartedAt !== undefined,
          newHunt: false,
          note: scope.note,
          questions: scope.questions ?? [],
          decidedAt: at,
          decidedBy: context.request.actorRef,
          receiptId: context.receiptId,
        });
        await deps.repos.adminConfig.save(existing, withExpansionScopes(current, { scopes: next.scopes, decidedAt: at }), at);
      } catch (error) {
        return refuse(writeFailureSays("the change to your hunt", error));
      }
      const words =
        change === "pause"
          ? `Paid work for ${label} is paused: its budget is now $0.00 (was ${money(from)}). Free plain-code work continues and calls already running finish.`
          : change === "resume"
            ? `Paid work for ${label} is resumed at ${money(to)}.`
            : `${label}'s budget is now ${money(to)} (was ${money(from)}). What was already spent stays spent.`;
      return {
        ok: true,
        outcome: "DONE",
        subject: savedKey,
        says: `${words} The runner reads it when its next round starts.`,
        openedWork: [],
        readBackAt: "/admin/work",
        undo: change === "pause" ? "Resume it." : `Set it back to ${money(from)}.`,
      };
    },
  },
];

