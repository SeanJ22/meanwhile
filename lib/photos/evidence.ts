import { createHash } from "node:crypto";
import { imagesIn, pickPortraits } from "../hunt/portrait-pick.ts";
import { parseCsv } from "../sources/plural/index.ts";
import { pageWords } from "../control-plane/promotion/section3.ts";
import { captureProblem } from "../civic-data/worker-publication-evidence.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";

export interface PortraitSources {
  readonly imageUrl: string;
  readonly captures: readonly WorkerPublicationCapture[];
}

/** Source references ride on the existing portrait binding, not an approval file. */
export interface PortraitVerification {
  readonly name: string;
  readonly imageUrl: string;
  readonly checkedAt: string;
  readonly imageHash: string;
  readonly sourceImageHash: string;
  readonly sources: readonly { readonly url: string; readonly artifactId: string; readonly contentHash: string; readonly retrievedAt: string }[];
  readonly license: { readonly value: string; readonly sourceUrl: string; readonly quote: string };
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

/** The same named image on two independently published saved pages. */
export function verifyPortraitSources(name: string, input: PortraitSources, now: string): Omit<PortraitVerification, "imageHash" | "sourceImageHash"> {
  const valid = input.captures.filter(c => {
    const age = Date.parse(now) - Date.parse(c.observedAt);
    return !captureProblem(c) && age >= 0 && age <= 7 * 86_400_000 && namesImage(name, input.imageUrl, c);
  });
  const sources = [...new Map(valid.map(c => [publisher(c.evidence.canonicalUrl), c])).values()];
  if (sources.length < 2 || new Set(sources.map(c => c.evidence.contentHash)).size < 2) throw Error("PORTRAIT_SECOND_SOURCE_MISSING");
  // The bulk roster's CC0 licence covers its data, never the linked image.
  let license: PortraitVerification["license"] | undefined;
  for (const capture of sources.filter(c => publisher(c.evidence.canonicalUrl) !== "openstates.org")) {
    const text = pageWords(capture.evidence.text);
    const match = /(?:portrait|photograph|photo|image)\s+(?:is\s+|: ?)?(?:licensed under\s+|released (?:under|into)\s+|in (?:the )?)?(public domain|cc0|cc by(?:-sa)? [\d.]+)/i.exec(text);
    if (match) { license = { value: match[1], sourceUrl: capture.evidence.canonicalUrl, quote: match[0] }; break; }
  }
  // Existing government-portrait policy: attribution and removal on request,
  // without pretending the government's portrait is public domain.
  if (!license) {
    const official = sources.find(c => isOfficialSource(c.evidence.canonicalUrl));
    if (official) license = { value: "official government portrait; attribution; remove on request",
      sourceUrl: official.evidence.canonicalUrl, quote: name };
  }
  if (!license) throw Error("PORTRAIT_IMAGE_LICENCE_UNVERIFIED");
  return { name, imageUrl: input.imageUrl, checkedAt: now, license,
    sources: sources.map(c => ({url:c.evidence.canonicalUrl,artifactId:c.evidence.artifactId,contentHash:c.evidence.contentHash,retrievedAt:c.observedAt})) };
}

export function portraitVerificationMatches(name: string, verification?: PortraitVerification): boolean {
  if (!verification || !sameName(name, verification.name) || !/^sha256-[a-f0-9]{64}$/.test(verification.imageHash) ||
    !/^sha256-[a-f0-9]{64}$/.test(verification.sourceImageHash) ||
    !verification.license?.value || !verification.license.quote || !Number.isFinite(Date.parse(verification.checkedAt))) return false;
  try {
    return verification.sources.length >= 2 && new Set(verification.sources.map(s => publisher(s.url))).size >= 2 &&
      new Set(verification.sources.map(s => s.contentHash)).size >= 2 &&
      verification.sources.every(s => s.artifactId && /^sha256-[a-f0-9]{64}$/.test(s.contentHash)) &&
      verification.sources.some(s => s.url === verification.license.sourceUrl);
  } catch { return false; }
}

/** Bind corroboration to the published image bytes and the exact source image. */
export function portraitBindingMatches(name: string, photo: {url: string; sourceUrl?: string | null; verification?: PortraitVerification}): boolean {
  return portraitVerificationMatches(name, photo.verification) && photo.sourceUrl === photo.verification!.imageUrl &&
    new RegExp(`^/api/portraits/officials/${photo.verification!.imageHash.slice(7)}\\.(jpg|png|webp|gif)$`).test(photo.url);
}

export const portraitHash = (bytes: Uint8Array) => `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
