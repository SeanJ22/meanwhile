/**
 * Picking a portrait off a page. A candidate image must carry the person's
 * own name in its alt text or filename; otherwise this reports nothing, since
 * page furniture (a seal, a badge, a banner) is what a "largest" or "first"
 * image heuristic picks. `og:image` is never used: on candidate sites it is
 * a share card, not a portrait.
 */

import { PORTRAIT_ACCEPT } from "../photos/decode.ts";
import { sourceUserAgent } from "../sources/http.ts";

/** One image on a page, resolved against the page's own URL. */
export interface PageImage {
  src: string;
  alt: string;
}

/**
 * Every `<img>` on the page, with its `src` and `alt`. A lazily loaded image
 * has a placeholder in `src` and the real file in `data-src`, so both are
 * emitted, `data-src` first; the picker decides on the name, not the order.
 * `srcset` is read too, at its first candidate.
 */
export function imagesIn(html: string, base: string): PageImage[] {
  const out: PageImage[] = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const attr = (name: string): string | null =>
      new RegExp(`\\b${name}\\s*=\\s*"([^"]+)"`, "i").exec(tag)?.[1] ??
      new RegExp(`\\b${name}\\s*=\\s*'([^']+)'`, "i").exec(tag)?.[1] ??
      null;
    const alt = attr("alt") ?? "";
    const firstOfSrcset = attr("srcset")?.split(",")[0]?.trim().split(/\s+/)[0] ?? null;
    for (const src of [attr("data-src"), attr("data-lazy-src"), attr("src"), firstOfSrcset]) {
      if (!src) continue;
      try {
        const resolved = new URL(src, base).toString();
        if (!out.some((i) => i.src === resolved)) out.push({ src: resolved, alt });
      } catch {
        /* a malformed src is not an image */
      }
    }
  }
  return out;
}

/** Surnames and given names, so a filename or alt can be matched against them. */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/** The picked portrait, and why it was picked. */
export interface PickedPortrait {
  src: string;
  alt: string;
  why: string;
}

/**
 * A candidate is refused when the publisher's own alt text or filename calls
 * it furniture (`logo`, `banner`, `seal`, `masthead`, `wordmark`,
 * `letterhead`, `favicon`): an office banner can be named after the
 * officeholder. It can only remove a candidate, never add one.
 */
const FURNITURE =
  /\b(logos?|banners?|seals?|mastheads?|wordmarks?|letterheads?|favicons?|placeholders?|icons?|slides?|sliders?|heros?|headers?|footers?|sprites?|backgrounds?)\b/;

/**
 * The words in a filename, splitting on every separator a filename uses:
 * `\b` is not enough, since `_` is a word character (`Name_LOGOS.ai.png`).
 */
function words(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

/** Does the page's own alt text or filename call this furniture? */
export function looksLikeFurniture(img: PageImage): boolean {
  let src = img.src;
  try {
    src = decodeURIComponent(img.src);
  } catch {
    /* A malformed escape is not a reason to skip the check — test the raw. */
  }
  // Only the file's own name, not the directory path.
  const file = src.split(/[?#]/)[0].split("/").pop() ?? "";
  return FURNITURE.test(words(img.alt)) || FURNITURE.test(words(file));
}

/**
 * The name must be on the image, not on the site: the haystack is the alt
 * text and the filename, never the whole URL, because a campaign's domain
 * carries the candidate's name and would match every image on it.
 */
function imageHaystack(img: PageImage): string {
  let src = img.src;
  try {
    src = decodeURIComponent(img.src);
  } catch {
    /* keep the raw */
  }
  const file = src.split(/[?#]/)[0].split("/").pop() ?? "";
  return `${img.alt} ${file}`.toLowerCase();
}

/**
 * Every name-matching image on the page, in page order. A page often carries
 * several renditions of one person, and the first may be below
 * `MIN_PORTRAIT_EDGE`; a decoding caller walks this list.
 */
export function pickPortraits(name: string, all: readonly PageImage[]): PickedPortrait[] {
  const want = nameTokens(name);
  const surname = want[want.length - 1];
  const out: PickedPortrait[] = [];
  const seen = new Set<string>();
  for (const img of all) {
    if (looksLikeFurniture(img)) continue;
    const haystack = imageHaystack(img);
    const hits = want.filter((t) => haystack.includes(t));
    if (hits.length >= 2 || (surname && haystack.includes(surname) && /\.(jpe?g|png|webp)/i.test(img.src))) {
      if (seen.has(img.src)) continue;
      seen.add(img.src);
      out.push({ src: img.src, alt: img.alt, why: `name matched on ${hits.join(", ") || surname}` });
    }
  }
  return out;
}

/**
 * Pick the portrait: name-matched, or nothing. Two tokens matched, or the
 * surname matched on something that is plainly an image file (the extension
 * keeps it from matching a surname inside an unrelated URL path).
 */
export function pickPortrait(name: string, all: readonly PageImage[]): PickedPortrait | null {
  return pickPortraits(name, all)[0] ?? null;
}

/**
 * A US phone number on the page, in the shape these sites write. Narrow: a
 * loose digit run matches addresses, zip+4s, fees and meeting times.
 */
export function phoneIn(text: string): string | null {
  const m =
    /\(?\b(\d{3})\)?[\s.-]{1,2}(\d{3})[\s.-](\d{4})\b(\s*(?:x|ext\.?|extension)\s*\d{1,5})?/i.exec(text);
  if (!m) return null;
  const area = m[1];
  // 000 and 555 are not dialable area codes; a match on either is a template.
  if (area === "000" || area === "555") return null;
  return `${area}-${m[2]}-${m[3]}${m[4] ? ` ${m[4].trim()}` : ""}`;
}

/**
 * Is this URL actually an image? A name-matched `<img src>` can serve a
 * soft-404 HTML page with a 200. Both the content type and the magic bytes
 * must agree.
 */
export interface ImageVerdict {
  ok: boolean;
  status: number;
  bytes: number;
  contentType: string;
  why: string;
}

/** The first bytes of the formats a portrait may be in. */
function magicOf(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
  const riff = String.fromCharCode(...b.slice(0, 4));
  const webp = String.fromCharCode(...b.slice(8, 12));
  if (riff === "RIFF" && webp === "WEBP") return "webp";
  return null;
}

/** `&#038;` and friends, which a page's own markup puts inside a src. */
export function decodeEntities(url: string): string {
  return url
    .replace(/&#0?38;|&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"');
}

export async function verifyIsImage(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ImageVerdict> {
  let res: Response;
  try {
    res = await fetchImpl(decodeEntities(url), {
      headers: { "user-agent": sourceUserAgent(), accept: PORTRAIT_ACCEPT },
      redirect: "follow",
    });
  } catch (e) {
    return { ok: false, status: 0, bytes: 0, contentType: "", why: `request failed: ${(e as Error).message}` };
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    return { ok: false, status: res.status, bytes: 0, contentType, why: `HTTP ${res.status}` };
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const magic = magicOf(bytes);
  if (!magic) {
    return {
      ok: false,
      status: res.status,
      bytes: bytes.length,
      contentType,
      why:
        `HTTP 200 with ${bytes.length} B of ${contentType || "an unnamed type"} whose first bytes are ` +
        "no image format this reads. A 200 that is not the thing is not a document — most often a " +
        "soft 404 wearing an image's URL.",
    };
  }
  if (!/^image\//i.test(contentType)) {
    return {
      ok: false,
      status: res.status,
      bytes: bytes.length,
      contentType,
      why: `the bytes are a ${magic} and the server calls it ${contentType} — the two disagree, and a portrait is not shipped on a disagreement`,
    };
  }
  return {
    ok: true,
    status: res.status,
    bytes: bytes.length,
    contentType,
    why: `${bytes.length} B of ${magic}, served as ${contentType}`,
  };
}
