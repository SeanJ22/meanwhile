import { linkingPageFrom, section3Page } from "../control-plane/promotion/section3.ts";
import type { EvidenceSpan, FieldValue } from "../control-plane/workers/types.ts";
import type { Provenance } from "../sources/types.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";

/** Keep only the parser's exact saved span, bound to this published field and
 * capture. A summary or another record's span can never become its quote. */
export function parserFieldSources(recordId: string, fields: Readonly<Record<string, FieldValue | unknown>>,
  spans: readonly EvidenceSpan[], captures: readonly WorkerPublicationCapture[], now: string): Record<string, Provenance> {
  const sources: Record<string, Provenance> = {};
  for (const span of spans) {
    if (span.recordId !== recordId || fields[span.field] === undefined || fields[span.field] === null || !span.quote) continue;
    const capture = captures.find(c => c.evidence.artifactId === span.artifactId && c.evidence.contentHash === span.contentHash);
    if (!capture || span.start < 0 || span.end <= span.start || capture.evidence.text.slice(span.start, span.end) !== span.quote) continue;
    sources[span.field] = { sourceUrl: capture.evidence.canonicalUrl, sourceOrg: capture.evidence.sourceId,
      collectedAt: capture.observedAt, verifiedAt: now,
      kind: section3Page({ url: capture.evidence.canonicalUrl, text: capture.evidence.text, retrievedAt: capture.observedAt,
        sourcePolicy: capture.sourcePolicy, campaign: capture.campaign, linkingPage: linkingPageFrom(capture.evidence.canonicalUrl, captures.map(c => c.evidence)) }, "", now).kind, quote: span.quote };
  }
  return sources;
}
