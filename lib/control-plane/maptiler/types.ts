/**
 * **WHAT MAPTILER SAYS WE SPENT** — MAPQ-5, 2026-09-07.
 *
 * ## Why the provider is asked rather than counted here
 *
 * The first billing period closed at 101,863 requests against a 100,000
 * allowance, and this repository's own numbers could not confirm or refute a
 * single one of them: the requests are made by browsers, to a third party, and
 * nothing we host is on the path. The only authority on what MapTiler counted
 * is MapTiler.
 *
 * So this is an INGESTION of the provider's own analytics, read-only, with a
 * server-side service credential — never the public browser key, which cannot
 * read an account and must never be asked to.
 *
 * ## The record keeps the provider's own vocabulary
 *
 * A day row stores MapTiler's `classifier`, `item_id`, `label` and `group`
 * exactly as returned. Collapsing `Tiles` and `Rendered maps` into one
 * "requests" number at ingestion time is how a bill becomes unexplainable: the
 * two are billed differently and a session is not a request. Projection into
 * plain language happens later and separately, in `usage.ts`, where it can be
 * read and argued with.
 *
 * ## Provenance is machine-owned (RULING 252)
 *
 * Every fetch records its endpoint (with the token removed), the HTTP status,
 * the byte length, and a SHA-256 of the exact response body. That is enough to
 * re-run the same request and prove the number in the panel came from the bytes
 * the provider sent — without storing an account dump in the control plane and
 * without ever writing a credential next to it.
 *
 * ## NOT CONNECTED is a state, and it is not zero
 *
 * A missing service token means we have not asked. It must never render as
 * "you have used 0 requests", which is the single most dangerous wrong answer
 * this panel could give: it would read as headroom.
 */

/** The record shape. Bumped when the shape changes, never when the numbers do. */
export const MAPTILER_USAGE_FORMAT_VERSION = 1;

/** The service credential. Server-side only; never `NEXT_PUBLIC_`, never a log line. */
export const MAPTILER_SERVICE_TOKEN_VAR = "MAPTILER_SERVICE_TOKEN";

/** The allowance the account is actually on, when the owner has told us. */
export const MAPTILER_ALLOWANCE_VAR = "MAPTILER_MONTHLY_ALLOWANCE";

/**
 * The free-tier allowance the first overrun was measured against.
 *
 * A DEFAULT, and the panel says so: MapTiler does not return the plan ceiling
 * on the analytics endpoint, so a ceiling nobody confirmed is a stated
 * assumption rather than a fact. `MAPTILER_MONTHLY_ALLOWANCE` overrides it.
 */
export const DEFAULT_MAPTILER_ALLOWANCE = 100_000;

/** MapTiler's own classifiers. `api_keys` is the one attribution needs. */
export type MapTilerClassifier = "api_keys" | "services" | "service_credentials";

/** MapTiler's own request groups. A session is not a request and never becomes one here. */
export type MapTilerGroup = "request" | "session" | "export";

/** The billing period this reading covers. */
export type MapTilerPeriod =
  | "current_billing_period"
  | "last_billing_period"
  | "past_30_days"
  | "past_90_days";

/**
 * One (date, classifier item, group) count, exactly as the provider reported it.
 *
 * `estimated` matters: MapTiler's timeline includes projected data for the
 * remainder of the current period, and a projection presented as a measurement
 * is the kind of confident sentence about nothing this project has a rule
 * against.
 */
export interface MapTilerUsageDay {
  readonly date: string;
  readonly classifier: MapTilerClassifier;
  /** The provider's own id for the key or the service. */
  readonly itemId: string;
  /** The provider's own label. For `api_keys` this is the key NAME, never its value. */
  readonly label: string;
  readonly group: MapTilerGroup | string;
  readonly count: number;
  readonly estimated: boolean;
}

/** Enough to audit one number back to the bytes the provider sent. */
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
  /** We asked and the provider answered. */
  | "CONNECTED"
  /** No service credential in this runtime. We have not asked. NEVER zero usage. */
  | "NOT_CONNECTED"
  /** We asked and could not get an answer. Also never zero usage. */
  | "COULD_NOT_ASK";

/**
 * **THE PUBLISHED READING.** One aggregate, written by a publisher that can
 * reach both MapTiler and the reader store, read by the admin console at one
 * instant.
 */
export interface MapTilerUsageSnapshot {
  readonly formatVersion: number;
  readonly collectedAt: string;
  readonly publisher: string;
  readonly connection: MapTilerConnection;
  /** Why, when the connection is not CONNECTED. Plain language, for the owner. */
  readonly detail: string | null;
  readonly period: MapTilerPeriod;
  /** The billing window the provider itself reported, when it reported one. */
  readonly since: string | null;
  readonly until: string | null;
  /** The ceiling, and whether anybody confirmed it. */
  readonly allowance: number | null;
  readonly allowanceIsAssumed: boolean;
  readonly days: readonly MapTilerUsageDay[];
  readonly provenance: readonly MapTilerFetchProvenance[];
  /**
   * OUR OWN side of the comparison (MAPQ-7), when the publisher could read it.
   *
   * Aggregate counts of reader-app events by the actor class the runner already
   * declares — no new identity system, no person-level anything, no IP. It is
   * here rather than in a second aggregate so the two halves of the comparison
   * are read at one instant and cannot drift apart.
   */
  readonly actors: MapTilerActorCounts | null;
}

/**
 * **DECLARED SYNTHETIC VERSUS EVERYTHING ELSE**, on our side of the wire.
 *
 * Reuses `search_log.run_class` — the declaration `lib/db/run-marker.ts`
 * already carries — rather than inventing a second robot identity. Counts
 * only; the read path is the same allowlist every sold query goes through.
 *
 * **These are reader-app EVENTS, not map sessions**, and the panel says so.
 * Every session that reaches the Reader loads the map, so the two move
 * together, but one is not the other and calling an event count a session
 * count would be the kind of confident wrong number this whole repair exists
 * to stop producing.
 */
export interface MapTilerActorCounts {
  readonly since: string;
  readonly until: string;
  /** Runs that declared themselves automated. After MAPQ-1, these spend nothing at MapTiler. */
  readonly declaredSynthetic: number;
  /** Everything that declared nothing. The default, and what a reader looks like. */
  readonly undeclaredPublic: number;
  /** Attributable to neither — excluded from every aggregate, exactly as the store does. */
  readonly unattributed: number;
  /** The author using his own product. Not a robot and not a reader. */
  readonly author: number;
}
