export interface CommonsCandidacyIdentity {
  readonly candidacyId: string;
  readonly wikidataId: string;
  readonly officeTitle: string;
  readonly ocdId: string;
  readonly stateCode: string;
}

export const freelyLicensedPortrait = (value: string): boolean => /^(?:CC0(?: 1\.0)?|public domain|CC BY(?:-SA)? \d+(?:\.\d+)?)$/i.test(value.trim());

/** Stored portraits live under one prefix per kind of subject; the public route serves both. */
export type PortraitKeyPrefix = "officials" | "candidates";

/** Source references ride on the existing portrait binding, not an approval file. */
export interface PortraitVerification {
  readonly personId: string;
  readonly decoderVersion?: string;
  readonly width?: number;
  readonly height?: number;
  readonly imageRetrievedAt?: string;
  readonly basis?: "OWN_PAGE" | "TWO_SOURCES" | "COMMONS";
  readonly ownPageUrl?: string;
  readonly attribution?: { readonly sourceUrl: string; readonly name: string; readonly author?: string };
  readonly commons?: CommonsCandidacyIdentity & { readonly identitySourceUrl: string };
  readonly name: string;
  readonly imageUrl: string;
  readonly checkedAt: string;
  readonly imageHash: string;
  readonly sourceImageHash: string;
  readonly sources: readonly { readonly url: string; readonly artifactId?: string; readonly vaultKey?:string; readonly contentHash: string; readonly retrievedAt: string }[];
  readonly license?: { readonly value: string; readonly sourceUrl: string; readonly quote: string };
}

/** Known source ownership groups; mirrors of the same dataset are one source. */
export const portraitPublisher = (value: string): string => {
  const url = new URL(value), host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (/(^|\.)openstates\.org$/.test(host) || /^(raw\.githubusercontent\.com|github\.com|codeload\.github\.com)$/.test(host) && /^\/openstates\/people(?:\/|$)/.test(url.pathname)) return "openstates.org";
  const government = /(?:^|\.)([^.]+\.gov)$/.exec(host)?.[1] ?? /(?:^|\.)(state\.[a-z]{2}\.us)$/.exec(host)?.[1];
  if (government) return government;
  return /(?:^|\.)([^.]+\.(?:com|org|net|edu))$/.exec(host)?.[1] ?? "unresolved-publisher";
};
export function portraitVerificationMatches(personId: string, verification?: PortraitVerification): boolean {
  if (!verification || !personId || personId !== verification.personId || !/^sha256-[a-f0-9]{64}$/.test(verification.imageHash) ||
    !/^sha256-[a-f0-9]{64}$/.test(verification.sourceImageHash) ||
    !Number.isFinite(Date.parse(verification.checkedAt))) return false;
  try {
    const validSources = verification.sources.length > 0 && verification.sources.every(s =>
      (s.artifactId || s.vaultKey?.startsWith("project/freshness/source/")) && /^sha256-[a-f0-9]{64}$/.test(s.contentHash) && Number.isFinite(Date.parse(s.retrievedAt)));
    const attributed = verification.attribution ? verification.attribution.name === verification.name &&
      verification.sources.some(s => s.url === verification.attribution!.sourceUrl)
      : Boolean(verification.license?.value && verification.license.quote && verification.sources.some(s => s.url === verification.license!.sourceUrl));
    if (!validSources || !attributed) return false;
    if (verification.basis === "COMMONS") {
      const identity = verification.commons;
      return Boolean(identity && identity.candidacyId === personId && /^Q\d+$/.test(identity.wikidataId) &&
        /\/state:([^/]+)/.exec(identity.ocdId)?.[1].toUpperCase() === identity.stateCode.toUpperCase() && identity.officeTitle &&
        verification.attribution?.author && verification.license && freelyLicensedPortrait(verification.license.value) &&
        new URL(verification.license.sourceUrl).hostname === "commons.wikimedia.org" &&
        new URL(identity.identitySourceUrl).hostname === "query.wikidata.org" &&
        verification.sources.some(source => source.url === identity.identitySourceUrl));
    }
    if (verification.basis === "OWN_PAGE") return verification.sources.some(s => s.url === verification.ownPageUrl);
    return verification.sources.length >= 2 && new Set(verification.sources.map(s => portraitPublisher(s.url))).size >= 2 &&
      new Set(verification.sources.map(s => s.contentHash)).size >= 2;
  } catch { return false; }
}

/** Bind corroboration to the published image bytes and the exact source image. */
export function portraitBindingMatches(personId: string, photo: {url: string; sourceUrl?: string | null; verification?: PortraitVerification},
  prefix: PortraitKeyPrefix = "officials"): boolean {
  return portraitVerificationMatches(personId, photo.verification) && photo.sourceUrl === photo.verification!.imageUrl &&
    new RegExp(`^/api/portraits/${prefix}/${photo.verification!.imageHash.slice(7)}\\.(jpg|png|webp|gif)$`).test(photo.url);
}
