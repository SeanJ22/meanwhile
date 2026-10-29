import type { CandidateLinks } from "./candidate-sites.ts";
import type { Candidacy } from "./types.ts";
import { ballotCandidateDisplayName } from "./name-case.ts";
import { samePerson } from "../identity/match-person.ts";
import { nameParts, splitDisplayName } from "../identity/name-parts.ts";
import { nativePersonIdFromUrl, personIdentityKeys } from "../officials/people-identity.ts";

export interface HeldCandidatePerson {
  readonly id: string;
  readonly name: string;
  readonly personId?: string;
  readonly nativeIds?: Readonly<Record<string, readonly string[]>>;
  readonly websiteUrl?: string | null;
  readonly sourceUrl?: string | null;
  readonly profileUrls?: readonly string[];
  readonly provenance?: { readonly sourceUrl: string | null };
}

function pageKey(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hostname = url.hostname.replace(/^www\./, "");
    url.hash = "";
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}

/** An already verified official profile can identify a person running for a
 * different office. This relationship makes no claim about incumbency. */
export function verifiedCandidateProfilePerson(
  candidate: Candidacy,
  official: CandidateLinks["official"],
  holders: readonly HeldCandidatePerson[],
): { readonly personId: string; readonly keys: readonly string[]; readonly sourceUrls: readonly string[] } | null {
  const source = pageKey(candidate.provenance.sourceUrl), profile = pageKey(official?.url);
  if (!candidate.provenance.sourceUrl || !source || !profile || source === profile || !official?.verification.trim() ||
      !Number.isFinite(Date.parse(official.attemptedAt))) return null;
  const parts = splitDisplayName(ballotCandidateDisplayName({ ...candidate, ticket: undefined }));
  const native = nativePersonIdFromUrl(official.url);
  const nativeKey = native ? `${native.source}:${native.id}` : null;
  const usesPage = (holder: HeldCandidatePerson) => [holder.websiteUrl, holder.sourceUrl, holder.provenance?.sourceUrl, ...holder.profileUrls ?? []]
    .some(url => pageKey(url) === profile);
  // The verified profile page is the seat both sides stand on. A holder is tied to it by the native id the page carries or by publishing the
  // page, and the name must agree as well: the identifier alone does not outrank a name the page does not show.
  const page = `profile ${profile}`;
  const probe = { id: candidate.id, name: nameParts(parts.givenName, parts.familyName), seats: [page] };
  const atPage = (holder: HeldCandidatePerson) => {
    const held = splitDisplayName(holder.name);
    const linked = (nativeKey !== null && personIdentityKeys(holder).has(nativeKey)) || usesPage(holder);
    return { id: holder.id, name: nameParts(held.givenName, held.familyName), seats: linked ? [page] : [] };
  };
  if (!nativeKey && holders.some(holder => usesPage(holder) && !samePerson(probe, atPage(holder)))) return null;
  const matches = holders.filter(holder => samePerson(probe, atPage(holder)));
  if (!matches.length) return null;
  // All matches point to the same exact sourced profile, so aliases of that
  // native person remain available even when two publishers use different ids.
  const keys = new Set(matches.flatMap(holder => [...personIdentityKeys(holder)]));
  if (nativeKey) keys.add(nativeKey);
  return { personId: matches[0].personId ?? matches[0].id, keys: [...keys].sort(),
    sourceUrls: [...new Set([candidate.provenance.sourceUrl, official.url])] };
}
