import type { ArtifactRecord } from "../repository/types.ts";
import { createHash } from "node:crypto";

export interface CandidatePublicationLink {
  readonly url: string;
  readonly source: NonNullable<ArtifactRecord["publicationLink"]>;
}

/** Inventory same-host pages from exact approved HTML. The inventory is an
 * acquisition queue, not a claim that a site or candidate has no other pages. */
export function candidatePublicationLinks(input: {
  readonly html: string;
  readonly sourceUrl: string;
  readonly sourceArtifactId: string;
  readonly sourceContentHash: string;
  readonly approvalRecordId: string;
  readonly candidacyId: string;
}): CandidatePublicationLink[] {
  let origin: URL;
  try { origin = new URL(input.sourceUrl); }
  catch { return []; }
  if (origin.protocol !== "https:" || origin.username || origin.password) return [];
  const found = new Map<string, CandidatePublicationLink>();
  for (const match of input.html.matchAll(/<a\b[^>]*>/gi)) {
    const tag = match[0], start = match.index;
    if (start === undefined) continue;
    const attribute = /\bhref\s*=\s*(["'])(.*?)\1/i.exec(tag);
    if (!attribute) continue;
    let target: URL;
    try { target = new URL(attribute[2].replace(/&amp;/gi, "&"), origin); }
    catch { continue; }
    if (target.protocol !== "https:" || target.hostname !== origin.hostname || target.port !== origin.port ||
      target.username || target.password || target.hash || target.href === origin.href ||
      /\.(?:pdf|jpe?g|png|gif|svg|webp|ico|css|js|zip)(?:$|\?)/i.test(target.pathname) ||
      /\/(?:wp-admin|admin|login|logout|account)(?:\/|$)/i.test(target.pathname)) continue;
    if (found.has(target.href)) continue;
    found.set(target.href, { url: target.href, source: {
      candidacyId: input.candidacyId, approvalRecordId: input.approvalRecordId,
      sourceArtifactId: input.sourceArtifactId, sourceUrl: input.sourceUrl, sourceContentHash: input.sourceContentHash,
      start, end: start + tag.length, quote: tag, offsetUnit: "UTF16_CODE_UNITS",
    } });
  }
  return [...found.values()].sort((a, b) => a.url.localeCompare(b.url));
}

/** Re-derive the link from the saved source tag. A supplied target URL or span
 * is never authoritative merely because a metadata row declares it. */
export function candidatePublicationLinkMatches(link: CandidatePublicationLink, html: string, sourceHash: string): boolean {
  const source = link.source;
  if (source.sourceContentHash !== sourceHash ||
    `sha256-${createHash("sha256").update(html).digest("hex")}` !== sourceHash ||
    source.offsetUnit !== "UTF16_CODE_UNITS" ||
    !Number.isSafeInteger(source.start) || !Number.isSafeInteger(source.end) ||
    source.start < 0 || source.end > html.length || source.start >= source.end ||
    html.slice(source.start, source.end) !== source.quote) return false;
  return candidatePublicationLinks({ html: source.quote, sourceUrl: source.sourceUrl,
    sourceArtifactId: source.sourceArtifactId, sourceContentHash: source.sourceContentHash,
    approvalRecordId: source.approvalRecordId, candidacyId: source.candidacyId })
    .some(row => row.url === link.url);
}
