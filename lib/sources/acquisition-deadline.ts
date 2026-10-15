
export const ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS = 20 * 60_000;
export const ROUTINE_SOURCE_SETTLEMENT_BUDGET_MS = 10 * 60_000;


export class SourceAcquisitionDeadlineError extends Error {
  readonly sourceLabel: string;
  readonly timeoutMs: number;

  constructor(sourceLabel: string, timeoutMs: number) {
    super(`${sourceLabel} exceeded its ${timeoutMs}ms acquisition deadline`);
    this.name = "SourceAcquisitionDeadlineError";
    this.sourceLabel = sourceLabel;
    this.timeoutMs = timeoutMs;
  }
}

export function isSourceAcquisitionDeadlineError(
  error: unknown,
): error is SourceAcquisitionDeadlineError {
  return error instanceof SourceAcquisitionDeadlineError;
}

export interface SourceAcquisitionDomain {
  readonly signal: AbortSignal;
  /** Throws the exact abort reason, preventing a swallowed abort from passing. */
  assertActive(): void;
  /** Clears the deadline and parent listener. It never throws. */
  dispose(): void;
}

export function openSourceAcquisitionDomain(input: {
  readonly sourceLabel: string;
  readonly timeoutMs: number;
  readonly parentSignal?: AbortSignal;
}): SourceAcquisitionDomain {
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new Error(`SOURCE_ACQUISITION_DEADLINE_INVALID:${input.sourceLabel}:${input.timeoutMs}`);
  }

  const controller = new AbortController();

  const abortFromParent = () => {
    controller.abort(input.parentSignal?.reason ?? new DOMException("The parent acquisition was aborted", "AbortError"));
  };
  if (input.parentSignal?.aborted) abortFromParent();
  else input.parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  const timer = setTimeout(() => {
    controller.abort(new SourceAcquisitionDeadlineError(input.sourceLabel, input.timeoutMs));
  }, input.timeoutMs);

  let disposed = false;
  return {
    signal: controller.signal,
    assertActive() {
      if (controller.signal.aborted) {
        throw controller.signal.reason ?? new DOMException("The acquisition was aborted", "AbortError");
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      input.parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

export async function runInSourceAcquisitionDomain<T>(
  input: {
    readonly sourceLabel: string;
    readonly timeoutMs: number;
    readonly parentSignal?: AbortSignal;
  },
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const domain = openSourceAcquisitionDomain(input);
  try {
    domain.assertActive();
    const value = await operation(domain.signal);
    domain.assertActive();
    return value;
  } finally {
    domain.dispose();
  }
}

/** A retry/politeness delay that settles immediately when its source aborts. */
export function sourceAcquisitionSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("The acquisition was aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new DOMException("The acquisition was aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
