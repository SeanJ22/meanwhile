/**
 * **EVERY CONTROL-PLANE STORE CALL IS BOUNDED BY ITS CLASS, AND A TIMEOUT HAS
 * A NAME.** (Runner bounded store calls, 2026-09-23.)
 *
 * ## Why
 *
 * On 2026-09-23 the first research cycle after four of five runner relaunches
 * ran into the supervisor's 15-minute wall (04:11Z, 17:32:59Z, 19:34:18Z,
 * 21:35:02Z) and left no crash record, no FRESHNESS_CYCLE digest and nothing on
 * stderr. The one bound on a Neon request was installNeonRequestDeadline's
 * process-wide 30 s transport deadline. A request that hit it surfaced as the
 * driver's generic `Error connecting to database: TimeoutError`, or as a bare
 * `TimeoutError` when it fired during the body. Nothing named the call, and the
 * research-state write retried up to four read-and-CAS pairs without a word.
 * Four minutes of silent 30 s timeouts cannot be told from a hang.
 *
 * ## The classes, sized from measurement
 *
 * Measured read-only against the production control plane on 2026-09-23
 * (host SeanLenovo, every page in a database-enforced READ ONLY transaction,
 * the cycle's exact keyset pages):
 *
 * ```
 *   class     what it covers                            measured                         bound
 *   POINT     one small row, a small write, a log       p50 87 ms; worst 324 ms on a     10 s
 *             head, an advisory lock, a DDL statement   fresh connection
 *   DOCUMENT  one row that is a large document:         169-615 ms per 0.8-1.5 MB row    20 s
 *             research state 1.1 MB, field manual
 *             1.4 MB, method candidates 0.8 MB, owner
 *             snapshot 428 KB; appends to the logs
 *             whose records reach 73-708 KB
 *   PAGE      one keyset page of at most 100 rows       0.1-0.3 s typical; largest       25 s
 *                                                       3.85 MB in 0.55 s; 2.43 MB in
 *                                                       0.95 s under 11 parallel reads
 * ```
 *
 * Each bound is about 30 times the slowest request measured in its class. POINT
 * also covers one full connect-window walk (three IPv4 addresses at the 2.5 s
 * window of connect-attempt-window.ts, 7.5 s). PAGE stays under the 30 s
 * process-wide transport deadline, so where both are installed the named bound
 * fires first; the 30 s deadline remains the backstop for every Neon request
 * that does not come through here.
 *
 * ## A budget around a group of calls
 *
 * A request bound caps one HTTP request, not an operation that makes many.
 * `withStoreBudget` sets a deadline for every call made inside it: each request
 * gets the smaller of its class bound and the time left, and a call made after
 * the budget is spent fails at once without touching the network. That is how
 * the research cycle's finalization steps complete or fail by name inside their
 * own budgets, well inside the wall.
 *
 * ## The two kinds of timeout
 *
 * ```
 *   REQUEST   the class bound fired. The store did not answer in time; the next
 *             attempt may. Retryable: connect-retry and the startup-read retry
 *             retry it where they already retry a transport failure.
 *   DEADLINE  the enclosing budget ran out. Retrying cannot help, and is not done.
 * ```
 *
 * The request is cancelled through the driver's fetch (`fetchOptions.signal`),
 * so an abandoned request does not keep running. The call also settles from its
 * own timer, so a transport that ignores the signal cannot hold it either.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { withQueryCaller } from "../../db/transfer-by-caller.ts";

export const CONTROL_PLANE_CALL_CLASSES = ["POINT", "DOCUMENT", "PAGE"] as const;
export type ControlPlaneCallClass = (typeof CONTROL_PLANE_CALL_CLASSES)[number];
export type ControlPlaneRequestBounds = Readonly<Record<ControlPlaneCallClass, number>>;

/** The request bound per class, in milliseconds. See the table above. */
export const CONTROL_PLANE_REQUEST_BOUNDS_MS: ControlPlaneRequestBounds = Object.freeze({
  POINT: 10_000,
  DOCUMENT: 20_000,
  PAGE: 25_000,
});

export type ControlPlaneTimeoutKind = "REQUEST" | "DEADLINE";

/** One bounded store call, named for the record and never carrying a value or a parameter. */
export interface ControlPlaneCall {
  /** `<table>.<operation>`, for example `cp_research_state.compareAndSet`. */
  readonly operation: string;
  readonly callClass: ControlPlaneCallClass;
}

/** A store call that did not settle inside its bound or its budget. */
export class ControlPlaneRequestTimeout extends Error {
  readonly code = "CONTROL_PLANE_REQUEST_TIMEOUT";
  readonly operation: string;
  readonly callClass: ControlPlaneCallClass;
  readonly timeoutMs: number;
  readonly kind: ControlPlaneTimeoutKind;
  /** The enclosing budget's label when one applied. */
  readonly budget: string | null;
  /** A REQUEST timeout may succeed on another attempt; a spent DEADLINE cannot. */
  readonly retryable: boolean;

  constructor(input: {
    readonly operation: string;
    readonly callClass: ControlPlaneCallClass;
    readonly timeoutMs: number;
    readonly kind: ControlPlaneTimeoutKind;
    readonly budget: string | null;
  }) {
    const what = `${input.operation} (${input.callClass})`;
    super(
      input.kind === "REQUEST"
        ? `CONTROL_PLANE_REQUEST_TIMEOUT: ${what} did not settle within its ${input.timeoutMs} ms request bound`
        : input.timeoutMs <= 0
          ? `CONTROL_PLANE_REQUEST_TIMEOUT: ${what} was not sent; the budget of ${input.budget ?? "its caller"} was already spent`
          : `CONTROL_PLANE_REQUEST_TIMEOUT: ${what} did not settle within the ${input.timeoutMs} ms left in the budget of ${input.budget ?? "its caller"}`,
    );
    this.name = "ControlPlaneRequestTimeout";
    this.operation = input.operation;
    this.callClass = input.callClass;
    this.timeoutMs = input.timeoutMs;
    this.kind = input.kind;
    this.budget = input.budget;
    this.retryable = input.kind === "REQUEST";
  }
}

/** Duck-typed so a timeout that crossed a realm or a driver wrapper is still recognized. */
export function isControlPlaneRequestTimeout(value: unknown): value is ControlPlaneRequestTimeout {
  return (
    value instanceof ControlPlaneRequestTimeout ||
    (value !== null &&
      typeof value === "object" &&
      (value as { name?: unknown }).name === "ControlPlaneRequestTimeout" &&
      (value as { code?: unknown }).code === "CONTROL_PLANE_REQUEST_TIMEOUT")
  );
}

/* ------------------------------------------------------------- budgets --- */

interface StoreBudget {
  readonly label: string;
  readonly deadlineMs: number;
}

const ambientBudget = new AsyncLocalStorage<StoreBudget>();

/** The budget in force for store calls made here, or undefined outside every budget. */
export function currentStoreBudget(): { readonly label: string; readonly deadlineMs: number } | undefined {
  return ambientBudget.getStore();
}

/**
 * Run `fn` with a deadline `budgetMs` from now for every store call made inside
 * it. A budget nested in a tighter one keeps the tighter deadline and its label.
 * This bounds store calls only; the caller still owns any other await.
 */
export function withStoreBudget<T>(
  label: string,
  budgetMs: number,
  fn: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  const requested = now() + Math.max(0, budgetMs);
  const outer = ambientBudget.getStore();
  const budget: StoreBudget =
    outer !== undefined && outer.deadlineMs <= requested ? outer : { label, deadlineMs: requested };
  return ambientBudget.run(budget, fn);
}

/* ------------------------------------------------------------ observer --- */

type TimeoutObserver = (timeout: ControlPlaneRequestTimeout) => void;
let timeoutObserver: TimeoutObserver | null = null;

/**
 * One process-wide observer, told of every store timeout as it happens. The
 * research cycle points it at stderr, so a timeout that its caller then absorbs
 * into a named runtime condition is still on the record when the cycle dies.
 * Returns a function that removes it.
 */
export function observeControlPlaneTimeouts(observer: TimeoutObserver): () => void {
  timeoutObserver = observer;
  return () => {
    if (timeoutObserver === observer) timeoutObserver = null;
  };
}

function report(timeout: ControlPlaneRequestTimeout): ControlPlaneRequestTimeout {
  try {
    timeoutObserver?.(timeout);
  } catch {
    /* an observer that throws never changes the outcome of the call */
  }
  return timeout;
}

/* ------------------------------------------------------- the bounded call --- */

/** The driver's per-query options: the only one used here is the fetch signal. */
export interface BoundableQueryOptions {
  readonly fetchOptions?: { readonly signal?: AbortSignal };
}

export interface BoundableSql {
  query(text: string, params?: readonly unknown[], options?: BoundableQueryOptions): PromiseLike<unknown>;
}

/**
 * Issue one query under its class bound and the enclosing budget.
 *
 * Settles with the query's own result or error, or with a named
 * ControlPlaneRequestTimeout at the bound. The driver's promise is observed
 * exactly once: the Neon driver runs its query each time `then` is called.
 */
export async function boundedQuery(
  sql: BoundableSql,
  call: ControlPlaneCall,
  text: string,
  params?: readonly unknown[],
  options: { readonly bounds?: ControlPlaneRequestBounds; readonly now?: () => number } = {},
): Promise<unknown> {
  const now = options.now ?? Date.now;
  const bound = (options.bounds ?? CONTROL_PLANE_REQUEST_BOUNDS_MS)[call.callClass];
  const budget = ambientBudget.getStore();
  const left = budget === undefined ? Number.POSITIVE_INFINITY : budget.deadlineMs - now();
  const kind: ControlPlaneTimeoutKind = left < bound ? "DEADLINE" : "REQUEST";
  const timeoutMs = Math.max(0, Math.floor(Math.min(bound, left)));
  const timeoutFor = (ms: number) =>
    new ControlPlaneRequestTimeout({
      operation: call.operation,
      callClass: call.callClass,
      timeoutMs: ms,
      kind,
      budget: kind === "DEADLINE" ? (budget?.label ?? null) : null,
    });
  if (timeoutMs <= 0) throw report(timeoutFor(0));

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const timeout = report(timeoutFor(timeoutMs));
      controller.abort(timeout);
      reject(timeout);
    }, timeoutMs);
  });
  try {
    /* The response's bytes count under this operation and its caller (vital signs, transfer-by-caller.ts). */
    return await withQueryCaller(call.operation, () => Promise.race([
      sql.query(text, params, { fetchOptions: { signal: controller.signal } }),
      expired,
    ]));
  } catch (error) {
    /* The driver may reject first with its own wrapper of our abort; the name is ours. */
    if (controller.signal.aborted && isControlPlaneRequestTimeout(controller.signal.reason)) {
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
