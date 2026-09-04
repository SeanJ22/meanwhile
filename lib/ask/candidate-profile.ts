import { allCandidateCards, type CandidateCardData } from "../ballot/candidate-cards.ts";
import { allCandidateLinks, type CandidateLinks } from "../ballot/candidate-sites.ts";
import { readerPersonKeys } from "../identity/reader-person.ts";
import type { EvidenceGap, EvidenceRecord, EvidenceSubject } from "./evidence.ts";

type ProfileAnswer = { records: EvidenceRecord[]; gaps: EvidenceGap[]; denominators: Record<string, number> };
const pointer = (key: string) => key.replaceAll("~", "~0").replaceAll("/", "~1");
const readDate = (text: string | null | undefined) => text?.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? null;
const sourceUrl = (url: string | null | undefined) => Boolean(url && /^https?:\/\//.test(url));

/** Same curated fields that feed candidate cards; pictures and contact routes have their own contracts. */
export function projectCandidateProfile(
  subject: EvidenceSubject,
  keys: readonly string[],
  cards: Record<string, CandidateCardData>,
  links: Record<string, CandidateLinks>,
): ProfileAnswer {
  const records: EvidenceRecord[] = [];
  const gaps: EvidenceGap[] = [];
  const denominators: Record<string, number> = { candidateCardsRead: 0, candidateLinkProfilesRead: 0, candidateBiosReturned: 0, candidateLinksReturned: 0, candidateProfileFieldsWithheld: 0 };
  if (subject.kind !== "PERSON") return { records, gaps, denominators };
  for (const key of [...new Set(keys)].sort()) {
    const card = cards[key];
    if (card) denominators.candidateCardsRead++;
    if (card?.bio) {
      const retrievedAt = readDate(card.bioSourceLabel);
      if (sourceUrl(card.bioSourceUrl) && card.bioSourceLabel && retrievedAt) {
        const holdingPath = `data/ballot/candidate-cards-2026.json#/cards/${pointer(key)}`;
        records.push({ kind: "CANDIDATE_BIO", id: `candidate-bio:${key}`, subjectId: subject.id,
          canonicalSubjectId: key, text: `“${card.bio}” — ${card.bioSourceLabel}`,
          sourceUrl: card.bioSourceUrl, sourceOrg: card.bioSourceLabel, retrievedAt,
          candidateProfile: { field: "bio", value: card.bio, label: card.bioSourceLabel, holdingKey: key, holdingPath } });
        denominators.candidateBiosReturned++;
      } else {
        denominators.candidateProfileFieldsWithheld++;
        gaps.push({ whose: "OURS", statement: "A held candidate biography lacks its recorded source or read date, so it has not been asserted in this answer." });
      }
    }
    const found = links[key];
    if (found) denominators.candidateLinkProfilesRead++;
    for (const field of ["official", "campaign"] as const) {
      const link = found?.[field];
      if (!link) continue;
      if (!sourceUrl(link.url) || !link.verification?.trim() || !readDate(link.attemptedAt)) {
        denominators.candidateProfileFieldsWithheld++;
        gaps.push({ whose: "OURS", statement: "A held candidate link lacks its recorded verification or read date, so it has not been asserted in this answer." });
        continue;
      }
      const label = link.label ?? (field === "official" ? "Official page" : "Campaign site");
      const holdingPath = `data/ballot/candidate-links-2026.json#/links/${pointer(key)}/${field}`;
      records.push({ kind: "CANDIDATE_LINK", id: `candidate-link:${key}:${field}`, subjectId: subject.id,
        canonicalSubjectId: key, text: `${label}: ${link.url}`, sourceUrl: link.url,
        sourceOrg: label, retrievedAt: link.attemptedAt,
        candidateProfile: { field, value: link.url, label, verification: link.verification, holdingPath, holdingKey: key } });
      denominators.candidateLinksReturned++;
    }
  }
  return { records, gaps, denominators };
}

/** Resolve only committed current person/candidacy relationships; never compare names. */
export function candidateProfileEvidenceFor(subject: EvidenceSubject): ProfileAnswer {
  if (subject.kind !== "PERSON") return projectCandidateProfile(subject, [], {}, {});
  try {
    const identity = readerPersonKeys(subject.id);
    if (identity.status === "IDENTITY_UNRESOLVED") return {
      records: [], gaps: [{ whose: "OURS", statement: "The current candidate/profile identity is unresolved, so no other person's biography or links have been attached." }],
      denominators: { candidateProfileIdentityUnresolved: 1 },
    };
    return projectCandidateProfile(subject, identity.keys, allCandidateCards().cards, allCandidateLinks().links);
  } catch {
    return { records: [], gaps: [{ whose: "OURS", statement: "The held candidate biographies and verified links could not be read for this answer." }],
      denominators: { candidateProfileLoaderFailures: 1 } };
  }
}
