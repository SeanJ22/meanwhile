/**
 * Transient-connect resilience for the Postgres control plane.
 *
 * The Neon serverless driver is HTTP-per-query, so the FIRST query a process
 * issues is also its connect. Under host load that connect can fail
 * transiently: the driver throws `NeonDbError: Error connecting to database:
 * <transport>` — a message it emits ONLY when the underlying `fetch` itself
 * threw before any HTTP response arrived (its `sourceError` is the raw
 * `TypeError: fetch failed`, `ECONNRESET`, an aborted deadline, …). A SQL error
 * or an HTTP-status refusal is a different thing: it comes back as a parsed
 * response the driver turns into a `NeonDbError` carrying a SQLSTATE `code`, not
 * this transport message.
 *
 * Before this, that single transient throw at cycle START aborted a whole
 * standing-runner cycle. The per-cycle child crashed ~2s in having dispatched
 * nothing, the supervisor's 60-minute loop stayed up and relaunched, and the
 * failure presented as ~15-second cycles doing no work while civic-data
 * promotion and the scout lane went unrun. A ten-read manual probe of the same
 * endpoint succeeded every time: the endpoint was healthy, the connect blipped.
 *
 * So: retry that establishment-transient class a bounded number of times with
 * exponential backoff and jitter, and ONLY that class. Two things are never
 * retried here:
 *   - a latched host-local Neon circuit (`PROVIDER_CIRCUIT_BROKEN` from
 *     installNeonCircuitBreaker) — that is a HARD, billing/quota-class refusal
 *     whose own contract forbids an automated retry before its eligible time;
 *   - anything that is not a transport-establishment failure (a SQL error, an
 *     HTTP-status refusal, a 64 MiB over-cap read) — those are not blips and a
 *     retry would only fail again or, worse, re-issue non-idempotent work.
 *
 * And it is only ever wrapped around IDEMPOTENT connect work: the idempotent
 * schema `bootstrap`, or a read-only connectivity probe / read. It must never
 * wrap an arbitrary write: retrying a write whose RESPONSE was lost (the write
 * committed, the connection dropped on the way back) could double-apply it —
 * which the append-only and compare-and-set identities refuse, but should never
 * be asked to. The request-deadline (installNeonRequestDeadline) composes
 * cleanly: it bounds each attempt, so a HUNG connect aborts and becomes one
 * more retryable transient rather than stalling the cycle.
 *
 * Shape mirrors the bounded compareAndSet retry in scout-candidates.ts (a fixed
 * attempt count, re-throw on the last), with added backoff because the
 * condition is a transient network blip, not a lost write race.
 */

/** Attempts INCLUDING the first try. 5 = one try plus four retries. */
export const CONTROL_PLANE_CONNECT_MAX_ATTEMPTS = 5;
/** First backoff; each subsequent one doubles until the cap. */
export const CONTROL_PLANE_CONNECT_BASE_BACKOFF_MS = 250;
/** No single backoff exceeds this, so the total stays bounded. */
export const CONTROL_PLANE_CONNECT_MAX_BACKOFF_MS = 4_000;

/**
 * The transport-establishment failure family, matched on message text. The
 * primary, unambiguous signal is the driver's own `Error connecting to
 * database` (see the file header); the rest are the raw Node transport errors
 * that can surface directly, plus the deadline's abort/timeout.
 */
const TRANSIENT_TRANSPORT =
  /error connecting to database|fetch failed|econnreset|econnrefused|enotfound|eai_again|etimedout|socket hang up|network error|und_err|terminated|the operation was aborted|operation timed out|timed out|timeout/i;

/** A latched circuit is a HARD refusal; its message is never a retry signal. */
const HARD_CIRCUIT = /PROVIDER_CIRCUIT_BROKEN/;

function messageOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(value);
}

function nameOf(value: unknown): string {
  if (value && typeof value === "object") {
    const name = (value as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

/**
 * True when `error` is a transient failure to ESTABLISH the control-plane
 * connection — the narrow class it is safe and useful to retry. Walks the
 * `cause` / `sourceError` chain the driver populates, and refuses a latched
 * circuit outright. `DOMException` (the deadline's abort) is duck-typed rather
 * than `instanceof Error`, because in Node it does not extend `Error`.
 */
export function isTransientControlPlaneConnectError(error: unknown): boolean {
  if (HARD_CIRCUIT.test(messageOf(error))) return false;

  const seen = new Set<unknown>();
  let cursor: unknown = error;
  for (let depth = 0; cursor !== null && cursor !== undefined && depth < 8; depth += 1) {
    if (seen.has(cursor)) break;
    seen.add(cursor);

    const message = messageOf(cursor);
    if (HARD_CIRCUIT.test(message)) return false;
    // The driver names a transport-establishment failure exactly; trust that
    // before the broader message match, which is only a backstop for a raw
    // transport error surfacing without the wrapper.
    if (nameOf(cursor) === "NeonDbError" && /error connecting to database/i.test(message)) {
      return true;
    }
    if (TRANSIENT_TRANSPORT.test(message)) return true;

    if (cursor && typeof cursor === "object") {
      const next = (cursor as { sourceError?: unknown; cause?: unknown });
      cursor = next.sourceError ?? next.cause ?? null;
    } else {
      break;
    }
  }
  return false;
}

export interface ControlPlaneConnectRetryOptions {
  /** Attempts including the first. Default CONTROL_PLANE_CONNECT_MAX_ATTEMPTS. */
  readonly maxAttempts?: number;
  readonly baseBackoffMs?: number;
  readonly maxBackoffMs?: number;
  /** Injected for tests so no real time passes. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injected for tests so the jittered delay is deterministic. */
  readonly random?: () => number;
  /** Observability hook, fired once per retry (never on the first attempt). */
  readonly onRetry?: (info: {
    readonly attempt: number;
    readonly delayMs: number;
    readonly error: unknown;
  }) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying ONLY transient connection-establishment failures (see
 * isTransientControlPlaneConnectError) up to `maxAttempts`, with capped
 * exponential backoff and full jitter between tries. Any other error — and the
 * transient one on the final attempt — throws unchanged, so a persistent
 * outage still fails loudly and is recorded; nothing is masked as success.
 */
export async function withControlPlaneConnectRetry<T>(
  fn: () => Promise<T>,
  options: ControlPlaneConnectRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? CONTROL_PLANE_CONNECT_MAX_ATTEMPTS));
  const base = Math.max(0, options.baseBackoffMs ?? CONTROL_PLANE_CONNECT_BASE_BACKOFF_MS);
  const cap = Math.max(base, options.maxBackoffMs ?? CONTROL_PLANE_CONNECT_MAX_BACKOFF_MS);
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxAttempts || !isTransientControlPlaneConnectError(error)) throw error;
      const ceiling = Math.min(cap, base * 2 ** (attempt - 1));
      const delayMs = Math.round(random() * ceiling);
      options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}
