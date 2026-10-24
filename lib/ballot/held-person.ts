import type { CandidateLinks } from "./candidate-sites.ts";
import type { Candidacy } from "./types.ts";
import { ballotCandidateDisplayName } from "./name-case.ts";
import { nameParts, namesAgree, splitDisplayName } from "./incumbency.ts";
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
  const name = nameParts(parts.givenName, parts.familyName);
  const native = nativePersonIdFromUrl(official.url);
  const nativeKey = native ? `${native.source}:${native.id}` : null;
  const usesPage = (holder: HeldCandidatePerson) => [holder.websiteUrl, holder.sourceUrl, holder.provenance?.sourceUrl, ...holder.profileUrls ?? []]
    .some(url => pageKey(url) === profile);
  if (!nativeKey && holders.some(holder => {
    if (!usesPage(holder)) return false;
    const parts = splitDisplayName(holder.name);
    return !namesAgree(name, nameParts(parts.givenName, parts.familyName));
  })) return null;
  const matches = holders.filter(holder => {
    const parts = splitDisplayName(holder.name);
    if (!namesAgree(name, nameParts(parts.givenName, parts.familyName))) return false;
    if (nativeKey && personIdentityKeys(holder).has(nativeKey)) return true;
    return usesPage(holder);
  });
  if (!matches.length) return null;
  // All matches point to the same exact sourced profile, so aliases of that
  // native person remain available even when two publishers use different ids.
  const keys = new Set(matches.flatMap(holder => [...personIdentityKeys(holder)]));
  if (nativeKey) keys.add(nativeKey);
  return { personId: matches[0].personId ?? matches[0].id, keys: [...keys].sort(),
    sourceUrls: [...new Set([candidate.provenance.sourceUrl, official.url])] };
}
