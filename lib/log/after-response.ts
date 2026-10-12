import { AsyncLocalStorage } from "node:async_hooks";

const responseLifetime = new AsyncLocalStorage<{
  waitUntil: (work: Promise<unknown>) => void;
  responseReady: Promise<void>;
}>();

/** Host adapter supplies its own request lifetime without starting the Next server. */
export function withResponseLifetime<T>(waitUntil: (work: Promise<unknown>) => void, run: () => Promise<T>): Promise<T> {
  let responseReady!: () => void;
  const ready = new Promise<void>(resolve => { responseReady = resolve; });
  return responseLifetime.run({ waitUntil, responseReady: ready }, async () => {
    try { return await run(); }
    finally { responseReady(); }
  });
}

/**
 * Work the reader must not wait for and the runtime must not drop: scheduled
 * with `after()`, which keeps the invocation alive after the response. Outside
 * a request scope (route handlers called directly in tests) `after()` throws,
 * so the work runs immediately and the returned promise can be awaited. The
 * caller owns the work's own failures.
 */
export async function afterResponse(work: () => Promise<unknown>): Promise<void> {
  const lifetime = responseLifetime.getStore();
  if (lifetime) {
    lifetime.waitUntil(lifetime.responseReady.then(work));
    return;
  }
  try {
    const { after } = await import("next/server");
    after(work);
    return;
  } catch {
    await work();
  }
}
