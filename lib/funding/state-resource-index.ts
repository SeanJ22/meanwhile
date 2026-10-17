import { createHash } from "node:crypto";
import { requestPublisher, sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { campaignFinanceSource, type CampaignFinanceResource } from "./state-sources.ts";

const entities = (value: string) => value.replace(/&(?:amp|quot|apos|lt|gt|#39|#34);/g, match => ({ "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&#39;": "'", "&#34;": '"' })[match]!);
const attributes = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map(match => [match[1].toLowerCase(), entities(match[3])]));
const property = (value: unknown, path: string) => path.split(".").reduce<unknown>((at, key) => at !== null && typeof at === "object" ? (at as Record<string, unknown>)[key] : undefined, value);

export async function* campaignFinanceResources(state: string, options: { readonly vault: EvidenceStore; readonly signal: AbortSignal; readonly fetch?: typeof fetch }): AsyncGenerator<CampaignFinanceResource> {
  for (const resource of campaignFinanceSource(state).resources) {
    const index = resource.index;
    if (!index) { yield resource; continue; }
    const seen = new Set<string>();
    const visited = new Set([1]);
    let form: URLSearchParams | null = null, cookie = "", found = false;
    for (;;) {
      const response = await requestPublisher("campaign-finance download index", () => (options.fetch ?? fetch)(index.url, { signal: options.signal,
        headers: { ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}), ...(cookie ? { cookie } : {}) },
        ...(form ? { method: "POST", body: form.toString() } : {}) }));
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
      const urls = index.rowPath ? (() => {
        const rows = property(JSON.parse(text), index.rowPath);
        if (!Array.isArray(rows)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Campaign download index has no declared resource list.");
        return rows.filter(row => !index.filter || row[index.filter.field] === index.filter.value).map(row => {
          const id = row[index.idField!];
          if (typeof id !== "number" && typeof id !== "string") throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Campaign download index is missing a native file identifier.");
          return index.urlTemplate!.replace("{id}", encodeURIComponent(id));
        });
      })() : [...text.matchAll(/<a\b[^>]*>/gi)].flatMap(match => {
        const href = attributes(match[0]).href;
        return href && !href.startsWith("javascript:") ? [new URL(href, base).href] : [];
      });
      for (const url of urls) {
        if (!new RegExp(index.pattern, "i").test(url) || seen.has(url.toLowerCase())) continue;
        if (!url.toLowerCase().startsWith(index.downloadPrefix.toLowerCase())) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Campaign download index points outside its official publication directory.");
        seen.add(url.toLowerCase()); found = true;
        yield { ...resource, id: `${resource.id}:${createHash("sha256").update(url.toLowerCase()).digest("hex").slice(0, 16)}`, url };
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
    if (!found) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The official campaign download index contains no declared native files.");
  }
}
