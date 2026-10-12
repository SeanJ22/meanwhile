/**
 * Every control-plane store call is bounded by its class, and a timeout has a name.
 *   POINT     one small row or write, a log head, a lock, a DDL statement    10 s
 *   DOCUMENT  one row that is a large document, or a large-record append      20 s
 *   PAGE      one keyset page of at most 100 rows                            25 s
 * Each bound is about 30x the slowest measured request in its class; PAGE stays under the 30 s process-wide
 * transport deadline. `withStoreBudget` caps a group of calls. A REQUEST timeout may succeed on retry;
 * a DEADLINE timeout (budget spent) is never retried. The request is cancelled through the fetch signal
 * and also settles from its own timer.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { withQueryCaller } from "../../db/transfer-by-caller.ts";

export const CONTROL_PLANE_CALL_CLASSES = ["POINT", "DOCUMENT", "PAGE"] as const;
export type ControlPlaneCallClass = (typeof CONTROL_PLANE_CALL_CLASSES)[number];
export type ControlPlaneRequestBounds = Readonly<Record<ControlPlaneCallClass, number>>;

/** The request bound per class, in milliseconds. */
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

type TimeoutObserver = (timeout: ControlPlaneRequestTimeout) => void;
let timeoutObserver: TimeoutObserver | null = null;

/** One process-wide observer, told of every store timeout as it happens, even when the caller absorbs it. */
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

/** The driver's per-query options: the only one used here is the fetch signal. */
export interface BoundableQueryOptions {
  readonly fetchOptions?: { readonly signal?: AbortSignal };
}

export interface BoundableSql {
  query(text: string, params?: readonly unknown[], options?: BoundableQueryOptions): PromiseLike<unknown>;
}

/** The driver's promise is observed exactly once: the Neon driver runs its query each time `then` is called. */
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
