import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveFederalBulkBytes } from "../federal-money/bulk.ts";
import { federalJsonRecords } from "../federal-money/streams.ts";
import { createHash } from "node:crypto";
import { sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { campaignFinanceSource, type CampaignFinanceResource } from "./state-sources.ts";
import { campaignSourceResponse } from "./state-acquisition.ts";

const entities = (value: string) => value.replace(/&(?:amp|quot|apos|lt|gt|#39|#34);/g, match => ({ "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&#39;": "'", "&#34;": '"' })[match]!);
const attributes = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map(match => [match[1].toLowerCase(), entities(match[3])]));

interface IndexOptions {
  readonly vault: EvidenceStore;
  readonly signal: AbortSignal;
  readonly fetch?: typeof fetch;
  readonly onFailure?: (resource: string, url: string, error: unknown) => Promise<void>;
}

async function* jsonIndexedResources(resource: CampaignFinanceResource, options: IndexOptions, requireFiles: boolean, context: Readonly<Record<string, unknown>>): AsyncGenerator<CampaignFinanceResource> {
  const index = resource.index!;
  const directory = await mkdtemp(join(tmpdir(), "campaign-finance-index-"));
  let found = false;
  try {
    const { path } = await saveFederalBulkBytes({ root: directory, vault: options.vault, signal: options.signal }, () => campaignSourceResponse(index.url, {
      ...(index.method ? { method: index.method, headers: { "content-type": "application/json" }, body: JSON.stringify(index.body) } : {}),
    }, options), directory, index.url);
    const envelope = { rows: 0, found: false };
    for await (const text of federalJsonRecords(createReadStream(path), index.rowPath!, envelope)) {
      const parsed = JSON.parse(text), row = parsed !== null && typeof parsed === "object" ? parsed : { value: parsed };
      if (index.filter && row[index.filter.field] !== index.filter.value) continue;
      const values = index.split ? String(row[index.split.field] ?? "").split(index.split.delimiter).filter(Boolean) : [null];
      for (const value of values) {
        const item = { ...context, ...row, ...(index.split ? { [index.split.field]: value } : {}) };
        const url = new URL(resource.url), body: Record<string, unknown> = { ...resource.body };
        let route: string;
        if (index.parameters) {
          for (const { parameter, field } of index.parameters) {
            const value = item[field];
            if (typeof value !== "number" && typeof value !== "string" || value === "") throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Campaign bulk index is missing a published request parameter.");
            if (resource.method) body[parameter] = value; else url.searchParams.set(parameter, String(value));
          }
          route = url.href;
        } else {
          route = index.urlTemplate!.replace(/\{(\w+)\}/g, (_match, field: string) => {
            const value = item[field === "id" ? index.idField! : field];
            if (typeof value !== "number" && typeof value !== "string" || value === "") throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Campaign download index is missing a native file identifier.");
            return encodeURIComponent(value);
          });
        }
        if (!new RegExp(index.pattern, "i").test(route)) continue;
        if (!route.toLowerCase().startsWith(index.downloadPrefix.toLowerCase())) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Campaign download index points outside its official publication directory.");
        if (index.child) {
          try {
            for await (const next of indexedResources({ ...resource, index: { ...index.child, url: route } }, options, false, item)) { found = true; yield next; }
          } catch (error) {
            if (!options.onFailure) throw error;
            await options.onFailure(resource.id, route, error);
          }
        } else {
          found = true;
          const identity = route.toLowerCase() + JSON.stringify(resource.method ? body : null);
          const expectedFields = Object.fromEntries(Object.entries(index.expectedFields ?? {}).map(([field, source]) => {
            const value = item[source];
            if (typeof value !== "number" && typeof value !== "string") throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The campaign index is missing its declared native identity.");
            return [field, String(value)];
          }));
          yield { ...resource, id: `${resource.id}:${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`, url: route,
            ...(Object.keys(expectedFields).length ? { expectedFields } : {}), ...(resource.method ? { body } : {}) };
        }
      }
    }
    if (!envelope.found || requireFiles && !found) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The official campaign download index contains no declared native files.");
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function* indexedResources(resource: CampaignFinanceResource, options: IndexOptions, requireFiles = true, context: Readonly<Record<string, unknown>> = {}): AsyncGenerator<CampaignFinanceResource> {
  const index = resource.index;
  if (!index) throw new Error("The campaign resource has no download index.");
  if (index.rowPath !== undefined) { yield* jsonIndexedResources(resource, options, requireFiles, context); return; }
  const seen = new Set<string>();
  const visited = new Set([1]);
  let form: URLSearchParams | null = null, cookie = "", found = false;
  for (;;) {
    const response = await campaignSourceResponse(index.url, {
      headers: { ...(form ? { "content-type": "application/x-www-form-urlencoded" } : index.method ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
      ...(form ? { method: "POST", body: form.toString() } : index.method ? { method: index.method, body: JSON.stringify(index.body) } : {}) }, options);
    if (!response.ok || !response.body) { await response.body?.cancel(); throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", `Campaign download index returned HTTP ${response.status}.`); }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4 * 1024 * 1024) { await reader.cancel(); throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The campaign download index exceeds one metadata page."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks), hash = createHash("sha256").update(bytes).digest("hex");
    chunks.length = 0;
    await options.vault.put(`project/meanwhile/source/campaign-finance-index/${hash}`, bytes, { contentHash: `sha256-${hash}`, contentType: response.headers.get("content-type") ?? "text/html", byteLength: bytes.length });
    const text = bytes.toString("utf8"), base = response.url || index.url;
    const publications: { url: string; body?: Readonly<Record<string, unknown>> }[] = index.selectParameter ? [...text.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/gi)].flatMap(match => {
      const select = attributes(match[0].slice(0, match[0].indexOf(">") + 1));
      if (select.name !== index.selectParameter!.name && select.id !== index.selectParameter!.name) return [];
      return [...match[0].matchAll(/<option\b[^>]*>/gi)].flatMap(option => {
        const value = attributes(option[0]).value;
        if (!value || index.selectParameter!.valuePattern && !new RegExp(index.selectParameter!.valuePattern).test(value)) return [];
        if (resource.method) return [{ url: resource.url, body: { ...resource.body, [index.selectParameter!.parameter]: value } }];
        const url = new URL(resource.url); url.searchParams.set(index.selectParameter!.parameter, value);
        return [{ url: url.href }];
      });
    }) : [...text.matchAll(/<a\b[^>]*>/gi)].flatMap(match => {
      const href = attributes(match[0]).href;
      return href && !href.startsWith("javascript:") ? [{ url: new URL(href, base).href }] : [];
    });
    for (const { url: listedUrl, body } of publications) {
      if (!new RegExp(index.pattern, "i").test(listedUrl)) continue;
      const url = listedUrl;
      const identity = url.toLowerCase() + JSON.stringify(body ?? null);
      if (seen.has(identity)) continue;
      if (!listedUrl.toLowerCase().startsWith(index.downloadPrefix.toLowerCase()) || !url.toLowerCase().startsWith(index.downloadPrefix.toLowerCase())) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Campaign download index points outside its official publication directory.");
      seen.add(identity);
      if (index.childPattern) {
        try {
          for await (const entry of indexedResources({ ...resource, index: { url, pattern: index.childPattern, downloadPrefix: index.downloadPrefix } }, options, false)) {
            found = true; yield entry;
          }
        } catch (error) {
          if (!options.onFailure) throw error;
          await options.onFailure(resource.id, url, error);
        }
      } else {
        found = true;
        yield { ...resource, id: `${resource.id}:${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`, url, ...(body ? { body } : {}) };
      }
    }
    if (!index.postback) break;
    const posts = [...entities(text).matchAll(/__doPostBack\('([^']+)',\s*'Page\$(\d+)'\)/g)]
      .filter(match => match[1] === index.postback && !visited.has(Number(match[2]))).map(match => Number(match[2])).sort((a, b) => a - b);
    if (!posts.length) break;
    const next = posts[0]; visited.add(next);
    form = new URLSearchParams();
    for (const match of text.matchAll(/<input\b[^>]*>/gi)) {
      const at = attributes(match[0]);
      if (at.type?.toLowerCase() === "hidden" && at.name) form.set(at.name, at.value ?? "");
    }
    if (!form.has("__VIEWSTATE")) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Campaign bulk index pagination has no source form state.");
    form.set("__EVENTTARGET", index.postback); form.set("__EVENTARGUMENT", `Page$${next}`);
    cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") || cookie;
  }
  if (requireFiles && !found) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The official campaign download index contains no declared native files.");
}

export async function* campaignFinanceResources(state: string, options: IndexOptions): AsyncGenerator<CampaignFinanceResource> {
  for (const resource of campaignFinanceSource(state).resources) {
    if (resource.index) yield* indexedResources(resource, options);
    else yield resource;
  }
}
