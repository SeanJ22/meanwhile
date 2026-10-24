import { requestHuntStop } from "../hunt-orders.ts";
import { REGISTRY_STATES, stateBallotContractId } from "../../civic-data/state-scopes.ts";
import "../../ask/model.ts";
import "../../hunt/settings.ts";
import "../../design/copy-settings.ts";
import "../../facts/clocks.ts";
import { requestRoutineDue } from "../../civic-data/routine-due-request.ts";
import { playbookUpdateAction } from "./playbook-action.ts";
import { auditFlagAction, auditFlagRaiseAction } from "./audit-flag-action.ts";
import { officialsCheckAction } from "./officials-action.ts";
import { appendDecisionIntent, RUNNER_ID, SNAPSHOT_ID } from "../admin-data.ts";
import { fixConsequence, fixSubjectId, parseFixField, WHERE_SEPARATOR } from "../fix-queue.ts";
import { addFixItem, completeFixItem, fixItems, fixDispatchNote, recordFixDispatch } from "../fix-list.ts";
import { addUpdate } from "../updates.ts";
import { OWED_ACTIONS } from "./owed-actions.ts";
import { parseWhen, scheduledOrders, withScheduled, withoutScheduled, type ScheduledOrder } from "./scheduled-orders.ts";
import {
  ANSWERED_IN_OWN_WORDS,
  OWNER_ANSWER_MAX_CHARS,
  OWNER_SURFACE_FORMAT_VERSION,
  type OwnerDecisionIntent,
} from "../owner-surface.ts";
import {
  appendResearchIntent,
  buildResearchIntent,
  validateIntentNote,
} from "../research-view.ts";
import { RESEARCH_STATE_ID } from "../scheduler/research-policy.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { WakeHintWriter } from "./wake-hint.ts";
import {
  ADMIN_CONFIG_ID,
  defaultAdminConfig,
  fleetSpendCeilingOverrideUsd,
  isAdminConfig,
  withBillingFacts,
  withDiscoverySearch,
  withExpansionScopes,
  withFleetSpendCeiling,
  withPlaceTarget,
  placeTargetOf,
  withDataSwitch,
  dataSwitchOf,
  PLACE_TARGET_KEY,
} from "./admin-config.ts";
import { RECIPES } from "../data-business/recipes.ts";
import { defaultOn } from "../data-business/switches.ts";
import { audienceWords, isAudience } from "../data-business/types.ts";
import {
  billingFactId,
  billingFactsOf,
  factAmountWords,
  factPeriodWords,
  providerDefinition,
  validateBillingFact,
  withFactRecorded,
  withFactRemoved,
  type BillingFact,
} from "../billing-facts.ts";
import { FLEET_SPEND_CEILING_MAX_USD, resolveRollingCeiling } from "../fleet-safety.ts";
import {
  SCOPE_TYPE_WORDS,
  expansionScopesOf,
  scopeKeyOf,
  validateScopeBudget,
  validateScopeGeography,
  validateScopeKey,
  validateScopeNote,
  validateScopePriority,
  withScopeSet,
  type ExpansionScopeGeography,
} from "../expansion/scopes.ts";
import { ORIGINAL_LIFETIME_HUNT } from "../scheduler/hunt-continuation.ts";
import { WORK_QUESTION_WORDS, validateWorkQuestions, type WorkQuestion } from "../work-question.ts";
import { huntPlaceKey } from "../admin-view/v6-hunts-read.ts";
import { BULK_ACTIONS } from "./bulk-actions.ts";
import { LEAD_ACTIONS } from "../leads/actions.ts";
import { DOOR_ACTIONS } from "../../doors/actions.ts";
import { appendFailureSays, writeFailureSays } from "./write-readback.ts";
import { settingDefinition, settingUndo, settingValueWords, SPEND_CEILING_LOG_KEY, withLoggedChange, withSetting, type SettingValue } from "../settings.ts";
import { publishReaderSettings } from "../../civic-data/reader-settings-publication.ts";
import type { ActionDefinition, ActionRequest, ReceiptOutcome, RefusalCode } from "./contract.ts";

const CREATION_SCOPE = "all missing work for the requested geography";

export interface GatewayDeps {
  readonly repos: ControlPlaneRepositories;

  readonly now: () => string;
  readonly currentStateVersion: string | null;
  readonly codeSha: string | null;

  readonly wake?: WakeHintWriter | null;
  readonly readPlaceScore?: import("./hunt-score.ts").PlaceScoreReader;
}

export interface ActionEffect {
  readonly ok: true;

  readonly outcome: Exclude<ReceiptOutcome, "REFUSED">;
  readonly says: string;
  readonly subject?: string;
  readonly openedWork?: readonly { readonly kind: string; readonly id: string; readonly title: string }[];
  readonly readBackAt?: string | null;
  readonly undo?: string | null;
  readonly change?: { readonly before: string; readonly after: string };
}

export interface ActionRefusal {
  readonly ok: false;
  readonly refusal: RefusalCode;

  readonly says: string;
  readonly subject?: string;
}

export type ActionResult = ActionEffect | ActionRefusal;

export type ValidatedInput = Readonly<Record<string, unknown>>;

export type Validation =
  | { readonly ok: true; readonly value: ValidatedInput }
  | { readonly ok: false; readonly why: string };

export interface ActionContext {
  readonly request: ActionRequest;
  readonly receiptId: string;
  readonly at: string;
}

export interface RegisteredAction {
  readonly definition: ActionDefinition;

  readonly validate: (input: Readonly<Record<string, unknown>>) => Validation;
  readonly execute: (
    deps: GatewayDeps,
    context: ActionContext,
    input: ValidatedInput,
  ) => Promise<ActionResult>;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const collapse = (value: unknown): string => text(value).replace(/\s+/g, " ");
const bad = (why: string): Validation => ({ ok: false, why });
const refuse = (refusal: RefusalCode, says: string): ActionRefusal => ({ ok: false, refusal, says });

function storeRefusal(what: string, error: unknown): ActionRefusal {
  return refuse("DOWNSTREAM_REFUSED", writeFailureSays(what, error));
}

function decisionIntent(input: {
  readonly subjectId: string;
  readonly chosenOption: string;
  readonly consequenceShown: string;
  readonly ownerAnswer: string | null;
  readonly decidedAt: string;
  readonly actorRef: string;
}): OwnerDecisionIntent {
  return {
    formatVersion: OWNER_SURFACE_FORMAT_VERSION,

    intentId: `${input.subjectId}:${input.decidedAt}`,
    subjectId: input.subjectId,
    chosenOption: input.chosenOption,
    consequenceShown: input.consequenceShown,
    decidedAt: input.decidedAt,
    state: "RECORDED",
    canonicalRef: null,
    refusedReason: null,
    adminSessionRef: input.actorRef,
    ownerAnswer: input.ownerAnswer,
  };
}

async function appendIntent(
  deps: GatewayDeps,
  context: ActionContext,
  action: "PAUSE" | "RESUME" | "PAUSE_RUNNER" | "RESUME_RUNNER" | "RUN_CYCLE_NOW" | "DISPATCH" | "CANCEL_DISPATCH",
  note: string | null,
  said: { readonly says: string; readonly undo: string | null },

  budgetUsd: number | null = null,
): Promise<ActionResult> {
  const requestedAt = context.at;
  const intent = buildResearchIntent(action, requestedAt, context.request.actorRef, note, undefined, budgetUsd);
  const wrote = await appendResearchIntent(deps.repos, intent, requestedAt);
  if (!wrote.ok) return refuse("DOWNSTREAM_REFUSED", appendFailureSays(wrote.detail));
  return {
    ok: true,
    outcome: "QUEUED",
    says: said.says,
    subject: intent.intentId,
    openedWork: [],
    readBackAt: "/admin/research",
    undo: said.undo,
  };
}

const READBACK_SUBJECTS: Readonly<Record<string, { readonly name: string; readonly readBackAt: string }>> = {
  "control-centre": { name: "the control centre snapshot", readBackAt: "/admin" },
  runner: { name: "the runner's heartbeat", readBackAt: "/admin" },
  research: { name: "the research lane's state", readBackAt: "/admin/research" },
};

const REGISTRY: readonly RegisteredAction[] = [
  playbookUpdateAction,
  {
    definition: {
      type: "ballot.publish", label: "Publish ballots",
      does: "Asks the runner to publish each reviewed state ballot independently.",
      doesNot: "Keeps spending limits and pauses as they are.",
      authority: "OWNER_DECISION_REQUIRED", subjectKind: "national ballots", requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      return Object.keys(input).length ? bad("publish ballots takes no additional fields") : { ok: true, value: {} };
    },
    async execute(deps, context) {
      try {
        const requests = [];
        for (const state of REGISTRY_STATES) requests.push(await requestRoutineDue(deps.repos,
          [`--contract=${stateBallotContractId("ballot-contests", state)}`, "--reason=Publish ballots requested from Admin"], context.at));
        return { ok: true, outcome: "QUEUED", subject: requests[0].id,
          says: "Ballot publication is queued for the runner’s next pass. Each state’s publication result appears in Workers.",
          readBackAt: "/admin?view=workers", undo: null };
      } catch (error) { return storeRefusal("ballot publication", error); }
    },
  },
  {
    definition: {
      type: "config.setSetting", label: "Change a setting",
      does: "Saves the new value with when it changed, its previous value and an optional note, so it can be undone.",
      doesNot: "Leaves spending limits and pauses as they are.",
      authority: "OWNER_DECISION_REQUIRED", subjectKind: "a setting", requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const key = text(input.key);
      const definition = settingDefinition(key);
      const why = input.why === undefined || input.why === null ? "" : collapse(input.why);
      if (!definition) return bad("choose a registered setting");
      if (why.length > 2000) return bad("keep the note to 2,000 characters");
      if (input.undoOf !== undefined && (typeof input.undoOf !== "string" || !input.undoOf)) return bad("choose the change to undo");
      if (!definition.validate(input.value)) return bad(`choose a valid value for ${definition.label.toLowerCase()}`);
      return { ok: true, value: { key, value: input.value, why, ...(input.undoOf ? { undoOf: input.undoOf } : {}) } };
    },
    async execute(deps, context, input) {
      const key = String(input.key);
      const definition = settingDefinition(key)!;
      let next: import("./admin-config.ts").AdminConfig;
      let revision: number;
      try {
        const held = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID, { settingHistory: { where: { path: ["key"], value: key }, limit: 1, includeIds: [context.receiptId] } });
        const current = held && isAdminConfig(held.value) ? held.value : defaultAdminConfig(context.at);
        if (input.undoOf) {
          const undo = settingUndo(current, String(input.undoOf));
          if (!undo || undo.key !== key || JSON.stringify(undo.value) !== JSON.stringify(input.value)) return refuse("INVALID_INPUT", "This setting has changed again. Refresh its history before undoing it.");
        }
        next = withSetting(current, { id: context.receiptId, key, after: input.value as SettingValue,
          at: context.at, why: String(input.why), ...(input.undoOf ? { undoOf: String(input.undoOf) } : {}) });
        const written = await deps.repos.adminConfig.save(held, next, context.at);
        revision = written.revision;
      } catch (error) { return storeRefusal("your setting", error); }
      let published = true;
      if (definition.readerFacing) {
        try { published = await publishReaderSettings(next, revision); } catch { published = false; }
      }
      const words = settingValueWords(input.value as SettingValue, definition.unit, definition.choices);
      const beforeValue = (next.settingHistory ?? []).find((h) => h.id === context.receiptId)?.before;
      return { ok: true, outcome: published ? "DONE" : "QUEUED", subject: key,
        ...(beforeValue !== undefined ? { change: { before: settingValueWords(beforeValue as SettingValue, definition.unit, definition.choices), after: words } } : {}),
        says: published ? `${definition.label} is now ${words}.` : `${definition.label} is saved as ${words}; readers get it on the next publish.`,
        readBackAt: "/admin?view=settings", undo: null };
    },
  },
  {
    definition: {
      type: "queue.add",
      label: "Add this to the queue",
      does: "Adds a repair for the team and sends agents to a missing fact in a named place.",
      doesNot: "Keeps existing spending limits in force.",
      authority: "REVERSIBLE_NONPRODUCTION",
      subjectKind: "a gap you saw on a page",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const combined = text(input.fix);
      if (combined !== "") {
        const parsed = parseFixField(combined);
        if (parsed === null) return bad("the gap needs some words describing what the page said");
        return { ok: true, value: { subjectId: parsed.subjectId, consequenceShown: parsed.consequenceShown, kind: input.kind, place: input.place } };
      }
      const says = collapse(input.says);
      if (says === "") return bad("the gap needs some words describing what the page said");
      const where = collapse(input.where) || "the control centre";
      return {
        ok: true,
        value: { subjectId: fixSubjectId(where, says), consequenceShown: fixConsequence(where, says), kind: input.kind, place: input.place },
      };
    },
    async execute(deps, context, input) {
      const subjectId = String(input.subjectId);
      const consequence = String(input.consequenceShown);
      const at = consequence.indexOf(WHERE_SEPARATOR);
      let agentsSent = false;
      try {
        await addFixItem(deps.repos, {
          where: at < 0 ? "the control centre" : consequence.slice(0, at),
          says: at < 0 ? consequence : consequence.slice(at + WHERE_SEPARATOR.length),
          by: "owner", at: context.at,
        });
        const held = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID, { fixList: { ids: [subjectId] } });
        const item = held && isAdminConfig(held.value) ? fixItems(held.value).find(i => i.id === subjectId) : undefined;
        const where = at < 0 ? "the control centre" : consequence.slice(0, at);
        const says = at < 0 ? consequence : consequence.slice(at + WHERE_SEPARATOR.length);
        const note = fixDispatchNote(where, says, input.kind, input.place);
        if (note && item && item.state !== "FIXED") {
          if (!item.dispatch) {
            const action = lookupAction("fleet.deployHere")!;
            const checked = action.validate({ note });
            if (!checked.ok) return refuse("INVALID_INPUT", checked.why);
            const dispatchedAt = item.cameBackAt ?? item.addedAt;
            const sent = await action.execute(deps, { ...context, at: dispatchedAt }, checked.value);
            if (!sent.ok) return sent;
            await recordFixDispatch(deps.repos, subjectId, { intentId: sent.subject!, note, at: dispatchedAt });
          }
          agentsSent = true;
        }
      } catch (error) { return storeRefusal("the fix list", error); }
      return {
        ok: true,
        outcome: "QUEUED",
        subject: subjectId,
        says: agentsSent ? "Agents sent to the missing information." : "It is on the team’s fix list as Open.",
        openedWork: [],
        readBackAt: "/admin",
        undo: agentsSent ? "Take back the send from the queue." : null,
      };
    },
  },

  {
    definition: {
      type: "fix.complete",
      label: "Mark a fix done",
      does: "Records what broke, what changed, who or what changed it, and the before and after, so the fix list shows it as fixed.",
      doesNot: "Does not change anything itself.",
      authority: "REVERSIBLE_NONPRODUCTION",
      subjectKind: "an item on the fix list",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const id = text(input.id);
      const whatChanged = collapse(input.whatChanged);
      const changedBy = collapse(input.changedBy);
      const before = collapse(input.before);
      const after = collapse(input.after);
      if (!id.startsWith("fix:")) return bad("choose an item on the fix list");
      if (!whatChanged || !changedBy || !before || !after) return bad("say what changed, who changed it, and the before and after");
      let undo: { type: string; input: Record<string, unknown> } | null = null;
      if (input.undo !== undefined && input.undo !== null) {
        const u = input.undo as { type?: unknown; input?: unknown };
        if (typeof u.type !== "string" || !u.type || typeof u.input !== "object" || u.input === null) return bad("the undo needs an action and its input");
        undo = { type: u.type, input: u.input as Record<string, unknown> };
      }
      const label = input.label === "PROVEN" || input.label === "TESTING" ? input.label : undefined;
      return { ok: true, value: { id, whatChanged, changedBy, before, after, undo, ...(label ? { label } : {}) } };
    },
    async execute(deps, context, input) {
      const id = String(input.id);
      try {
        const held = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID, { fixList: { ids: [id] } });
        const config = held && isAdminConfig(held.value) ? held.value : null;
        if (!config || !fixItems(config).some((i) => i.id === id)) return refuse("INVALID_INPUT", "That item is not on the fix list.");
        await completeFixItem(deps.repos, id, {
          whatChanged: String(input.whatChanged), changedBy: String(input.changedBy),
          before: String(input.before), after: String(input.after),
          undo: input.undo as { type: string; input: Record<string, unknown> } | null,
        }, context.at);
      } catch (error) { return storeRefusal("the fix list", error); }
      try {
        await addUpdate(deps.repos, { id: `fix:${id}:${context.at}`, what: `Fixed: ${String(input.whatChanged)}`, at: context.at,
          label: input.label === "PROVEN" ? "PROVEN" : "TESTING", evidenceHref: `/admin?view=queue`,
          before: String(input.before), after: String(input.after) });
      } catch (error) { return storeRefusal("the updates feed", error); }
      return { ok: true, outcome: "DONE", subject: id, says: "It is on the fix list as Fixed and checked, with its before and after.",
        openedWork: [], readBackAt: "/admin?view=queue", undo: null };
    },
  },

  {
    definition: {
      type: "orders.schedule",
      label: "Schedule an order",
      does: "Saves an order to be sent later: at a time, after another order, repeating, or by a date.",
      doesNot: "Does not send the order now, and does not change its limits.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "an order to send later",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const orderType = text(input.orderType);
      const target = lookupAction(orderType);
      if (!target || orderType.startsWith("orders.") || target.definition.authority === "PROHIBITED") return bad("choose an order that can be sent");
      if (target.definition.requiresStateVersion) return bad("this order depends on what the screen showed, so it can only be sent now");
      const when = parseWhen(input);
      if (!when.ok) return bad(when.why);
      const inner = (typeof input.input === "object" && input.input !== null ? input.input : {}) as Record<string, unknown>;
      const checked = target.validate(inner);
      if (!checked.ok) return bad(checked.why);
      return { ok: true, value: { orderType, orderSubject:text(input.subject), orderInput: inner, ...when.value } };
    },
    async execute(deps, context, input) {
      const target = lookupAction(String(input.orderType))!;
      const order: ScheduledOrder = {
        id: context.receiptId, orderType: String(input.orderType), subject:String(input.orderSubject), input: input.orderInput as Record<string, unknown>,
        startAt: input.startAt as string | null, after: input.after as string | null, repeat: input.repeat as ScheduledOrder["repeat"],
        finishBy: input.finishBy as string | null, decidedBy: context.request.actorRef, decidedAt: context.at, receiptId: context.receiptId,
        label: target.definition.label,
      };
      try {
        for (let attempt = 0; ; attempt++) {
          const held = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID);
          const current = held && isAdminConfig(held.value) ? held.value : defaultAdminConfig(context.at);
          const next = withScheduled(current, order);
          if (next === current) break;
          try {
            await deps.repos.adminConfig.save(held, next, context.at);
            break;
          } catch (error) { if (attempt >= 1) throw error; }
        }
      } catch (error) { return storeRefusal("your scheduled order", error); }
      return { ok: true, outcome: "DONE", subject: order.id, says: `${order.label} is scheduled.`, openedWork: [],
        readBackAt: "/admin?view=queue", undo: "Unschedule it and it will not be sent." };
    },
  },
  {
    definition: {
      type: "orders.unschedule",
      label: "Unschedule an order",
      does: "Removes an order that was saved to be sent later, so it is never sent.",
      doesNot: "Does not undo anything an earlier run of it already did.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "a scheduled order",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const id = text(input.id);
      return id ? { ok: true, value: { id } } : bad("choose a scheduled order");
    },
    async execute(deps, context, input) {
      const id = String(input.id);
      try {
        for (let attempt = 0; ; attempt++) {
          const held = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID);
          const current = held && isAdminConfig(held.value) ? held.value : null;
          if (!held || !current || !scheduledOrders(current).some((o) => o.id === id)) return refuse("INVALID_INPUT", "That order is not scheduled any more.");
          try { await deps.repos.adminConfig.save(held, withoutScheduled(current, id, context.at), context.at); break; }
          catch (error) { if (attempt >= 1) throw error; }
        }
      } catch (error) { return storeRefusal("your scheduled order", error); }
      return { ok: true, outcome: "DONE", subject: id, says: "It is unscheduled and will not be sent.", openedWork: [], readBackAt: "/admin?view=queue", undo: null };
    },
  },

  {
    definition: {
      type: "decision.record",
      label: "Record your decision",
      does: "Records what you decided about this row, with the words you were shown when you decided it.",
      doesNot: "Does not change a ruling or any generated file.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "a row waiting on you",

      requiresStateVersion: true,
      refusals: ["INVALID_INPUT", "STALE_STATE", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const subjectId = text(input.subjectId);
      const chosenOption = collapse(input.chosenOption);
      const answer = typeof input.ownerAnswer === "string" ? input.ownerAnswer.replace(/\r\n/g, "\n").trim() : "";
      if (answer.length > OWNER_ANSWER_MAX_CHARS) {
        return bad(`your answer is longer than ${OWNER_ANSWER_MAX_CHARS} characters`);
      }
      if (chosenOption === "" && answer === "") return bad("pick an option or write an answer");
      return {
        ok: true,
        value: {
          subjectId,
          chosenOption: chosenOption === "" ? ANSWERED_IN_OWN_WORDS : chosenOption,
          consequenceShown: collapse(input.consequenceShown),
          ownerAnswer: answer === "" ? null : answer,
        },
      };
    },
    async execute(deps, context, input) {

      const subjectId = String(input.subjectId) || context.request.subject.trim();
      if (subjectId === "") return refuse("INVALID_INPUT", "The decision did not say which row it was about, so nothing was recorded.");
      const intent = decisionIntent({
        subjectId,
        chosenOption: String(input.chosenOption),
        consequenceShown: String(input.consequenceShown),
        ownerAnswer: input.ownerAnswer === null ? null : String(input.ownerAnswer),
        decidedAt: context.at,
        actorRef: context.request.actorRef,
      });
      const wrote = await appendDecisionIntent(deps.repos, intent, context.at);
      if (!wrote.ok) return refuse("DOWNSTREAM_REFUSED", appendFailureSays(wrote.detail));
      return {
        ok: true,
        outcome: "DONE",
        subject: subjectId,
        says: "Your decision is recorded and stands now.",
        openedWork: [],
        readBackAt: "/admin",
        undo: "Record a different decision on the same row; the later one stands and neither is deleted.",
      };
    },
  },

  {
    definition: {
      type: "research.pause",
      label: "Pause paid research",
      does: "Records a pause for the paid research lane on the runner's next read.",
      doesNot: "Does not stop the runner, cancel work already in flight, or pause plain-code work.",
      authority: "REVERSIBLE_NONPRODUCTION",
      subjectKind: "the paid research lane",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const note = validateIntentNote("PAUSE", input.note);
      return note.ok ? { ok: true, value: { note: note.note } } : bad(note.detail);
    },
    execute(deps, context, input) {
      return appendIntent(deps, context, "PAUSE", input.note === null ? null : String(input.note), {
        says: "The paid research lane has been asked to pause. New paid work waits when the runner next reads this intent; work already in flight may finish.",
        undo: "A separate paid-research resume intent is required to resume paid work.",
      });
    },
  },

  {
    definition: {
      type: "research.resume",
      label: "Resume paid research",
      does: "Records that the paid research lane may run again, on the runner's next read.",
      doesNot: "Does not start a round immediately, raise any spending limit, or resume a runner that is paused as a whole.",
      authority: "REVERSIBLE_NONPRODUCTION",
      subjectKind: "the paid research lane",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const note = validateIntentNote("RESUME", input.note);
      return note.ok ? { ok: true, value: { note: note.note } } : bad(note.detail);
    },
    execute(deps, context, input) {
      return appendIntent(deps, context, "RESUME", input.note === null ? null : String(input.note), {
        says: "The paid research lane has been asked to run again. The next round opens the lane, inside every spending limit that still stands.",
        undo: "Pause paid research again.",
      });
    },
  },

  {
    definition: {
      type: "runner.pause",
      label: "Pause the runner",
      does: "Tells the standing runner to stop starting new cycles.",
      doesNot: "Does not stop work already running, and does not touch the machine.",
      authority: "REVERSIBLE_NONPRODUCTION",
      subjectKind: "the standing runner",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const note = validateIntentNote("PAUSE_RUNNER", input.note);
      return note.ok ? { ok: true, value: { note: note.note } } : bad(note.detail);
    },
    execute(deps, context, input) {
      return appendIntent(deps, context, "PAUSE_RUNNER", input.note === null ? null : String(input.note), {
        says: "The runner has been asked to pause. It stops at the end of the cycle it is in, and the page says when it has.",
        undo: "Resume the runner.",
      });
    },
  },

  {
    definition: {
      type: "runner.resume",
      label: "Resume the runner",
      does: "Tells the standing runner it may start cycles again.",
      doesNot: "Does not start a cycle immediately, and does not touch the machine.",
      authority: "REVERSIBLE_NONPRODUCTION",
      subjectKind: "the standing runner",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const note = validateIntentNote("RESUME_RUNNER", input.note);
      return note.ok ? { ok: true, value: { note: note.note } } : bad(note.detail);
    },
    execute(deps, context, input) {
      return appendIntent(deps, context, "RESUME_RUNNER", input.note === null ? null : String(input.note), {
        says: "The runner has been asked to resume. It picks that up on its next look, and the page says when it has.",
        undo: "Pause the runner.",
      });
    },
  },

  {
    definition: {
      type: "runner.runCycleNow",
      label: "Run a cycle now",
      does: "Asks the runner to end its wait and start the next cycle early.",
      doesNot: "Does not add work, change what the cycle does, or override a pause.",
      authority: "REVERSIBLE_NONPRODUCTION",
      subjectKind: "the standing runner",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const note = validateIntentNote("RUN_CYCLE_NOW", input.note);
      return note.ok ? { ok: true, value: { note: note.note } } : bad(note.detail);
    },
    execute(deps, context) {
      return appendIntent(deps, context, "RUN_CYCLE_NOW", null, {
        says: "The runner has been asked to start the next cycle early. It is waiting to be picked up, and the page says when it has been.",
        undo: "Nothing to undo — a cycle that has started runs to its end.",
      });
    },
  },

  {
    definition: {
      type: "fleet.deployHere",
      label: "Deploy fleet here",
      does:
        "Tells the fleet where to go next, in your words. Where your words name a state, the runner also creates the work " +
        "that state's registry defines and no clock carries yet.",
      doesNot:
        `Does not start paid research, publish anything, or invent work no registry defines, and it creates ${CREATION_SCOPE}. ` +
        "Without a state in your words it only reorders the work the fleet already has.",
      authority: "REVERSIBLE_NONPRODUCTION",
      subjectKind: "where you want the fleet to work",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {

      const note = validateIntentNote("DISPATCH", input.note);
      if (!note.ok || note.note === null) return bad(note.ok ? "say what the fleet should go do" : note.detail);

      if (input.budgetUsd === undefined || input.budgetUsd === null || input.budgetUsd === "") return { ok: true, value: { note: note.note } };
      const budget = validateScopeBudget(input.budgetUsd);
      return budget.ok ? { ok: true, value: { note: note.note, budgetUsd: budget.value } } : bad(budget.why);
    },
    execute(deps, context, input) {
      const budgetUsd = typeof input.budgetUsd === "number" ? input.budgetUsd : null;
      return appendIntent(
        deps,
        context,
        "DISPATCH",
        String(input.note),
        {
          says:
            "The fleet has been told where to go. The next cycle puts what matches first and records what it matched — including nothing, by name, if nothing is registered there. " +
            `Where your words name a state, it also creates the work that state's registry defines and no clock carries yet (${CREATION_SCOPE}), ` +
            "and its acknowledgement counts what it created, what it reordered and what missing data blocked. Work that needs a model waits for the paid lane." +
            (budgetUsd === null
              ? " It carries no budget of its own, so only the Fleet ceiling bounds paid work on it."
              : ` Paid work on what it reaches may spend $${budgetUsd.toFixed(2)} in any rolling 24 hours; the runner holds it back there once that is spent, and the Fleet ceiling still binds first.`),
          undo: "Send it somewhere else; the later instruction is the one the next cycle reads.",
        },
        budgetUsd,
      );
    },
  },

  {
    definition: {
      type: "fleet.cancelDispatch",
      label: "Take back a sent instruction",
      does: "Asks the runner to stop carrying one instruction you sent with Deploy fleet here. The runner records when it has.",
      doesNot: "Does not undo work the instruction already created or reordered, and does not pause anything else.",
      authority: "REVERSIBLE_NONPRODUCTION",
      subjectKind: "an instruction you sent to the fleet",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const note = validateIntentNote("CANCEL_DISPATCH", input.intentId);
      return note.ok && note.note !== null ? { ok: true, value: { intentId: note.note } } : bad(note.ok ? "say which sent instruction to take back" : note.detail);
    },
    execute(deps, context, input) {
      return appendIntent(deps, context, "CANCEL_DISPATCH", String(input.intentId), {
        says: "Your request to take it back is saved. The next cycle stops carrying that instruction and records it; until it does, it is still a request.",
        undo: "Send the same words again; that is a new instruction.",
      });
    },
  },

  {
    definition: {
      type: "fleet.requestReadback",
      label: "Read this back now",
      does: "Reads what the system currently holds about one thing, right now, and records what it said.",
      doesNot: "Does not re-measure anything — it reports what was last written, and when.",
      authority: "READ_ONLY",
      subjectKind: "something the runner publishes",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const subject = text(input.subject).toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(READBACK_SUBJECTS, subject)) {
        return bad(`there is nothing called '${subject || "that"}' to read back`);
      }
      return { ok: true, value: { subject } };
    },
    async execute(deps, _context, input) {
      const key = String(input.subject);
      const which = READBACK_SUBJECTS[key];
      try {
        const persisted =
          key === "control-centre"
            ? await deps.repos.ownerSnapshots.read(SNAPSHOT_ID)
            : key === "runner"
              ? await deps.repos.runnerHeartbeat.read(RUNNER_ID)
              : await deps.repos.researchState.read(RESEARCH_STATE_ID);
        if (persisted === null) {
          return {
            ok: true,
            outcome: "DONE",
            subject: key,
            says: `Asked just now: the store is reachable and holds nothing for ${which.name} yet. That is the runner not having written it, not a failure to look.`,
            openedWork: [],
            readBackAt: which.readBackAt,
            undo: null,
          };
        }
        return {
          ok: true,
          outcome: "DONE",
          subject: key,
          says: `Asked just now: ${which.name} was last written at ${persisted.updatedAt}, and it has been written ${persisted.revision} time${persisted.revision === 1 ? "" : "s"} in all.`,
          openedWork: [],
          readBackAt: which.readBackAt,
          undo: null,
        };
      } catch (error) {
        return refuse(
          "DOWNSTREAM_REFUSED",
          `We could not ask about ${which.name} (${(error as Error)?.name ?? "error"}). Nothing is being claimed about it either way.`,
        );
      }
    },
  },

  {
    definition: {
      type: "config.setFleetSpendCeiling",
      label: "Set the Fleet spend ceiling",
      does:
        "Records the rolling 24-hour model-spend ceiling the Fleet runs under, durably, so a restart cannot lose it. The runner reads it at the start of its next cycle.",
      doesNot:
        "Does not start a cycle, deploy, restart, or spend anything by itself — it moves the ceiling the next cycle runs under. A lane paused at the old ceiling resumes on that cycle.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "how much the Fleet may spend in a rolling day",

      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const raw = input.rollingCeilingUsd;
      const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : Number.NaN;
      if (!Number.isFinite(parsed)) return bad("say the new ceiling as a dollar amount");
      if (parsed <= 0) {
        return bad("the ceiling has to be more than $0 — to stop the Fleet, pause the runner instead");
      }
      if (parsed > FLEET_SPEND_CEILING_MAX_USD) {
        return bad(`that ceiling is above the $${FLEET_SPEND_CEILING_MAX_USD} maximum this control allows`);
      }

      return { ok: true, value: { rollingCeilingUsd: Math.round(parsed * 100) / 100 } };
    },
    async execute(deps, context, input) {
      const rollingCeilingUsd = Number(input.rollingCeilingUsd);
      const at = context.at;

      let previousUsd: number;
      try {
        const existing = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID, { settingHistory: { ids: [context.receiptId] } });

        const current = existing !== null && isAdminConfig(existing.value) ? existing.value : defaultAdminConfig(at);
        previousUsd = resolveRollingCeiling(fleetSpendCeilingOverrideUsd(current)).rollingCeilingUsd;

        const next = withLoggedChange(withFleetSpendCeiling(current, {
          rollingCeilingUsd,
          previousUsd,
          decidedAt: at,
          decidedBy: context.request.actorRef,
          receiptId: context.receiptId,
        }), { id: context.receiptId, key: SPEND_CEILING_LOG_KEY, before: previousUsd, after: rollingCeilingUsd, at, why: "" });
        await deps.repos.adminConfig.save(existing, next, at);
      } catch (error) {
        return storeRefusal("your Fleet spend ceiling", error);
      }
      return {
        ok: true,
        outcome: "DONE",
        subject: "fleet spend ceiling",
        says:
          `Recorded: the Fleet spend ceiling is now $${rollingCeilingUsd.toFixed(2)} (was $${previousUsd.toFixed(2)}), and that survives a restart. ` +
          "The runner reads it at the start of its next cycle — no deploy, no restart — and a lane paused at the old ceiling resumes on that cycle. " +
          "Raising the ceiling removes a brake; it does not start a run.",
        openedWork: [],
        readBackAt: "/admin",
        undo: `Set it back to $${previousUsd.toFixed(2)}.`,
        change: { before: `$${previousUsd.toFixed(2)}`, after: `$${rollingCeilingUsd.toFixed(2)}` },
      };
    },
  },

  {
    definition: {
      type: "config.setPlaceTarget",
      label: "Set a target for a place",
      does:
        "Records how much of what a place is owed should be captured, for one ZIP, county, state or the country, durably, with the receipt that set it. The dispatcher reads it first when it orders work. Clearing it removes the target.",
      doesNot:
        "Does not start a round, send an agent, raise a spending limit, or hold back publishing: a fact that passes verification goes live whatever the target says.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "which place the target is for",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const key = typeof input.placeKey === "string" ? input.placeKey.trim() : "";
      if (!PLACE_TARGET_KEY.test(key)) return bad("say which place the target is for");
      const raw = input.goalPercent;
      if (raw === null || raw === undefined || raw === "") return { ok: true, value: { placeKey: key, goalPercent: null } };
      const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : Number.NaN;
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) return bad("the target is a percentage from 1 to 100");
      return { ok: true, value: { placeKey: key, goalPercent: Math.round(parsed * 10) / 10 } };
    },
    async execute(deps, context, input) {
      const placeKey = String(input.placeKey);
      const goalPercent = input.goalPercent === null ? null : Number(input.goalPercent);
      const at = context.at;
      let previous: number | null = null;
      try {
        const existing = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID, { placeTargets: { ids: [placeKey] } });
        const current = existing !== null && isAdminConfig(existing.value) ? existing.value : defaultAdminConfig(at);
        previous = placeTargetOf(current, placeKey)?.goalPercent ?? null;
        const next = withPlaceTarget(current, { key: placeKey, goalPercent, decidedAt: at, decidedBy: context.request.actorRef, receiptId: context.receiptId });
        await deps.repos.adminConfig.save(existing, next, at);
      } catch (error) {
        return storeRefusal("your place target", error);
      }
      const words = (n: number | null) => (n === null ? "no target" : `${n}%`);
      return {
        ok: true,
        outcome: "DONE",
        subject: placeKey,
        says: goalPercent === null
          ? `Recorded: the target for this place is cleared (it was ${words(previous)}). The dispatcher stops putting it first.`
          : `Recorded: the target for this place is now ${goalPercent}% (it was ${words(previous)}), and that survives a restart. The dispatcher reads it first when it orders work. A target does not start a round or hold back publishing.`,
        openedWork: [],
        readBackAt: "/admin?view=checklist",
        undo: previous === null ? "Clear the target." : `Set it back to ${previous}%.`,
      };
    },
  },

  {
    definition: {
      type: "config.setDataSwitch",
      label: "Switch a number on or off for an audience",
      does:
        "Records whether one number from the data business (a recipe such as the word cloud or support and oppose per name) may be read by one audience: Admin, the dashboard, or one named customer. Durable, with the receipt that set it. Takes effect on the next read.",
      doesNot:
        "Does not send anything to anyone, change what is captured, or change what readers see. A switch only decides who may read a number; the dashboard itself is not built yet.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "which number, and who may see it",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const recipe = typeof input.recipe === "string" ? input.recipe.trim() : "";
      if (!RECIPES.some((r) => r.id === recipe)) return bad("say which number the switch is for");
      const audience = typeof input.audience === "string" ? input.audience.trim() : "";
      if (!isAudience(audience)) return bad("say who the switch is for: Admin, the dashboard, or one named customer");
      const on = input.on;
      const yes = on === true || on === "true" || on === "on" || on === 1;
      const no = on === false || on === "false" || on === "off" || on === 0;
      if (!yes && !no) return bad("say whether the number is on or off for them");
      return { ok: true, value: { recipe, audience, on: yes } };
    },
    async execute(deps, context, input) {
      const recipe = String(input.recipe);
      const audience = String(input.audience);
      const on = input.on === true;
      const at = context.at;
      let before: boolean;
      try {
        const existing = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID);
        const current = existing !== null && isAdminConfig(existing.value) ? existing.value : defaultAdminConfig(at);
        const decided = dataSwitchOf(current, recipe, audience);
        before = decided !== null ? decided.on : defaultOn(audience);
        const next = withDataSwitch(current, { recipe, audience, on, decidedAt: at, decidedBy: context.request.actorRef, receiptId: context.receiptId });
        await deps.repos.adminConfig.save(existing, next, at);
      } catch (error) {
        return storeRefusal("your data switch", error);
      }
      const label = RECIPES.find((r) => r.id === recipe)!.label;
      const who = audienceWords(audience);
      return {
        ok: true,
        outcome: "DONE",
        subject: `${recipe}@${audience}`,
        says: `Recorded: “${label}” is now ${on ? "on" : "off"} for ${who} (it was ${before ? "on" : "off"}), and that survives a restart. It takes effect on the next read; nothing was sent to anyone.`,
        openedWork: [],
        readBackAt: "/admin?view=now",
        undo: `Switch it ${before ? "on" : "off"} again.`,
      };
    },
  },

  {
    definition: {
      type: "config.setDiscoverySearch",
      label: "Allow paid discovery search",
      does:
        "Records whether the meetings-discovery walk may send paid search requests (Brave and Exa), durably, so a restart cannot lose it. The runner reads it at the start of its next cycle.",
      doesNot:
        "Does not raise the runner's per-cycle and per-day search caps, resume paid research, or spend anything by itself. The free site walks run either way.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "how the system may spend",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const enabled = input.enabled;
      const on = enabled === true || enabled === "true" || enabled === "on" || enabled === 1;
      const off = enabled === false || enabled === "false" || enabled === "off" || enabled === 0;
      if (!on && !off) return bad("say whether paid discovery search is allowed or not allowed");
      const confirmed = input.confirmed;

      if (on && !(confirmed === true || confirmed === "true" || confirmed === "on" || confirmed === 1)) {
        return bad("turning paid discovery search on needs an explicit confirmation");
      }
      return { ok: true, value: { enabled: on } };
    },
    async execute(deps, context, input) {
      const enabled = input.enabled === true;
      const at = context.at;
      try {
        const existing = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID);

        const current = existing !== null && isAdminConfig(existing.value) ? existing.value : defaultAdminConfig(at);
        const next = withDiscoverySearch(current, {
          enabled,
          decidedAt: at,
          decidedBy: context.request.actorRef,
          receiptId: context.receiptId,
        });
        await deps.repos.adminConfig.save(existing, next, at);
      } catch (error) {
        return storeRefusal("your decision about paid discovery search", error);
      }
      return {
        ok: true,
        outcome: "DONE",
        subject: "paid discovery search",
        says: enabled
          ? "Recorded: the meetings-discovery walk may now use paid search, inside the runner's per-cycle and per-day caps. " +
            "The runner reads this at the start of its next cycle; every request it sends is charged as DISCOVERY_SEARCH."
          : "Recorded: paid discovery search is off. That is also the default. The free site walks continue.",
        openedWork: [],
        readBackAt: "/admin",
        undo: enabled ? "Turn paid discovery search off." : "Allow it again, with an explicit confirmation.",
      };
    },
  },

  {
    definition: {
      type: "expansion.scope.set",
      label: "Select this geography for expansion",
      does:
        "Records a geography you chose from the Census lookup, with its priority and selected lifetime or rolling 24-hour budget for paid work there, durably. " +
        "When research is enabled, the standing runner wakes promptly for this Send. At the start of its next cycle it creates the work the registry defines there that no clock carries yet, and puts all work there first.",
      doesNot:
        `Does not open the paid lane, add a government or a source no registry defines, or raise any spend limit, and it creates ${CREATION_SCOPE}. ` +
        "Its budget can only hold paid work back.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "a geography you want worked first",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const nested = input.geography;
      const geography = validateScopeGeography(
        nested !== null && typeof nested === "object" ? (nested as Readonly<Record<string, unknown>>) : input,
      );
      if (!geography.ok) return bad(geography.why);
      const priority = validateScopePriority(input.priority);
      if (!priority.ok) return bad(priority.why);
      const budget = validateScopeBudget(input.budgetUsd);
      if (!budget.ok) return bad(budget.why);
      const note = validateScopeNote(input.note);
      if (!note.ok) return bad(note.why);

      const questions = validateWorkQuestions(input.questions);
      if (!questions.ok) return bad(questions.why);
      if (input.huntBudget !== undefined && typeof input.huntBudget !== "boolean") return bad("Choose a budget for this hunt or a rolling budget.");
      if (input.newHunt !== undefined && typeof input.newHunt !== "boolean") return bad("Choose whether this is a separate hunt.");
      return { ok: true, value: { geography: geography.value, priority: priority.value, budgetUsd: budget.value, huntBudget: input.huntBudget === true, newHunt: input.newHunt === true, note: note.value, questions: questions.value } };
    },
    async execute(deps, context, input) {
      const geography = input.geography as ExpansionScopeGeography;
      const priority = Number(input.priority);
      const budgetUsd = Number(input.budgetUsd);
      const questions = (Array.isArray(input.questions) ? input.questions : []) as readonly WorkQuestion[];
      const at = context.at;
      let previous: { readonly priority: number; readonly budgetUsd: number } | null = null;
      let ceilingUsd: number;
      let lifetime = false;
      let originalLifetime = false;
      try {
        const existing = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID,{expansionScopes:{where:{path:["geography","stateAbbr"],value:geography.stateAbbr}}});
        const current = existing !== null && isAdminConfig(existing.value) ? existing.value : defaultAdminConfig(at);
        const held = expansionScopesOf(current);
        if (held.malformed > 0) {
          return refuse(
            "DOWNSTREAM_REFUSED",
            `${held.malformed} stored scope entr${held.malformed === 1 ? "y" : "ies"} on your policy row could not be read, so nothing was changed — writing over them would silently drop a budget you set.`,
          );
        }
        ceilingUsd = resolveRollingCeiling(fleetSpendCeilingOverrideUsd(current)).rollingCeilingUsd;
        const next = withScopeSet(held.scopes, {
          geography,
          priority,
          budgetUsd,
          huntBudget: input.huntBudget === true,
          newHunt: input.newHunt === true,
          note: input.note === null ? null : String(input.note),
          questions,
          decidedAt: at,
          decidedBy: context.request.actorRef,
          receiptId: context.receiptId,
        });
        previous = next.previous === null ? null : { priority: next.previous.priority, budgetUsd: next.previous.budgetUsd };
        const selected = next.scopes.find(s => s.key === scopeKeyOf(geography));
        lifetime = Boolean(selected?.budgetStartedAt);
        originalLifetime = selected?.key === ORIGINAL_LIFETIME_HUNT.key && selected.receiptId === ORIGINAL_LIFETIME_HUNT.receiptId &&
          selected.budgetStartedAt === ORIGINAL_LIFETIME_HUNT.budgetStartedAt && selected.budgetUsd === ORIGINAL_LIFETIME_HUNT.budgetUsd;
        const written = withExpansionScopes(current, { scopes: next.scopes, decidedAt: at });
        await deps.repos.adminConfig.save(existing, written, at);
      } catch (error) {
        return storeRefusal("your expansion scope", error);
      }
      const what = `${geography.label} (${SCOPE_TYPE_WORDS[geography.type].toLowerCase()}, ${geography.stateAbbr})`;
      const was = previous === null ? "newly selected" : `was priority ${previous.priority} with $${previous.budgetUsd.toFixed(2)}`;
      return {
        ok: true,
        outcome: "DONE",
        subject: scopeKeyOf(geography),
        says:
          `Recorded: ${what} is priority ${priority} with a $${budgetUsd.toFixed(2)} ${lifetime ? "Anthropic token budget for this hunt" : "rolling 24-hour budget"} for paid work there (${was}), and that survives a restart. ` +
          "Recording it makes no model call itself. If research is enabled, the standing runner wakes promptly for this Send; if a cycle is already active, it finishes first. At the start of its next cycle the runner creates the work the registry defines there that no clock carries yet " +
          `(${CREATION_SCOPE}) and puts all work there first; the acknowledgement counts what was created, reordered and blocked. ` +
          "Work that needs a model waits: the paid lane stays exactly as it is, " +
          (originalLifetime
            ? `and this exact original $${ORIGINAL_LIFETIME_HUNT.budgetUsd.toFixed(2)} lifetime hunt keeps its instruction receipt and allowance; the $${ceilingUsd.toFixed(2)} Fleet rolling ceiling does not bind its exact work. This action has its own saved receipt.`
            : `and the Fleet ceiling of $${ceilingUsd.toFixed(2)} still binds first${budgetUsd > ceilingUsd ? " — this budget is above it, so the Fleet ceiling is the one that holds" : ""}.`) +
          (questions.length > 0
            ? ` Your questions are kept on it and on every piece of work it reaches: ${questions.map((q) => WORK_QUESTION_WORDS[q]).join(" ")}`
            : ""),
        openedWork: [],
        readBackAt: "/admin/work",
        undo:
          previous === null
            ? "Remove this geography from the expansion list."
            : `Set it back to priority ${previous.priority} with $${previous.budgetUsd.toFixed(2)}.`,
      };
    },
  },

  {
    definition: {
      type: "expansion.scope.remove",
      label: "Remove this geography from expansion",
      does: "Asks the runner to stop this hunt in its next planning round.",
      doesNot: "Keeps acquired facts and work already in flight.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "a geography on your expansion list",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const placeKey = typeof input.placeKey === "string" ? input.placeKey.trim() : "";
      if (placeKey !== "") {
        return /^geo:[a-z]{2}.[a-z_]+.[0-9A-Za-z]{2,12}$/.test(placeKey) ? { ok: true, value: { key: placeKey } } : bad("say which hunt, by its place");
      }
      const key = validateScopeKey(input.key);
      return key.ok ? { ok: true, value: { key: key.value } } : bad(key.why);
    },
    async execute(deps,context,input) {
      const key=String(input.key);
      const place=/^geo:([a-z]{2})\./.exec(key);
      try {
        const lookupKey=key;
        const held=await deps.repos.adminConfig.read(ADMIN_CONFIG_ID,{expansionScopes:place?{where:{path:["geography","geoid"],value:key.split(".").at(-1)!}}:{ids:[lookupKey]}});
        const scope=expansionScopesOf(held?.value??null).scopes.find(scope=>scope.key===lookupKey || huntPlaceKey(scope)===key);
        const state=place?.[1]??scope?.geography.stateAbbr.toLowerCase();
        if(!state) return refuse("INVALID_INPUT","That hunt could not be found.");
        await requestHuntStop(deps.repos,{receiptId:context.receiptId,state,scopeKey:scope?.key??key,at:context.at,actor:context.request.actorRef});
      } catch(error) { return storeRefusal("your stop order",error); }
      return {ok:true,outcome:"DONE",subject:key,says:"Stop requested. Waiting for the runner.",openedWork:[],readBackAt:"/admin?view=queue",undo:"Start a new hunt."};
    },
  },
  {
    definition:{type:"expansion.scope.stopAll",label:"Stop every hunt",does:"Asks the runner to stop every current hunt in this state or the whole system.",
      doesNot:"Keeps acquired facts and work already in flight.",authority:"OWNER_DECISION_REQUIRED",subjectKind:"hunts",requiresStateVersion:false,refusals:["INVALID_INPUT","DOWNSTREAM_REFUSED"]},
    validate(input) {
      const state=typeof input.state==="string"?input.state.toLowerCase():null;
      return state===null || /^[a-z]{2}$/.test(state)?{ok:true,value:{state}}:bad("Choose a state.");
    },
    async execute(deps,context,input) {
      try { await requestHuntStop(deps.repos,{receiptId:context.receiptId,state:input.state===null?undefined:String(input.state),at:context.at,actor:context.request.actorRef}); }
      catch(error) { return storeRefusal("your stop order",error); }
      return {ok:true,outcome:"DONE",subject:input.state===null?"us":`st:${input.state}`,says:"Stop requested. Waiting for the runner.",openedWork:[],readBackAt:"/admin?view=queue",undo:"Start a new hunt."};
    },
  },

  ...BULK_ACTIONS,
  ...LEAD_ACTIONS,

  ...DOOR_ACTIONS,

  {
    definition: {
      type: "billing.fact.record",
      label: "Record a billing figure",
      does:
        "Records a figure you read from a provider's console, invoice or export — its amount, the period it covers, the day you read it and where — durably, so the Money screen can show it beside what the system measures itself.",
      doesNot:
        "Does not change any ceiling, budget or runner decision, and is never added to the system's own measured ledger for the same money. Entering the same provider, kind and period again corrects the earlier figure rather than adding a second one.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "a figure from a bill the system cannot read",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {

      const checked = validateBillingFact(input, "9999-12-31");
      return checked.ok ? { ok: true, value: { ...checked.value } } : bad(checked.why);
    },
    async execute(deps, context, input) {
      const at = context.at;
      const rechecked = validateBillingFact(input, at.slice(0, 10));
      if (!rechecked.ok) return refuse("INVALID_INPUT", `Nothing was recorded: ${rechecked.why}.`);
      const fact: BillingFact = {
        ...rechecked.value,
        id: billingFactId(rechecked.value),
        decidedAt: at,
        decidedBy: context.request.actorRef,
        receiptId: context.receiptId,
      };
      let previous: BillingFact | null = null;
      try {
        const existing = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID, { billingFacts: { ids: [fact.id] } });
        const current = existing !== null && isAdminConfig(existing.value) ? existing.value : defaultAdminConfig(at);
        const held = billingFactsOf(current);
        if (held.malformed > 0) {
          return refuse(
            "DOWNSTREAM_REFUSED",
            `${held.malformed} stored billing figure${held.malformed === 1 ? "" : "s"} on your policy row could not be read, so nothing was changed — rewriting the list would silently drop them.`,
          );
        }
        const next = withFactRecorded(held.facts, fact);
        previous = next.previous;
        const written = withBillingFacts(current, { facts: next.facts, decidedAt: at });
        await deps.repos.adminConfig.save(existing, written, at);
      } catch (error) {
        return storeRefusal("your billing figure", error);
      }
      const name = fact.label ?? providerDefinition(fact.provider).name;
      return {
        ok: true,
        outcome: "DONE",
        subject: fact.id,
        says:
          `Recorded: ${name}, ${factAmountWords(fact)} (${factPeriodWords(fact).toLowerCase()}), read ${fact.asOf} from ${fact.source}` +
          (previous === null ? "." : `, correcting the ${factAmountWords(previous)} entered for the same slot.`) +
          " It is shown beside the system's own measurements and never added to them.",
        openedWork: [],
        readBackAt: "/admin/money",
        undo: previous === null ? "Remove this figure." : `Enter ${factAmountWords(previous)} again for the same slot.`,
      };
    },
  },

  {
    definition: {
      type: "billing.fact.remove",
      label: "Remove a billing figure",
      does: "Takes one figure you entered off the Money screen, durably.",
      doesNot: "Does not change any ceiling, budget or measurement; the provider's row goes back to saying it has no reading.",
      authority: "OWNER_DECISION_REQUIRED",
      subjectKind: "a billing figure you entered",
      requiresStateVersion: false,
      refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"],
    },
    validate(input) {
      const id = text(input.id);
      if (id === "" || id.length > 200) return bad("say which figure to remove");
      return { ok: true, value: { id } };
    },
    async execute(deps, context, input) {
      const id = String(input.id);
      const at = context.at;
      let removed: BillingFact | null = null;
      try {
        const existing = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID, { billingFacts: { ids: [id] } });
        const current = existing !== null && isAdminConfig(existing.value) ? existing.value : null;
        if (existing === null || current === null) {
          return { ok: true, outcome: "DONE", subject: id, says: "That figure was not recorded, so nothing changed.", openedWork: [], readBackAt: "/admin/money", undo: null };
        }
        const held = billingFactsOf(current);
        if (held.malformed > 0) {
          return refuse(
            "DOWNSTREAM_REFUSED",
            `${held.malformed} stored billing figure${held.malformed === 1 ? "" : "s"} on your policy row could not be read, so nothing was changed — rewriting the list would silently drop them.`,
          );
        }
        const next = withFactRemoved(held.facts, id);
        if (next.removed === null) {
          return { ok: true, outcome: "DONE", subject: id, says: "That figure was not recorded, so nothing changed.", openedWork: [], readBackAt: "/admin/money", undo: null };
        }
        removed = next.removed;
        await deps.repos.adminConfig.save(existing, withBillingFacts(current, { facts: next.facts, decidedAt: at }), at);
      } catch (error) {
        return storeRefusal("the change to your billing figures", error);
      }
      return {
        ok: true,
        outcome: "DONE",
        subject: id,
        says: `Removed: ${removed.label ?? providerDefinition(removed.provider).name}, ${factAmountWords(removed)} (${factPeriodWords(removed).toLowerCase()}). That row goes back to saying it has no reading.`,
        openedWork: [],
        readBackAt: "/admin/money",
        undo: `Enter ${factAmountWords(removed)} again, read ${removed.asOf} from ${removed.source}.`,
      };
    },
  },

  ...OWED_ACTIONS,
  auditFlagAction,
  auditFlagRaiseAction,
  officialsCheckAction(),
];

export const ACTION_REGISTRY: Readonly<Record<string, RegisteredAction>> = Object.freeze(
  Object.fromEntries(REGISTRY.map((entry) => [entry.definition.type, entry])),
);

export const ACTION_TYPES: readonly string[] = REGISTRY.map((entry) => entry.definition.type);

export function lookupAction(type: string): RegisteredAction | null {
  if (typeof type !== "string") return null;
  return Object.prototype.hasOwnProperty.call(ACTION_REGISTRY, type) ? ACTION_REGISTRY[type] : null;
}

export function actionDefinitions(): readonly ActionDefinition[] {
  return REGISTRY.map((entry) => entry.definition);
}
