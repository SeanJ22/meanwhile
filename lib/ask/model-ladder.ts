import { MODELS, MODEL_TIERS } from "../models.ts";

/** One reader action shares its deadline across retries; a higher tier needs a failed attempt. */
export async function askModelLadder<T>(run: (model: string, signal: AbortSignal) => Promise<T>,
  options: { signal?: AbortSignal; deadlineMs?: number } = {}): Promise<T> {
  const deadline = options.deadlineMs ?? Date.now() + 6_000;
  let failure: unknown = new Error("Ask has no model result.");
  for (const tier of MODEL_TIERS) {
    const remaining = deadline - Date.now();
    if (options.signal?.aborted || remaining <= 0) throw failure;
    const timeout = AbortSignal.timeout(Math.max(1, remaining));
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    try { return await run(MODELS[tier].model, signal); }
    catch (error) { failure = error; }
  }
  throw failure;
}
