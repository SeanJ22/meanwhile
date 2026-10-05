/**
 * **THE OWNER'S OPERATIONAL POLICY, WRITTEN DOWN WHERE A RESTART CANNOT LOSE IT.**
 * (Admin Pass C, §9A.22 — the subscription-first API fallback toggle.)
 *
 * ## What this is, and what it is not
 *
 * Everything else in the control plane is a MEASUREMENT: what the runner did,
 * what a Scout found, what a contract read. This is the one aggregate that
 * holds a DECISION — what the owner has said the system may do. The two must
 * not share a store shape by accident, so the distinction is stated here: a
 * measurement is overwritten by a newer measurement, while a policy changes only
 * because someone decided to change it, and the record of who decided and when
 * is part of the value rather than metadata about it.
 *
 * ## Why the default is OFF, and why "after deploy/restart" is in the sentence
 *
 * §9A.22: *"Default behavior remains `API fallback = OFF`. This is correct and
 * must remain the default after deploy/restart."* A default that holds only
 * until the next process start is not a default, it is a coincidence. Three
 * places this could have lived, and why none of them work:
 *
 * ```
 *   browser state    resets invisibly, and only for the tab that set it
 *   an env var       the owner cannot move it, and changing it is a deploy
 *   a module const   the owner cannot move it at all
 * ```
 *
 * So it is a durable aggregate at one id, written by an `OWNER_DECISION_REQUIRED`
 * gateway action, and its absence reads as `defaultAdminConfig()` — which is OFF.
 * A control plane that has never been written to therefore answers OFF, and so
 * does one whose row was never created because the write failed. There is no
 * path by which "we could not read the policy" becomes "the policy is ON".
 *
 * ## The toggle is a RECORDED DECISION, and today that is all it is
 *
 * §9A.22 also says: *"If a safe persistent enforcement seam does not yet exist,
 * do not fake the toggle."* Measured on 2026-09-06: no executor in this
 * repository consults an API-fallback policy. `lib/control-plane/workers/*`
 * carries no subscription-versus-paid decision, `lib/control-plane/scheduler/
 * research-policy.ts` gates the model lane on a credential's PRESENCE by name
 * and on spend bounds, and the only `fallbackEnabled()` in the tree
 * (`lib/routing/unsourced-fallback.ts`) is about unsourced routing and has
 * nothing to do with paid inference.
 *
 * So writing `enabled: true` here records that the owner has authorised paid
 * fallback. It does not by itself permit a single paid call, because nothing
 * asks. That is stated in the action's own `doesNot` sentence, in the receipt
 * the owner reads, and in {@link API_FALLBACK_ENFORCEMENT} for the surface that
 * renders the control — and the exact missing seam is named in
 * {@link API_FALLBACK_MISSING_SEAM} rather than left for someone to discover.
 *
 * PURE. No store, no clock, no environment.
 */

import type { BillingFact } from "../billing-facts.ts";
import type { ExpansionScopeDecision } from "../expansion/scopes.ts";

export const ADMIN_CONFIG_FORMAT_VERSION = 1;

/** One row. The policy is singular by construction, not by convention. */
export const ADMIN_CONFIG_ID = "current";

/**
 * The `updatedAt` a never-written config carries.
 *
 * `defaultAdminConfig()` must be pure and must therefore not read a clock, and
 * `updatedAt` is not nullable because a written config always has one. The
 * epoch is the honest stand-in and it is never what a surface renders:
 * `apiFallback.decidedAt === null` is the field that means "the owner has never
 * decided this", and that is the one a renderer reads.
 */
export const ADMIN_CONFIG_NEVER_WRITTEN = "1970-01-01T00:00:00.000Z";

export interface AdminConfig {
  readonly settings?: Readonly<Record<string, import("../settings.ts").SettingValue>>;
  /** The fix list (BR-03): broken things and their repairs. */
  readonly fixList?: readonly import("../fix-list.ts").FixItem[];
  /** The updates feed (BR-24). */
  readonly updates?: readonly import("../updates.ts").UpdateRecord[];
  /** Orders scheduled for later (BR-15). */
  readonly scheduledOrders?: readonly import("./scheduled-orders.ts").ScheduledOrder[];
  readonly settingHistory?: readonly import("../settings.ts").SettingChange[];
  readonly routineRefreshRequests?: readonly import("../../civic-data/owner-refresh.ts").RoutineRefreshRequest[];
  /**
   * Scoped, expiring requests that bring one meeting partition's next read
   * forward for the standing runner's ordinary pass (`lib/civic-data/routine-due-request.ts`).
   * An engineering control for verifying the refresh schedule, not a policy;
   * optional because a config written before it existed holds none.
   */
  readonly routineDueRequests?: readonly import("../../civic-data/routine-due-request.ts").RoutineDueRequest[];
  readonly formatVersion: 1;
  readonly apiFallback: {
    /** May paid API fallback be used at all. Defaults false and stays false through a restart. */
    readonly enabled: boolean;
    /** When the owner last decided this. Null while he never has. */
    readonly decidedAt: string | null;
    /** The admin session reference that decided it. Never a person's name. */
    readonly decidedBy: string | null;
    /** The gateway receipt that carries the decision. Null while there is none. */
    readonly receiptId: string | null;
  };
  /**
   * The owner's override of the Fleet's rolling-24h model-spend ceiling, or null
   * when none stands and the built-in fallback in
   * `FLEET_SAFETY_BOUNDS.rolling24HourModelUsd` governs. Optional only because a
   * config written before this field existed carries no override — which reads
   * as the fallback, exactly as its absence should. "A ceiling that disappears
   * must not become no ceiling": the resolver in `fleet-safety.ts` supplies the
   * fallback, and this module stays free of that constant.
   */
  readonly fleetSpendCeiling?: FleetSpendCeilingDecision | null;
  /**
   * The owner's selected expansion scopes: one Census geography each, with a
   * priority and a rolling-24h paid-work budget (`lib/control-plane/expansion/
   * scopes.ts`). Optional because a config written before this field existed
   * selected none — which reads as none. Each entry carries its own
   * decidedAt/decidedBy/receiptId, exactly like the spend-ceiling dial.
   */
  readonly expansionScopes?: readonly ExpansionScopeDecision[] | null;
  /**
   * Billing figures the owner read where the system cannot look — a
   * provider's console, an invoice, an export (`lib/control-plane/billing-facts.ts`).
   * The one field on this row that is not policy: an attestation, kept here
   * because it shares the row's owner-only write path and its who-and-when
   * record. Nothing reads it to decide anything; the Money screen renders it.
   * Optional because a config written before this field existed carries none.
   */
  readonly billingFacts?: readonly BillingFact[] | null;
  /**
   * The owner's decision about PAID discovery search: Brave and Exa, returning
   * pointers only, used by the meetings-discovery walk when a government's own
   * site shows no route. Absent or null means he never decided, which reads as
   * OFF, so a fresh control plane, a failed write and a corrupt row all answer
   * OFF.
   *
   * The walks themselves are free and always on; this governs only the paid
   * step. The runner reads it at cycle start and builds no search step unless it
   * is on, and even then only inside its per-cycle and per-day caps. Optional
   * because a config written before this field existed carries no decision.
   */
  readonly discoverySearch?: DiscoverySearchDecision | null;
  /**
   * The owner's target for a place: "take this place to this share of what it is owed". One entry per place, set through the
   * gateway with the receipt that set it. The dispatcher reads these first when it orders work; nothing here gates publishing.
   * Optional because a config written before this field existed carries none.
   */
  readonly placeTargets?: readonly PlaceTargetDecision[] | null;
  /**
   * Who may see each number the data business makes (`lib/control-plane/data-business/`): one switch per recipe per audience, set
   * through the gateway with the receipt that set it. An audience with no entry takes the default in `data-business/switches.ts`:
   * Admin on; the dashboard and every customer off, so nothing leaves until the owner flips a switch. Read when a number is read,
   * so a flip takes effect at once and no runner has to pick it up. Optional because a config written before this field existed holds none.
   */
  readonly dataSwitches?: readonly DataSwitchDecision[] | null;
  readonly updatedAt: string;
}

/** One switch: this number, for this audience, on or off. `audience` is `admin`, `dashboard` or `customer:<id>`. */
export interface DataSwitchDecision {
  readonly recipe: string;
  readonly audience: string;
  readonly on: boolean;
  readonly setAt: string;
  readonly decidedBy: string;
  readonly receiptId: string;
}

/** One place's target. `key` is a v6 place key (`us`, `st:az`, `geo:az.county.04019`, `geo:az.zcta.85635`). */
export interface PlaceTargetDecision {
  readonly key: string;
  /** The share of what the place is owed that should be captured, 1 to 100. */
  readonly goalPercent: number;
  readonly setAt: string;
  readonly decidedBy: string;
  readonly receiptId: string;
}

export const PLACE_TARGET_KEY = /^(?:us|st:[a-z]{2}|geo:[a-z]{2}\.[a-z_]+\.[0-9A-Za-z]{1,16})$/;

/**
 * The next row after the owner sets, changes or clears a place's target (`goalPercent: null` clears it). Pure, like its
 * siblings; every other decision on the row is carried through.
 */
export function withPlaceTarget(
  current: AdminConfig,
  change: { readonly key: string; readonly goalPercent: number | null; readonly decidedAt: string; readonly decidedBy: string; readonly receiptId: string },
): AdminConfig {
  const others = (current.placeTargets ?? []).filter((t) => t.key !== change.key);
  const next = change.goalPercent === null ? others
    : [...others, { key: change.key, goalPercent: change.goalPercent, setAt: change.decidedAt, decidedBy: change.decidedBy, receiptId: change.receiptId }];
  return { ...current, formatVersion: ADMIN_CONFIG_FORMAT_VERSION, placeTargets: next.sort((a, b) => a.key.localeCompare(b.key)), updatedAt: change.decidedAt };
}

/** The target on a place, or null. A malformed entry reads as none, never as a goal. */
export function placeTargetOf(config: AdminConfig | null, key: string): PlaceTargetDecision | null {
  const t = (config?.placeTargets ?? []).find((x) => x?.key === key);
  return t && Number.isFinite(t.goalPercent) && t.goalPercent >= 1 && t.goalPercent <= 100 ? t : null;
}

/**
 * The next row after the owner flips one switch. One entry per recipe and audience, the later flip wins; every other decision on the
 * row is carried through. Pure, like its siblings. Defaults are not stored: a flip back to the default is still an entry, so the
 * receipt that set it is kept.
 */
export function withDataSwitch(
  current: AdminConfig,
  change: { readonly recipe: string; readonly audience: string; readonly on: boolean; readonly decidedAt: string; readonly decidedBy: string; readonly receiptId: string },
): AdminConfig {
  const others = (current.dataSwitches ?? []).filter((x) => !(x?.recipe === change.recipe && x?.audience === change.audience));
  const next = [...others, { recipe: change.recipe, audience: change.audience, on: change.on, setAt: change.decidedAt, decidedBy: change.decidedBy, receiptId: change.receiptId }];
  return { ...current, formatVersion: ADMIN_CONFIG_FORMAT_VERSION, dataSwitches: next.sort((a, b) => a.recipe.localeCompare(b.recipe) || a.audience.localeCompare(b.audience)), updatedAt: change.decidedAt };
}

/** The owner's explicit decision for a recipe and audience, or null. A malformed entry reads as none, never as ON. */
export function dataSwitchOf(config: AdminConfig | null, recipe: string, audience: string): DataSwitchDecision | null {
  const x = (config?.dataSwitches ?? []).find((d) => d?.recipe === recipe && d?.audience === audience);
  return x && typeof x.on === "boolean" ? x : null;
}

/** One owner decision about paid discovery search. */
export interface DiscoverySearchDecision {
  /** May the discovery walk send paid search requests at all. */
  readonly enabled: boolean;
  readonly decidedAt: string;
  /** The admin session reference that decided it. Never a person's name. */
  readonly decidedBy: string;
  /** The gateway receipt that carries the decision. */
  readonly receiptId: string;
}

/**
 * One owner decision about the Fleet's rolling-24h model-spend ceiling.
 *
 * `previousUsd` is the ceiling in force the instant before this change — a prior
 * override, or the fallback — so the console can show what it was without a
 * second read, and the record answers "who changed it, when, and from what".
 */
export interface FleetSpendCeilingDecision {
  /** The rolling 24-hour model-spend ceiling the owner set, in USD. Always finite and > 0. */
  readonly rollingCeilingUsd: number;
  readonly decidedAt: string;
  /** The admin session reference that decided it. Never a person's name. */
  readonly decidedBy: string;
  /** The gateway receipt that carries the decision. */
  readonly receiptId: string;
  /** The ceiling in force immediately before this change: a prior override, or the fallback. */
  readonly previousUsd: number;
}

/**
 * The policy a control plane that has never been written to holds.
 *
 * Callable with no argument so "the default" is one expression everywhere, and
 * still a pure function of its input when a caller has a real instant to stamp.
 */
export function defaultAdminConfig(updatedAt: string = ADMIN_CONFIG_NEVER_WRITTEN): AdminConfig {
  return {
    formatVersion: ADMIN_CONFIG_FORMAT_VERSION,
    apiFallback: { enabled: false, decidedAt: null, decidedBy: null, receiptId: null },
    updatedAt,
  };
}

/**
 * The next policy after an owner decision about API fallback.
 *
 * Pure: the caller does the read, this computes the value, the caller does the
 * compare-and-set. Splitting it that way is what lets the whole decision path
 * be proven against the in-memory repositories without a clock or a database.
 */
export function withApiFallback(
  current: AdminConfig,
  change: {
    readonly enabled: boolean;
    readonly decidedAt: string;
    readonly decidedBy: string;
    readonly receiptId: string;
  },
): AdminConfig {
  return {
    ...current,
    formatVersion: ADMIN_CONFIG_FORMAT_VERSION,
    apiFallback: {
      enabled: change.enabled,
      decidedAt: change.decidedAt,
      decidedBy: change.decidedBy,
      receiptId: change.receiptId,
    },
    updatedAt: change.decidedAt,
  };
}

/**
 * The next policy after an owner sets the Fleet spend ceiling.
 *
 * Pure, exactly like {@link withApiFallback}: the caller reads, this computes,
 * the caller compare-and-sets. `previousUsd` is passed in rather than derived
 * here because the fallback ceiling lives in `fleet-safety.ts` and this module
 * stays free of it — the caller resolves override-or-fallback and hands the
 * result in.
 */
export function withFleetSpendCeiling(
  current: AdminConfig,
  change: {
    readonly rollingCeilingUsd: number;
    readonly previousUsd: number;
    readonly decidedAt: string;
    readonly decidedBy: string;
    readonly receiptId: string;
  },
): AdminConfig {
  return {
    ...current,
    formatVersion: ADMIN_CONFIG_FORMAT_VERSION,
    fleetSpendCeiling: {
      rollingCeilingUsd: change.rollingCeilingUsd,
      decidedAt: change.decidedAt,
      decidedBy: change.decidedBy,
      receiptId: change.receiptId,
      previousUsd: change.previousUsd,
    },
    updatedAt: change.decidedAt,
  };
}

/**
 * The next policy after an owner changes the expansion scope list.
 *
 * Pure, like its siblings: the caller reads, computes the list with
 * `withScopeSet` / `withScopeRemoved`, and compare-and-sets the result. Every
 * other decision on the row is carried through untouched.
 */
export function withExpansionScopes(
  current: AdminConfig,
  change: { readonly scopes: readonly ExpansionScopeDecision[]; readonly decidedAt: string },
): AdminConfig {
  return {
    ...current,
    formatVersion: ADMIN_CONFIG_FORMAT_VERSION,
    expansionScopes: [...change.scopes],
    updatedAt: change.decidedAt,
  };
}

/**
 * The next row after the owner records or removes a billing figure.
 *
 * Pure, like its siblings: the caller reads, computes the list with
 * `withFactRecorded` / `withFactRemoved`, and compare-and-sets the result.
 * Every decision on the row is carried through untouched.
 */
export function withBillingFacts(
  current: AdminConfig,
  change: { readonly facts: readonly BillingFact[]; readonly decidedAt: string },
): AdminConfig {
  return {
    ...current,
    formatVersion: ADMIN_CONFIG_FORMAT_VERSION,
    billingFacts: [...change.facts],
    updatedAt: change.decidedAt,
  };
}

/**
 * The next policy after an owner decides about paid discovery search.
 *
 * Pure, like its siblings: the caller reads, this computes, the caller
 * compare-and-sets. Every other decision on the row is carried through.
 */
export function withDiscoverySearch(
  current: AdminConfig,
  change: {
    readonly enabled: boolean;
    readonly decidedAt: string;
    readonly decidedBy: string;
    readonly receiptId: string;
  },
): AdminConfig {
  return {
    ...current,
    formatVersion: ADMIN_CONFIG_FORMAT_VERSION,
    discoverySearch: {
      enabled: change.enabled,
      decidedAt: change.decidedAt,
      decidedBy: change.decidedBy,
      receiptId: change.receiptId,
    },
    updatedAt: change.decidedAt,
  };
}

/**
 * Whether the owner has allowed paid discovery search. Only an explicit `true`
 * is ON; an absent decision, a malformed one and an unreadable row all read
 * OFF, so no failure path starts paid search.
 */
export function discoverySearchEnabled(config: AdminConfig | null): boolean {
  return config?.discoverySearch?.enabled === true;
}

/**
 * The override ceiling a config carries, or null when none stands.
 *
 * Null also for a malformed value — a non-finite or non-positive override is no
 * override, so the caller's resolver falls back to a real ceiling rather than
 * letting a corrupt row read as "spend nothing" or "spend without limit".
 */
export function fleetSpendCeilingOverrideUsd(config: AdminConfig | null): number | null {
  const override = config?.fleetSpendCeiling;
  if (override === null || override === undefined) return null;
  const usd = override.rollingCeilingUsd;
  return typeof usd === "number" && Number.isFinite(usd) && usd > 0 ? usd : null;
}

/** A stored value that is not a config at all reads as no config, never as ON. */
export function isAdminConfig(value: unknown): value is AdminConfig {
  if (value === null || typeof value !== "object") return false;
  const fallback = (value as { apiFallback?: unknown }).apiFallback;
  return (
    typeof fallback === "object" &&
    fallback !== null &&
    typeof (fallback as { enabled?: unknown }).enabled === "boolean"
  );
}

/** One read of the config row: the row (null when never written), or why it could not be read. */
export type AdminConfigRead =
  | { readonly row: { readonly value: unknown } | null }
  | { readonly unreadable: string };

/**
 * The config row as the runner may use it for PAID work (2026-09-25).
 *
 * `config` is the row only when it can be trusted: it was read, it is a
 * config, and any spend ceiling it carries is a positive finite number. A row
 * never written is trusted as the defaults — no override, paid search OFF,
 * nothing held. Anything else returns `config: null`, so every switch on the
 * row reads OFF, and `holdPaidWork` names why. The caller holds paid work on
 * that sentence rather than fall back to the built-in ceiling: the owner's dial
 * may be set BELOW the fallback, so an unreadable or corrupt row falling back
 * could raise the ceiling in force, and "not readable" is not "allowed".
 */
export function adminConfigForPaidWork(read: AdminConfigRead): {
  readonly config: AdminConfig | null;
  readonly holdPaidWork: string | null;
} {
  if ("unreadable" in read) {
    return { config: null, holdPaidWork: `the owner's config row (spend ceiling and paid-search switch) could not be read: ${read.unreadable}` };
  }
  if (read.row === null) return { config: null, holdPaidWork: null };
  const value = read.row.value;
  if (!isAdminConfig(value)) {
    return { config: null, holdPaidWork: "the owner's config row (spend ceiling and paid-search switch) is not a valid config" };
  }
  const ceiling = value.fleetSpendCeiling;
  if (ceiling !== null && ceiling !== undefined && fleetSpendCeilingOverrideUsd(value) === null) {
    const stated = typeof ceiling === "object" ? (ceiling as { rollingCeilingUsd?: unknown }).rollingCeilingUsd : ceiling;
    return {
      config: null,
      holdPaidWork: `the owner's spend ceiling on the config row is malformed (${String(stated).slice(0, 40)} is not a positive dollar amount)`,
    };
  }
  return { config: value, holdPaidWork: null };
}

/**
 * What the console may claim about the toggle today.
 *
 * §9A.22's own words for the state where the decision can be recorded but
 * nothing enforces it. The surface renders the plain sentence beside the
 * control; this constant exists so the surface and the gateway cannot disagree
 * about which state we are in.
 */
export const API_FALLBACK_ENFORCEMENT = "ACTIVE_IN_THE_AGENT_BRIDGE";

/**
 * The exact seam that is STILL missing, named rather than left to be rediscovered.
 *
 * ACLOSE-2 closed the half this toggle was written for: `liveExecutionChoice`
 * in `lib/control-plane/agents/execution.ts` reads this policy through
 * `apiFallbackPolicy`, and every delegated job now takes its path from it —
 * subscription first, REFUSE when the setting is off, and a paid adapter only
 * when the setting is on AND that provider has a governed one AND its
 * credential is present AND its ceiling permits. `runSingleJob` refuses rather
 * than running a paid path it cannot meter.
 *
 * What remains is a DIFFERENT consumer of the same word: the autonomous worker
 * runtime (`lib/control-plane/workers/runtime.ts`, `research-runtime.ts`) spends
 * against the credential named by `WORKER_CREDENTIAL_VAR` under its own
 * `RESEARCH_BOUNDS` ceiling and does not consult this owner setting. That is
 * governed spending rather than ungoverned spending — but it is not governed by
 * THIS switch, and saying so is the difference between a scope and a gap.
 */
export const API_FALLBACK_MISSING_SEAM =
  "The Agent Bridge enforces this setting: lib/control-plane/agents/execution.ts reads it on every " +
  "delegated job and refuses rather than billing when it is off. The autonomous worker runtime " +
  "(lib/control-plane/workers/runtime.ts and research-runtime.ts, where the credential named by " +
  "WORKER_CREDENTIAL_VAR is used) is a separate spender under its own RESEARCH_BOUNDS ceiling and " +
  "does not consult this switch; turning this off does not stop that.";
