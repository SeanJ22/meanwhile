import { imagesIn, pickPortraits } from "../hunt/portrait-pick.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import type { PortraitCapture } from "../photos/evidence.ts";
import type { PortraitRuntime } from "../photos/store.ts";
import { storeVerifiedPortrait } from "../photos/store.ts";
import type { CandidateCardData } from "./candidate-cards.ts";
import type { CampaignSiteIdentity, CampaignSiteSupportingRead } from "../candidates/campaign-site-verifier.ts";
import { wikidataCandidacyPortraitIdentity } from "../photos/commons.ts";
import { acquireKnownRelease, type KnownRelease } from "../sources/known-release.ts";
import { sourceUserAgent } from "../sources/http.ts";

export interface CandidateSitePage {
  readonly identity: CampaignSiteIdentity;
  readonly capture: WorkerPublicationCapture;
  readonly cycleSource?: CampaignSiteSupportingRead;
}

export type CandidatePortraitPatch = Pick<CandidateCardData, "personId" | "photoUrl" | "photoSource" | "photoVerification">;

export async function candidatePortraitFromOwnSite(page: CandidateSitePage, now: string, io?: PortraitRuntime):
  Promise<{ readonly patch: CandidatePortraitPatch } | { readonly gap: string }> {
  const { canonicalUrl, text } = page.capture.evidence;
  const name = `${page.identity.givenName} ${page.identity.familyName}`.replace(/\s+/g, " ").trim();
  const personId = page.identity.candidacyId;
  const image = pickPortraits(name, imagesIn(text, canonicalUrl))[0];
  if (!image) return { gap: "PORTRAIT_NOT_ON_OWN_PAGE" };
  const photo = await storeVerifiedPortrait(personId, {
    subject: { personId, name, profileUrls: [canonicalUrl] },
    imageUrl: image.src,
    captures: [page.capture],
    campaign: { url: canonicalUrl, identity: page.identity, cycleSource: page.cycleSource },
  }, now, io, "candidates");
  if (photo.verification?.basis !== "OWN_PAGE") return { gap: "PORTRAIT_NOT_FROM_OWN_PAGE" };
  return { patch: { personId, photoUrl: photo.url, photoSource: `Portrait from the campaign's own site, ${new URL(canonicalUrl).hostname.replace(/^www\./, "")}`,
    photoVerification: photo.verification } };
}

export interface CommonsPortraitRuntime {
  readonly capture?: (url: string) => Promise<KnownRelease>;
  readonly portrait?: PortraitRuntime;
}

function commonsCapture(release: KnownRelease): PortraitCapture {
  if (!release.vaultKey) throw Error("COMMONS_CAPTURE_NOT_VAULTED");
  return { evidence: { vaultKey: release.vaultKey, contentHash: `sha256-${release.sha256}`,
    text: new TextDecoder().decode(release.bytes), canonicalUrl: release.finalUrl, retrievedAt: release.retrievedAt,
    sourceId: "candidate-wikimedia-portrait" },
    observedAt: release.retrievedAt, httpStatus: release.httpStatus, transport: "REACHABLE", partial: false };
}

function wikidataCandidatePortraitQuery(subject: CampaignSiteIdentity): string {
  const name = JSON.stringify(`${subject.givenName} ${subject.familyName}`.replace(/\s+/g, " ").trim());
  return `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT DISTINCT ?person ?personLabel ?officeLabel ?districtLabel ?districtNumber ?stateCode ?image WHERE {
  ?person rdfs:label ?personLabel; wdt:P18 ?image.
  FILTER(LANG(?personLabel) = "en" && LCASE(STR(?personLabel)) = LCASE(${name}))
  { ?person p:P39 ?statement. ?statement ps:P39 ?office.
    OPTIONAL { ?statement pq:P768 ?district. }
  } UNION {
    ?person p:P3602 ?statement.
    OPTIONAL { ?statement pq:P768 ?district. }
    OPTIONAL { ?statement pq:P794 ?office. }
  }
  OPTIONAL { ?office wdt:P279* ?officeClass. ?officeClass rdfs:label ?officeLabel. FILTER(LANG(?officeLabel) = "en") }
  { ?district wdt:P131* ?state. } UNION { ?office wdt:P1001/wdt:P131* ?state. }
  ?state wdt:P300 ?stateCode.
  FILTER(?stateCode = "US-${subject.stateCode.toUpperCase()}")
  OPTIONAL { ?district rdfs:label ?districtLabel. FILTER(LANG(?districtLabel) = "en") }
  OPTIONAL { ?district wdt:P1545 ?districtNumber. }
}`;
}

export async function candidatePortraitFromCommons(subject: CampaignSiteIdentity, now: string, io?: CommonsPortraitRuntime):
  Promise<{ readonly patch: CandidatePortraitPatch } | { readonly gap: string }> {
  const capture = io?.capture ?? (async (url: string) => acquireKnownRelease({ sourceId: "candidate-wikimedia-portrait", releaseId: url,
    url, allowedHosts: [new URL(url).hostname], parserVersion: "candidate-wikimedia-portrait/1", maxBytes: 2_000_000,
    checkAfterMs: 7 * 86_400_000, signal: AbortSignal.timeout(30_000),
    headers: { accept: "application/json", "user-agent": sourceUserAgent(), "api-user-agent": sourceUserAgent() },
    validate: bytes => { JSON.parse(new TextDecoder().decode(bytes)); } }));
  const sourceUrl = `https://query.wikidata.org/sparql?${new URLSearchParams({ query: wikidataCandidatePortraitQuery(subject), format: "json" })}`;
  const identityCapture = commonsCapture(await capture(sourceUrl));
  const name = `${subject.givenName} ${subject.familyName}`.replace(/\s+/g, " ").trim();
  const body = JSON.parse(identityCapture.evidence.text);
  const matches = new Map<string, { image: string; identity: { candidacyId: string; wikidataId: string; officeTitle: string; ocdId: string; stateCode: string } }>();
  for (const row of body.results?.bindings ?? []) {
    const wikidataId = typeof row.person?.value === "string" ? row.person.value.split("/").at(-1) : "";
    const identity = { candidacyId: subject.candidacyId, wikidataId, officeTitle: subject.officeTitle, ocdId: subject.ocdId, stateCode: subject.stateCode };
    const image = wikidataCandidacyPortraitIdentity(identity, name, identityCapture.evidence.text);
    if (image) matches.set(wikidataId, { image, identity });
  }
  if (matches.size !== 1) return { gap: "COMMONS_CANDIDACY_IDENTITY_UNRESOLVED" };
  const matched = [...matches.values()][0];
  const image = new URL(matched.image);
  if (!["commons.wikimedia.org", "upload.wikimedia.org"].includes(image.hostname)) return { gap: "COMMONS_IMAGE_NOT_HELD" };
  const title = `File:${decodeURIComponent(image.pathname.split("/").at(-1) ?? "").replace(/_/g, " ")}`;
  const metadataUrl = `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ action: "query", titles: title, prop: "imageinfo", iiprop: "extmetadata|url", format: "json" })}`;
  const metadataCapture = commonsCapture(await capture(metadataUrl));
  const pages = Object.values(JSON.parse(metadataCapture.evidence.text).query?.pages ?? {}) as { title?: string; imageinfo?: { url?: string }[] }[];
  const imageUrl = pages.find(page => page.title === title)?.imageinfo?.[0]?.url;
  if (!imageUrl) return { gap: "COMMONS_IMAGE_NOT_HELD" };
  const photo = await storeVerifiedPortrait(subject.candidacyId, { subject: { personId: subject.candidacyId, name, profileUrls: [] },
    imageUrl, commons: matched.identity, captures: [identityCapture, metadataCapture] }, now, io?.portrait, "candidates");
  if (photo.verification?.basis !== "COMMONS") return { gap: "COMMONS_LICENSE_NOT_VERIFIED" };
  return { patch: { personId: subject.candidacyId, photoUrl: photo.url,
    photoSource: `Wikimedia Commons: ${photo.verification.attribution!.author}, ${photo.verification.license!.value}`,
    photoVerification: photo.verification } };
}
