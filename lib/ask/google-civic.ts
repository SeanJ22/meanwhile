import type { EvidencePack, EvidenceRecord } from "./evidence.ts";
import type { CivicFact, CivicJson, CivicLookup } from "../sources/google-civic/model.ts";

const words = (v: unknown) => typeof v === "string" ? v : "";
export function googleCivicQuestion(question: string): boolean {
  return googleCivicSitesQuestion(question) || /\b(ballot|running for)\b/i.test(question);
}
export function googleCivicSitesQuestion(question: string): boolean {
  return /\b(polling|(?:where|when) (?:can|do|should) I vote|early[ -]vot(?:e|ing)|vote sites?|voting (?:locations?|sites?|hours)|drop[ -]?off|drop off)\b/i.test(question);
}
export function civicFactText(row: CivicFact): string {
  if (row.kind === "CONTEST") {
    const candidates = Array.isArray(row.value.candidates) ? row.value.candidates as CivicJson[] : [];
    return `Google Civic lists ${words(row.value.office) || words(row.value.referendumTitle) || words(row.value.type) || "a contest"} for the queried address on November 3, 2026.` +
      (candidates.length ? ` Candidates: ${candidates.map(candidate => (words(candidate.name) || "Candidate name not supplied") + (words(candidate.party) ? ` (${words(candidate.party)})` : "")).join("; ")}.` : "") +
      (words(row.value.referendumText) ? ` ${words(row.value.referendumText)}` : "");
  }
  const address = row.value.address as CivicJson | undefined;
  const kind = row.kind === "EARLY_VOTE_SITE" ? "early-vote site" : row.kind === "DROP_OFF_LOCATION" ? "ballot drop-off location" : "polling place";
  return `Google Civic lists ${words(address?.locationName) || "a voting location"} as a ${kind} for the queried address for November 3, 2026, at ${[address?.line1, address?.line2, address?.city, address?.state, address?.zip].map(words).filter(Boolean).join(", ")}.` +
    (words(row.value.pollingHours) ? ` Hours: ${words(row.value.pollingHours)}.` : "") +
    (words(row.value.notes) ? ` ${words(row.value.notes)}` : "");
}
export function googleCivicEvidence(lookup: CivicLookup): EvidenceRecord[] {
  return lookup.rows.flatMap(row => row.sources.map((source, index) => ({
    kind: row.kind === "CONTEST" ? "CONTEST" as const : "SOURCE_PASSAGE" as const,
    id: `${row.id}:source-${index}`, text: civicFactText(row), sourceUrl: source.sourceUrl,
    sourceOrg: source.sourceOrg, retrievedAt: source.collectedAt,
    googleCivic: { official: source.official, publishedAt: source.publishedAt, electionId: row.electionId, ocdId: row.ocdId },
  })));
}
export function civicVotingSitesPack(question: string, lookup: CivicLookup): EvidencePack {
  const records = googleCivicEvidence({ ...lookup, rows: lookup.rows.filter(row => row.kind !== "CONTEST") });
  return { question, intent: "UNKNOWN", temporal: { kind: "NONE" }, subject: null,
    records,
    gaps: records.length === 0 ? [{ whose: "OURS", statement: "We're working on getting this info. You can check your address with your election office." }] : [],
    denominators: { googleCivicRows: lookup.counts.loaded, googleCivicJoined: lookup.counts.joined, googleCivicUnjoined: lookup.counts.unjoined }, today: lookup.checkedAt.slice(0, 10) };
}
