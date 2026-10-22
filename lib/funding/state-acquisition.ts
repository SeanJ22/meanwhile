import { temporaryPath } from "../civic-data/temporary-path.ts";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { SourceCheckEvidence } from "../civic-data/types.ts";
import { requestPublisher, sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import { federalBulkMemory, saveFederalBulkBytes } from "../federal-money/bulk.ts";
import { federalCsvRecords, federalJsonRecords, federalJsonStringBytes, federalZipBytes, federalZipEntries, type FederalJsonEnvelope } from "../federal-money/streams.ts";
import { csvRows } from "../reference/csv.ts";
import { OUTBOUND_USER_AGENT } from "../geo/outbound-agent.ts";
import { campaignSourceRecord, type CampaignSourceCapture, type CampaignSourceRecord } from "./state-source-records.ts";
import { CAMPAIGN_FINANCE_PARSER, campaignFinanceSource, type CampaignFinanceResource } from "./state-sources.ts";
import { campaignSession } from "./state-request.ts";
import { joinedCampaignSourceRows } from "./state-source-join.ts";

interface DownloadCheckpoint { readonly etag: string | null; readonly modified: string | null; readonly archiveId: string; readonly rawHash: string; readonly path: string; readonly byteLength: number; readonly retrievedAt: string }
interface Download extends DownloadCheckpoint { readonly sourceCheck: SourceCheckEvidence; readonly runId: string | null;readonly releaseVersion?:string }
interface ResourceCheckpoint { readonly rawHash: string; readonly rows: number; readonly total: number | null; readonly retrievedAt: string; readonly publicationId: string | null }
interface CampaignSourcePage {
  readonly records: readonly CampaignSourceRecord[];
  readonly inputRecords:number;
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
  readonly releaseEveryMs?: number;
  readonly selectRecord?:(row:CampaignSourceRecord)=>CampaignSourceRecord|null;
  readonly onCapture?:(capture:CampaignSourceCapture)=>Promise<void>;
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function requestIdentity(url: string, body: Record<string, unknown> | null, resource: CampaignFinanceResource): string {
  const stableUrl = new URL(url), stableBody = body ? { ...body } : null;
  if (resource.throughDateParameter) {
    if (stableBody) delete stableBody[resource.throughDateParameter];
    else stableUrl.searchParams.delete(resource.throughDateParameter);
  }
  if (stableBody && resource.session?.hiddenFields) for (const name of Object.keys(stableBody)) if (name.startsWith("__")) delete stableBody[name];
  if (stableBody && resource.session?.tokenField) delete stableBody[resource.session.tokenField];
  return `${stableUrl.href}:${JSON.stringify(stableBody)}`;
}
const sleep = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
  signal.addEventListener("abort", abort, { once: true });
});

export async function campaignSourceResponse(url: string, init: RequestInit, options: Pick<Options, "signal" | "fetch" | "sleep">): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", OUTBOUND_USER_AGENT);
  for (let attempt = 0; ; attempt++) {
    options.signal.throwIfAborted();
    const result = await requestPublisher("official campaign finance", () => (options.fetch ?? fetch)(url, { ...init, headers, signal: options.signal }));
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
  url: string; retrievedAt: string; publicationDate: string | null; archiveId: string; rawHash: string; byteLength: number;
}, options: Options, envelope: FederalJsonEnvelope = { rows: 0, found: false }): AsyncGenerator<{ records: CampaignSourceRecord[]; capture: CampaignSourceCapture;inputRecords:number }> {
  let records: CampaignSourceRecord[] = [], bytes = 0, inputRecords=0, projectionOrdinal = 0, columns: string[] | null = null, selectedColumns: readonly { field: string; index: number }[] | null = null, preambleRows = resource.preambleRows ?? 0;
  let capture: CampaignSourceCapture = { url: metadata.url, retrievedAt: metadata.retrievedAt, publicationDate: metadata.publicationDate,
    rawHash: metadata.rawHash, byteLength: metadata.byteLength, vaultKey: metadata.archiveId };
  const json = resource.kind === "JSON" || resource.kind === "SOCRATA";
  const decoded = resource.jsonStringEnvelope ? federalJsonStringBytes(input, resource.jsonStringEnvelope) : input;
  const rows = json ? federalJsonRecords(decoded, resource.rowPath ?? "", envelope) : federalCsvRecords(input, resource.encoding, resource.quote);
  for await (const raw of rows) {
    options.signal.throwIfAborted();
    if (!json && preambleRows > 0) {
      const published = resource.preamblePublicationDate ? new RegExp(resource.preamblePublicationDate).exec(raw)?.[1]?.trim() : null;
      if (published) capture = { ...capture, publicationDate: published };
      preambleRows--; continue;
    }
    if (!json && columns === null) {
      columns = [...csvRows(raw.replace(/^\uFEFF/, ""), resource.delimiter, resource.quote)][0];
      if (!columns?.length || !resource.csvColumns && new Set(columns).size !== columns.length) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Campaign export columns are missing or repeated.");
      if (resource.csvColumns) {
        selectedColumns = resource.csvColumns.map(({ field, header, occurrence = 1 }) => {
          const index = columns!.flatMap((name, index) => name === header ? [index] : [])[occurrence - 1];
          if (index === undefined) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Campaign export no longer contains its declared native column occurrence.");
          return { field, index };
        });
        if (new Set(selectedColumns.map(column => column.field)).size !== selectedColumns.length) throw new Error("Campaign export mappings repeat a projected field.");
      }
      const projectedColumns = selectedColumns?.map(column => column.field) ?? columns;
      if (resource.filedCondition && !projectedColumns.includes(resource.filedCondition.field)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Campaign export no longer contains its filing status column.");
      if ([...resource.identity, ...(resource.filerIdentity ?? [])].some(field => !projectedColumns.includes(field)) ||
          resource.filer.length && !resource.filer.some(field => projectedColumns.includes(field)) ||
          resource.amounts.length && !resource.amounts.some(amount => projectedColumns.includes(amount.field))) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Campaign export no longer contains its declared native identity or amount columns.");
      continue;
    }
    const length = Buffer.byteLength(raw);
    if (records.length && (records.length >= 500 || bytes + length > 2 * 1024 * 1024)) {
      if (federalBulkMemory.hasSubscribers) federalBulkMemory.publish({ stage: "campaign-project", item: metadata.url, itemBytes: bytes, retainedRows: records.length });
      yield { records, capture,inputRecords }; records = []; bytes = 0; inputRecords=0;
    }
    let value: Record<string, unknown>;
    if (json) value = JSON.parse(raw);
    else {
      const fields = [...csvRows(raw, resource.delimiter, resource.quote)][0];
      if (!fields || fields.length === 1 && fields[0] === "") continue;
      if (fields.length !== columns!.length) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "A campaign row differs from its source columns.");
      value = Object.fromEntries((selectedColumns ?? columns!.map((field, index) => ({ field, index }))).map(({ field, index }) => [field, fields[index]]));
    }
    inputRecords++;
    const sourceRecord=campaignSourceRecord(state, resource, value, capture, projectionOrdinal++);
    const record=options.selectRecord?options.selectRecord(sourceRecord):sourceRecord;
    if(record){records.push(record);bytes+=length;}
  }
  if (records.length || inputRecords || json || columns!==null) {
    if (federalBulkMemory.hasSubscribers) federalBulkMemory.publish({ stage: "campaign-project", item: metadata.url, itemBytes: bytes, retainedRows: records.length });
    yield { records, capture,inputRecords };
  }
  if (!json && columns === null) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The campaign export has no source columns.");
  if (json && !envelope.found) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The campaign API response has no declared record array.");
}

async function* filePages(state: string, resource: CampaignFinanceResource, path: string,
  metadata: Parameters<typeof capturedRows>[3] & { readonly rawHash: string; readonly byteLength: number }, options: Options, envelope: FederalJsonEnvelope, lookup?: Download) {
  if (resource.emptyResponse && metadata.byteLength <= Buffer.byteLength(resource.emptyResponse) + 2 &&
      (await readFile(path, "utf8")).trim() === resource.emptyResponse) return;
  if (resource.lookup) {
    const capture: CampaignSourceCapture = { url: metadata.url, retrievedAt: metadata.retrievedAt, publicationDate: metadata.publicationDate,
      rawHash: metadata.rawHash, byteLength: metadata.byteLength, vaultKey: metadata.archiveId, ...(lookup ? {
      lookup: { url: lookup.sourceCheck.requestedUrl, rawHash: lookup.rawHash, vaultKey: lookup.archiveId, byteLength: lookup.byteLength,
        retrievedAt: lookup.retrievedAt, publicationDate: lookup.modified && Number.isFinite(Date.parse(lookup.modified)) ? new Date(lookup.modified).toISOString() : null },
    } : {}) };
    let records: CampaignSourceRecord[] = [], ordinal = 0,inputRecords=0,bytes=0;
    for await (const raw of federalJsonRecords(joinedCampaignSourceRows(path, resource, `${path}.join`, options.signal, lookup?.path), "", envelope)) {
      if(records.length && (records.length>=500 || bytes+Buffer.byteLength(raw)>2*1024*1024)){
        yield {records,capture,inputRecords};records=[];inputRecords=0;bytes=0;
      }
      inputRecords++;
      const sourceRecord=campaignSourceRecord(state, resource, JSON.parse(raw), capture, ordinal++);
      const record=options.selectRecord?options.selectRecord(sourceRecord):sourceRecord;
      if(record){records.push(record);bytes+=Buffer.byteLength(raw);}
    }
    if (records.length || inputRecords) yield { records, capture,inputRecords };
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
  await writeFile(temporaryPath(temporary), JSON.stringify(value));
  await rename(temporaryPath(temporary), temporaryPath(path));
}
async function download(state: string, url: string, resource: CampaignFinanceResource, body: Record<string, unknown> | null, options: Options): Promise<Download> {
  const key = digest(requestIdentity(url, body, resource));

  const directory = join(options.directory, state, "downloads", key);
  await mkdir(temporaryPath(directory), { recursive: true });
  const head = join(directory, "download.json");
  let prior = await checkpoint<Download>(head);
  if (prior) {
    try { if (!(await stat(prior.path)).isFile()) prior = null; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") prior = null; else throw error; }
  }
  if (options.runId && prior?.runId === options.runId) return prior;
  const at=(options.now??(()=>new Date().toISOString()))();
  if(prior && options.releaseEveryMs !== undefined && Date.parse(at)-Date.parse(prior.sourceCheck.checkedAt)<options.releaseEveryMs)return prior;
  const resourceUrl=new URL(resource.url);
  const versionUrl=resource.releaseVersionUrl ?? (resource.kind==="SOCRATA" ? new URL(`/api/views/${resourceUrl.pathname.split("/").at(-1)!.replace(/\.json$/,"")}.json`,resourceUrl).href : null);
  let releaseVersion:string|undefined;
  let releasePublishedAt:string|null=null;
  if(versionUrl && options.releaseEveryMs!==undefined){
    const metadata=await campaignSourceResponse(versionUrl,{},options);
    const reader=metadata.body?.getReader(),chunks:Uint8Array[]=[];
    let length=0;
    try{
      for(;;){
        const chunk=await reader?.read();
        if(!chunk || chunk.done)break;
        length+=chunk.value.byteLength;
        if(length>4*1024*1024)throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID","The source release metadata exceeds one metadata page");
        chunks.push(chunk.value);
      }
    }finally{await reader?.cancel();}
    const bytes=Buffer.concat(chunks,length);
    const value=property(JSON.parse(new TextDecoder().decode(bytes)),resource.releaseVersionPath??"rowsUpdatedAt");
    if(typeof value!=="number" && typeof value!=="string")throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID","The source release metadata has no published version");
    releaseVersion=String(value);
    if(resource.kind==="SOCRATA" && typeof value==="number" && Number.isFinite(new Date(value*1000).getTime()))releasePublishedAt=new Date(value*1000).toISOString();
    const rawHash=digest(new TextDecoder().decode(bytes));
    await options.vault.put(`project/meanwhile/source/campaign-finance-release/${rawHash}`,bytes,{contentHash:`sha256-${rawHash}`,byteLength:bytes.length,contentType:"application/json"});
    if(prior?.releaseVersion===releaseVersion){
      const unchanged:Download={...prior,runId:options.runId??null,sourceCheck:{...prior.sourceCheck,checkedAt:at}};
      await saveCheckpoint(head,unchanged);return unchanged;
    }
  }
  const headers = new Headers({ accept: "application/json, text/csv, application/zip, */*" });
  for (const [name, value] of Object.entries(resource.headers ?? {})) headers.set(name, value);
  if (resource.method && body && !headers.has("content-type")) headers.set("content-type", resource.requestEncoding === "FORM" ? "application/x-www-form-urlencoded; charset=UTF-8" : "application/json");
  if (resource.kind === "SOCRATA" && process.env.SOCRATA_APP_TOKEN) headers.set("x-app-token", process.env.SOCRATA_APP_TOKEN);
  if (prior?.etag) headers.set("if-none-match", prior.etag);
  else if (prior?.modified) headers.set("if-modified-since", prior.modified);
  const acquired = await campaignSourceResponse(url, { headers, ...(resource.method ? { method: resource.method, body: resource.requestEncoding === "FORM" ? new URLSearchParams(Object.entries(body ?? {}).map(([name, value]) => [name, value === null || value === undefined ? "" : String(value)])).toString() : JSON.stringify(body) } : {}) }, options);
  const checkedAt = (options.now ?? (() => new Date().toISOString()))();
  if (acquired.status === 304) {
    await acquired.body?.cancel();
    if (!prior) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "An unchanged campaign response has no saved source body.");
    const value: Download = { ...prior, runId: options.runId ?? null, sourceCheck: { requestedUrl: url, finalUrl: acquired.url || url, httpStatus: 304, rawHash: prior.rawHash, checkedAt } };
    await saveCheckpoint(head, value);
    return value;
  }
  const generation = join(directory, randomUUID());
  await mkdir(temporaryPath(generation), { recursive: true });
  try {
    if (!acquired.body) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The campaign publication has no response bytes.");
    const bodyHash = createHash("sha256");
    const raw = new Response(acquired.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(bytes, controller) {
      bodyHash.update(bytes); controller.enqueue(bytes);
    } })), { status: acquired.status, headers: acquired.headers });
    const { path, archiveId } = await saveFederalBulkBytes({ root: options.directory, vault: options.vault, signal: options.signal }, async () => raw, generation, url);
    const rawHash = bodyHash.digest("hex");
    const bytesHeld: DownloadCheckpoint = prior?.rawHash === rawHash ? { ...prior, etag: acquired.headers.get("etag") } : {
      path, archiveId, rawHash, byteLength: (await stat(path)).size, etag: acquired.headers.get("etag"), modified: acquired.headers.get("last-modified")??releasePublishedAt, retrievedAt: checkedAt,
    };
    const value: Download = { ...bytesHeld,...(releaseVersion?{releaseVersion}:{}), runId: options.runId ?? null, sourceCheck: { requestedUrl: url, finalUrl: acquired.url || url, httpStatus: 200, rawHash, checkedAt } };
    await saveCheckpoint(head, value);
    if (value.path !== path) await rm(temporaryPath(generation), { recursive: true, force: true });
    else if (prior) await rm(temporaryPath(dirname(prior.path)), { recursive: true, force: true });
    return value;
  } catch (error) { await rm(temporaryPath(generation), { recursive: true, force: true }); throw error; }
}

export async function* acquireCampaignFinanceResource(state: string, resource: CampaignFinanceResource, options: Options): AsyncGenerator<CampaignSourcePage> {
  campaignFinanceSource(state);
  const descriptorHash = digest(`${CAMPAIGN_FINANCE_PARSER}:${JSON.stringify(resource)}`);
  resource = await campaignSession(resource, options.vault, url => campaignSourceResponse(url, {}, options));
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
    const body: Record<string, unknown> | null = resource.method || resource.jsonQuery ? { ...resource.body } : null;
    if (resource.throughDateParameter) {
      const through = (options.now ?? (() => new Date().toISOString()))().slice(0, 10);
      if (body) body[resource.throughDateParameter] = through;
      else url.searchParams.set(resource.throughDateParameter, through);
    }
    const paged = resource.kind === "SOCRATA" || resource.offsetParameter !== undefined;
    if(resource.since){
      const since=resource.since,year=campaignFinanceSource(state).minimumYear;
      const condition=since.kind==="YEAR" ? `${since.field} >= ${year}` : `${since.field} >= '${year}-01-01T00:00:00.000'`;
      if(resource.kind!=="SOCRATA")throw new Error("Campaign date predicate requires its declared native API");
      const held=url.searchParams.get("$where");url.searchParams.set("$where",held?`(${held}) AND (${condition})`:condition);
    }
    if (resource.kind === "SOCRATA") {
      url.searchParams.set("$limit", String(pageSize)); url.searchParams.set("$offset", String(offset));
      if(!url.searchParams.has("$order"))url.searchParams.set("$order", ":id");
    } else if (resource.offsetParameter) {
      const parameters = { [resource.offsetParameter]: offset, ...(resource.limitParameter ? { [resource.limitParameter]: pageSize } : {}) };
      for (const [name, value] of Object.entries(parameters)) {
        if (body) body[name] = value; else url.searchParams.set(name, String(value));
      }
    }
    if (resource.jsonQuery) url.searchParams.set(resource.jsonQuery.parameter, JSON.stringify({ [resource.jsonQuery.field]: body }));
    const directory = join(options.directory, state, resource.id);
    await mkdir(temporaryPath(directory), { recursive: true });
    const checkpointPath = join(directory, digest(requestIdentity(url.href, body, resource)) + ".json");
    const prior = await checkpoint<ResourceCheckpoint>(checkpointPath);
    const raw = await download(state, url.href, resource, body, options);
    const lookupUrl = resource.lookup?.relativeUrl ? new URL(resource.lookup.relativeUrl, url).href : resource.lookup?.url;
    if (resource.lookup?.publicationResource && !campaignFinanceSource(state).resources.some(row => row.id === resource.lookup!.publicationResource)) throw new Error("The shared native cover file has no registered publication resource.");
    const lookup = lookupUrl ? await download(state, lookupUrl, { ...resource, method: undefined }, null, options) : undefined;
    const metadata = { url: url.href, retrievedAt: raw.retrievedAt, archiveId: raw.archiveId, rawHash: raw.rawHash, byteLength: raw.byteLength,
      publicationDate: raw.modified && Number.isFinite(Date.parse(raw.modified)) ? new Date(raw.modified).toISOString() : null };
    await options.onCapture?.({url:metadata.url,retrievedAt:metadata.retrievedAt,publicationDate:metadata.publicationDate,
      rawHash:raw.rawHash,byteLength:raw.byteLength,vaultKey:raw.archiveId});
    if(lookup)await options.onCapture?.({url:lookup.sourceCheck.requestedUrl,retrievedAt:lookup.retrievedAt,publicationDate:null,
      rawHash:lookup.rawHash,byteLength:lookup.byteLength,vaultKey:lookup.archiveId});
    const projectionHash = digest(`${descriptorHash}:${raw.rawHash}:${lookup?.rawHash ?? ""}`);
    const unchanged = prior?.rawHash === projectionHash;
    if (unchanged && options.acceptedPublicationId && prior.publicationId === options.acceptedPublicationId) {
      await saveCheckpoint(checkpointPath, { ...prior, publicationId: options.publicationId ?? null });
      const complete = completed(prior.rows, prior.total, paged);
      yield { records: [],inputRecords:0, capture: null, offset, complete, unchanged: true, sourceCheck: raw.sourceCheck, observedAt: raw.retrievedAt };
      if (complete) return;
      offset += resource.offsetUnit === "PAGE" ? 1 : prior.rows; continue;
    }
    const envelope: FederalJsonEnvelope = { rows: 0, found: false };
    let count = 0;
    for await (const page of filePages(state, resource, raw.path, metadata, options, envelope, lookup)) {
      count += page.inputRecords;
      yield { ...page, offset: offset + count, complete: false, unchanged, sourceCheck: raw.sourceCheck, observedAt: raw.retrievedAt };
    }
    const total = resource.totalPath ? property(envelope.value, resource.totalPath) as number : null;
    const errors = resource.errorsPath ? property(envelope.value, resource.errorsPath) : null;
    if (errors && (!Array.isArray(errors) || errors.length)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The campaign API reports incomplete or failed source results.");
    const complete = completed(count, total, paged);
    await saveCheckpoint(checkpointPath, { rawHash: projectionHash, rows: count, total, retrievedAt: raw.retrievedAt, publicationId: options.publicationId ?? null } satisfies ResourceCheckpoint);
    yield { records: [],inputRecords:0, capture: null, offset: offset + count, complete, unchanged, sourceCheck: raw.sourceCheck, observedAt: raw.retrievedAt };
    if (complete) return;
    offset += resource.offsetUnit === "PAGE" ? 1 : count;
  }
}
