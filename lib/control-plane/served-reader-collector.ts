/** Bounded, free HTTP readbacks of the ordinary public ballot. Runs in the existing console publisher. */
import { createHash } from "node:crypto";
import type { DerivedCampaignSiteRecord } from "../civic-data/derived-campaign-sites.ts";
import type { ServedReaderReadback, ServedReaderWitness } from "./served-reader.ts";
import { PUBLIC_SITE_ORIGIN } from "../ops/origins.ts";
export interface PublicPageRead {
  readonly status: number;
  readonly html: string;
  /** Observed after opening this exact candidate's Battlecard and Sources controls. */
  readonly openedLinks?: readonly { readerKey: string; href: string; domSha256: string }[];
  /** Exact failure at the visible control; never inferred from stored publication. */
  readonly failures?: readonly { readerKey: string; reason: string }[];
}

const entities = (v: string): string => v.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[a-f\d]+);/gi, s => {
  const x = s.slice(1, -1).toLowerCase();
  return ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" } as Record<string, string>)[x] ?? String.fromCodePoint(Number(x.startsWith("#x") ? `0x${x.slice(2)}` : x.slice(1)));
});
const attributes = (tag: string): Map<string, string> => new Map([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1].toLowerCase(), entities(m[2] ?? m[3])]));
/** Recognize the link only inside the exact server-rendered candidate container; script text is never evidence. */
export function campaignVisibleInHtml(html: string, readerKey: string, campaignUrl: string): boolean {
  const clean = html.replace(/<!--[^]*?-->|<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, "");
  const stack: string[] = [];
  let targetDepth = -1;
  for (const m of clean.matchAll(/<\/?[a-z][a-z\d-]*(?:\s+(?:[^'">]|"[^"]*"|'[^']*')*)?\s*\/?>/gi)) {
    const tag = m[0];
    const name = /^<\/?([a-z\d-]+)/i.exec(tag)![1].toLowerCase();
    if (tag.startsWith("</")) {
      const i = stack.lastIndexOf(name);
      if (i >= 0) stack.length = i;
      if (stack.length < targetDepth) targetDepth = -1;
      continue;
    }
    const attrs = attributes(tag);
    const isVoid = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(name) || tag.endsWith("/>");
    if (!isVoid) stack.push(name);
    if (attrs.get("data-candidate-target") === readerKey) targetDepth = stack.length;
    if (targetDepth > 0 && name === "a" && attrs.get("href") === campaignUrl) return true;
  }
  return false;
}

export async function collectServedReader(input: {
  readonly records: readonly DerivedCampaignSiteRecord[];
  readonly versionId: string;
  readonly destinations: ReadonlyMap<string, string>;
  readonly now: string;
  readonly read: (url: string) => Promise<PublicPageRead>;
}): Promise<ServedReaderReadback> {
  const pages = new Map<string, Promise<PublicPageRead | null>>();
  const errors: string[] = [];
  const witnesses: ServedReaderWitness[] = [];
  for (const record of input.records) {
    const url = input.destinations.get(record.candidacyId);
    const base = { itemId: record.campaign.evidence.approvalItemId, approvalId: record.campaign.evidence.approvalRecordId,
      versionId: input.versionId, readerKey: record.id, url: url ?? "", checkedAt: input.now, responseSha256: null };
    if (!url || !url.startsWith(`${PUBLIC_SITE_ORIGIN}/ballot?zip=`) || !/^\d{5}$/.test(url.slice(`${PUBLIC_SITE_ORIGIN}/ballot?zip=`.length))) {
      witnesses.push({ ...base, state: "NOT_OBSERVED", reason: "No exact Census-backed ballot destination is held for this candidacy." });
      continue;
    }
    if (!pages.has(url)) pages.set(url, input.read(url).catch(() => { errors.push(`Public read failed: ${url}`); return null; }));
    const page = await pages.get(url)!;
    const opened = page?.openedLinks?.find(x => x.readerKey === record.id && x.href === record.campaign.url);
    const visible = page?.status === 200 && (opened !== undefined || campaignVisibleInHtml(page.html, record.id, record.campaign.url));
    witnesses.push({ ...base, responseSha256: opened?.domSha256 ?? (page ? createHash("sha256").update(page.html).digest("hex") : null),
      state: visible ? "CONFIRMED" : "NOT_OBSERVED",
      reason: visible ? opened ? "Exact candidate Battlecard → Sources → verified campaign link observed on the public ballot." : "Exact candidate container and verified campaign link observed on the public ballot." : page?.failures?.find(x => x.readerKey === record.id)?.reason ?? `Exact candidate and campaign link not observed${page ? ` (HTTP ${page.status})` : " (read failed)"}.` });
  }
  return { checkedAt: input.now, witnesses, errors };
}
