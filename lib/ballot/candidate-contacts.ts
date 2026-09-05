import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateBallotFile } from "../sources/ballot-nj-morris/index.ts";

/** Published filing contacts, attached only to an exact current candidacy ID. */
export interface CandidateContact {
  candidacyId: string;
  email: string | null;
  filedAddress: string | null;
  sourceUrl: string;
  sourceOrg: string;
  collectedAt: string;
}

export interface CandidateContactCensus {
  contacts: CandidateContact[];
  withheld: { candidacyId: string; reason: string }[];
}

let cache: CandidateContactCensus | null = null;

/**
 * This explicit reader contract admits the current clerk's normalized contact
 * snapshot. A new acquisition file, Parser output, or directory listing cannot
 * become reader truth by appearing in a directory. R256 permits the address a
 * candidate published on the filing; the older snapshot note is not current law.
 */
export function candidateContactCensus(): CandidateContactCensus {
  if (cache) return cache;
  const ballot: unknown = JSON.parse(readFileSync(join(process.cwd(), "data", "states", "nj", "ballot", "nj-morris-2026.json"), "utf8"));
  validateBallotFile(ballot);
  const current = new Set(ballot.candidacies.map((candidate) => candidate.id));
  const source = JSON.parse(readFileSync(join(process.cwd(), "data", "states", "nj", "ballot", "nj-morris-2026-contacts.json"), "utf8")) as { contacts: CandidateContact[] };
  const contacts: CandidateContact[] = [];
  const withheld: CandidateContactCensus["withheld"] = [];
  const counts = new Map<string, number>();
  for (const row of source.contacts) counts.set(row.candidacyId, (counts.get(row.candidacyId) ?? 0) + 1);
  for (const row of source.contacts) {
    const reason = !current.has(row.candidacyId) ? "The contact does not identify a current canonical candidacy."
      : counts.get(row.candidacyId) !== 1 ? "More than one contact record claims this candidacy; the current contact identity is unresolved."
      : !row.sourceUrl?.startsWith("https://") || !row.sourceOrg || !row.collectedAt ? "The contact lacks its published source or read date."
      : null;
    if (reason) { withheld.push({ candidacyId: row.candidacyId, reason }); continue; }
    contacts.push({ candidacyId: row.candidacyId, email: row.email?.trim() || null,
      filedAddress: row.filedAddress?.trim() || null, sourceUrl: row.sourceUrl,
      sourceOrg: row.sourceOrg, collectedAt: row.collectedAt });
  }
  cache = { contacts, withheld };
  return cache;
}

export function candidateContactForCandidacy(candidacyId: string): CandidateContact | null {
  // Other authority namespaces do not depend on the Morris clerk snapshot.
  if (!candidacyId.startsWith("ballot-nj-morris:")) return null;
  return candidateContactCensus().contacts.find((contact) => contact.candidacyId === candidacyId) ?? null;
}
