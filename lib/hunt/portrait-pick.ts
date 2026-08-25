/**
 * **PICKING A PORTRAIT OFF A PAGE — one implementation, every hunt.**
 *
 * Lifted out of `scripts/hunt-morris-portraits-0823.mts` on 2026-08-25, where it
 * had worked correctly for the seven Morris County commissioners and was about
 * to be copied into a second hunt. RULING 103: a class sweep covers duplicated
 * IMPLEMENTATIONS, not only named instances, and the cheapest way to have no
 * duplicate is to move the original rather than write a second.
 *
 * ## WHY THE MATCH IS ON THE NAME AND NOTHING ELSE
 *
 * A page furniture image — a county seal, a Granicus badge, a banner, a
 * department header — is exactly what a "largest image" or "first image"
 * heuristic picks, and **a wrong face is the one failure the photo rule says
 * fails at every door.** So a candidate image must carry the person's own name
 * in its alt text or its filename, and where none does this reports nothing
 * rather than offering the best of a bad set.
 *
 * ## AND NEVER `og:image`
 *
 * The 2026-08-24 session measured it: **7 of 7 `og:image` reads on candidate
 * sites returned a share card** — a banner with a slogan across it, sometimes a
 * group shot, occasionally a logo. Every one would have failed the composition
 * standard, and none of them is a portrait. This reads `<img>` elements on the
 * page, which is where a portrait actually is.
 */

import { sourceUserAgent } from "../sources/http.ts";

/** One image on a page, resolved against the page's own URL. */
export interface PageImage {
  src: string;
  alt: string;
}

/**
 * Every `<img>` on the page, with its `src` and `alt`.
 *
 * ## BOTH `data-src` AND `src`, AND `data-src` FIRST
 *
 * This read `src` and fell back to `data-src` only when `src` was absent. A
 * lazily-loaded image has **both**: a placeholder in `src` and the real file in
 * `data-src`. So the placeholder won, the real portrait was never offered to the
 * picker, and the page read as carrying no image of the person — an absence
 * manufactured by our own reader.
 *
 * A reader with JavaScript sees the `data-src` file, so that is the one this
 * project is looking at. Both are emitted, `data-src` first, because a page may
 * lazily load the furniture and eagerly load the portrait as easily as the
 * reverse and the picker decides on the NAME rather than on the order.
 *
 * `srcset` is read too, at its first candidate: a responsive portrait often
 * carries no plain `src` worth having.
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
 * Pick the portrait. Name-matched, or nothing.
 *
 * Two tokens matched, or the surname matched on something that is plainly an
 * image file. The second clause exists because a page often writes only
 * `selen.jpg` and calling that a miss would lose a real portrait; the file
 * extension is what stops it matching a surname inside an unrelated URL path.
 */
export function pickPortrait(name: string, all: readonly PageImage[]): PickedPortrait | null {
  const want = nameTokens(name);
  const surname = want[want.length - 1];
  for (const img of all) {
    const haystack = `${img.alt} ${decodeURIComponent(img.src)}`.toLowerCase();
    const hits = want.filter((t) => haystack.includes(t));
    if (hits.length >= 2 || (surname && haystack.includes(surname) && /\.(jpe?g|png|webp)/i.test(img.src))) {
      return { src: img.src, alt: img.alt, why: `name matched on ${hits.join(", ") || surname}` };
    }
  }
  return null;
}

/**
 * A US phone number on the page, in the shape these sites actually write.
 *
 * Deliberately narrow. A loose digit run matches a street address, a zip+4, a
 * fee schedule and a meeting time, and a wrong phone number on a named person's
 * card sends a reader to a stranger.
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
 * **IS THIS URL ACTUALLY AN IMAGE?**
 *
 * The picker above finds a name-matched `<img src>` in a page's markup. That is
 * a claim about the MARKUP and not about what the URL serves, and the two came
 * apart the first time this ran at scale.
 *
 * Measured 2026-08-25 on the door-2 walk: `chesterborough.org//images/2022/08/08/
 * russell-goodwin.jpeg` — note the double slash, which the page's own template
 * emitted — answers **HTTP 200 with `text/html` and 12,119 bytes.** It is the
 * site's soft-404 page wearing an image's URL. Two portraits were queued for the
 * author's review that way, and the ONLY reason it was caught is that RULING 2
 * made somebody open the review sheet as an image and see two broken tiles.
 *
 * A 200 that is not the thing is not a document, and a soft-404 offered as a
 * named person's face is the wrong-face failure in a different costume.
 *
 * **The content type is checked AND the bytes are.** A server can label anything
 * anything; the magic numbers are what the file is. Both must agree, because a
 * JPEG served as `text/html` and an HTML page served as `image/jpeg` are both
 * things that happen and neither is a portrait this product can use.
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
      headers: { "user-agent": sourceUserAgent() },
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
