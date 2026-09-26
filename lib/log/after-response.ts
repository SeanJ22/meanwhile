import { AsyncLocalStorage } from "node:async_hooks";

const responseLifetime = new AsyncLocalStorage<(work: Promise<unknown>) => void>();

/** Host adapter supplies its own request lifetime without starting the Next server. */
export function withResponseLifetime<T>(waitUntil: (work: Promise<unknown>) => void, run: () => Promise<T>): Promise<T> {
  return responseLifetime.run(waitUntil, run);
}

/**
 * **WORK THE READER MUST NOT WAIT FOR, THAT THE RUNTIME MUST NOT DROP.**
 * (Prompt E item 4, 2026-08-20; `PD04`.)
 *
 * A serverless invocation ends when the response is returned, and a promise
 * still in flight at that moment is dropped — silently, without rejecting, so
 * no `.catch` ever sees it. That is how one `search_log` insert in ninety went
 * missing from a store this business sells, and it is how Prompt D's alarm
 * failed on its first live probe one layer down.
 *
 * `after()` is the platform's own answer: it schedules work the invocation is
 * kept alive for, strictly after the response has gone.
 *
 * ## Why this wrapper exists rather than a bare `after()`
 *
 * `after()` THROWS when it is called outside a request scope, and a route
 * handler is called outside a request scope all the time in this repo — every
 * test that exercises `app/api/**` imports the handler and calls it directly
 * (`scripts/test-alias-loader.mjs` exists precisely so they can). A bare
 * `after()` turns those into `after was called outside a request scope`, which
 * is a real error about a real constraint and tells nobody anything about the
 * route.
 *
 * Outside a request scope there is no invocation to keep alive, so the correct
 * behaviour is simply to DO the work and let the caller await it. That is what
 * the fallback does, and it is why this returns a promise in that case and
 * nothing in the normal one: `await afterResponse(...)` costs a production
 * reader one microtask and costs a test the actual completion, which is what
 * each of them needs.
 *
 * ## What it does NOT do
 *
 * It does not catch the work's own failures. The caller owns those — the
 * sold-store write paths swallow for the reader and raise on the alarm path,
 * and moving that decision in here would hide it from the file where RULING 25
 * is being obeyed.
 */
export async function afterResponse(work: () => Promise<unknown>): Promise<void> {
  const waitUntil = responseLifetime.getStore();
  if (waitUntil) { waitUntil(Promise.resolve().then(work)); return; }
  try {
    const { after } = await import("next/server");
    after(work);
    return;
  } catch {
    await work();
  }
}
