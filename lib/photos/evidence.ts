import { createHash } from "node:crypto";
import { imagesIn, pickPortraits } from "../hunt/portrait-pick.ts";
import { parseCsv } from "../sources/plural/index.ts";
import { pageWords, linkingPageFrom, pageLinksTo, section3Page, type Section3Page } from "../control-plane/promotion/section3.ts";
import { captureProblem } from "../civic-data/worker-publication-evidence.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";

export interface PortraitSources {
  readonly imageUrl: string;
  readonly captures: readonly WorkerPublicationCapture[];
  /** Canonical identity and URL of the candidate's verified campaign page. */
  readonly campaign?: NonNullable<Section3Page["campaign"]> & { readonly url: string };
}

/** Source references ride on the existing portrait binding, not an approval file. */
export interface PortraitVerification {
  readonly basis?: "OWN_PAGE" | "TWO_SOURCES";
  readonly ownPageUrl?: string;
  readonly attribution?: { readonly sourceUrl: string; readonly name: string };
  readonly name: string;
  readonly imageUrl: string;
  readonly checkedAt: string;
  readonly imageHash: string;
  readonly sourceImageHash: string;
  readonly sources: readonly { readonly url: string; readonly artifactId: string; readonly contentHash: string; readonly retrievedAt: string }[];
  readonly license?: { readonly value: string; readonly sourceUrl: string; readonly quote: string };
}

const publisher = (url: string) => new URL(url).hostname.toLowerCase().replace(/^www\./, "").split(".").slice(-2).join(".");
const sameName = (a: string, b: string) => pageWords(a).normalize("NFKD").replace(/\p{M}/gu, "") === pageWords(b).normalize("NFKD").replace(/\p{M}/gu, "");

function namesImage(name: string, imageUrl: string, capture: WorkerPublicationCapture): boolean {
  const { text, canonicalUrl } = capture.evidence;
  if (/^https:\/\/data\.openstates\.org\/people\//.test(canonicalUrl)) {
    const [header, ...rows] = parseCsv(text);
    const n = header?.indexOf("name"), i = header?.indexOf("image");
    return n !== undefined && n >= 0 && i !== undefined && i >= 0 && rows.some(row => sameName(row[n] ?? "", name) && row[i] === imageUrl);
  }
  return pageWords(text).includes(pageWords(name)) && pickPortraits(name, imagesIn(text, canonicalUrl)).some(image => image.src === imageUrl);
}

function ownPortraitPage(name: string, input: PortraitSources, capture: WorkerPublicationCapture, now: string): boolean {
  const url = capture.evidence.canonicalUrl;
  const linked = linkingPageFrom(url, input.captures.filter(c => !captureProblem(c)).map(c => c.evidence));
  if (isOfficialSource(url, linked)) {
    // A government link to one account does not make every account on a
    // social platform official. The exact saved account must be linked.
    const social = /(?:facebook|instagram|twitter|x|linkedin|youtube)\.com$/i.test(new URL(url).hostname);
    return !social || Boolean(linked && pageLinksTo({ url: linked.url, text: linked.html, retrievedAt: now }, url));
  }
  const identity = input.campaign;
  return Boolean(identity && identity.url === url && sameName(identity.name, name) && section3Page({ url,
    text: capture.evidence.text, retrievedAt: capture.observedAt, campaign: identity }, "OFFICIAL_PORTRAIT", now).ok);
}

/** Official and own-campaign portraits need only their own named image; other images need two independent sources. */
export function verifyPortraitSources(name: string, input: PortraitSources, now: string): Omit<PortraitVerification, "imageHash" | "sourceImageHash"> {
  const valid = input.captures.filter(c => {
    const age = Date.parse(now) - Date.parse(c.observedAt);
    return !captureProblem(c) && age >= 0 && age <= 7 * 86_400_000 && namesImage(name, input.imageUrl, c);
  });
  let sources = [...new Map(valid.map(c => [publisher(c.evidence.canonicalUrl), c])).values()];
  const own = valid.find(c => ownPortraitPage(name, input, c, now));
  if (own) sources = [own, ...sources.filter(c => publisher(c.evidence.canonicalUrl) !== publisher(own.evidence.canonicalUrl))];
  if (!own && (sources.length < 2 || new Set(sources.map(c => c.evidence.contentHash)).size < 2)) throw Error("PORTRAIT_SECOND_SOURCE_MISSING");
  // The bulk roster's CC0 licence covers its data, never the linked image.
  let license: PortraitVerification["license"] | undefined;
  for (const capture of sources.filter(c => publisher(c.evidence.canonicalUrl) !== "openstates.org")) {
    const text = pageWords(capture.evidence.text);
    const match = /(?:portrait|photograph|photo|image)\s+(?:is\s+|: ?)?(?:licensed under\s+|released (?:under|into)\s+|in (?:the )?)?(public domain|cc0|cc by(?:-sa)? [\d.]+)/i.exec(text);
    if (match) { license = { value: match[1], sourceUrl: capture.evidence.canonicalUrl, quote: match[0] }; break; }
  }
  const attribution = { sourceUrl: (own ?? sources[0]).evidence.canonicalUrl, name };
  return { name, imageUrl: input.imageUrl, checkedAt: now, ...(license ? { license } : {}), attribution,
    basis: own ? "OWN_PAGE" : "TWO_SOURCES", ...(own ? { ownPageUrl: own.evidence.canonicalUrl } : {}),
    sources: sources.map(c => ({url:c.evidence.canonicalUrl,artifactId:c.evidence.artifactId,contentHash:c.evidence.contentHash,retrievedAt:c.observedAt})) };
}

export function portraitVerificationMatches(name: string, verification?: PortraitVerification): boolean {
  if (!verification || !sameName(name, verification.name) || !/^sha256-[a-f0-9]{64}$/.test(verification.imageHash) ||
    !/^sha256-[a-f0-9]{64}$/.test(verification.sourceImageHash) ||
    !Number.isFinite(Date.parse(verification.checkedAt))) return false;
  try {
    const validSources = verification.sources.length > 0 && verification.sources.every(s =>
      s.artifactId && /^sha256-[a-f0-9]{64}$/.test(s.contentHash) && Number.isFinite(Date.parse(s.retrievedAt)));
    const attributed = verification.attribution ? verification.attribution.name === verification.name &&
      verification.sources.some(s => s.url === verification.attribution!.sourceUrl)
      : Boolean(verification.license?.value && verification.license.quote && verification.sources.some(s => s.url === verification.license!.sourceUrl));
    if (!validSources || !attributed) return false;
    if (verification.basis === "OWN_PAGE") return verification.sources.some(s => s.url === verification.ownPageUrl);
    return verification.sources.length >= 2 && new Set(verification.sources.map(s => publisher(s.url))).size >= 2 &&
      new Set(verification.sources.map(s => s.contentHash)).size >= 2;
  } catch { return false; }
}

/** Bind corroboration to the published image bytes and the exact source image. */
export function portraitBindingMatches(name: string, photo: {url: string; sourceUrl?: string | null; verification?: PortraitVerification}): boolean {
  return portraitVerificationMatches(name, photo.verification) && photo.sourceUrl === photo.verification!.imageUrl &&
    new RegExp(`^/api/portraits/officials/${photo.verification!.imageHash.slice(7)}\\.(jpg|png|webp|gif)$`).test(photo.url);
}

export const portraitHash = (bytes: Uint8Array) => `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
