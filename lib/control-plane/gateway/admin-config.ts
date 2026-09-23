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
  readonly routineRefreshRequests?: readonly import("../../civic-data/owner-refresh.ts").RoutineRefreshRequest[];
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
  readonly updatedAt: string;
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
