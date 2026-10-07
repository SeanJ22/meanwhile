/**
 * Retries only transient failures to establish a Postgres connection (the driver's `Error connecting to
 * database`, raw transport errors, a REQUEST-kind timeout). Never retries a latched Neon circuit, a
 * DEADLINE-kind timeout, a SQL error or an HTTP-status refusal. Wrap only idempotent work: a retried
 * write whose response was lost could double-apply.
 */
import { isControlPlaneRequestTimeout } from "./request-bounds.ts";

/** Attempts INCLUDING the first try. 5 = one try plus four retries. */
export const CONTROL_PLANE_CONNECT_MAX_ATTEMPTS = 5;
/** First backoff; each subsequent one doubles until the cap. */
export const CONTROL_PLANE_CONNECT_BASE_BACKOFF_MS = 250;
/** No single backoff exceeds this, so the total stays bounded. */
export const CONTROL_PLANE_CONNECT_MAX_BACKOFF_MS = 4_000;

/** The transport-establishment failure family, matched on message text. */
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

/** Walks the `cause` / `sourceError` chain and refuses a latched circuit outright. */
export function isTransientControlPlaneConnectError(error: unknown): boolean {
  if (HARD_CIRCUIT.test(messageOf(error))) return false;

  const seen = new Set<unknown>();
  let cursor: unknown = error;
  for (let depth = 0; cursor !== null && cursor !== undefined && depth < 8; depth += 1) {
    if (seen.has(cursor)) break;
    seen.add(cursor);

    // A named control-plane timeout decides for itself, before the broad message match.
    if (isControlPlaneRequestTimeout(cursor)) return cursor.retryable;

    const message = messageOf(cursor);
    if (HARD_CIRCUIT.test(message)) return false;
    // The driver's exact transport-establishment message is trusted before the broader backstop match.
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
  /** Replaces isTransientControlPlaneConnectError for a caller whose read names its own failure; the caller then owns refusing a latched circuit. */
  readonly isRetryable?: (error: unknown) => boolean;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Capped exponential backoff with full jitter. Any other error, and the transient one on the final attempt, throws unchanged. */
export async function withControlPlaneConnectRetry<T>(
  fn: () => Promise<T>,
  options: ControlPlaneConnectRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? CONTROL_PLANE_CONNECT_MAX_ATTEMPTS));
  const base = Math.max(0, options.baseBackoffMs ?? CONTROL_PLANE_CONNECT_BASE_BACKOFF_MS);
  const cap = Math.max(base, options.maxBackoffMs ?? CONTROL_PLANE_CONNECT_MAX_BACKOFF_MS);
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const isRetryable = options.isRetryable ?? isTransientControlPlaneConnectError;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryable(error)) throw error;
      const ceiling = Math.min(cap, base * 2 ** (attempt - 1));
      const delayMs = Math.round(random() * ceiling);
      options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}
