import type { ArtifactRecord } from "../repository/types.ts";
import { createHash } from "node:crypto";
import type { Attempt } from "../attempt.ts";
import { readHeldBytes, type VaultIndex } from "../evidence/read-only-vault.ts";

export interface CandidatePublicationLink {
  readonly url: string;
  readonly source: NonNullable<ArtifactRecord["publicationLink"]>;
}

/** The original capture, not a publication-specific replacement acquisition. */
export interface HeldCandidatePublicationRead {
  readonly record: ArtifactRecord;
  readonly attempt: Attempt;
  readonly workItemSubject: string;
  readonly body: string;
  readonly vaultSha256: string;
  readonly vaultCanonicalUrl: string | null;
  readonly vaultRetrievalUrl: string | null;
  readonly vaultRetrievedAt: string | null;
  readonly vaultTier: ArtifactRecord["tier"];
  readonly vaultWorkItemId: string | null;
  readonly vaultAttemptId: string | null;
  readonly vaultHttpStatus: number | null;
  readonly vaultContentType: string;
  readonly vaultMethodRouteId: string | null;
  readonly vaultPermission: string | null;
}

/** Recognise a requested publisher alias for triage only. Acceptance still
 * requires its literal saved final URL and all capture checks below. */
export function candidatePublicationCaptureTargets(link: CandidatePublicationLink, capture: HeldCandidatePublicationRead): boolean {
  if (capture.record.canonicalUrl === link.url || capture.vaultRetrievalUrl === link.url) return true;
  try {
    const requested = new URL(capture.record.canonicalUrl), target = new URL(link.url);
    return requested.protocol === target.protocol && requested.hostname.replace(/^www\./, "") === target.hostname.replace(/^www\./, "") &&
      requested.port === target.port && requested.pathname === target.pathname && requested.search === target.search && requested.hash === target.hash;
  } catch { return false; }
}

/** Query only observed targets and requested URLs already named by their
 * saved redirect metadata. No alternate URL is invented or fetched. */
export function candidatePublicationCaptureUrls(links: readonly CandidatePublicationLink[], vault: VaultIndex): string[] {
  const targets = new Set(links.map(link => link.url));
  const urls = new Set(targets);
  for (const held of [...vault.byId.values(), ...[...vault.byWorkItem.values()].flat()]) {
    if (held.canonicalUrl && held.retrievalUrl && targets.has(held.retrievalUrl)) urls.add(held.canonicalUrl);
  }
  return [...urls].sort();
}

export async function heldCandidatePublicationRead(record: ArtifactRecord, attempt: Attempt,
  vault: VaultIndex, workItemSubject = ""): Promise<HeldCandidatePublicationRead | null> {
  const held = vault.byWorkItem.get(record.workItemId)?.find(row => row.id === record.artifactId &&
    row.attemptId === record.attemptId && row.canonicalUrl === record.canonicalUrl && row.retrievedAt === record.recordedAt)
    ?? vault.byId.get(record.artifactId);
  if (!held || held.tier === "RESTRICTED_RAW") return null;
  const body = new TextDecoder("utf-8", { fatal: true }).decode(await readHeldBytes(held));
  return { record, attempt, workItemSubject, body, vaultSha256: held.contentHash.slice("sha256-".length),
    vaultCanonicalUrl: held.canonicalUrl, vaultRetrievalUrl: held.retrievalUrl, vaultRetrievedAt: held.retrievedAt,
    vaultTier: held.tier, vaultWorkItemId: held.workItemId, vaultAttemptId: held.attemptId,
    vaultHttpStatus: held.httpStatus, vaultContentType: held.contentType,
    vaultMethodRouteId: held.methodRouteId, vaultPermission: held.permission };
}

/** Existing source and capture checks apply to held bytes from every job.
 * The approved parent identifies the publisher; deeper quoted pages do not
 * have to repeat the parent's office or election year. */
export function candidatePublicationCaptureIssue(link: CandidatePublicationLink, parentHtml: string,
  capture: HeldCandidatePublicationRead): string | null {
  if (!candidatePublicationLinkMatches(link, parentHtml, link.source.sourceContentHash)) return "the exact approved parent href or hash does not match";
  const { record, attempt } = capture;
  if (record.partial || (record.tier !== "RAW" && record.tier !== "SANITIZED_DERIVED") || capture.vaultTier !== record.tier) return "the capture is partial, restricted or differs from its saved tier";
  if (attempt.id !== record.attemptId || attempt.workItemId !== record.workItemId ||
    record.workItemId !== capture.vaultWorkItemId || record.attemptId !== capture.vaultAttemptId ||
    attempt.outcome !== "COMPLETED" || !attempt.artifactIds.includes(record.artifactId)) return "the original completed Attempt does not own this capture";
  const hash = createHash("sha256").update(capture.body, "utf8").digest("hex");
  if (record.contentHash !== `sha256-${hash}` || capture.vaultSha256 !== hash ||
    record.byteLength !== Buffer.byteLength(capture.body, "utf8")) return "the captured bytes differ from their original hash or length";
  if (capture.vaultCanonicalUrl !== record.canonicalUrl || capture.vaultRetrievedAt !== record.recordedAt ||
    !capture.vaultRetrievedAt || !Number.isFinite(Date.parse(capture.vaultRetrievedAt))) return "the original requested URL or source observation date differs from its sidecar";
  if (capture.vaultHttpStatus === null || capture.vaultHttpStatus < 200 || capture.vaultHttpStatus >= 300 ||
    !/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(record.contentType) || record.contentType !== capture.vaultContentType) return "the capture is not a complete successful HTML response";
  try {
    const requested = new URL(record.canonicalUrl), final = new URL(capture.vaultRetrievalUrl ?? ""), parent = new URL(link.source.sourceUrl);
    const samePublisher = (url: URL) => url.protocol === "https:" && !url.username && !url.password &&
      url.hostname.replace(/^www\./, "") === parent.hostname.replace(/^www\./, "") && url.port === parent.port;
    if (!samePublisher(requested) || !samePublisher(final) ||
      (record.canonicalUrl !== link.url && capture.vaultRetrievalUrl !== link.url)) return "the original requested/final URLs do not identify this exact linked page on the approved publisher";
  } catch { return "the recorded source URLs are malformed"; }
  return null;
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
