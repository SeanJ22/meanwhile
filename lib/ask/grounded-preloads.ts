/** Run unrelated canonical Reader preloads as independent failure domains. */
export async function settleGroundedSourcePreloads(
  preloads: readonly (() => Promise<unknown>)[],
): Promise<PromiseSettledResult<unknown>[]> {
  return Promise.allSettled(preloads.map((preload) => Promise.resolve().then(preload)));
}
