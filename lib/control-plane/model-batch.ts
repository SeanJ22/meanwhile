/** Message Batches for independent unattended work. Reader responses and dependent tool turns use Messages. */
import { randomUUID } from "node:crypto";
import { anthropicBetasFor, cachedModelRequest, ModelTransportError, type ModelRequest, type ModelResponse, type ModelTransport } from "./scheduler/scout-executor.ts";

export const MESSAGE_BATCHES_ENDPOINT = "https://api.anthropic.com/v1/messages/batches";

/**
 * The lanes this module may serve. Each is not reader-facing and each request
 * stands alone. A lane is added here with its flag and its reason, never by a
 * caller inventing an environment variable.
 */
export const BATCH_LANES = {
  "background-worker-audit": {
    flag: "WTP_BACKGROUND_WORKER_BATCH",
    defaultEnabled: true,
    readerFacing: false as const,
    why: "independent evidence reviews in unattended workers; each request has its complete held context and no reader is waiting",
  },
  "ask-model-comparison": {
    flag: "WTP_ASK_COMPARE_BATCH",
    readerFacing: false as const,
    defaultEnabled: false,
    why: "the comparison harness sends independent synthesis requests offline; nobody waits on the answer and no request depends on another's response",
  },
} as const;
export type BatchLane = keyof typeof BATCH_LANES;

const ON = new Set(["1", "true", "on"]);

/** Whether a registered lane's batch routing is switched on. OFF unless the flag says otherwise. */
export function batchEnabledFor(lane: BatchLane, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const entry = BATCH_LANES[lane];
  if (!entry || entry.readerFacing) return false;
  const value = env[entry.flag];
  return value === undefined ? entry.defaultEnabled : ON.has(value.trim().toLowerCase());
}

/** One request inside a batch: the Messages API body, keyed by a caller-chosen id. Results come back in ANY order; key by `custom_id`, never position. */
export interface BatchRequestItem {
  readonly custom_id: string;
  readonly params: Record<string, unknown>;
}

export interface MessageBatch {
  readonly id: string;
  readonly processing_status: "in_progress" | "canceling" | "ended" | string;
  readonly request_counts: { readonly processing: number; readonly succeeded: number; readonly errored: number; readonly canceled: number; readonly expired: number };
  readonly results_url: string | null;
}

export type BatchResult =
  | { readonly custom_id: string; readonly result: { readonly type: "succeeded"; readonly message: Record<string, unknown> } }
  | { readonly custom_id: string; readonly result: { readonly type: "errored"; readonly error?: unknown } }
  | { readonly custom_id: string; readonly result: { readonly type: "canceled" | "expired" } };

export class MessageBatchError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "MessageBatchError";
    this.status = status;
  }
}

function headers(apiKey: string): Record<string, string> {
  return { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
}

/** The wire body of a batch submission. Exposed so a test can assert the shape without a network. */
export function batchRequestBody(items: readonly BatchRequestItem[]): { readonly requests: readonly BatchRequestItem[] } {
  if (items.length === 0) throw new MessageBatchError("a batch needs at least one request", null);
  const ids = new Set(items.map((i) => i.custom_id));
  if (ids.size !== items.length) throw new MessageBatchError("custom_id must be unique inside a batch", null);
  return { requests: items };
}

export async function submitMessageBatch(
  apiKey: string,
  items: readonly BatchRequestItem[],
  fetchImpl: typeof fetch = fetch,
  endpoint = MESSAGE_BATCHES_ENDPOINT,
  betas: readonly string[] = [],
): Promise<MessageBatch> {
  const response = await fetchImpl(endpoint, { method: "POST", headers: { ...headers(apiKey), ...(betas.length ? { "anthropic-beta": betas.join(",") } : {}) }, body: JSON.stringify(batchRequestBody(items)) });
  if (!response.ok) throw new MessageBatchError(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`, response.status);
  return (await response.json()) as MessageBatch;
}

export async function retrieveMessageBatch(
  apiKey: string,
  id: string,
  fetchImpl: typeof fetch = fetch,
  endpoint = MESSAGE_BATCHES_ENDPOINT,
): Promise<MessageBatch> {
  const response = await fetchImpl(`${endpoint}/${encodeURIComponent(id)}`, { method: "GET", headers: headers(apiKey) });
  if (!response.ok) throw new MessageBatchError(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`, response.status);
  return (await response.json()) as MessageBatch;
}

/** The results file is JSON Lines; one object per request, in any order. */
export async function readMessageBatchResults(apiKey: string, resultsUrl: string, fetchImpl: typeof fetch = fetch): Promise<BatchResult[]> {
  const response = await fetchImpl(resultsUrl, { method: "GET", headers: headers(apiKey) });
  if (!response.ok) throw new MessageBatchError(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`, response.status);
  const text = await response.text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as BatchResult);
}

export interface SingleRequestBatchOptions {
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
  readonly endpoint?: string;
  /** How often to ask whether the batch ended. The scheduler's own cadence; a test injects a short one. */
  readonly pollIntervalMs?: number;
  /** Give up after this long. The API's own ceiling is 24 hours. */
  readonly deadlineMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly customId?: string;
}

/**
 * Run ONE Messages API request through the Batches API and return the
 * message as the Messages API would have — the caller reads `usage` and
 * `content` exactly as before, and marks the usage `batch: true` so the
 * pricing halves once. Throws a `MessageBatchError` naming the result type
 * when the request errored, was canceled or expired.
 */
export async function runSingleRequestBatch(
  params: Record<string, unknown>,
  options: SingleRequestBatchOptions,
): Promise<{ readonly message: Record<string, unknown>; readonly batchId: string; readonly waitedMs: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const interval = options.pollIntervalMs ?? 60_000;
  const deadline = options.deadlineMs ?? Number.POSITIVE_INFINITY;
  const customId = options.customId ?? "single";
  const started = Date.now();
  let batch = await submitMessageBatch(options.apiKey, [{ custom_id: customId, params }], fetchImpl, options.endpoint);
  while (batch.processing_status !== "ended") {
    if (Date.now() - started > deadline) throw new MessageBatchError(`batch ${batch.id} did not end inside ${deadline}ms`, null);
    await sleep(interval);
    batch = await retrieveMessageBatch(options.apiKey, batch.id, fetchImpl, options.endpoint);
  }
  if (!batch.results_url) throw new MessageBatchError(`batch ${batch.id} ended without a results_url`, null);
  const results = await readMessageBatchResults(options.apiKey, batch.results_url, fetchImpl);
  const mine = results.find((r) => r.custom_id === customId);
  if (!mine) throw new MessageBatchError(`batch ${batch.id} carried no result for ${customId}`, null);
  if (mine.result.type !== "succeeded") {
    const detail = "error" in mine.result && mine.result.error ? ` ${JSON.stringify(mine.result.error).slice(0, 200)}` : "";
    throw new MessageBatchError(`batch ${batch.id} request ${customId} ${mine.result.type}${detail}`, null);
  }
  return { message: mine.result.message, batchId: batch.id, waitedMs: Date.now() - started };
}

/** Coalesce independent unattended reviews; dependent tool conversations keep Messages.
 * This uses the provider's existing batch state, not a second queue or budget store.
 * A failed submission/result is surfaced once and never resubmitted here.
 */
export function backgroundBatchTransport(options: Omit<SingleRequestBatchOptions, "customId" | "deadlineMs">): ModelTransport {
  type Pending = { id: string; request: ModelRequest; resolve: (response: ModelResponse) => void; reject: (error: unknown) => void };
  let pending: Pending[] = [];
  let scheduled = false;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  async function flush() {
    const entries = pending;
    pending = [];
    scheduled = false;
    try {
      let batch = await submitMessageBatch(options.apiKey, entries.map(entry => ({ custom_id: entry.id,
        params: cachedModelRequest(entry.request) as unknown as Record<string, unknown> })), fetchImpl, options.endpoint,
        [...new Set(entries.flatMap(entry => anthropicBetasFor(entry.request)))]);
      while (batch.processing_status !== "ended") {
        await sleep(options.pollIntervalMs ?? 60_000);
        batch = await retrieveMessageBatch(options.apiKey, batch.id, fetchImpl, options.endpoint);
      }
      if (!batch.results_url) throw new MessageBatchError(`batch ${batch.id} ended without results`, null);
      const results = new Map((await readMessageBatchResults(options.apiKey, batch.results_url, fetchImpl)).map(result => [result.custom_id, result.result]));
      for (const entry of entries) {
        const result = results.get(entry.id);
        if (result?.type === "succeeded") entry.resolve({ ...result.message, batch: true } as unknown as ModelResponse);
        else {
          const error = result?.type === "errored" ? result.error as { type?: string; message?: string } : undefined;
          const transient = error?.type === "rate_limit_error" || error?.type === "overloaded_error" || error?.type === "api_error";
          entry.reject(new ModelTransportError(`BACKGROUND_BATCH_${result?.type ?? "missing"}:${error?.type ?? ""}:${error?.message ?? ""}`, transient ? 503 : 400));
        }
      }
    } catch (error) {
      const failure = error instanceof MessageBatchError ? new ModelTransportError(error.message, error.status) : error;
      for (const entry of entries) entry.reject(failure);
    }
  }
  return request => new Promise<ModelResponse>((resolve, reject) => {
    if (request.max_tokens < 1) { reject(new ModelTransportError("BACKGROUND_BATCH_MAX_TOKENS_INVALID", 400)); return; }
    pending.push({ id: randomUUID(), request, resolve, reject });
    if (!scheduled) { scheduled = true; setImmediate(() => { void flush(); }); }
  });
}
