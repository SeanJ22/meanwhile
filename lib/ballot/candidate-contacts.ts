import { currentNjMorrisReadModel, validateBallotFile } from "../sources/ballot-nj-morris/index.ts";

/** Published filing contacts, attached only to an exact current candidacy ID. */
export interface CandidateContact {
  candidacyId: string;
  email: string | null;
  /** @deprecated Compatibility for Ask; filed addresses never leave evidence. */
  filedAddress: null;
  sourceUrl: string;
  sourceOrg: string;
  collectedAt: string;
}

export interface CandidateContactCensus {
  contacts: CandidateContact[];
  withheld: { candidacyId: string; reason: string }[];
}

let cachedModel: object | null = null;
let cache: CandidateContactCensus | null = null;

/**
 * This explicit reader contract admits contacts only from the same promoted
 * BALLOT_FILING projection as the ballot. A new acquisition file, parser output,
 * or directory listing cannot become Reader truth by appearing in a directory.
 */
export function candidateContactCensus(): CandidateContactCensus {
  const projection = currentNjMorrisReadModel();
  if (cache && cachedModel === projection) return cache;
  const ballot: unknown = projection.ballot;
  validateBallotFile(ballot);
  const current = new Set(ballot.candidacies.map((candidate) => candidate.id));
  const source = projection.contacts;
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
      filedAddress: null, sourceUrl: row.sourceUrl,
      sourceOrg: row.sourceOrg, collectedAt: row.collectedAt });
  }
  cachedModel = projection;
  cache = { contacts, withheld };
  return cache;
}

export function candidateContactForCandidacy(candidacyId: string): CandidateContact | null {
  // Other authority namespaces do not depend on the Morris clerk snapshot.
  if (!candidacyId.startsWith("ballot-nj-morris:")) return null;
  return candidateContactCensus().contacts.find((contact) => contact.candidacyId === candidacyId) ?? null;
}
