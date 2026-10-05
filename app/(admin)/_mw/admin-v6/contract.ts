/**
 * **THE ADMIN v6 READ/ACTION CONTRACT — HOW A PAGE LEARNS A BACKEND IS READY.**
 * (Proposed to Codex 2026-09-28; see ACCEPTANCE.md "Contract" and the shared
 * handoff note. Codex owns the backend side and may move these types under
 * lib/control-plane; the shapes must stay compatible.)
 *
 * No endpoint is guessed. The deployed live pulse (`GET /api/admin/live`,
 * already polled by every Admin page) gains one optional field, `v6`, that
 * ANNOUNCES what the backend can serve:
 *
 * ```
 *   pulse.v6 = {
 *     version: 1,
 *     sections: { stuck: { contract: "admin-v6/stuck@1", href: "/api/admin/…", revision: "…" }, … },
 *     actions:  { recheck: { contract: "admin-v6/action/recheck@1", type: "<gateway action type>" }, … },
 *     receiptLookup: { contract: "admin-v6/receipt@1", href: "/api/admin/…" } | undefined,
 *   }
 * ```
 *
 * A section the pulse does not announce is "waiting for the backend": a real,
 * recoverable state of the connection. The moment a pulse announces it, every
 * open page fetches it for its current scope and replaces the waiting state;
 * whenever its `revision` moves, the page fetches again. Nothing reloads and no
 * one flips a switch. An action becomes usable only when announced, and being
 * announced never sends anything.
 *
 * Section response (`GET <href>?scope=<place key>`, JSON, same session guard):
 *
 * ```
 *   { contract: "admin-v6/<section>@1", scope: "<place key>", revision: "…",
 *     asOf: "<ISO>", data: <the section's type in model.ts>, missingParts?: string[] }
 * ```
 *
 * Action send: the existing `POST /api/admin/action` with the announced `type`,
 * `subject` = the control's target, the page's idempotency key, `stateVersion`
 * (the latest pulse revision when the announcement says the action requires
 * one, otherwise null), and that action's exact input keys (`actionInput`).
 *
 * Receipt lookup: `GET <href>?type=<gateway type>&key=<idempotency key>` →
 * `{ contract: "admin-v6/receipt@1", receipt: ActionReceipt | null }`. The
 * durable identity is `<type>:<key>` (Codex); it never resubmits.
 *
 * Paged sections: `GET <href>?scope=…&limit=…[&cursor=…][&q=…][&<filter>=…]`;
 * the envelope adds `page: { total: number | null, nextCursor, prevCursor }`.
 *
 * PURE.
 */
import type { ActionKind, AdminV6Data } from "./model.ts";
import { settingValueFromInput } from "./actions.ts";

export const V6_CAPABILITY_VERSION = 1;

export type SectionId = keyof AdminV6Data;
export const SECTION_IDS: readonly SectionId[] = [
  "places", "hunts", "national", "results", "stuck", "sameCause", "history", "workers", "checklist", "agents", "spend", "sends", "reliability", "publication", "money", "learning", "fixes",
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
  /** The registry action quotes the rendered state; the page sends the latest pulse revision. */
  readonly requiresStateVersion: boolean;
}
export interface V6Capabilities {
  readonly version: number;
  readonly sections: Readonly<Partial<Record<SectionId, SectionAnnouncement>>>;
  readonly actions: Readonly<Partial<Record<ActionKind, ActionAnnouncement>>>;
  readonly receiptLookup?: { readonly contract: string; readonly href: string };
}

export interface SectionResponse<T = unknown> {
  readonly contract: string;
  readonly scope: string;
  readonly revision: string;
  readonly asOf: string;
  readonly data: T;
  readonly missingParts?: readonly string[];
  readonly page?: SectionPage;
}

/** A window of a bounded, indexed section. `total` null means unknown, never zero. */
export interface SectionPage {
  readonly total: number | null;
  readonly nextCursor: string | null;
  readonly prevCursor: string | null;
}

/** Sections read one window at a time; the page never fetches their whole population. */
export const PAGED_SECTIONS: readonly SectionId[] = ["history", "checklist", "fixes"];
export const PAGE_LIMIT = 50;

const SAME_ORIGIN_PATH = /^\/api\/admin\/[A-Za-z0-9/_\-.]+$/;

/** Read the announcement off a pulse, defensively. Anything malformed is ignored, not trusted. */
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

/** Is this announced action one this page knows how to send? */
export function supportedAction(caps: V6Capabilities | null, kind: ActionKind): ActionAnnouncement | null {
  const a = caps?.actions[kind];
  return a && a.contract === actionContract(kind) ? a : null;
}

/* ------------------------------------------------ exact per-action inputs */

export interface ActionInputSource {
  readonly target: string;
  readonly scopeKey: string;
  readonly option: string | null;
  readonly words: string;
  readonly amount: string;
  readonly selected: readonly string[];
  readonly fields?: Readonly<Record<string,string>>;
  readonly startAt?: string;
  readonly payload?: Readonly<Record<string, string>>;
}

/**
 * The exact input keys each `admin-v6/action/<kind>@1` contract sends (Codex,
 * 20:18 UTC: "the real gateway validates each registry action's exact input
 * keys"; a generic payload is never sent). The gateway `subject` is always the
 * control's target. A version change here is a new contract version.
 */
export function actionInput(kind: ActionKind, s: ActionInputSource): Readonly<Record<string, unknown>> {
  const limit = () => (s.amount.trim() === "" ? null : Number(s.amount));
  switch (kind) {
    case "decide":
      return { decisionId: s.target, cardVersion:s.payload?.version, option: s.option, words: s.words.trim() || null, fields:s.fields, startAt:s.startAt };
    case "hunt-start": {
      // A single hunt starts from one ZIP place (`geo:az.zcta.85635`). Anything wider starts from the many-hunts panel.
      const zip = /^geo:([a-z]{2})\.zcta\.(\d{5})$/.exec(s.target);
      return { items: zip ? [{ zip: zip[2], stateAbbr: zip[1].toUpperCase(), budgetUsd: limit() }] : [], priority: 1, huntBudget: true };
    }
    case "hunt-start-many":
      return { items: JSON.parse(s.payload?.items ?? "[]") as unknown, priority: Number(s.payload?.priority ?? 1), note: s.payload?.note ?? null, huntBudget: true };
    case "hunt-limit":
      return { placeKey: s.target, change: "set", budgetUsd: limit() };
    case "hunt-pause":
      return { placeKey: s.target, change: "pause" };
    case "hunt-resume":
      return { placeKey: s.target, change: "resume" };
    case "hunt-stop":
      return { placeKey: s.target };
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
      // The target is "<recipe>@<audience>": a recipe id has no "@", an audience (admin, dashboard, customer:<id>) has none either.
      const at = s.target.indexOf("@");
      return { recipe: at < 0 ? s.target : s.target.slice(0, at), audience: at < 0 ? "" : s.target.slice(at + 1), on: kind === "data-switch-on" };
    }
    case "global-search-on":
      return { enabled: true, confirmed: true };
    case "global-search-off":
      return { enabled: false };
    case "cancel-send":
      return { intentId: s.target };
    case "setting-set":
      // config.setSetting: the target is the setting's key; the payload says how its value is typed.
      return { key: s.target, value: settingValueFromInput(s.payload?.control ?? "text", s.amount, s.option) ?? null, why: s.words.trim() };
    case "setting-undo":
      // The same action with the logged previous value, quoting the change it undoes so a later change is never jumped over.
      return { key: s.target, value: JSON.parse(s.payload?.value ?? "null") as unknown, why: s.words.trim() || "Undo", undoOf: s.payload?.undoOf ?? "" };
    case "send-agents":
      // fleet.deployHere: where the fleet goes next, in words. A typed dollar amount is that Send's own rolling budget.
      return { note: (s.payload?.words ?? s.words).trim(), ...(s.amount.trim() === "" ? {} : { budgetUsd: Number(s.amount) }) };
  }
}
