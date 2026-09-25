/** Runs `run` with `globalThis.fetch` answered by a recorded stub, restoring the real one afterwards. */
export async function withFetch<T>(fetchImpl: unknown, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}
