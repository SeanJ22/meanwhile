import { temporaryPath } from "../civic-data/temporary-path.ts";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, readdir, rm, writeFile, truncate, rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseCsv } from "../reference/csv.ts";
import { sourceAcquisitionFailure, requestPublisher, readPublisherBody } from "../civic-data/source-acquisition-error.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { DurableEvidenceStore } from "../control-plane/evidence/durable-store.ts";
import { FEDERAL_MONEY_STATES } from "./sources.ts";
import { parseFederalMoney } from "./parse.ts";
import { readFederalMoneyCapture, saveFederalMoneyCapture } from "./vault.ts";
import { buildFederalBulk, chunkFederalCsvFile, chunkFederalJson, federalBulkCapture, federalBulkId, federalBulkMetadata, saveFederalBulkBytes, stageFederalBulkBytes, vaultFederalBulkBytes, scanFederalJson, federalBulkRangeHeaders, spoolFederalBytes, completedFederalBulkPath, completeFederalBulkState, federalBulkMemory, type FederalBulkContext } from "./bulk.ts";
import { federalCsvRecords, federalZipBytes, federalZipEntries, FEDERAL_MONEY_CHUNK_ROWS, type FederalZipEntry, type FederalJsonEnvelope } from "./streams.ts";
import type { FederalMoneyCursor, FederalMoneyPage, FederalMoneySource } from "./model.ts";

export interface FederalMoneyAcquireOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => string;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly signal?: AbortSignal;
  readonly dataGovApiKey?: string;
  readonly samGovApiKey?: string;
  readonly cursor?: FederalMoneyCursor | null;
  readonly since?: string;
  readonly retries?: number;
  readonly evidenceStore?: EvidenceStore;
  readonly cacheRoot?: string;
}
const USA = "https://api.usaspending.gov", SAM = "https://api.sam.gov/entity-information/v3", FAC = "https://api.fac.gov", FEMA = "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries";
const awardCategories = [["02", "03", "04", "05"], ["A", "B", "C", "D"], ["07", "08"]] as const;
const childTables = ["findings", "findings_text", "corrective_action_plans", "additional_ueis"] as const;
type Context = Required<Pick<FederalMoneyAcquireOptions, "fetch" | "now" | "sleep" | "retries" | "evidenceStore">> & FederalMoneyAcquireOptions;
function cleanUrl(value: string): string { const url = new URL(value); for (const key of [...url.searchParams.keys()]) if (/api.?key|token|signature|credential|authorization/i.test(key)) url.searchParams.delete(key); return url.href; }
function publisherUrl(value: string, origin: string): string {
  const url = new URL(value, origin), allowed = origin === USA ? ["api.usaspending.gov", "files.usaspending.gov"] : ["api.sam.gov"];
  if (url.protocol !== "https:" || !allowed.includes(url.hostname) || url.username || url.password) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The publisher returned an unexpected download host.");
  return url.href;
}
function retryDelay(response: Response, attempt: number, now: string): number {
  const header = response.headers.get("retry-after");
  if (header) { const seconds = Number(header); if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000); const time = Date.parse(header); if (Number.isFinite(time)) return Math.max(0, time - Date.parse(now)); }
  return Math.min(60_000, 1000 * 2 ** attempt);
}
async function request(ctx: Context, source: FederalMoneySource, url: string, init: RequestInit = {}, pending = false): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    ctx.signal?.throwIfAborted(); const response = await requestPublisher(source, () => ctx.fetch(url, { ...init, signal: ctx.signal }));
    if (response.ok || pending && [202, 404].includes(response.status)) return response;
    if ((response.status === 429 || response.status >= 500) && attempt < ctx.retries) { await response.body?.cancel(); await ctx.sleep(retryDelay(response, attempt, ctx.now()), ctx.signal); continue; }
    throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", `${source}: the publisher returned HTTP ${response.status}.`);
  }
}
async function control(ctx: Context, source: FederalMoneySource, url: string, init: RequestInit = {}) {
  const response = await request(ctx, source, url, init), body = await readPublisherBody(source, () => boundedText(response, 8 * 1024 * 1024));
  const published = response.headers.get("last-modified");
  return { response, body, url: cleanUrl(url), retrievedAt: ctx.now(), publicationDate: published && Number.isFinite(Date.parse(published)) ? new Date(published).toISOString() : null };
}
async function boundedText(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader(), buffers: Uint8Array[] = []; let length = 0;
  try { for (;;) { const next = await reader.read(); if (next.done) break; length += next.value.length; if (length > limit) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The publisher control response exceeded its size limit."); buffers.push(next.value); } }
  finally { await reader.cancel(); }
  return Buffer.concat(buffers).toString("utf8");
}
function json(body: string): Record<string, unknown> {
  try { const value: unknown = JSON.parse(body); if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>; } catch { /* Invalid control data is reported below without source bytes. */ }
  throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The publisher returned an invalid control response.");
}
function valueString(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
const emptyPage = (continuation: FederalMoneyCursor | null, declaredTotal: number | null = null): FederalMoneyPage => ({ facts: [], captures: [], complete: continuation === null, declaredTotal, continuation });
async function sourcePage(ctx: Context, source: FederalMoneySource, state: string, result: { url: string; body: string; retrievedAt: string; publicationDate: string | null }, continuation: FederalMoneyCursor | null, total: number | null = null): Promise<FederalMoneyPage> {
  const capture = await saveFederalMoneyCapture({ ...result, format: "json" }, ctx.evidenceStore);
  return { facts: parseFederalMoney(source, capture, state, result.body), captures: [capture], complete: continuation === null, declaredTotal: total, continuation };
}
const bulkContext = (ctx: Context): FederalBulkContext => ({ root: ctx.cacheRoot ?? join(tmpdir(), "meanwhile-federal-money", federalBulkId(process.cwd())), vault: ctx.evidenceStore, signal: ctx.signal });
async function bulkPage(ctx: Context, state: string, cursor: FederalMoneyCursor, next: FederalMoneyCursor | null): Promise<FederalMoneyPage> {
  const bulk = bulkContext(ctx), metadata = await federalBulkMetadata(bulk, cursor.bulkId!, state);
  if (!metadata) throw new Error("The source bulk cache is incomplete.");
  const index = cursor.chunkIndex ?? 0;
  if (index >= metadata.count) return emptyPage(next, metadata.total);
  const capture = await federalBulkCapture(bulk, cursor.bulkId!, state, index), body = await readFederalMoneyCapture(capture, ctx.evidenceStore);
  if (federalBulkMemory.hasSubscribers) federalBulkMemory.publish({ stage: "capture-parse", item: `${capture.url}:${state}:${index}`, itemBytes: capture.byteLength, liveItems: 1 });
  const continuation = index + 1 < metadata.count ? { ...cursor, chunkIndex: index + 1 } : next;
  return { facts: parseFederalMoney(cursor.source, capture, state, body), captures: [capture], complete: continuation === null, declaredTotal: metadata.total, continuation };
}
async function fema(ctx: Context, state: string, cursor: FederalMoneyCursor): Promise<FederalMoneyPage> {
  const offset = cursor.offset ?? 0, url = new URL(FEMA);
  url.searchParams.set("$filter", `state eq '${state}'${cursor.since ? ` and lastRefresh ge '${cursor.since}'` : ""}`);
  url.searchParams.set("$orderby", "id"); url.searchParams.set("$top", String(FEDERAL_MONEY_CHUNK_ROWS)); url.searchParams.set("$skip", String(offset)); url.searchParams.set("$inlinecount", "allpages");
  const result = await control(ctx, "openfema", url.href), body = json(result.body), rows = body.DisasterDeclarationsSummaries;
  if (!Array.isArray(rows)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "OpenFEMA: the declaration array is missing.");
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata as Record<string, unknown> : {}, total = typeof metadata.count === "number" && metadata.count >= rows.length ? metadata.count : null;
  const nextOffset = offset + rows.length, done = total === null ? rows.length < FEDERAL_MONEY_CHUNK_ROWS : nextOffset >= total;
  return sourcePage(ctx, "openfema", state, result, done ? null : { ...cursor, offset: nextOffset }, total);
}
async function fac(ctx: Context, state: string, cursor: FederalMoneyCursor): Promise<FederalMoneyPage> {
  if (cursor.phase === "historic") return historicAudits(ctx, state, cursor);
  const key = ctx.dataGovApiKey ?? process.env.DATA_GOV_API_KEY;
  if (!key) throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "Federal Audit Clearinghouse: DATA_GOV_API_KEY is unavailable in this runtime.");
  const headers = { "X-Api-Key": key, Prefer: "count=exact" }, table = cursor.phase;
  if (table !== "general" && !(childTables as readonly string[]).includes(table)) throw new Error("Invalid Federal Audit Clearinghouse continuation.");
  const url = new URL(`${FAC}/${table}`), offset = cursor.offset ?? 0, limit = table === "general" ? 100 : FEDERAL_MONEY_CHUNK_ROWS;
  if (table === "general") { if (state === "ZZ") url.searchParams.set("or", `(auditee_state.is.null,auditee_state.not.in.(${FEDERAL_MONEY_STATES.join(",")}))`); else url.searchParams.set("auditee_state", `eq.${state}`); if (cursor.since) url.searchParams.set("fac_accepted_date", `gte.${cursor.since.slice(0, 10)}`); }
  else { if (!cursor.reportIds?.length) throw new Error("Federal Audit Clearinghouse continuation has no report ids."); for (const id of cursor.reportIds) if (!/^[A-Za-z0-9:_-]+$/.test(id)) throw new Error("Invalid audit report id."); url.searchParams.set("report_id", `in.(${cursor.reportIds.join(",")})`); }
  url.searchParams.set("order", table === "general" ? "report_id.asc" : table === "findings" ? "report_id.asc,reference_number.asc,award_reference.asc" : table === "additional_ueis" ? "report_id.asc,additional_uei.asc" : "report_id.asc,finding_ref_number.asc"); url.searchParams.set("limit", String(limit)); url.searchParams.set("offset", String(offset));
  const result = await control(ctx, "federal-audit-clearinghouse", url.href, { headers }); let rows: unknown;
  try { rows = JSON.parse(result.body); } catch { throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Federal Audit Clearinghouse: the source response is not JSON."); }
  if (!Array.isArray(rows)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Federal Audit Clearinghouse: the report array is missing.");
  const countText = result.response.headers.get("content-range")?.split("/").at(-1), total = countText && /^\d+$/.test(countText) ? Number(countText) : null, done = total === null ? rows.length < limit : offset + rows.length >= total;
  let continuation: FederalMoneyCursor | null;
  if (table === "general") {
    const reportIds = rows.map(row => valueString((row as Record<string, unknown>).report_id));
    if (reportIds.some(id => id === null)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Federal Audit Clearinghouse: a general record has no report id.");
    continuation = reportIds.length ? { ...cursor, phase: childTables[0], offset: 0, reportIds: reportIds as string[], nextOffset: offset + rows.length, generalComplete: done } : done ? cursor.since ? null : { source: cursor.source, phase: "historic", year: 1998 } : { ...cursor, offset: offset + rows.length };
  } else if (!done) continuation = { ...cursor, offset: offset + rows.length };
  else { const index = (childTables as readonly string[]).indexOf(table); continuation = index + 1 < childTables.length ? { ...cursor, phase: childTables[index + 1]!, offset: 0 } : cursor.generalComplete ? cursor.since ? null : { source: cursor.source, phase: "historic", year: 1998 } : { source: cursor.source, phase: "general", offset: cursor.nextOffset ?? 0, since: cursor.since }; }
  return sourcePage(ctx, "federal-audit-clearinghouse", state, result, continuation, table === "general" ? total : null);
}
async function splitHistoricalEntry(bulk: FederalBulkContext, directory: string, archivePath: string, entry: FederalZipEntry, year: number, general: boolean, reports: string, split: string): Promise<void> {
  const spool = join(directory, `entry-${federalBulkId(entry.name)}`), checkpoint = `${spool}.split`;
  await spoolFederalBytes(bulk, spool, federalZipBytes(archivePath, entry));
  let progress = { offset: 0, headerText: "", complete: false, sizes: {} as Record<string, number> };
  try { progress = JSON.parse(await readFile(checkpoint, "utf8")) as typeof progress; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (progress.complete) return;
  const name = encodeURIComponent(entry.name);
  for (const target of await readdir(split)) { const path = join(split, target, name); try { await truncate(temporaryPath(path), progress.sizes[target] ?? 0); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
  let header = progress.headerText ? parseCsv(progress.headerText)[0]!.map(value => value.replace(/^\uFEFF/, "")) : null, rows = 0, largestRow = 0;
  const handles = new Map<string, Awaited<ReturnType<typeof open>>>();
  const save = async (complete = false) => { progress.complete = complete; await writeFile(temporaryPath(`${checkpoint}.next`), JSON.stringify(progress)); await rename(temporaryPath(`${checkpoint}.next`), temporaryPath(checkpoint)); rows = 0; };
  try {
    for await (const record of federalCsvRecords(createReadStream(spool, { start: progress.offset }))) {
      const recordBytes = Buffer.byteLength(record);
      if (federalBulkMemory.hasSubscribers && (rows === 0 || recordBytes > largestRow)) federalBulkMemory.publish({ stage: "state-split", item: `${year}/${entry.name}`, itemBytes: recordBytes, liveItems: 1 });
      largestRow = Math.max(largestRow, recordBytes);
      bulk.signal?.throwIfAborted(); progress.offset += Buffer.byteLength(record); const values = parseCsv(record)[0]; if (!values || !values.some(Boolean)) continue;
      if (!header) { header = values.map(value => value.replace(/^\uFEFF/, "")); progress.headerText = record; continue; }
      const row = Object.fromEntries(header.map((field, index) => [field, values[index] ?? ""])), report = federalBulkId([row.AUDITYEAR ?? year, row.DBKEY ?? ""]);
      let target = FEDERAL_MONEY_STATES.includes(row.STATE?.toUpperCase() ?? "") ? row.STATE!.toUpperCase() : "ZZ";
      if (general) await writeFile(temporaryPath(join(reports, report)), target);
      else { try { target = await readFile(join(reports, report), "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
      const path = join(split, target, name); let handle = handles.get(target);
      if (!handle) {
        await mkdir(temporaryPath(join(split, target)), { recursive: true }); handle = await open(temporaryPath(path), "a+");
        if ((await handle.stat()).size === 0) { await handle.write(progress.headerText); progress.sizes[target] = Buffer.byteLength(progress.headerText); }
        if (handles.size >= 16) { const [oldState, oldHandle] = handles.entries().next().value!; await oldHandle.close(); handles.delete(oldState); } handles.set(target, handle);
      }
      await handle.write(record); progress.sizes[target] = (progress.sizes[target] ?? 0) + Buffer.byteLength(record); rows++;
      if (rows >= FEDERAL_MONEY_CHUNK_ROWS) await save();
    }
    await save(true);
  } finally { for (const handle of handles.values()) await handle.close(); }
}
async function historicAudits(ctx: Context, state: string, cursor: FederalMoneyCursor): Promise<FederalMoneyPage> {
  const year = cursor.year ?? 1998;
  if (year < 1998 || year > 2015) throw new Error("Invalid historic FAC year.");
  const bulk = bulkContext(ctx), id = cursor.bulkId ?? federalBulkId(["fac-census", year]);
  await buildFederalBulk(bulk, id, async directory => {
    const indexUrl = "https://www.fac.gov/data/download/historic/", index = await control(ctx, "federal-audit-clearinghouse", indexUrl);
    const archive = [...index.body.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(match => new URL(match[1]!, indexUrl)).find(url => url.pathname.endsWith(`census-${year}.zip`));
    if (!archive || archive.protocol !== "https:" || !["app.fac.gov", "www.fac.gov"].includes(archive.hostname)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `Federal Audit Clearinghouse: the official historic index has no ${year} archive.`);
    const saved = await saveFederalBulkBytes(bulk, async () => request(ctx, "federal-audit-clearinghouse", archive.href, { headers: await federalBulkRangeHeaders(directory) }), directory, archive.href);
    const reports = join(directory, "reports"), split = join(directory, "split"); await mkdir(temporaryPath(reports), { recursive: true }); await mkdir(temporaryPath(split), { recursive: true });
    let hasGeneral = false;
    for (const general of [true, false]) for await (const entry of federalZipEntries(saved.path)) {
      if (!/\.csv$/i.test(entry.name) || (general ? !/ELECAUDITHEADER/i.test(entry.name) : !/ELECAUDITFINDINGS(?:TEXT)?|ELECCAPTEXT|ELECUEIS/i.test(entry.name))) continue;
      if (general) hasGeneral = true;
      await splitHistoricalEntry(bulk, directory, saved.path, entry, year, general, reports, split);
    }
    if (!hasGeneral) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Federal Audit Clearinghouse: its historic archive has no general table.");
    for (const target of await readdir(split)) {
      let count = 0;
      for (const name of [...new Set((await readdir(join(split, target))).filter(name => /\.csv(?:\.ordered)?$/i.test(decodeURIComponent(name))).map(name => name.replace(/\.ordered$/, "")))].sort((a, b) => Number(/ELECAUDITHEADER/i.test(b)) - Number(/ELECAUDITHEADER/i.test(a)) || a.localeCompare(b))) count = await chunkFederalCsvFile(bulk, directory, target, "federal-audit-clearinghouse", join(split, target, name), { url: `${archive.href}#${name}`, format: "csv", retrievedAt: ctx.now(), publicationDate: null, archiveId: saved.archiveId }, count);
      await completeFederalBulkState(bulk, directory, target, { count, archiveId: saved.archiveId, total: null });
    }
  });
  if (!await federalBulkMetadata(bulk, id, state)) return emptyPage(year === 2015 ? null : { source: cursor.source, phase: "historic", year: year + 1 });
  return bulkPage(ctx, state, { ...cursor, bulkId: id }, year === 2015 ? null : { source: cursor.source, phase: "historic", year: year + 1 });
}
function nextSpending(cursor: FederalMoneyCursor, now: string): FederalMoneyCursor | null {
  if (!cursor.since && cursor.year !== undefined && cursor.year < new Date(now).getUTCFullYear()) return { source: "usaspending", phase: "download", category: cursor.category, location: cursor.location, year: cursor.year + 1, since: cursor.since };
  const category = cursor.category ?? 0;
  return cursor.location !== "recipient" ? { source: "usaspending", phase: "download", category, location: "recipient", since: cursor.since } : category + 1 < awardCategories.length ? { source: "usaspending", phase: "download", category: category + 1, location: "performance", since: cursor.since } : null;
}
async function spending(ctx: Context, state: string, cursor: FederalMoneyCursor): Promise<FederalMoneyPage> {
  let current = cursor;
  if (current.bulkId) return bulkPage(ctx, state, current, nextSpending(current, ctx.now()));
  const category = awardCategories[current.category ?? 0]; if (!category) throw new Error("Invalid USAspending category continuation.");
  const locationFilter = current.location === "recipient" ? "recipient_locations" : "place_of_performance_locations";
  if (current.year === undefined) current = { ...current, year: 2000 };
  if (!current.statusUrl || !current.fileUrl) {
    const filters = { agencies: [{ type: "awarding", tier: "toptier", name: "all" }], prime_award_types: category, [locationFilter]: [{ country: "USA", state }],
      date_type: current.since ? "last_modified_date" : "action_date",
      date_range: { start_date: current.since?.slice(0, 10) ?? (current.year === 2000 ? "2000-10-01" : `${current.year}-01-01`), end_date: current.since ? ctx.now().slice(0, 10) : `${current.year}-12-31` } };
    const result = await control(ctx, "usaspending", `${USA}/api/v2/bulk_download/awards/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filters, file_format: "csv" }) }), data = json(result.body), statusUrl = valueString(data.status_url), fileUrl = valueString(data.file_url);
    if (!statusUrl || !fileUrl) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "USAspending: the transaction extract links are missing."); current = { ...current, statusUrl: publisherUrl(statusUrl, USA), fileUrl: publisherUrl(fileUrl, USA) };
  }
  const status = await control(ctx, "usaspending", publisherUrl(current.statusUrl!, USA)), stateValue = String(json(status.body).status ?? "").toLowerCase();
  if (["failed", "error"].includes(stateValue)) throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "USAspending: the publisher could not generate its transaction extract.");
  if (!["finished", "ready", "complete", "completed"].includes(stateValue)) return emptyPage(current);
  const id = federalBulkId(["usaspending", state, current.year, current.category, current.location, current.since ?? "initial"]), bulk = bulkContext(ctx);
  await buildFederalBulk(bulk, id, async directory => {
    const identityPath = join(directory, "source.json");
    let source = { fileUrl: current.fileUrl!, statusUrl: current.statusUrl!, publicationDate: status.publicationDate };
    try { source = JSON.parse(await readFile(identityPath, "utf8")) as typeof source; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await writeFile(temporaryPath(identityPath), JSON.stringify(source)); }
    const saved = await saveFederalBulkBytes(bulk, async () => request(ctx, "usaspending", publisherUrl(source.fileUrl, USA), { headers: await federalBulkRangeHeaders(directory) }), directory, cleanUrl(source.fileUrl)); let count = 0, found = false;
    for await (const entry of federalZipEntries(saved.path)) if (/\.csv$/i.test(entry.name) && !/dictionary|readme|data.?sources/i.test(entry.name)) { found = true; const spool = join(directory, `entry-${federalBulkId(entry.name)}`); await spoolFederalBytes(bulk, spool, federalZipBytes(saved.path, entry)); count = await chunkFederalCsvFile(bulk, directory, state, "usaspending", spool, { url: `${cleanUrl(source.fileUrl)}#${encodeURIComponent(entry.name)}`, format: "csv", retrievedAt: ctx.now(), publicationDate: source.publicationDate, archiveId: saved.archiveId }, count); }
    if (!found) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "USAspending: the transaction archive has no source CSV.");
    await completeFederalBulkState(bulk, directory, state, { count, archiveId: saved.archiveId, total: null });
  });
  return bulkPage(ctx, state, { ...current, bulkId: id, chunkIndex: 0 }, nextSpending(current, ctx.now()));
}
async function sam(ctx: Context, state: string, cursor: FederalMoneyCursor): Promise<FederalMoneyPage> {
  const next: FederalMoneyCursor | null = cursor.registered === false ? null : { source: "sam-gov-entities", phase: "extract", registered: false, since: cursor.since };
  if (cursor.bulkId) return bulkPage(ctx, state, cursor, next);
  const key = ctx.samGovApiKey ?? process.env.SAM_GOV_API_KEY; if (!key) throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "SAM.gov: SAM_GOV_API_KEY is unavailable in this runtime.");
  const headers = { "X-Api-Key": key, Accept: "application/json", "Content-Type": "application/json" }, url = new URL(`${SAM}/entities`);
  url.searchParams.set("api_key", key); url.searchParams.set("physicalAddressProvinceOrStateCode", state); url.searchParams.set("samRegistered", cursor.registered === false ? "No" : "Yes"); url.searchParams.set("includeSections", "entityRegistration,coreData"); url.searchParams.set("format", "json");
  if (cursor.since) { const format = (date: Date) => `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}/${date.getUTCFullYear()}`; url.searchParams.set("updateDate", `[${format(new Date(cursor.since))},${format(new Date(ctx.now()))}]`); }
  const id = federalBulkId(["sam", state, cursor.registered !== false, cursor.since ?? "initial"]), bulk = bulkContext(ctx);
  await buildFederalBulk(bulk, id, async directory => {
    let response = await completedFederalBulkPath(directory) ? new Response() : await request(ctx, "sam-gov-entities", url.href, { headers }), downloadToken: string | null = null, requestUrl = url.href, requestMethod: "GET" | "POST" = "GET";
    for (let pending = 0; ; pending++) {
      ctx.signal?.throwIfAborted();
      if ([202, 404].includes(response.status)) { await response.body?.cancel(); await ctx.sleep(retryDelay(response, pending, ctx.now()), ctx.signal); response = await request(ctx, "sam-gov-entities", requestUrl, { headers, method: requestMethod }, true); continue; }
      const path = await stageFederalBulkBytes(bulk, response, directory);
      const envelope = await samExtractResponse(bulk, path, key), data = envelope.value ?? {};
      if (envelope.found) {
        await scanFederalJson(bulk, path, "entityData", [downloadToken ?? ""]);
        if (data.links && typeof data.links === "object" && valueString((data.links as Record<string, unknown>).nextLink)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "SAM.gov returned a paginated response to a full-state extract request; the response is incomplete.");
        const total = data.totalRecords ?? data.totalRecordsCount;
        if (typeof total === "number" && total !== envelope.rows) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "SAM.gov: its extract row count did not reconcile; incomplete data was retained for retry.");
        const archiveId = await vaultFederalBulkBytes(bulk, path, cleanUrl(url.href));
        const result = await chunkFederalJson(bulk, directory, state, path, { url: cleanUrl(url.href), format: "json", retrievedAt: ctx.now(), publicationDate: response.headers.get("last-modified"), archiveId }, "entityData");
        await completeFederalBulkState(bulk, directory, state, { count: result.count, archiveId, total: typeof total === "number" ? total : null }); break;
      }
      const values = [data.downloadURL, data.downloadUrl, data.downloadLink, data.url, data.message, data.detail].filter(value => typeof value === "string").join(" "), rawLink = values.match(/https:\/\/api\.sam\.gov\/[^\s"<>]+/)?.[0];
      await rm(temporaryPath(path)); await rm(temporaryPath(join(directory, "download.state")), { force: true });
      if (!rawLink && /not ready|in progress|being processed|not available|try again/i.test(values)) { await ctx.sleep(retryDelay(response, pending, ctx.now()), ctx.signal); response = await request(ctx, "sam-gov-entities", requestUrl, { headers, method: requestMethod }, true); continue; }
      if (!rawLink) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "SAM.gov: the public state extract download link is missing.");
      const download = new URL(publisherUrl(rawLink, SAM)); download.searchParams.delete("apiKey"); download.searchParams.set("api_key", key); downloadToken = download.searchParams.get("token");
      requestMethod = /\bPOST\s+url\s*:/i.test(values) ? "POST" : "GET";
      requestUrl = download.href; response = await request(ctx, "sam-gov-entities", requestUrl, { headers, method: requestMethod }, true);
    }
  });
  return bulkPage(ctx, state, { ...cursor, bulkId: id, chunkIndex: 0 }, next);
}
async function samExtractResponse(bulk: FederalBulkContext, path: string, key: string): Promise<FederalJsonEnvelope> {
  const file = await open(path, "r");
  try {
    const prefix = Buffer.alloc(4096), { bytesRead } = await file.read(prefix, 0, prefix.length, 0);
    const start = prefix.subarray(0, bytesRead).toString("utf8").replace(/^\uFEFF/, "").trimStart();
    if (prefix[0] === 0x1f && prefix[1] === 0x8b || start.startsWith("{") || start.startsWith("[")) return scanFederalJson(bulk, path, "entityData", [key]);
    if ((await file.stat()).size > 8 * 1024 * 1024) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The publisher control response exceeded its size limit.");
    let notice = new TextDecoder("utf-8", { fatal: true }).decode(await file.readFile());
    if (start.startsWith('"')) {
      try { const value: unknown = JSON.parse(notice); if (typeof value !== "string") throw new Error(); notice = value; }
      catch { throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "SAM.gov: its extract notice is invalid."); }
    }
    if (notice.includes(key) || notice.includes(encodeURIComponent(key))) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "SAM.gov: its source response echoed a private credential and cannot be saved.");
    return { rows: 0, found: false, value: { message: notice } };
  } finally { await file.close(); }
}
export function federalMoneyAcquisitionVault(): EvidenceStore {
  return new DurableEvidenceStore(join(process.cwd(), "data", "control-plane", "vault"));
}
export async function acquireFederalMoney(source: FederalMoneySource, state: string, options: FederalMoneyAcquireOptions = {}): Promise<FederalMoneyPage> {
  state = state.toUpperCase(); if (!/^[A-Z]{2}$/.test(state)) throw new Error("Invalid federal money state.");
  if (options.cursor && options.cursor.source !== source) throw new Error("Federal money cursor belongs to another source.");
  const ctx: Context = { ...options, fetch: options.fetch ?? fetch, now: options.now ?? (() => new Date().toISOString()), evidenceStore: options.evidenceStore ?? federalMoneyAcquisitionVault(), retries: options.retries ?? 4,
    sleep: options.sleep ?? ((milliseconds, signal) => new Promise((resolve, reject) => { signal?.throwIfAborted(); const timer = setTimeout(done, milliseconds); function done() { signal?.removeEventListener("abort", abort); resolve(); } function abort() { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason); } signal?.addEventListener("abort", abort, { once: true }); })) };
  const cursor: FederalMoneyCursor = options.cursor ?? { source, phase: source === "federal-audit-clearinghouse" ? "general" : source === "usaspending" ? "download" : source === "openfema" ? "declarations" : "extract", since: options.since };
  return (source === "openfema" ? fema : source === "federal-audit-clearinghouse" ? fac : source === "usaspending" ? spending : sam)(ctx, state, cursor);
}
