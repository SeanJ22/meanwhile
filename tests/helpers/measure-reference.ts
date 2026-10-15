import type { MeasureSourceReference } from "../../lib/ballot/types.ts";
import type { WorkerEvidence } from "../../lib/control-plane/workers/types.ts";

export function measureReference(evidence: WorkerEvidence): MeasureSourceReference {
  const sourceHash = evidence.contentHash.replace(/^sha256-/, "");
  return { sourceUrl: evidence.canonicalUrl, sourceHash, retrievedAt: evidence.retrievedAt, publisher: evidence.sourceId,
    vault: { key: `project/freshness/source/${new URL(evidence.canonicalUrl).hostname}/${evidence.retrievedAt.slice(0, 10).replaceAll("-", "/")}/translation-test/sha256-${sourceHash}.txt`,
      byteLength: Buffer.byteLength(evidence.text), contentType: "text/plain" } };
}
