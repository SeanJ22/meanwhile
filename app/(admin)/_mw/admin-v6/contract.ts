import type { ActionKind, AdminV6Data } from "./model.ts";
import { settingValueFromInput } from "./actions.ts";

export const V6_CAPABILITY_VERSION = 1;

export type SectionId = keyof AdminV6Data;
export const SECTION_IDS: readonly SectionId[] = [
  "places", "hunts", "national", "results", "officials", "stuck", "sameCause", "workRows", "history", "workers", "checklist", "agents", "spend", "sends", "reliability", "publication", "money", "scoreboard", "fixes",
];

export function sectionContract(id: SectionId): string {
  return `admin-v6/${id}@1`;
}
export function actionContract(kind: ActionKind): string {
  return `admin-v6/action/${kind}@1`;
}
export const RECEIPT_LOOKUP_CONTRACT = "admin-v6/receipt@1";

export interface SectionAnnouncement {
  readonly contract: string;
  readonly href: string;
  readonly revision: string;
}
export interface ActionAnnouncement {
  readonly contract: string;
  readonly type: string;
  readonly requiresStateVersion: boolean;
}
export interface V6Capabilities {
  readonly version: number;
  readonly sections: Readonly<Partial<Record<SectionId, SectionAnnouncement>>>;
  readonly actions: Readonly<Partial<Record<ActionKind, ActionAnnouncement>>>;
  readonly receiptLookup?: { readonly contract: string; readonly href: string };
}

export interface SectionPage {
  readonly total: number | null;
  readonly nextCursor: string | null;
  readonly prevCursor: string | null;
}

export const PAGED_SECTIONS: readonly SectionId[] = ["workRows", "history", "checklist", "fixes"];
export const PAGE_LIMIT = 50;

const SAME_ORIGIN_PATH = /^\/api\/admin\/[A-Za-z0-9/_\-.]+$/;

export function capabilitiesOf(pulse: unknown): V6Capabilities | null {
  if (!pulse || typeof pulse !== "object") return null;
  const raw = (pulse as { v6?: unknown }).v6;
  if (!raw || typeof raw !== "object") return null;
  const v = raw as { version?: unknown; sections?: unknown; actions?: unknown; receiptLookup?: unknown };
  if (typeof v.version !== "number") return null;
  const sections: Partial<Record<SectionId, SectionAnnouncement>> = {};
  if (v.sections && typeof v.sections === "object") {
    for (const id of SECTION_IDS) {
      const a = (v.sections as Record<string, unknown>)[id] as Partial<SectionAnnouncement> | undefined;
      if (a && typeof a.contract === "string" && typeof a.href === "string" && SAME_ORIGIN_PATH.test(a.href) && typeof a.revision === "string") {
        sections[id] = { contract: a.contract, href: a.href, revision: a.revision };
      }
    }
  }
  const actions: Partial<Record<ActionKind, ActionAnnouncement>> = {};
  if (v.actions && typeof v.actions === "object") {
    for (const [kind, a] of Object.entries(v.actions as Record<string, unknown>)) {
      const x = a as Partial<ActionAnnouncement> | undefined;
      if (x && typeof x.contract === "string" && typeof x.type === "string" && x.type) actions[kind as ActionKind] = { contract: x.contract, type: x.type, requiresStateVersion: x.requiresStateVersion === true };
    }
  }
  const rl = v.receiptLookup as { contract?: unknown; href?: unknown } | undefined;
  const receiptLookup = rl && typeof rl.contract === "string" && typeof rl.href === "string" && SAME_ORIGIN_PATH.test(rl.href) ? { contract: rl.contract, href: rl.href } : undefined;
  return { version: v.version, sections, actions, receiptLookup };
}

export function supportedAction(caps: V6Capabilities | null, kind: ActionKind): ActionAnnouncement | null {
  const a = caps?.actions[kind];
  return a && a.contract === actionContract(kind) ? a : null;
}

export interface ActionInputSource {
  readonly target: string;
  readonly scopeKey: string;
  readonly option: string | null;
  readonly words: string;
  readonly amount: string;
  readonly selected: readonly string[];
  readonly payload?: Readonly<Record<string, string>>;
}

export function actionInput(kind: ActionKind, s: ActionInputSource): Readonly<Record<string, unknown>> {
  const limit = () => (s.amount.trim() === "" ? null : Number(s.amount));
  switch (kind) {
    case "ballot-publish":
      return {};
    case "officials-check":
      return { placeKey: s.target || s.scopeKey, note: s.words.trim() || null };
    case "decide":
      return { decisionId: s.target, option: s.option, words: s.words.trim() || null };
    case "hunt-start": {

      const zip = /^geo:([a-z]{2})\.zcta\.(\d{5})$/.exec(s.target);
      return { items: zip ? [{ zip: zip[2], stateAbbr: zip[1].toUpperCase(), budgetUsd: limit() }] : [], priority: 1, huntBudget: true };
    }
    case "hunt-start-many":
      return { items: JSON.parse(s.payload?.items ?? "[]") as unknown, priority: Number(s.payload?.priority ?? 1), note: s.payload?.note ?? null, huntBudget: true };
    case "leads-send":
      return { rows: JSON.parse(s.payload?.rows ?? "[]") as unknown };
    case "hunt-limit":
      return { placeKey: s.target, change: "set", budgetUsd: limit() };
    case "hunt-pause":
      return { placeKey: s.target, change: "pause" };
    case "hunt-resume":
      return { placeKey: s.target, change: "resume" };
    case "hunt-stop":
      return { placeKey: s.target };
    case "hunt-stop-state":
      return {state:s.target.replace(/^st:/,"")};
    case "hunt-stop-all":
      return {state:null};
    case "global-paid":
    case "global-paid-resume":
      return {};
    case "global-runner-pause":
    case "global-runner-resume":
      return { note: s.words.trim() || null };
    case "global-ceiling":
      return { rollingCeilingUsd: s.amount.trim() === "" ? null : Number(s.amount) };
    case "target-set":
      return { placeKey: s.target, goalPercent: s.amount.trim() === "" ? null : Number(s.amount) };
    case "target-clear":
      return { placeKey: s.target, goalPercent: null };
    case "data-switch-on":
    case "data-switch-off": {

      const at = s.target.indexOf("@");
      return { recipe: at < 0 ? s.target : s.target.slice(0, at), audience: at < 0 ? "" : s.target.slice(at + 1), on: kind === "data-switch-on" };
    }
    case "global-search-on":
      return { enabled: true, confirmed: true };
    case "global-search-off":
      return { enabled: false };
    case "cancel-send":
      return { intentId: s.target };
    case "order-schedule":
      return JSON.parse(s.payload?.scheduledInput??"{}") as Readonly<Record<string,unknown>>;
    case "order-unschedule":
      return { id: s.target };
    case "owed-add":
      return { group: s.option ?? "", requirement: s.amount.trim(), why: s.words.trim() };
    case "owed-decline":
      return { placeKey: s.target, rows: JSON.parse(s.payload?.rows ?? "[]") as unknown, why: s.words.trim() };
    case "owed-undo":
      return { undoChangeId: s.target };
    case "setting-set":

      return { key: s.target, value: s.target==="brief.time" && s.amount.trim()==="" ? "" : settingValueFromInput(s.payload?.control ?? "text", s.amount, s.option) ?? null, why: s.words.trim() };
    case "setting-undo":

      return { key: s.target, value: JSON.parse(s.payload?.value ?? "null") as unknown, why: s.words.trim() || "Undo", undoOf: s.payload?.undoOf ?? "" };
    case "send-agents":

      return { note: (s.payload?.words ?? s.words).trim(), ...(s.amount.trim() === "" ? {} : { budgetUsd: Number(s.amount) }) };
    default:
      throw new Error("This control is not available yet.");
  }
}
