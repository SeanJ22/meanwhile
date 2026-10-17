import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { SourceCheckEvidence } from "../civic-data/types.ts";
import { requestPublisher, sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import { saveFederalBulkBytes } from "../federal-money/bulk.ts";
import { federalCsvRecords, federalJsonRecords, federalZipBytes, federalZipEntries, type FederalJsonEnvelope } from "../federal-money/streams.ts";
import { saveFederalMoneyCapture } from "../federal-money/vault.ts";
import { csvRows } from "../reference/csv.ts";
import { campaignSourceRecord, type CampaignSourceCapture, type CampaignSourceRecord } from "./state-source-records.ts";
import { campaignFinanceSource, type CampaignFinanceResource } from "./state-sources.ts";
import { joinedCampaignSourceRows } from "./state-source-join.ts";

interface DownloadCheckpoint { readonly etag: string | null; readonly modified: string | null; readonly archiveId: string; readonly rawHash: string; readonly path: string; readonly byteLength: number; readonly retrievedAt: string }
interface Download extends DownloadCheckpoint { readonly sourceCheck: SourceCheckEvidence; readonly runId: string | null }
interface ResourceCheckpoint { readonly rawHash: string; readonly rows: number; readonly total: number | null; readonly retrievedAt: string; readonly publicationId: string | null }
interface CampaignSourcePage {
  readonly records: readonly CampaignSourceRecord[];
  readonly capture: CampaignSourceCapture | null;
  readonly offset: number;
  readonly complete: boolean;
  readonly unchanged: boolean;
  readonly sourceCheck: SourceCheckEvidence;
  readonly observedAt: string;
}
interface Options {
  readonly vault: EvidenceStore;
  readonly directory: string;
  readonly signal: AbortSignal;
  readonly fetch?: typeof fetch;
  readonly now?: () => string;
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly acceptedPublicationId?: string;
  readonly publicationId?: string;
  readonly runId?: string;
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const sleep = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
  signal.addEventListener("abort", abort, { once: true });
});

async function response(url: string, headers: Headers, resource: CampaignFinanceResource, body: Record<string, unknown> | null, options: Options): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    options.signal.throwIfAborted();
    const result = await requestPublisher("official campaign finance", () => (options.fetch ?? fetch)(url, { headers, signal: options.signal,
      ...(resource.method ? { method: resource.method, body: JSON.stringify(body) } : {}) }));
    if (result.status !== 429 && result.status < 500 || attempt >= 3) {
      if (!result.ok && result.status !== 304) {
        await result.body?.cancel();
        throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", `The campaign-finance publisher returned HTTP ${result.status}.`);
      }
      if (result.status === 206 || result.headers.has("content-range")) {
        await result.body?.cancel();
        throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", "The campaign publisher returned a partial body to a complete publication request.");
      }
      return result;
    }
    const retry = result.headers.get("retry-after"), seconds = Number(retry);
    const delay = retry ? Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - Date.now() : 2000 * 2 ** attempt;
    await result.body?.cancel();
    await (options.sleep ?? sleep)(Math.max(0, Number.isFinite(delay) ? delay : 30_000), options.signal);
  }
}

async function* capturedRows(state: string, resource: CampaignFinanceResource, input: AsyncIterable<Uint8Array>, metadata: {
  url: string; retrievedAt: string; publicationDate: string | null; archiveId: string;
}, options: Options, envelope: FederalJsonEnvelope = { rows: 0, found: false }): AsyncGenerator<{ records: CampaignSourceRecord[]; capture: CampaignSourceCapture }> {
  const capacity = 2 * 1024 * 1024;
  let buffer = Buffer.allocUnsafe(capacity), used = 0, count = 0, projectionOrdinal = 0;
  let header: string | null = null, preambleRows = resource.preambleRows ?? 0;
  const format = resource.kind === "JSON" || resource.kind === "SOCRATA" ? "json" : "csv";
  async function flush() {
    if (format === "json") buffer[used++] = 93;
    const saved = await saveFederalMoneyCapture({ ...metadata, format, body: buffer.subarray(0, used) }, options.vault);
    const capture: CampaignSourceCapture = { ...saved, storage: "CHUNK" };
    const records: CampaignSourceRecord[] = [];
    if (format === "json") {
      for (const raw of JSON.parse(buffer.toString("utf8", 0, used)) as Record<string, unknown>[]) records.push(campaignSourceRecord(state, resource, raw, capture, projectionOrdinal++));
    } else {
      let columns: string[] | null = null;
      for (const row of csvRows(buffer.toString("utf8", 0, used).replace(/^\uFEFF/, ""), resource.delimiter, resource.quote)) {
        if (!columns) { columns = row; continue; }
        if (row.length === 1 && row[0] === "") continue;
        if (row.length !== columns.length) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "A campaign row differs from its source columns.");
        records.push(campaignSourceRecord(state, resource, Object.fromEntries(columns.map((column, index) => [column, row[index]])), capture, projectionOrdinal++));
      }
    }
    used = 0; count = 0;
    return { records, capture };
  }
  const rows = format === "json" ? federalJsonRecords(input, resource.rowPath ?? "", envelope) : federalCsvRecords(input, resource.encoding, resource.quote);
  for await (const raw of rows) {
    options.signal.throwIfAborted();
    if (format === "csv" && preambleRows > 0) { preambleRows--; continue; }
    if (format === "csv" && header === null) {
      header = raw;
      const columns = [...csvRows(raw.replace(/^\uFEFF/, ""), resource.delimiter, resource.quote)][0];
      if (!columns?.length || new Set(columns).size !== columns.length) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Campaign export columns are missing or repeated.");
      if (resource.identity.some(field => !columns.includes(field)) || resource.committee.length && !resource.committee.some(field => columns.includes(field)) || resource.amounts.length && !resource.amounts.some(amount => columns.includes(amount.field))) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Campaign export no longer contains its declared native identity or amount columns.");
      continue;
    }
    const bytes = Buffer.byteLength(raw);
    if (count && (count >= 500 || used + bytes + 2 > capacity)) yield await flush();
    if (!count) {
      const prefix = format === "json" ? "[" : header!;
      const required = Buffer.byteLength(prefix) + bytes + 1;
      if (buffer.length < required) buffer = Buffer.allocUnsafe(Math.max(capacity, required));
      used = buffer.write(prefix);
    } else if (format === "json") buffer[used++] = 44;
    used += buffer.write(raw, used); count++;
  }
  if (count) yield await flush();
  if (format === "csv" && header === null) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The campaign export has no source columns.");
  if (format === "json" && !envelope.found) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The campaign API response has no declared record array.");
}

async function* filePages(state: string, resource: CampaignFinanceResource, path: string,
  metadata: Parameters<typeof capturedRows>[3] & { readonly rawHash: string; readonly byteLength: number }, options: Options, envelope: FederalJsonEnvelope) {
  if (resource.kind === "ZIP" && resource.lookup) {
    const capture: CampaignSourceCapture = { ...metadata, storage: "ARCHIVE", vaultKey: metadata.archiveId };
    let records: CampaignSourceRecord[] = [], ordinal = 0;
    for await (const raw of federalJsonRecords(joinedCampaignSourceRows(path, resource, `${path}.join`, options.signal), "", envelope)) {
      records.push(campaignSourceRecord(state, resource, JSON.parse(raw), capture, ordinal++));
      if (records.length >= 500) { yield { records, capture }; records = []; }
    }
    if (records.length) yield { records, capture };
  } else if (resource.kind === "ZIP") {
    let found = false;
    for await (const entry of federalZipEntries(path)) {
      if (entry.name.endsWith("/") || resource.filePattern && !new RegExp(resource.filePattern, "i").test(entry.name)) continue;
      found = true;
      yield* capturedRows(state, resource, federalZipBytes(path, entry), { ...metadata, url: `${metadata.url}#${encodeURIComponent(entry.name)}` }, options);
    }
    if (!found) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The campaign archive has no declared native filing table.");
  } else yield* capturedRows(state, resource, createReadStream(path), metadata, options, envelope);
}

const property = (value: unknown, path: string) => path.split(".").reduce<unknown>((at, key) => at !== null && typeof at === "object" ? (at as Record<string, unknown>)[key] : undefined, value);
async function checkpoint<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function saveCheckpoint(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}`;
  await writeFile(temporary, JSON.stringify(value));
  await rename(temporary, path);
}
async function download(state: string, url: string, resource: CampaignFinanceResource, body: Record<string, unknown> | null, options: Options): Promise<Download> {
  const key = digest(`${url}:${JSON.stringify(body)}`);

  const directory = join(options.directory, state, "downloads", key);
  await mkdir(directory, { recursive: true });
  const head = join(directory, "download.json");
  let prior = await checkpoint<Download>(head);
  if (prior) {
    try { if (!(await stat(prior.path)).isFile()) prior = null; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") prior = null; else throw error; }
  }
  if (options.runId && prior?.runId === options.runId) return prior;
  const headers = new Headers({ accept: "application/json, text/csv, application/zip, */*" });
  for (const [name, value] of Object.entries(resource.headers ?? {})) headers.set(name, value);
  if (body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (resource.kind === "SOCRATA" && process.env.SOCRATA_APP_TOKEN) headers.set("x-app-token", process.env.SOCRATA_APP_TOKEN);
  if (prior?.etag) headers.set("if-none-match", prior.etag);
  else if (prior?.modified) headers.set("if-modified-since", prior.modified);
  const acquired = await response(url, headers, resource, body, options);
  const checkedAt = (options.now ?? (() => new Date().toISOString()))();
  if (acquired.status === 304) {
    await acquired.body?.cancel();
    if (!prior) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "An unchanged campaign response has no saved source body.");
    const value: Download = { ...prior, runId: options.runId ?? null, sourceCheck: { requestedUrl: url, finalUrl: acquired.url || url, httpStatus: 304, rawHash: prior.rawHash, checkedAt } };
    await saveCheckpoint(head, value);
    return value;
  }
  const generation = join(directory, randomUUID());
  await mkdir(generation, { recursive: true });
  try {
    if (!acquired.body) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The campaign publication has no response bytes.");
    const bodyHash = createHash("sha256");
    const raw = new Response(acquired.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(bytes, controller) {
      bodyHash.update(bytes); controller.enqueue(bytes);
    } })), { status: acquired.status, headers: acquired.headers });
    const { path, archiveId } = await saveFederalBulkBytes({ root: options.directory, vault: options.vault, signal: options.signal }, async () => raw, generation, url);
    const rawHash = bodyHash.digest("hex");
    const bytesHeld: DownloadCheckpoint = prior?.rawHash === rawHash ? { ...prior, etag: acquired.headers.get("etag") } : {
      path, archiveId, rawHash, byteLength: (await stat(path)).size, etag: acquired.headers.get("etag"), modified: acquired.headers.get("last-modified"), retrievedAt: checkedAt,
    };
    const value: Download = { ...bytesHeld, runId: options.runId ?? null, sourceCheck: { requestedUrl: url, finalUrl: acquired.url || url, httpStatus: 200, rawHash, checkedAt } };
    await saveCheckpoint(head, value);
    if (value.path !== path) await rm(generation, { recursive: true, force: true });
    else if (prior) await rm(dirname(prior.path), { recursive: true, force: true });
    return value;
  } catch (error) { await rm(generation, { recursive: true, force: true }); throw error; }
}

export async function* acquireCampaignFinanceResource(state: string, resource: CampaignFinanceResource, options: Options): AsyncGenerator<CampaignSourcePage> {
  campaignFinanceSource(state);
  const pageSize = resource.pageSize ?? (resource.kind === "SOCRATA" ? 50_000 : 500);
  let offset = resource.firstOffset ?? 0;
  let totalRead = 0, expectedTotal: number | null = null;
  function completed(rows: number, total: number | null, paged: boolean) {
    if (resource.totalPath) {
      if (!Number.isSafeInteger(total) || total! < 0 || expectedTotal !== null && total !== expectedTotal) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The campaign API denominator changed or is missing.");
      expectedTotal = total;
      totalRead += rows;
      if (totalRead > total! || rows === 0 && totalRead < total!) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The campaign API response is truncated or exceeds its denominator.");
      return totalRead === total;
    }
    return !paged || rows < pageSize;
  }
  for (;;) {
    const url = new URL(resource.url);
    const body: Record<string, unknown> | null = resource.method ? { ...resource.body } : null;
    const paged = resource.kind === "SOCRATA" || resource.offsetParameter !== undefined;
    if (resource.kind === "SOCRATA") {
      url.searchParams.set("$limit", String(pageSize)); url.searchParams.set("$offset", String(offset)); url.searchParams.set("$order", ":id");
    } else if (resource.offsetParameter) {
      const parameters = { [resource.offsetParameter]: offset, ...(resource.limitParameter ? { [resource.limitParameter]: pageSize } : {}) };
      for (const [name, value] of Object.entries(parameters)) {
        if (body) body[name] = value; else url.searchParams.set(name, String(value));
      }
    }
    const directory = join(options.directory, state, resource.id);
    await mkdir(directory, { recursive: true });
    const checkpointPath = join(directory, digest(`${url.href}:${JSON.stringify(body)}`) + ".json");
    const prior = await checkpoint<ResourceCheckpoint>(checkpointPath);
    const raw = await download(state, url.href, resource, body, options);
    const unchanged = prior?.rawHash === raw.rawHash;
    if (unchanged && options.acceptedPublicationId && prior.publicationId === options.acceptedPublicationId) {
      await saveCheckpoint(checkpointPath, { ...prior, publicationId: options.publicationId ?? null });
      const complete = completed(prior.rows, prior.total, paged);
      yield { records: [], capture: null, offset, complete, unchanged: true, sourceCheck: raw.sourceCheck, observedAt: raw.retrievedAt };
      if (complete) return;
      offset += resource.offsetUnit === "PAGE" ? 1 : prior.rows; continue;
    }
    const metadata = { url: url.href, retrievedAt: raw.retrievedAt, archiveId: raw.archiveId, rawHash: raw.rawHash, byteLength: raw.byteLength,
      publicationDate: raw.modified && Number.isFinite(Date.parse(raw.modified)) ? new Date(raw.modified).toISOString() : null };
    const envelope: FederalJsonEnvelope = { rows: 0, found: false };
    let count = 0;
    for await (const page of filePages(state, resource, raw.path, metadata, options, envelope)) {
      count += page.records.length;
      yield { ...page, offset: offset + count, complete: false, unchanged, sourceCheck: raw.sourceCheck, observedAt: raw.retrievedAt };
    }
    const total = resource.totalPath ? property(envelope.value, resource.totalPath) as number : null;
    const errors = resource.errorsPath ? property(envelope.value, resource.errorsPath) : null;
    if (errors && (!Array.isArray(errors) || errors.length)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The campaign API reports incomplete or failed source results.");
    const complete = completed(count, total, paged);
    await saveCheckpoint(checkpointPath, { rawHash: raw.rawHash, rows: count, total, retrievedAt: raw.retrievedAt, publicationId: options.publicationId ?? null } satisfies ResourceCheckpoint);
    yield { records: [], capture: null, offset: offset + count, complete, unchanged, sourceCheck: raw.sourceCheck, observedAt: raw.retrievedAt };
    if (complete) return;
    offset += resource.offsetUnit === "PAGE" ? 1 : count;
  }
}
