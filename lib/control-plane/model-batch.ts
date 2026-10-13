/** Message Batches for independent unattended work. Reader responses and dependent tool turns use Messages. */
import { createHash, randomUUID } from "node:crypto";
import type { AttemptProviderBatch } from "./attempt.ts";
import { canonicalJson, type ControlPlaneRepositories } from "./repository/types.ts";
import { anthropicBetasFor, cachedModelRequest, ModelTransportError, type ModelRequest, type ModelResponse, type ModelTransport } from "./scheduler/scout-executor.ts";

export const MESSAGE_BATCHES_ENDPOINT = "https://api.anthropic.com/v1/messages/batches";

export const BATCH_LANES = {
  "background-worker-audit": {
    flag: "WTP_BACKGROUND_WORKER_BATCH",
    defaultEnabled: true,
    readerFacing: false as const,
    why: "independent evidence reviews in unattended workers; each request has its complete held context and no reader is waiting",
  },
  "background-worker-parse": {
    flag: "WTP_BACKGROUND_WORKER_BATCH",
    defaultEnabled: true,
    readerFacing: false as const,
    why: "independent saved-document extraction windows in unattended workers; no reader waits on the response",
  },
  "background-worker-research": {
    flag: "WTP_BACKGROUND_WORKER_BATCH",
    defaultEnabled: true,
    readerFacing: false as const,
    why: "unattended blanks outside the meeting and election windows, translations, summaries and rechecks",
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

/** Only work without a reader deadline can wait for the discount service. */
export type BatchJob = "LIVE_REFRESH" | "PUBLISH_NOW" | "MISSION_CORE" | "BACKFILL" | "HISTORY" | "AUDIT_SAMPLE"
  | "PAGE_READER" | "TRANSLATOR" | "STANCE_SUMMARY" | "RECHECKER" | "LOSS_STUDY" | "BLANK" | "ASK";
export interface BatchPriority {
  readonly subjectId?: string;
  readonly now: string;
  readonly meetingStartsAt?: readonly string[];
  readonly electionAt?: readonly string[];
  readonly readerImpactAt?: string | null;
}

/** Eligibility is kept even when batching is switched off, so Admin has the real denominator. */
export function batchEligibleForJob(job: BatchJob | undefined, priority?: BatchPriority): boolean {
  if (job === undefined || ["ASK", "LIVE_REFRESH", "PUBLISH_NOW", "MISSION_CORE"].includes(job)) return false;
  if (!priority) return job !== "BLANK";
  const now = Date.parse(priority.now);
  if (!Number.isFinite(now)) return false;
  const near = (at: string, days: number, pastDays = 0) => {
    const date = Date.parse(at);
    return !Number.isFinite(date) || (date >= now - pastDays * 86_400_000 && date <= now + days * 86_400_000);
  };
  return !(priority.meetingStartsAt ?? []).some(at => near(at, 7, 7))
    && !(priority.electionAt ?? []).some(at => near(at, 60))
    && !(priority.readerImpactAt && near(priority.readerImpactAt, 7, 7));
}
export function batchEnabledForJob(lane: BatchLane, job: BatchJob | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env, priority?: BatchPriority): boolean {
  return batchEligibleForJob(job, priority) && batchEnabledFor(lane, env);
}

/** One request inside a batch: the Messages API body, keyed by a caller-chosen id. Results come back in ANY order; key by `custom_id`, never position. */
export interface BatchRequestItem {
  readonly custom_id: string;
  readonly params: Record<string, unknown>;
}

export interface MessageBatch {
  readonly created_at?: string;
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
  readonly pollIntervalMs?: number;
  /** Give up after this long. The API's own ceiling is 24 hours. */
  readonly deadlineMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly customId?: string;
}

/** Returns the message as the Messages API would, with usage marked `batch: true`. Throws `MessageBatchError` on an errored, canceled or expired result. */
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

/** A failed submission or result is surfaced once and never resubmitted here. */
export interface BatchJournal {
  readonly read: (requestHash: string) => Promise<AttemptProviderBatch | null>;
  readonly write: (record: AttemptProviderBatch) => Promise<void>;
}

export function batchRequestHash(request: ModelRequest): string {
  return createHash("sha256").update(canonicalJson(cachedModelRequest(request))).digest("hex");
}

export function attemptBatchJournal(repos: ControlPlaneRepositories, taskId: string, now: () => string): BatchJournal {
  return {
    read: async hash => {
      const attempts = await repos.attempts.listWhere(["routeTaskId"], taskId);
      return attempts.flatMap(a => a.value.providerBatches ?? []).find(r => r.requestHash === hash && r.batchId !== null)
        ?? attempts.flatMap(a => a.value.providerBatches ?? []).find(r => r.requestHash === hash) ?? null;
    },
    write: async record => {
      const lease = await repos.leases.mustRead(taskId);
      const attempts = await repos.attempts.listWhere(["routeTaskId"], taskId);
      const active = attempts.find(a => a.value.outcome === null && a.value.leaseId === lease.value.id);
      const at = now();
      if (!active || lease.value.released || Date.parse(lease.value.expiresAt) <= Date.parse(at)) throw new ModelTransportError("BATCH_JOURNAL_LEASE_NOT_HELD", 400);
      await repos.attempts.compareAndSet(active.id, active.revision, { ...active.value,
        providerBatches: [...(active.value.providerBatches ?? []).filter(r => r.requestHash !== record.requestHash), record] }, at);
    },
  };
}

export function backgroundBatchTransport(options: Omit<SingleRequestBatchOptions, "customId" | "deadlineMs"> & {
  readonly journal?: BatchJournal;
}): ModelTransport & { readonly withJournal: (journal: BatchJournal) => ModelTransport } {
  type Pending = { id: string; request: ModelRequest; record: AttemptProviderBatch | null; startedMs: number;
    journal?: BatchJournal;
    resolve: (response: ModelResponse) => void; reject: (error: unknown) => void };
  let pending: Pending[] = [];
  let scheduled = false;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  async function recoverUncertain(record: AttemptProviderBatch): Promise<MessageBatch> {
    // The POST may have succeeded before its id was saved: correlate the prewritten custom id, never resubmit.
    for (;;) {
      let cursor: string | null = null;
      let processing = false;
      do {
        const url = new URL(options.endpoint ?? MESSAGE_BATCHES_ENDPOINT);
        url.searchParams.set("limit", "100");
        if (cursor) url.searchParams.set("after_id", cursor);
        const response = await fetchImpl(url.href, { headers: headers(options.apiKey) });
        if (!response.ok) throw new MessageBatchError(`BATCH_RECOVERY_LIST_HTTP_${response.status}`, response.status);
        const page = await response.json() as { data: MessageBatch[]; has_more: boolean; last_id: string | null };
        for (const batch of page.data) {
          if (batch.created_at && Date.parse(batch.created_at) < Date.parse(record.submittedAt) - 300_000) continue;
          if (batch.processing_status !== "ended") { processing = true; continue; }
          if (batch.results_url && (await readMessageBatchResults(options.apiKey, batch.results_url, fetchImpl)).some(r => r.custom_id === record.customId)) return batch;
        }
        cursor = page.has_more ? page.last_id : null;
      } while (cursor);
      if (!processing) throw new ModelTransportError("BATCH_SUBMISSION_UNRESOLVED: provider result not found; unchanged request will not be resubmitted", 400);
      await sleep(options.pollIntervalMs ?? 60_000);
    }
  }
  async function finish(entries: Pending[], initial: MessageBatch) {
    let batch = initial;
    while (batch.processing_status !== "ended") {
      await sleep(options.pollIntervalMs ?? 60_000);
      batch = await retrieveMessageBatch(options.apiKey, batch.id, fetchImpl, options.endpoint);
    }
    if (!batch.results_url) throw new MessageBatchError(`batch ${batch.id} ended without results`, null);
    const results = new Map((await readMessageBatchResults(options.apiKey, batch.results_url, fetchImpl)).map(result => [result.custom_id, result.result]));
    for (const entry of entries) {
      const result = results.get(entry.id);
      if (result?.type === "succeeded") entry.resolve({ ...result.message, batch: true, batchWaitedMs: Math.max(0, Date.now() - entry.startedMs) } as unknown as ModelResponse);
      else {
        const error = result?.type === "errored" ? result.error as { type?: string } : undefined;
        // A completed batch request is not submitted again, even for a provider error.
        entry.reject(new ModelTransportError(`BACKGROUND_BATCH_${result?.type ?? "missing"}:${error?.type ?? ""}`, 400));
      }
    }
  }
  async function flush() {
    const entries = pending;
    pending = [];
    scheduled = false;
    try {
      const batch = await submitMessageBatch(options.apiKey, entries.map(entry => ({ custom_id: entry.id,
        params: cachedModelRequest(entry.request) as unknown as Record<string, unknown> })), fetchImpl, options.endpoint,
        [...new Set(entries.flatMap(entry => anthropicBetasFor(entry.request)))]);
      for (const entry of entries) if (entry.record) await entry.journal!.write({ ...entry.record, batchId: batch.id });
      await finish(entries, batch);
    } catch (error) {
      const failure = error instanceof MessageBatchError ? new ModelTransportError(error.message, error.status) : error;
      for (const entry of entries) entry.reject(failure);
    }
  }
  const send = async (request: ModelRequest, journal = options.journal): Promise<ModelResponse> => {
    if (request.max_tokens < 1) throw new ModelTransportError("BACKGROUND_BATCH_MAX_TOKENS_INVALID", 400);
    const hash = batchRequestHash(request);
    const existing = await journal?.read(hash);
    if (existing) {
      const batch = existing.batchId ? await retrieveMessageBatch(options.apiKey, existing.batchId, fetchImpl, options.endpoint) : await recoverUncertain(existing);
      await journal!.write({ ...existing, batchId: batch.id });
      return new Promise<ModelResponse>((resolve, reject) => { void finish([{ id: existing.customId, request, record: existing, startedMs: Date.now(), resolve, reject }], batch).catch(reject); });
    }
    const record = journal ? { requestHash: hash, customId: randomUUID(), batchId: null, submittedAt: new Date().toISOString() } : null;
    if (record) await journal!.write(record);
    return new Promise<ModelResponse>((resolve, reject) => {
    pending.push({ id: record?.customId ?? randomUUID(), request, record, startedMs: Date.now(), journal, resolve, reject });
    if (!scheduled) { scheduled = true; setImmediate(() => { void flush(); }); }
    });
  };
  const waitingSend = async (request: ModelRequest, journal = options.journal): Promise<ModelResponse> => {
    request.onBatchWait?.(true);
    try { return await send(request, journal); }
    finally { request.onBatchWait?.(false); }
  };
  return Object.assign((request: ModelRequest) => waitingSend(request), { withJournal: (journal: BatchJournal): ModelTransport => request => waitingSend(request, journal) });
}
