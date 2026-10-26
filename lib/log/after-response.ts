import { AsyncLocalStorage } from "node:async_hooks";

let nextAfter: typeof import("next/server")["after"] | undefined;

const lifetimeSlot = Symbol.for("meanwhile.response-lifetime");
const host = globalThis as typeof globalThis & { [lifetimeSlot]?: AsyncLocalStorage<(work: Promise<unknown>) => void> };
const responseLifetime = host[lifetimeSlot] ??= new AsyncLocalStorage<(work: Promise<unknown>) => void>();

/** Host adapter supplies its own request lifetime without starting the Next server. */
export function withResponseLifetime<T>(waitUntil: (work: Promise<unknown>) => void, run: () => Promise<T>): Promise<T> {
  return responseLifetime.run(waitUntil, run);
}

/**
 * Work the reader must not wait for and the runtime must not drop: scheduled
 * with `after()`, which keeps the invocation alive after the response. Outside
 * a request scope (route handlers called directly in tests) `after()` throws,
 * so the work runs immediately and the returned promise can be awaited. The
 * caller owns the work's own failures.
 */
export async function afterResponse(work: () => Promise<unknown>, options: { backgroundFallback?: boolean } = {}): Promise<void> {
  const waitUntil = responseLifetime.getStore();
  if (waitUntil) { waitUntil(Promise.resolve().then(work)); return; }
  if (options.backgroundFallback && !process.env.NETLIFY && process.env.NEXT_RUNTIME !== "nodejs") {
    void work(); return;
  }
  try {
    // Keep the host adapter once loaded. Register later work synchronously;
    // another asynchronous module lookup can otherwise outlive a canceled send.
    nextAfter ??= (await import("next/server")).after;
    nextAfter(work);
    return;
  } catch {
    if (options.backgroundFallback) void work();
    else await work();
  }
}
