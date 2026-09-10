export type BoundedWorkResult<T> =
  | { readonly index: number; readonly ok: true; readonly value: T; readonly error: null }
  | { readonly index: number; readonly ok: false; readonly value: null; readonly error: string };

/**
 * Continuously drain finite work through a fixed number of workers. A rejected
 * item becomes its own ordered result and cannot stop a worker from taking the
 * next unrelated item.
 */
export async function runBoundedWorkPool<TInput, TOutput>(
  items: readonly TInput[],
  concurrency: number,
  work: (item: TInput, index: number) => Promise<TOutput>,
): Promise<readonly BoundedWorkResult<TOutput>[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new Error(`BOUNDED_WORK_CONCURRENCY_INVALID:${concurrency}`);
  }
  const results = new Array<BoundedWorkResult<TOutput>>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { index, ok: true, value: await work(items[index]!, index), error: null };
      } catch (error) {
        results[index] = {
          index,
          ok: false,
          value: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  });
  await Promise.all(workers);
  return results;
}
