/**
 * Shared host, vendor and credential budgets. The budget is shared: every
 * worker touching one publisher contends on one HostBudget, because per-worker
 * politeness multiplies with fan-out.
 *
 *   - HOST: one origin. Concurrency, minimum interval, daily cap, backoff.
 *   - VENDOR: one supplier spanning many hosts (e.g. many tenants of one platform).
 *   - CREDENTIAL: an API key's own quota, shared by everyone who holds it.
 *
 * Pure functions of (ledger, host, now); nothing reads a clock. `tryAcquire`
 * returns a new ledger for the caller to thread.
 */

/** ---------------------------------------------------------------- budgets */

export interface HostBudget {
  /** Bare origin host, e.g. "example.legistar.com". Never a full URL. */
  readonly host: string;
  /** Requests in flight AT ONCE, across every worker in the system. */
  readonly maxConcurrent: number;
  /** Floor between the START of one request and the next, for this host. */
  readonly minIntervalMs: number;
  /** Requests per UTC day. Null means no daily cap has been established. */
  readonly dailyRequestCap: number | null;
  /** Set by `backoff()` on 429/503. Null when the host is not backed off. */
  readonly backoffUntil: string | null;
  /** `Crawl-delay` as the host itself published it; overrides a shorter `minIntervalMs`. */
  readonly observedCrawlDelayMs: number | null;
  /** Which vendor this host belongs to, if any. */
  readonly vendor: string | null;
}

export interface VendorBudget {
  /** e.g. "legistar", "granicus", "civicplus". */
  readonly vendor: string;
  /** Concurrency across the SUM of every host attributed to this vendor. */
  readonly maxConcurrent: number;
  /** Daily cap across the SUM. Null means none established. */
  readonly dailyRequestCap: number | null;
  readonly backoffUntil: string | null;
}

export interface CredentialBudget {
  /** Opaque handle. NEVER the secret itself, and never any part of it. */
  readonly credentialId: string;
  readonly vendor: string | null;
  /** Quota as the ISSUER states it, not as we hope it is. */
  readonly dailyRequestCap: number | null;
  readonly maxConcurrent: number | null;
  readonly backoffUntil: string | null;
}

/** Live counters for one host. Derived state only; never authored by a worker. */
export interface HostState {
  readonly inFlight: number;
  readonly lastRequestAt: string | null;
  readonly requestsToday: number;
  /** UTC day (YYYY-MM-DD) `requestsToday` counts. Rolls over on comparison. */
  readonly day: string | null;
  readonly backoffUntil: string | null;
  readonly backoffReason: string | null;
}

export interface CredentialState {
  readonly inFlight: number;
  readonly requestsToday: number;
  readonly day: string | null;
}

export interface BudgetLedger {
  readonly hosts: Readonly<Record<string, HostBudget>>;
  readonly vendors: Readonly<Record<string, VendorBudget>>;
  readonly credentials: Readonly<Record<string, CredentialBudget>>;
  readonly hostState: Readonly<Record<string, HostState>>;
  readonly credentialState: Readonly<Record<string, CredentialState>>;
  /**
   * Dollar holds paid work took against Send and area budgets, on this shared
   * ledger so concurrent work decides against the same remaining budget
   * (`expansion/spend-holds.ts`). Absent on a ledger no budgeted work touched.
   */
  readonly spendHolds?: Readonly<Record<string, SpendHold>>;
}

/** One hold on a Send or area budget (`spend-holds.ts` carries the rule). */
export interface SpendHold {
  readonly holdId: string;
  /** The job (one Scout dispatch) the hold is for; a job's holds settle together. */
  readonly jobId: string;
  readonly obligationId: string;
  /** Budget keys: `send:<assignment key>` and `area:<scope key>`. */
  readonly keys: readonly string[];
  /** These lines never expire at midnight or after a restart. */
  readonly lifetimeKeys?: readonly string[];
  /** The worst case reserved. */
  readonly usd: number;
  readonly heldAt: string;
  /** What the hold is for, in words: the job, an escalation, a pre-warm, a request past the job's hold. */
  readonly what: string;
  /** Null while the work runs (or after a crash): the whole hold counts until its window ends. */
  readonly settled: { readonly usd: number; readonly costRecordedAt: string } | null;
}

/** A concurrency refusal has no knowable wait; the stated wait is a retry hint. */
export const CONCURRENCY_RETRY_HINT_MS = 250;

const EMPTY_HOST_STATE: HostState = {
  inFlight: 0,
  lastRequestAt: null,
  requestsToday: 0,
  day: null,
  backoffUntil: null,
  backoffReason: null,
};

const EMPTY_CREDENTIAL_STATE: CredentialState = { inFlight: 0, requestsToday: 0, day: null };

export function createLedger(input: {
  hosts: readonly HostBudget[];
  vendors?: readonly VendorBudget[];
  credentials?: readonly CredentialBudget[];
}): BudgetLedger {
  const hosts: Record<string, HostBudget> = {};
  const hostState: Record<string, HostState> = {};
  for (const h of input.hosts) {
    hosts[h.host] = h;
    hostState[h.host] = { ...EMPTY_HOST_STATE, backoffUntil: h.backoffUntil };
  }
  const vendors: Record<string, VendorBudget> = {};
  for (const v of input.vendors ?? []) vendors[v.vendor] = v;
  const credentials: Record<string, CredentialBudget> = {};
  const credentialState: Record<string, CredentialState> = {};
  for (const c of input.credentials ?? []) {
    credentials[c.credentialId] = c;
    credentialState[c.credentialId] = EMPTY_CREDENTIAL_STATE;
  }
  return { hosts, vendors, credentials, hostState, credentialState };
}

/** ------------------------------------------------------------- acquisition */

export const BUDGET_REFUSALS = [
  "UNREGISTERED_HOST",
  "HOST_BACKOFF",
  "HOST_CONCURRENCY",
  "HOST_MIN_INTERVAL",
  "HOST_DAILY_CAP",
  "VENDOR_BACKOFF",
  "VENDOR_CONCURRENCY",
  "VENDOR_DAILY_CAP",
  "CREDENTIAL_UNKNOWN",
  "CREDENTIAL_BACKOFF",
  "CREDENTIAL_CONCURRENCY",
  "CREDENTIAL_DAILY_CAP",
] as const;
export type BudgetRefusal = (typeof BUDGET_REFUSALS)[number];

export interface AcquireResult {
  readonly granted: boolean;
  /** The ledger to thread onward. Unchanged when the acquire was refused. */
  readonly ledger: BudgetLedger;
  /** How long to wait before retrying. 0 only when granted. */
  readonly waitMs: number;
  /** Machine-readable refusal class, null when granted. */
  readonly refusal: BudgetRefusal | null;
  /** Prose naming the scope that refused and the number it refused against. */
  readonly reason: string;
}

function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

function msUntilNextUtcDay(now: string): number {
  const next = Date.parse(`${utcDay(now)}T00:00:00.000Z`) + 24 * 60 * 60 * 1000;
  return Math.max(next - Date.parse(now), 0);
}

/** Today's counters, rolled over if `now` is a later UTC day. */
function todayState(state: HostState, now: string): HostState {
  const day = utcDay(now);
  if (state.day === day) return state;
  return { ...state, day, requestsToday: 0 };
}

function todayCredentialState(state: CredentialState, now: string): CredentialState {
  const day = utcDay(now);
  if (state.day === day) return state;
  return { ...state, day, requestsToday: 0 };
}

/** The interval actually owed to this host: our floor, or its own stated delay. */
export function effectiveIntervalMs(budget: HostBudget): number {
  return Math.max(budget.minIntervalMs, budget.observedCrawlDelayMs ?? 0);
}

/** Every host currently attributed to a vendor. */
export function hostsOfVendor(ledger: BudgetLedger, vendor: string): HostBudget[] {
  return Object.values(ledger.hosts).filter((h) => h.vendor === vendor);
}

/** In-flight SUMMED across a vendor's hosts. Derived, so it cannot drift. */
export function vendorInFlight(ledger: BudgetLedger, vendor: string): number {
  return hostsOfVendor(ledger, vendor).reduce(
    (sum, h) => sum + (ledger.hostState[h.host]?.inFlight ?? 0),
    0,
  );
}

/** Today's requests SUMMED across a vendor's hosts. */
export function vendorRequestsToday(ledger: BudgetLedger, vendor: string, now: string): number {
  return hostsOfVendor(ledger, vendor).reduce((sum, h) => {
    const state = ledger.hostState[h.host];
    if (!state) return sum;
    return sum + (state.day === utcDay(now) ? state.requestsToday : 0);
  }, 0);
}

function refuse(
  ledger: BudgetLedger,
  refusal: BudgetRefusal,
  waitMs: number,
  reason: string,
): AcquireResult {
  return { granted: false, ledger, waitMs: Math.max(waitMs, 0), refusal, reason };
}

/** Ask the shared budget to make one request to `host`. A host with no registered budget is refused. */
export function tryAcquire(
  ledger: BudgetLedger,
  host: string,
  now: string,
  opts: { credentialId?: string } = {},
): AcquireResult {
  const budget = ledger.hosts[host];
  if (!budget) {
    return refuse(
      ledger,
      "UNREGISTERED_HOST",
      CONCURRENCY_RETRY_HINT_MS,
      `No HostBudget is registered for ${host}. The politeness owed to an uncharacterised ` +
        "publisher is unknown, and an unknown budget refuses rather than assuming one.",
    );
  }

  const state = todayState(ledger.hostState[host] ?? EMPTY_HOST_STATE, now);
  const nowMs = Date.parse(now);
  const interval = effectiveIntervalMs(budget);

  const backoffUntil = state.backoffUntil ?? budget.backoffUntil;
  if (backoffUntil && Date.parse(backoffUntil) > nowMs) {
    return refuse(
      ledger,
      "HOST_BACKOFF",
      Date.parse(backoffUntil) - nowMs,
      `${host} is backed off until ${backoffUntil}` +
        (state.backoffReason ? ` (${state.backoffReason})` : "") +
        ". A backed-off host is not retried early by any worker.",
    );
  }

  if (state.inFlight >= budget.maxConcurrent) {
    return refuse(
      ledger,
      "HOST_CONCURRENCY",
      Math.max(interval, CONCURRENCY_RETRY_HINT_MS),
      `${host} is at its SHARED concurrency limit: ${state.inFlight} of ${budget.maxConcurrent} ` +
        "in flight across all workers. The limit belongs to the host, not to a worker, so a " +
        "second worker does not get a second allowance.",
    );
  }

  if (state.lastRequestAt !== null && interval > 0) {
    const elapsed = nowMs - Date.parse(state.lastRequestAt);
    if (elapsed < interval) {
      return refuse(
        ledger,
        "HOST_MIN_INTERVAL",
        interval - elapsed,
        `${host} owes ${interval}ms between requests` +
          (budget.observedCrawlDelayMs !== null
            ? ` (its own published crawl-delay is ${budget.observedCrawlDelayMs}ms)`
            : "") +
          `; ${elapsed}ms have passed since ${state.lastRequestAt}.`,
      );
    }
  }

  if (budget.dailyRequestCap !== null && state.requestsToday >= budget.dailyRequestCap) {
    return refuse(
      ledger,
      "HOST_DAILY_CAP",
      msUntilNextUtcDay(now),
      `${host} has used ${state.requestsToday} of its ${budget.dailyRequestCap} requests for ` +
        `${utcDay(now)}. The cap resets at the next UTC day.`,
    );
  }

  if (budget.vendor) {
    const vendor = ledger.vendors[budget.vendor];
    if (vendor) {
      if (vendor.backoffUntil && Date.parse(vendor.backoffUntil) > nowMs) {
        return refuse(
          ledger,
          "VENDOR_BACKOFF",
          Date.parse(vendor.backoffUntil) - nowMs,
          `Vendor ${vendor.vendor} is backed off until ${vendor.backoffUntil}; that covers ` +
            `${host} even though the host itself is clear.`,
        );
      }
      const inFlight = vendorInFlight(ledger, vendor.vendor);
      if (inFlight >= vendor.maxConcurrent) {
        return refuse(
          ledger,
          "VENDOR_CONCURRENCY",
          Math.max(interval, CONCURRENCY_RETRY_HINT_MS),
          `Vendor ${vendor.vendor} is at ${inFlight} of ${vendor.maxConcurrent} concurrent ` +
            `across ${hostsOfVendor(ledger, vendor.vendor).length} host(s). ${host} is under its ` +
            "own host limit, but the vendor budget constrains the SUM.",
        );
      }
      if (vendor.dailyRequestCap !== null) {
        const used = vendorRequestsToday(ledger, vendor.vendor, now);
        if (used >= vendor.dailyRequestCap) {
          return refuse(
            ledger,
            "VENDOR_DAILY_CAP",
            msUntilNextUtcDay(now),
            `Vendor ${vendor.vendor} has used ${used} of ${vendor.dailyRequestCap} requests ` +
              `across all its hosts for ${utcDay(now)}.`,
          );
        }
      }
    }
  }

  let credentialState: CredentialState | null = null;
  if (opts.credentialId !== undefined) {
    const credential = ledger.credentials[opts.credentialId];
    if (!credential) {
      return refuse(
        ledger,
        "CREDENTIAL_UNKNOWN",
        CONCURRENCY_RETRY_HINT_MS,
        `Credential ${opts.credentialId} has no registered budget. An unquantified key is ` +
          "refused rather than spent against a quota nobody recorded.",
      );
    }
    credentialState = todayCredentialState(
      ledger.credentialState[opts.credentialId] ?? EMPTY_CREDENTIAL_STATE,
      now,
    );
    if (credential.backoffUntil && Date.parse(credential.backoffUntil) > nowMs) {
      return refuse(
        ledger,
        "CREDENTIAL_BACKOFF",
        Date.parse(credential.backoffUntil) - nowMs,
        `Credential ${credential.credentialId} is backed off until ${credential.backoffUntil}.`,
      );
    }
    if (
      credential.maxConcurrent !== null &&
      credentialState.inFlight >= credential.maxConcurrent
    ) {
      return refuse(
        ledger,
        "CREDENTIAL_CONCURRENCY",
        Math.max(interval, CONCURRENCY_RETRY_HINT_MS),
        `Credential ${credential.credentialId} is at ${credentialState.inFlight} of ` +
          `${credential.maxConcurrent} concurrent. The quota follows the key, not the worker.`,
      );
    }
    if (
      credential.dailyRequestCap !== null &&
      credentialState.requestsToday >= credential.dailyRequestCap
    ) {
      return refuse(
        ledger,
        "CREDENTIAL_DAILY_CAP",
        msUntilNextUtcDay(now),
        `Credential ${credential.credentialId} has used ${credentialState.requestsToday} of ` +
          `${credential.dailyRequestCap} requests for ${utcDay(now)}.`,
      );
    }
  }

  const nextHostState: HostState = {
    ...state,
    inFlight: state.inFlight + 1,
    lastRequestAt: now,
    requestsToday: state.requestsToday + 1,
    day: utcDay(now),
  };

  const nextLedger: BudgetLedger = {
    ...ledger,
    hostState: { ...ledger.hostState, [host]: nextHostState },
    credentialState:
      opts.credentialId !== undefined && credentialState
        ? {
            ...ledger.credentialState,
            [opts.credentialId]: {
              inFlight: credentialState.inFlight + 1,
              requestsToday: credentialState.requestsToday + 1,
              day: utcDay(now),
            },
          }
        : ledger.credentialState,
  };

  return {
    granted: true,
    ledger: nextLedger,
    waitMs: 0,
    refusal: null,
    reason: `${host}: ${nextHostState.inFlight} of ${budget.maxConcurrent} in flight, ` +
      `${nextHostState.requestsToday} request(s) today.`,
  };
}

/** Return a slot. Floors at zero so a double release cannot hand out free concurrency. */
export function release(
  ledger: BudgetLedger,
  host: string,
  opts: { credentialId?: string } = {},
): BudgetLedger {
  const state = ledger.hostState[host];
  const next: BudgetLedger = {
    ...ledger,
    hostState: state
      ? { ...ledger.hostState, [host]: { ...state, inFlight: Math.max(state.inFlight - 1, 0) } }
      : ledger.hostState,
  };
  if (opts.credentialId === undefined) return next;
  const cs = ledger.credentialState[opts.credentialId];
  if (!cs) return next;
  return {
    ...next,
    credentialState: {
      ...next.credentialState,
      [opts.credentialId]: { ...cs, inFlight: Math.max(cs.inFlight - 1, 0) },
    },
  };
}

/** Record a 429/503 (or a Retry-After) as a shared, named backoff. `why` is required. */
export function backoff(
  ledger: BudgetLedger,
  host: string,
  until: string,
  why: string,
): BudgetLedger {
  const state = ledger.hostState[host] ?? EMPTY_HOST_STATE;
  const existing = state.backoffUntil;
  // Never shorten an existing backoff.
  const applied =
    existing && Date.parse(existing) > Date.parse(until) ? existing : until;
  return {
    ...ledger,
    hostState: {
      ...ledger.hostState,
      [host]: { ...state, backoffUntil: applied, backoffReason: why },
    },
  };
}

/** Lift a backoff once it has actually elapsed. Never early. */
export function clearBackoff(ledger: BudgetLedger, host: string, now: string): BudgetLedger {
  const state = ledger.hostState[host];
  if (!state?.backoffUntil) return ledger;
  if (Date.parse(state.backoffUntil) > Date.parse(now)) return ledger;
  return {
    ...ledger,
    hostState: {
      ...ledger.hostState,
      [host]: { ...state, backoffUntil: null, backoffReason: null },
    },
  };
}

/** What a budget report says out loud. */
export function describeBudget(ledger: BudgetLedger, host: string): string {
  const budget = ledger.hosts[host];
  if (!budget) return `${host}: NO REGISTERED BUDGET (acquires are refused)`;
  const state = ledger.hostState[host] ?? EMPTY_HOST_STATE;
  const parts = [
    `${host}: ${state.inFlight}/${budget.maxConcurrent} in flight`,
    `interval ${effectiveIntervalMs(budget)}ms`,
    `today ${state.requestsToday}${budget.dailyRequestCap === null ? "" : `/${budget.dailyRequestCap}`}`,
  ];
  if (budget.vendor) parts.push(`vendor ${budget.vendor} sum ${vendorInFlight(ledger, budget.vendor)}`);
  if (state.backoffUntil) parts.push(`BACKED OFF until ${state.backoffUntil} (${state.backoffReason ?? "unnamed"})`);
  return parts.join(", ");
}
