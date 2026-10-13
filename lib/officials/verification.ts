import { isOfficialSource } from "../civic-data/source-authority.ts";
import { hostSourceKind, type SourceKind } from "../control-plane/promotion/source-kinds.ts";

export function hostOf(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).host.toLowerCase().replace(/^www\./, ""); }
  catch { return null; }
}

/** Preserve the recorded source classification, including government-linked
 * vendor portals; classify legacy sources through the shared source table. */
export function provenanceKind(provenance: { kind?: SourceKind; sourceUrl: string | null }): SourceKind {
  if (provenance.kind) return provenance.kind;
  return provenance.sourceUrl && isOfficialSource(provenance.sourceUrl) ? "OFFICIAL" : hostSourceKind(provenance.sourceUrl ?? "");
}

/** A candidate's own words or campaign links: their own site is a Campaign source; an official page or a known publisher keeps its own kind. */
export function candidateOwnKind(sourceUrl: string | null): SourceKind {
  const kind = provenanceKind({ sourceUrl });
  return kind === "OTHER" && hostOf(sourceUrl) !== null ? "CAMPAIGN" : kind;
}
