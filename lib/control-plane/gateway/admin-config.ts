import type { BillingFact } from "../billing-facts.ts";
import type { ExpansionScopeDecision } from "../expansion/scopes.ts";

export const ADMIN_CONFIG_FORMAT_VERSION = 1;

export const ADMIN_CONFIG_ID = "current";

/** Never rendered: `apiFallback.decidedAt === null` is what means "never decided". */
export const ADMIN_CONFIG_NEVER_WRITTEN = "1970-01-01T00:00:00.000Z";

export interface AdminConfig {
  readonly latestBrief?: import("../admin-view/brief.ts").BriefSnapshot;
  readonly settings?: Readonly<Record<string, import("../settings.ts").SettingValue>>;
  /** The fix list (BR-03): broken things and their repairs. */
  readonly legacyFixQueueImportedAt?: string;
  readonly fixList?: readonly import("../fix-list.ts").FixItem[];
  readonly updates?: readonly import("../updates.ts").UpdateRecord[];
  readonly methodStandings?: readonly import("../../method/fix-status.ts").MethodStanding[];
  readonly scheduledOrders?: readonly import("./scheduled-orders.ts").ScheduledOrder[];
  readonly settingHistory?: readonly import("../settings.ts").SettingChange[];
  readonly owedOverlay?: import("../../coverage/owed-overlay.ts").OwedOverlayRecord;
  readonly routineRefreshRequests?: readonly import("../../civic-data/owner-refresh.ts").RoutineRefreshRequest[];
  /** Scoped, expiring requests that bring one meeting partition's next read forward. */
  readonly routineDueRequests?: readonly import("../../civic-data/routine-due-request.ts").RoutineDueRequest[];
  readonly formatVersion: 1;
  readonly apiFallback: {
    /** May paid API fallback be used at all. Defaults false and stays false through a restart. */
    readonly enabled: boolean;
    readonly decidedAt: string | null;
    readonly decidedBy: string | null;
    readonly receiptId: string | null;
  };
  /** Null means the built-in `FLEET_SAFETY_BOUNDS.rolling24HourModelUsd` governs; never "no ceiling". */
  readonly fleetSpendCeiling?: FleetSpendCeilingDecision | null;
  readonly expansionScopes?: readonly ExpansionScopeDecision[] | null;
  /** Owner-attested billing figures: an attestation, not policy. Nothing reads it to decide anything. */
  readonly billingFacts?: readonly BillingFact[] | null;
  /** Absent or null reads as OFF. Governs only the paid search step. */
  readonly discoverySearch?: DiscoverySearchDecision | null;
  readonly placeTargets?: readonly PlaceTargetDecision[] | null;
  /** An audience with no entry takes the default in `data-business/switches.ts`. */
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

/** A v6 place key: `us`, `st:<state>`, or `geo:<state>.<kind>.<geoid>`. */
export interface PlaceTargetDecision {
  readonly key: string;
  /** The share of what the place is owed that should be captured, 1 to 100. */
  readonly goalPercent: number;
  readonly setAt: string;
  readonly decidedBy: string;
  readonly receiptId: string;
}

export const PLACE_TARGET_KEY = /^(?:us|st:[a-z]{2}|geo:[a-z]{2}\.[a-z_]+\.[0-9A-Za-z]{1,16})$/;

/** `goalPercent: null` clears the target. */
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

/** A flip back to the default is still stored as an entry, so its receipt is kept. */
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

export interface DiscoverySearchDecision {
  readonly enabled: boolean;
  readonly decidedAt: string;
  readonly decidedBy: string;
  readonly receiptId: string;
}

export interface FleetSpendCeilingDecision {
  /** The rolling 24-hour model-spend ceiling the owner set, in USD. Always finite and > 0. */
  readonly rollingCeilingUsd: number;
  readonly decidedAt: string;
  readonly decidedBy: string;
  readonly receiptId: string;
  /** The ceiling in force immediately before this change: a prior override, or the fallback. */
  readonly previousUsd: number;
}

export function defaultAdminConfig(updatedAt: string = ADMIN_CONFIG_NEVER_WRITTEN): AdminConfig {
  return {
    formatVersion: ADMIN_CONFIG_FORMAT_VERSION,
    apiFallback: { enabled: false, decidedAt: null, decidedBy: null, receiptId: null },
    updatedAt,
  };
}

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

/** Only an explicit `true` is ON. */
export function discoverySearchEnabled(config: AdminConfig | null): boolean {
  return config?.discoverySearch?.enabled === true;
}

/** A non-finite or non-positive override reads as no override. */
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

export type AdminConfigRead =
  | { readonly row: { readonly value: unknown } | null }
  | { readonly unreadable: string };

/**
 * `config` is null unless the row was read, is a config and carries a valid ceiling; `holdPaidWork`
 * then says why. Paid work holds rather than falling back to the built-in ceiling, because the
 * owner's ceiling may be below the fallback.
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

export const API_FALLBACK_MISSING_SEAM =
  "The autonomous worker runtime (lib/control-plane/workers/runtime.ts and research-runtime.ts, where the credential named by " +
  "WORKER_CREDENTIAL_VAR is used) spends under its own RESEARCH_BOUNDS ceiling and " +
  "does not consult this switch; turning this off does not stop that.";
