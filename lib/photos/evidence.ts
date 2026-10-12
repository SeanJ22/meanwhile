import { portraitPublisher, type PortraitVerification } from "./binding.ts";
import { createHash } from "node:crypto";
import { imagesIn, pickPortraits } from "../hunt/portrait-pick.ts";
import { parseCsv } from "../sources/plural/index.ts";
import { parse as parseYaml } from "yaml";
import { pageWords, linkingPageFrom, pageLinksTo, section3Page, type Section3Page } from "../control-plane/promotion/section3.ts";
import { captureProblem } from "../civic-data/worker-publication-evidence.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";

/** A portrait can cite either a worker artifact or an immutable known-source vault object. */
export interface PortraitCapture extends Pick<WorkerPublicationCapture,"observedAt"|"httpStatus"|"transport"|"partial"> {
  readonly evidence: {
    readonly canonicalUrl:string;
    readonly sourceId:string;
    readonly contentHash:string;
    readonly text:string;
    readonly retrievedAt:string;
    readonly artifactId?:string;
    readonly vaultKey?:string;
  };
}

export interface PortraitSubject {
  readonly personId: string;
  readonly name: string;
  readonly nativeIds?: Readonly<Record<string,readonly string[]>>;
  /** Verified source profile URLs for this exact subject. */
  readonly profileUrls: readonly string[];
}

export interface PortraitSources {
  readonly subject: PortraitSubject;
  readonly imageUrl: string;
  readonly captures: readonly PortraitCapture[];
  /** Canonical identity and URL of the candidate's verified campaign page. */
  readonly campaign?: NonNullable<Section3Page["campaign"]> & { readonly url: string };
}

const sameName = (a: string, b: string) => pageWords(a).normalize("NFKD").replace(/\p{M}/gu, "") === pageWords(b).normalize("NFKD").replace(/\p{M}/gu, "");

function namesImage(subject: PortraitSubject, imageUrl: string, capture: PortraitCapture): boolean {
  const { text, canonicalUrl } = capture.evidence;
  const ids = new Set([subject.personId, ...Object.entries(subject.nativeIds ?? {}).flatMap(([source, values]) => values.flatMap(id => [id,`${source}:${id}`]))]);
  if (/^https:\/\/data\.openstates\.org\/people\//.test(canonicalUrl)) {
    const [header, ...rows] = parseCsv(text);
    const n = header?.indexOf("name"), i = header?.indexOf("image"), id = header?.indexOf("id");
    return id >= 0 && n >= 0 && i >= 0 && rows.some(row => ids.has(row[id]) && sameName(row[n] ?? "",subject.name) && row[i] === imageUrl);
  }
  if (/^https:\/\/(?:raw\.githubusercontent\.com\/openstates\/people|v3\.openstates\.org)\//.test(canonicalUrl)) {
    try {
      const row = parseYaml(text) as {id?:string;name?:string;image?:string};
      return Boolean(row.id && ids.has(row.id) && sameName(row.name ?? "",subject.name) && row.image === imageUrl);
    } catch { return false; }
  }
  if (/^https:\/\/api\.congress\.gov\/v3\/member\//.test(canonicalUrl)) {
    try {
      const row = JSON.parse(text).member;
      return Boolean(row?.bioguideId && (ids.has(row.bioguideId) || ids.has(`congress:${row.bioguideId}`)) && row.depiction?.imageUrl === imageUrl);
    } catch { return false; }
  }
  return subject.profileUrls.includes(canonicalUrl) && pageWords(text).includes(pageWords(subject.name)) &&
    pickPortraits(subject.name,imagesIn(text,canonicalUrl)).some(image=>image.src === imageUrl);
}

function ownPortraitPage(name: string, input: PortraitSources, capture: PortraitCapture, now: string): boolean {
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
export function verifyPortraitSources(personId: string, input: PortraitSources, now: string): Omit<PortraitVerification, "imageHash" | "sourceImageHash"> {
  if (!personId || personId !== input.subject.personId) throw Error("PORTRAIT_PERSON_ID_MISMATCH");
  const name = input.subject.name;
  const valid = input.captures.filter(c => {
    const age = Date.parse(now) - Date.parse(c.observedAt);
    return !captureProblem(c) && Boolean(c.evidence.artifactId || c.evidence.vaultKey?.startsWith("project/freshness/source/")) &&
      age >= 0 && age <= 7 * 86_400_000 && namesImage(input.subject, input.imageUrl, c);
  });
  let sources = [...new Map(valid.map(c => [portraitPublisher(c.evidence.canonicalUrl), c])).values()];
  const own = valid.find(c => ownPortraitPage(name, input, c, now));
  if (own) sources = [own, ...sources.filter(c => portraitPublisher(c.evidence.canonicalUrl) !== portraitPublisher(own.evidence.canonicalUrl))];
  if (!own && (sources.length < 2 || new Set(sources.map(c => c.evidence.contentHash)).size < 2)) throw Error("PORTRAIT_SECOND_SOURCE_MISSING");
  // The bulk roster's CC0 licence covers its data, never the linked image.
  let license: PortraitVerification["license"] | undefined;
  for (const capture of sources.filter(c => portraitPublisher(c.evidence.canonicalUrl) !== "openstates.org")) {
    const text = pageWords(capture.evidence.text);
    const match = /(?:portrait|photograph|photo|image)\s+(?:is\s+|: ?)?(?:licensed under\s+|released (?:under|into)\s+|in (?:the )?)?(public domain|cc0|cc by(?:-sa)? [\d.]+)/i.exec(text);
    if (match) { license = { value: match[1], sourceUrl: capture.evidence.canonicalUrl, quote: match[0] }; break; }
  }
  const attribution = { sourceUrl: (own ?? sources[0]).evidence.canonicalUrl, name };
  return { personId, name, imageUrl: input.imageUrl, checkedAt: now, ...(license ? { license } : {}), attribution,
    basis: own ? "OWN_PAGE" : "TWO_SOURCES", ...(own ? { ownPageUrl: own.evidence.canonicalUrl } : {}),
    sources: sources.map(c => ({url:c.evidence.canonicalUrl,
      ...(c.evidence.artifactId ? {artifactId:c.evidence.artifactId} : {vaultKey:c.evidence.vaultKey}),
      contentHash:c.evidence.contentHash,retrievedAt:c.evidence.retrievedAt})) };
}

export const portraitHash = (bytes: Uint8Array) => `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
