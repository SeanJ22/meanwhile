import { isOfficialSource } from "../civic-data/source-authority.ts";
import { hostSourceKind, type SourceKind } from "../control-plane/promotion/source-kinds.ts";

export type Verification =
  | { kind: "confirmed"; date: string }
  | { kind: "official"; date: string; by: string }
  | { kind: "unverified" };

export interface VerifiableProvenance {
  kind?: SourceKind;
  sourceUrl: string | null;
  collectedAt: string | null;
  verifiedAt: string | null;
}

export function hostOf(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).host.toLowerCase().replace(/^www\./, ""); }
  catch { return null; }
}

/** Publication carries the verified label, including government-linked vendor
 * portals. Legacy sources still receive a label from the shared source table. */
export function provenanceKind(provenance: Pick<VerifiableProvenance, "kind" | "sourceUrl">): SourceKind {
  if (provenance.kind) return provenance.kind;
  return provenance.sourceUrl && isOfficialSource(provenance.sourceUrl) ? "OFFICIAL" : hostSourceKind(provenance.sourceUrl ?? "");
}

export const PROVENANCE_KIND_LABELS: Readonly<Record<SourceKind, string>> = {
  OFFICIAL: "Official", CAMPAIGN: "Campaign", FILING: "Filing", VOTER_GUIDE: "Voter guide",
  FORUM: "Forum", NEWS: "News", REFERENCE: "Reference", OTHER: "Other",
};

export function verificationOf(provenance: VerifiableProvenance): Verification {
  if (provenance.verifiedAt) return { kind: "confirmed", date: provenance.verifiedAt.slice(0, 10) };
  if (provenanceKind(provenance) === "OFFICIAL" && provenance.collectedAt) {
    return { kind: "official", date: provenance.collectedAt.slice(0, 10), by: hostOf(provenance.sourceUrl) ?? "the publishing body" };
  }
  return { kind: "unverified" };
}
