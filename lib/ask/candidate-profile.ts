import { allCandidateCards, type CandidateCardData } from "../ballot/candidate-cards.ts";
import { allCandidateLinks, campaignLinkIsDerived, type CandidateLinks } from "../ballot/candidate-sites.ts";
import { derivedCampaignSiteHoldingPath } from "../civic-data/derived-campaign-sites.ts";
import { readerPersonKeys } from "../identity/reader-person.ts";
import { candidateContactForCandidacy } from "../ballot/candidate-contacts.ts";
import { stateBallotScope } from "../civic-data/state-scopes.ts";
import type { EvidenceGap, EvidenceRecord, EvidenceSubject } from "./evidence.ts";

type ProfileAnswer = { records: EvidenceRecord[]; gaps: EvidenceGap[]; denominators: Record<string, number> };
const pointer = (key: string) => key.replaceAll("~", "~0").replaceAll("/", "~1");
const readDate = (text: string | null | undefined) => text?.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? null;
const sourceUrl = (url: string | null | undefined) => Boolean(url && /^https?:\/\//.test(url));

const embeddedUrl = (text: string | null | undefined) => text?.match(/https?:\/\/[^\s)]+/)?.[0] ?? null;
const contactValue = (text: string) => text.toLowerCase().replace(/[^a-z0-9@]/g, "");

function projectCandidateProfile(
  state: string,
  subject: EvidenceSubject,
  keys: readonly string[],
  cards: Record<string, CandidateCardData>,
  links: Record<string, CandidateLinks>,
  campaignHolding: (key: string) => string | null = () => null,
): ProfileAnswer {
  const records: EvidenceRecord[] = [];
  const gaps: EvidenceGap[] = [];
  const denominators: Record<string, number> = { candidateCardsRead: 0, candidateLinkProfilesRead: 0, candidateBiosReturned: 0, candidateLinksReturned: 0, candidateContactsReturned: 0, candidateContactSourceUrlsUnrecorded: 0, candidateProfileFieldsWithheld: 0 };
  if (subject.kind !== "PERSON") return { records, gaps, denominators };
  for (const key of [...new Set(keys)].sort()) {
    const card = cards[key];
    if (card) denominators.candidateCardsRead++;
    if (card?.bio) {
      const retrievedAt = readDate(card.bioSourceLabel);
      if (sourceUrl(card.bioSourceUrl) && card.bioSourceLabel && retrievedAt) {
        const holdingPath = `civic-data:CANDIDATE_PROFILE:${stateBallotScope("candidate-profiles", state)}#/cards/${pointer(key)}`;
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
    for (const field of ["email", "phone"] as const) {
      const value = card?.[field];
      if (!value) continue;
      const label = field === "phone" ? card.phoneLabel ?? "Recorded phone" : "Recorded email";
      const sourceNote = field === "phone" ? card.phoneSource ?? card.phoneLabel : null;
      // A verified page is this field's source only when its held verification
      // actually includes this value. A biography URL is never a contact source.
      const exactLink = [found?.official, found?.campaign].find(link => link?.verification && sourceUrl(link.url)
        && readDate(link.attemptedAt) && contactValue(link.verification).includes(contactValue(value)));
      const filing = candidateContactForCandidacy(state, key);
      const exactFiling = field !== "phone" && filing?.[field] === value ? filing : null;
      const url = embeddedUrl(sourceNote) ?? exactFiling?.sourceUrl ?? exactLink?.url ?? null;
      const retrievedAt = readDate(sourceNote) ?? exactFiling?.collectedAt ?? exactLink?.attemptedAt ?? null;
      const publisher = sourceNote ?? exactFiling?.sourceOrg ?? (exactLink ? exactLink.label ?? new URL(exactLink.url).hostname : "Candidate-card contact record");
      const provenanceLimitation = !url || !retrievedAt ? "This contact's source URL or read date was not recorded." : null;
      if (!url) denominators.candidateContactSourceUrlsUnrecorded++;
      records.push({ kind: "CANDIDATE_CONTACT", id: `candidate-contact-field:${key}:${field}`, subjectId: subject.id,
        canonicalSubjectId: key, text: `${label}: ${value}${provenanceLimitation ? ` ${provenanceLimitation}` : ""}`,
        sourceUrl: url, sourceOrg: publisher, retrievedAt,
        candidateProfile: { field, value, label, holdingKey: key,
          holdingPath: `civic-data:CANDIDATE_PROFILE:${stateBallotScope("candidate-profiles", state)}#/cards/${pointer(key)}/${field}`,
          sourceNote: sourceNote ?? null, provenanceLimitation } });
      denominators.candidateContactsReturned++;
    }
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
      const holdingPath = (field === "campaign" ? campaignHolding(key) : null) ??
        `civic-data:CANDIDATE_PROFILE:${stateBallotScope("candidate-profiles", state)}#/links/${pointer(key)}/${field}`;
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
export function candidateProfileEvidenceFor(state: string, subject: EvidenceSubject): ProfileAnswer {
  if (subject.kind !== "PERSON") return projectCandidateProfile(state, subject, [], {}, {});
  try {
    const identity = readerPersonKeys(subject.id);
    if (identity.status === "IDENTITY_UNRESOLVED") return {
      records: [], gaps: [{ whose: "OURS", statement: "The current candidate/profile identity is unresolved, so no other person's biography or links have been attached." }],
      denominators: { candidateProfileIdentityUnresolved: 1 },
    };
    const cards = allCandidateCards(state);
    return projectCandidateProfile(state, subject, identity.keys, cards.cards, allCandidateLinks(state).links,
      (key) => (campaignLinkIsDerived(state, key) ? derivedCampaignSiteHoldingPath(state, key) : null));
  } catch {
    return { records: [], gaps: [{ whose: "OURS", statement: "The held candidate biographies, contacts, and verified links could not be read for this answer." }],
      denominators: { candidateProfileLoaderFailures: 1 } };
  }
}
