/** The record shape. Bumped when the shape changes, never when the numbers do. */
export const MAPTILER_USAGE_FORMAT_VERSION = 2;

/** The service credential. Server-side only; never `NEXT_PUBLIC_`, never a log line. */
export const MAPTILER_SERVICE_TOKEN_VAR = "MAPTILER_SERVICE_TOKEN";

export const MAPTILER_ALLOWANCE_VAR = "MAPTILER_MONTHLY_ALLOWANCE";

/** A default, not a confirmed plan ceiling: the analytics endpoint does not return it. `MAPTILER_MONTHLY_ALLOWANCE` overrides it. */
export const DEFAULT_MAPTILER_ALLOWANCE = 100_000;

export type MapTilerClassifier = "api_keys" | "services" | "service_credentials";

export type MapTilerGroup = "request" | "session" | "export";

export type MapTilerPeriod =
  | "current_billing_period"
  | "last_billing_period"
  | "past_30_days"
  | "past_90_days";

/** `estimated` marks the provider's projection for the rest of the period, not a measurement. */
export interface MapTilerUsageDay {
  readonly date: string;
  readonly classifier: MapTilerClassifier;
  readonly itemId: string;
  /** The provider's own label. For `api_keys` this is the key name, never its value. */
  readonly label: string;
  readonly group: MapTilerGroup | string;
  readonly count: number;
  readonly estimated: boolean;
}

export interface MapTilerFetchProvenance {
  /** The URL asked for, with the credential removed. */
  readonly endpoint: string;
  readonly classifier: MapTilerClassifier;
  readonly group: MapTilerGroup;
  readonly requestedAt: string;
  readonly status: number;
  readonly responseBytes: number;
  /** SHA-256 of the exact response body, hex. Re-fetch and compare. */
  readonly responseSha256: string;
  readonly datasets: number;
  readonly points: number;
  /** What went wrong, when something did. Never a token, never a URL with one in it. */
  readonly error: string | null;
}

export type MapTilerConnection =
  | "CONNECTED"
  /** No service credential in this runtime. We have not asked. NEVER zero usage. */
  | "NOT_CONNECTED"
  /** We asked and could not get an answer. Also never zero usage. */
  | "COULD_NOT_ASK";

/** The newest collection attempt, kept beside the retained good reading so a failed refresh is visible without replacing it. */
export interface MapTilerUsageAttempt {
  readonly attemptedAt: string;
  readonly connection: MapTilerConnection;
  readonly detail: string | null;
  readonly provenance: readonly MapTilerFetchProvenance[];
}

export interface MapTilerUsageSnapshot {
  readonly formatVersion: number;
  readonly collectedAt: string;
  readonly publisher: string;
  readonly connection: MapTilerConnection;
  readonly detail: string | null;
  readonly period: MapTilerPeriod;
  readonly since: string | null;
  readonly until: string | null;
  readonly allowance: number | null;
  readonly allowanceIsAssumed: boolean;
  readonly days: readonly MapTilerUsageDay[];
  readonly provenance: readonly MapTilerFetchProvenance[];
  /** Optional only for version-one snapshots written before the standing collector. */
  readonly latestAttempt?: MapTilerUsageAttempt | null;
  readonly actors: MapTilerActorCounts | null;
  /** Why the reader-event comparison is unknown. Null when `actors` is measured. */
  readonly actorsDetail?: string | null;
}

/** Reader-app events, not map sessions, split by the declared `search_log.run_class`. Counts only. */
export interface MapTilerActorCounts {
  readonly since: string;
  readonly until: string;
  readonly declaredSynthetic: number;
  readonly undeclaredPublic: number;
  /** Attributable to neither — excluded from every aggregate, exactly as the store does. */
  readonly unattributed: number;
  readonly author: number;
}
