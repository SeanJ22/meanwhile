import { gunzipSync } from "node:zlib";
import { parseCsv } from "../reference/csv.ts";
import { readZipEntries } from "../sources/archive.ts";
import { sourceAcquisitionFailure, requestPublisher, readPublisherBody } from "../civic-data/source-acquisition-error.ts";
import { parseFederalMoney } from "./parse.ts";
import type { FederalMoneyCapture, FederalMoneyCursor, FederalMoneyPage, FederalMoneySource } from "./model.ts";

export interface FederalMoneyAcquireOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => string;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly signal?: AbortSignal;
  readonly dataGovApiKey?: string;
  readonly samGovApiKey?: string;
  readonly cursor?: FederalMoneyCursor | null;
  /** Work bounds resume from a saved cursor; they never imply dataset completion. */
  readonly maxPages?: number;
  readonly since?: string;
  readonly retries?: number;
}
const USA = "https://api.usaspending.gov";
const SAM = "https://api.sam.gov/entity-information/v3";
const FAC = "https://api.fac.gov";
const FEMA = "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries";
const awardCategories = [["02", "03", "04", "05"], ["A", "B", "C", "D"], ["07", "08"]] as const;
const childTables = ["findings", "findings_text", "corrective_action_plans", "additional_ueis"] as const;
type Context = Required<Pick<FederalMoneyAcquireOptions, "fetch" | "now" | "sleep" | "retries">> & FederalMoneyAcquireOptions;
function cleanUrl(value: string): string {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) if (/api.?key|token|signature|credential|authorization/i.test(key)) url.searchParams.delete(key);
  return url.href;
}
function publisherUrl(value: string, origin: string): string {
  const url = new URL(value, origin);
  const allowed = origin === USA ? ["api.usaspending.gov", "files.usaspending.gov"] : ["api.sam.gov"];
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
    ctx.signal?.throwIfAborted();
    const response = await requestPublisher(source, () => ctx.fetch(url, { ...init, signal: ctx.signal }));
    if (response.ok || (pending && [202, 404].includes(response.status))) return response;
    if ((response.status === 429 || response.status >= 500) && attempt < ctx.retries) { await ctx.sleep(retryDelay(response, attempt, ctx.now()), ctx.signal); continue; }
    throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", `${source}: the publisher returned HTTP ${response.status}.`);
  }
}
async function capture(ctx: Context, source: FederalMoneySource, url: string, init: RequestInit = {}): Promise<{ capture: FederalMoneyCapture; response: Response }> {
  const response = await request(ctx, source, url, init);
  const body = await readPublisherBody(source, () => response.text());
  const published = response.headers.get("last-modified");
  return { response, capture: { url: cleanUrl(url), body, retrievedAt: ctx.now(), publicationDate: published && Number.isFinite(Date.parse(published)) ? new Date(published).toISOString() : null } };
}
function json(captured: FederalMoneyCapture): Record<string, unknown> {
  try { const value: unknown = JSON.parse(captured.body); if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>; } catch { /* Source failure below carries no body or credentials. */ }
  throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The publisher returned an invalid control response.");
}
function valueString(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function page(captures: FederalMoneyCapture[], source: FederalMoneySource, state: string, continuation: FederalMoneyCursor | null, total: number | null = null): FederalMoneyPage {
  return { facts: captures.flatMap(value => parseFederalMoney(source, value, state)), captures, complete: continuation === null, declaredTotal: total, continuation };
}
async function fema(ctx: Context, state: string, cursor: FederalMoneyCursor): Promise<FederalMoneyPage> {
  const offset = cursor.offset ?? 0;
  const url = new URL(FEMA);
  url.searchParams.set("$filter", `state eq '${state}'${cursor.since ? ` and lastRefresh ge '${cursor.since}'` : ""}`);
  url.searchParams.set("$orderby", "id"); url.searchParams.set("$top", "1000"); url.searchParams.set("$skip", String(offset)); url.searchParams.set("$inlinecount", "allpages");
  const result = await capture(ctx, "openfema", url.href);
  const body = json(result.capture), rows = body.DisasterDeclarationsSummaries;
  if (!Array.isArray(rows)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "OpenFEMA: the declaration array is missing.");
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata as Record<string, unknown> : {};
  const total = typeof metadata.count === "number" && metadata.count >= rows.length ? metadata.count : null;
  const nextOffset = offset + rows.length;
  const done = total === null ? rows.length < 1000 : nextOffset >= total;
  return page([result.capture], "openfema", state, done ? null : { ...cursor, offset: nextOffset }, total);
}
async function fac(ctx: Context, state: string, cursor: FederalMoneyCursor): Promise<FederalMoneyPage> {
  if (cursor.phase === "historic") return historicAudits(ctx, state, cursor);
  const key = ctx.dataGovApiKey ?? process.env.DATA_GOV_API_KEY;
  if (!key) throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "Federal Audit Clearinghouse: DATA_GOV_API_KEY is unavailable in this runtime.");
  const headers = { "X-Api-Key": key, Prefer: "count=exact" };
  const table = cursor.phase === "general" ? "general" : cursor.phase;
  if (table !== "general" && !(childTables as readonly string[]).includes(table)) throw new Error("Invalid Federal Audit Clearinghouse continuation.");
  const url = new URL(`${FAC}/${table}`), offset = cursor.offset ?? 0, limit = table === "general" ? 100 : 20_000;
  if (table === "general") { url.searchParams.set("auditee_state", `eq.${state}`); if (cursor.since) url.searchParams.set("fac_accepted_date", `gte.${cursor.since.slice(0, 10)}`); }
  else { if (!cursor.reportIds?.length) throw new Error("Federal Audit Clearinghouse continuation has no report ids."); for (const id of cursor.reportIds) if (!/^[A-Za-z0-9:_-]+$/.test(id)) throw new Error("Invalid audit report id."); url.searchParams.set("report_id", `in.(${cursor.reportIds.join(",")})`); }
  url.searchParams.set("order", table === "general" ? "report_id.asc" : table === "findings" ? "report_id.asc,reference_number.asc,award_reference.asc" : table === "additional_ueis" ? "report_id.asc,additional_uei.asc" : "report_id.asc,finding_ref_number.asc");
  url.searchParams.set("limit", String(limit)); url.searchParams.set("offset", String(offset));
  const result = await capture(ctx, "federal-audit-clearinghouse", url.href, { headers });
  let rows: unknown; try { rows = JSON.parse(result.capture.body); } catch { throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Federal Audit Clearinghouse: the source response is not JSON."); }
  if (!Array.isArray(rows)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Federal Audit Clearinghouse: the report array is missing.");
  const range = result.response.headers.get("content-range"), countText = range?.split("/").at(-1), total = countText && /^\d+$/.test(countText) ? Number(countText) : null;
  const done = total === null ? rows.length < limit : offset + rows.length >= total;
  let continuation: FederalMoneyCursor | null;
  if (table === "general") {
    const reportIds = rows.map(row => valueString((row as Record<string, unknown>).report_id));
    if (reportIds.some(id => id === null)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Federal Audit Clearinghouse: a general record has no report id.");
    continuation = reportIds.length ? { ...cursor, phase: childTables[0], offset: 0, reportIds: reportIds as string[], nextOffset: offset + rows.length, generalComplete: done } : done ? cursor.since ? null : { source: cursor.source, phase: "historic", year: 1998 } : { ...cursor, offset: offset + rows.length };
  } else if (!done) continuation = { ...cursor, offset: offset + rows.length };
  else {
    const index = (childTables as readonly string[]).indexOf(table);
    continuation = index + 1 < childTables.length ? { ...cursor, phase: childTables[index + 1]!, offset: 0 } : cursor.generalComplete ? cursor.since ? null : { source: cursor.source, phase: "historic", year: 1998 } : { source: cursor.source, phase: "general", offset: cursor.nextOffset ?? 0, since: cursor.since };
  }
  return page([result.capture], "federal-audit-clearinghouse", state, continuation, table === "general" ? total : null);
}
/** Iterate source CSV records without building an all-country record array. */
function* csvRecords(text: string): Generator<string> {
  let start = 0, quoted = false;
  for (let at = 0; at < text.length; at++) {
    if (text[at] === '"') { if (quoted && text[at + 1] === '"') at++; else quoted = !quoted; }
    if (text[at] === "\n" && !quoted) { yield text.slice(start, at + 1); start = at + 1; }
  }
  if (start < text.length) yield text.slice(start);
}
async function historicAudits(ctx: Context, state: string, cursor: FederalMoneyCursor): Promise<FederalMoneyPage> {
  const year = cursor.year ?? 1998;
  if (year < 1998 || year > 2015) throw new Error("Invalid historic FAC year.");
  const indexUrl = "https://www.fac.gov/data/download/historic/";
  const index = await capture(ctx, "federal-audit-clearinghouse", indexUrl);
  const candidates = [...index.capture.body.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(match => new URL(match[1]!, indexUrl));
  const archive = candidates.find(url => url.pathname.endsWith(`census-${year}.zip`));
  if (!archive || archive.protocol !== "https:" || !["app.fac.gov", "www.fac.gov"].includes(archive.hostname)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `Federal Audit Clearinghouse: the official historic index has no ${year} archive.`);
  const response = await request(ctx, "federal-audit-clearinghouse", archive.href);
  const bytes = await readPublisherBody("federal-audit-clearinghouse", async () => new Uint8Array(await response.arrayBuffer()));
  let entries: ReturnType<typeof readZipEntries>; try { entries = readZipEntries(bytes); } catch { throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Federal Audit Clearinghouse: its historic archive could not be decoded."); }
  const general = entries.find(entry => /ELECAUDITHEADER.*\.csv$/i.test(entry.name));
  if (!general) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Federal Audit Clearinghouse: its historic archive has no general table.");
  const reportIds = new Set<string>(), captures: FederalMoneyCapture[] = [];
  function select(entry: typeof general & {}, isGeneral: boolean) {
    let header: string[] | null = null, headerText = ""; const selected: string[] = [];
    for (const record of csvRecords(entry.data.toString("utf8"))) {
      const values = parseCsv(record)[0]; if (!values) continue;
      if (!header) { header = values.map(value => value.replace(/^\uFEFF/, "")); headerText = record; continue; }
      const row = Object.fromEntries(header.map((name, i) => [name, values[i] ?? ""]));
      const id = `${row.AUDITYEAR ?? year}:${row.DBKEY ?? ""}`;
      if (isGeneral ? row.STATE?.toUpperCase() === state : reportIds.has(id)) { selected.push(record); if (isGeneral) reportIds.add(id); }
    }
    // The excerpt retains exact source header and exact source row bytes; only other states are omitted.
    if (selected.length) captures.push({ url: `${archive!.href}#${encodeURIComponent(entry.name)}`, body: headerText + selected.join(""), retrievedAt: ctx.now(), publicationDate: null });
  }
  select(general, true);
  for (const entry of entries) if (/ELECAUDITFINDINGS(?:TEXT)?|ELECCAPTEXT|ELECUEIS/i.test(entry.name) && /\.csv$/i.test(entry.name)) select(entry, false);
  return page(captures, "federal-audit-clearinghouse", state, year === 2015 ? null : { ...cursor, year: year + 1 });
}
function nextSpending(cursor: FederalMoneyCursor, now: string): FederalMoneyCursor | null {
  if (cursor.year !== undefined && cursor.year < new Date(now).getUTCFullYear()) return { source: "usaspending", phase: "download", category: cursor.category, location: cursor.location, year: cursor.year + 1 };
  const category = cursor.category ?? 0;
  return cursor.location !== "recipient" ? { source: "usaspending", phase: "download", category, location: "recipient" } : category + 1 < awardCategories.length ? { source: "usaspending", phase: "download", category: category + 1, location: "performance" } : null;
}
async function spending(ctx: Context, state: string, cursor: FederalMoneyCursor): Promise<FederalMoneyPage> {
  let current = cursor;
  const category = awardCategories[current.category ?? 0]; if (!category) throw new Error("Invalid USAspending category continuation.");
  const locationFilter = current.location === "recipient" ? "recipient_locations" : "place_of_performance_locations";
  if (current.year === undefined && !current.statusUrl) {
    // Discover the earliest date from the provider, so historical backfill has no invented cutoff.
    const earliest = await capture(ctx, "usaspending", `${USA}/api/v2/search/spending_by_transaction/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filters: { award_type_codes: category, [locationFilter]: [{ country: "USA", state }] }, fields: ["Action Date"], sort: "Action Date", order: "asc", page: 1, limit: 1 }) });
    const results = json(earliest.capture).results;
    if (!Array.isArray(results)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "USAspending: its historical date query returned no results array.");
    if (results.length === 0) return { facts: [], captures: [], complete: nextSpending(current, ctx.now()) === null, declaredTotal: 0, continuation: nextSpending(current, ctx.now()) };
    const date = valueString((results[0] as Record<string, unknown>)["Action Date"]);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "USAspending: its earliest transaction has no action date.");
    current = { ...current, year: Number(date.slice(0, 4)) };
  }
  if (!current.statusUrl || !current.fileUrl) {
    const filters = { award_type_codes: category, [locationFilter]: [{ country: "USA", state }], time_period: [{ start_date: `${current.year}-01-01`, end_date: `${current.year}-12-31` }] };
    // Annual state partitions bound worker memory; no row limit truncates the extract.
    const result = await capture(ctx, "usaspending", `${USA}/api/v2/download/search/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filters, spending_level: ["transactions"], file_format: "csv" }) });
    const data = json(result.capture), statusUrl = valueString(data.status_url), fileUrl = valueString(data.file_url);
    if (!statusUrl || !fileUrl) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "USAspending: the transaction extract links are missing.");
    current = { ...current, statusUrl: publisherUrl(statusUrl, USA), fileUrl: publisherUrl(fileUrl, USA) };
  }
  const status = await capture(ctx, "usaspending", publisherUrl(current.statusUrl!, USA));
  const stateValue = String(json(status.capture).status ?? "").toLowerCase();
  if (["failed", "error"].includes(stateValue)) throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "USAspending: the publisher could not generate its transaction extract.");
  if (!["finished", "ready", "complete", "completed"].includes(stateValue)) return { facts: [], captures: [], complete: false, declaredTotal: null, continuation: current };
  const response = await request(ctx, "usaspending", publisherUrl(current.fileUrl!, USA));
  const bytes = await readPublisherBody("usaspending", async () => new Uint8Array(await response.arrayBuffer()));
  let entries: ReturnType<typeof readZipEntries>;
  try { entries = readZipEntries(bytes); } catch { throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "USAspending: the transaction archive could not be decoded."); }
  const captures = entries.filter(entry => /\.csv$/i.test(entry.name) && !/dictionary|readme|data.?sources/i.test(entry.name)).map(entry => ({ url: `${cleanUrl(current.fileUrl!)}#${encodeURIComponent(entry.name)}`, body: entry.data.toString("utf8"), retrievedAt: ctx.now(), publicationDate: status.capture.publicationDate }));
  if (!captures.length) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "USAspending: the transaction archive has no source CSV.");
  return page(captures, "usaspending", state, nextSpending(current, ctx.now()));
}
async function sam(ctx: Context, state: string, cursor: FederalMoneyCursor): Promise<FederalMoneyPage> {
  const key = ctx.samGovApiKey ?? process.env.SAM_GOV_API_KEY;
  if (!key) throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "SAM.gov: SAM_GOV_API_KEY is unavailable in this runtime.");
  const headers = { "X-Api-Key": key, Accept: "application/json", "Content-Type": "application/json" };
  const url = new URL(`${SAM}/entities`);
  // Public GET examples document query authentication; saved URLs are stripped by capture().
  url.searchParams.set("api_key", key);
  url.searchParams.set("physicalAddressProvinceOrStateCode", state); url.searchParams.set("samRegistered", cursor.registered === false ? "No" : "Yes"); url.searchParams.set("includeSections", "entityRegistration,coreData"); url.searchParams.set("format", "json");
  if (cursor.since) { const from = new Date(cursor.since); const format = (date: Date) => `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}/${date.getUTCFullYear()}`; url.searchParams.set("updateDate", `[${format(from)},${format(new Date(ctx.now()))}]`); }
  const result = await capture(ctx, "sam-gov-entities", url.href, { headers });
  let captured = result.capture;
  let downloadToken: string | null = null;
  const data = json(captured);
  if (!Array.isArray(data.entityData)) {
    const values = [data.downloadURL, data.downloadUrl, data.downloadLink, data.url, data.message, data.detail].filter(value => typeof value === "string").join(" ");
    const rawLink = values.match(/https:\/\/api\.sam\.gov\/[^\s"<>]+/)?.[0];
    if (!rawLink) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "SAM.gov: the public state extract download link is missing.");
    const download = new URL(publisherUrl(rawLink, SAM)); download.searchParams.delete("apiKey"); download.searchParams.set("api_key", key);
    downloadToken = download.searchParams.get("token");
    // A generated token is used only in this request, never in saved source captures or public URLs.
    for (let pending = 0; ; pending++) {
      ctx.signal?.throwIfAborted();
      const response = await request(ctx, "sam-gov-entities", download.href, { headers }, true);
      if ([202, 404].includes(response.status)) { await ctx.sleep(retryDelay(response, pending, ctx.now()), ctx.signal); continue; }
      const bytes = await readPublisherBody("sam-gov-entities", async () => Buffer.from(await response.arrayBuffer()));
      let body: string; try { body = (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString("utf8"); } catch { throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "SAM.gov: its state extract could not be decompressed."); }
      // SAM can return a pending message with HTTP200; its documented control response has no entity array.
      if (/not ready|in progress|being processed|not available|try again/i.test(body) && !body.includes('"entityData"')) { await ctx.sleep(retryDelay(response, pending, ctx.now()), ctx.signal); continue; }
      captured = { url: cleanUrl(url.href), body, retrievedAt: ctx.now(), publicationDate: response.headers.get("last-modified") }; break;
    }
  } else if (data.links && typeof data.links === "object" && valueString((data.links as Record<string, unknown>).nextLink)) {
    throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "SAM.gov returned a paginated response to a full-state extract request; the response is incomplete.");
  }
  // Preserve exact source evidence rather than storing or rewriting an echoed credential.
  for (const secret of [key, downloadToken]) if (secret && (captured.body.includes(secret) || captured.body.includes(encodeURIComponent(secret)))) {
    throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "SAM.gov: its source response echoed a private credential and cannot be saved.");
  }
  const records = parseFederalMoney("sam-gov-entities", captured, state);
  const count = json(captured).totalRecords ?? json(captured).totalRecordsCount;
  if (typeof count === "number" && count > records.length) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "SAM.gov: its extract row count did not reconcile; incomplete data was retained for retry.");
  return page([captured], "sam-gov-entities", state, cursor.registered === false ? null : { source: "sam-gov-entities", phase: "extract", registered: false, since: cursor.since }, typeof count === "number" ? count : null);
}

/** Acquisition is state-scoped, bulk/paged and resumable; no per-government scouting. */
export async function acquireFederalMoney(source: FederalMoneySource, state: string, options: FederalMoneyAcquireOptions = {}): Promise<FederalMoneyPage> {
  state = state.toUpperCase(); if (!/^[A-Z]{2}$/.test(state)) throw new Error("Invalid federal money state.");
  if (options.cursor && options.cursor.source !== source) throw new Error("Federal money cursor belongs to another source.");
  const ctx: Context = { ...options, fetch: options.fetch ?? fetch, now: options.now ?? (() => new Date().toISOString()), retries: options.retries ?? 4, sleep: options.sleep ?? ((milliseconds, signal) => new Promise((resolve, reject) => { signal?.throwIfAborted(); const timer = setTimeout(done, milliseconds); function done() { signal?.removeEventListener("abort", abort); resolve(); } function abort() { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason); } signal?.addEventListener("abort", abort, { once: true }); })) };
  let cursor: FederalMoneyCursor | null = options.cursor ?? { source, phase: source === "federal-audit-clearinghouse" ? "general" : source === "usaspending" ? "download" : source === "openfema" ? "declarations" : "extract", since: options.since };
  const acquire = source === "openfema" ? fema : source === "federal-audit-clearinghouse" ? fac : source === "usaspending" ? spending : sam;
  const batches: FederalMoneyPage[] = [];
  for (let i = 0; cursor && i < (options.maxPages ?? 1); i++) { const result = await acquire(ctx, state, cursor); batches.push(result); const next = result.continuation ?? null; if (next && JSON.stringify(next) === JSON.stringify(cursor) && result.captures.length === 0) { cursor = next; break; } cursor = next; }
  const facts = [...new Map(batches.flatMap(value => value.facts).map(value => [value.id, value])).values()];
  return { facts, captures: batches.flatMap(value => value.captures), complete: cursor === null, declaredTotal: batches.at(-1)?.declaredTotal ?? null, continuation: cursor };
}
