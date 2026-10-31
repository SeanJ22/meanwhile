/**
 * Picking a portrait off a page. A candidate image must carry the person's
 * own name in its alt text or filename; otherwise this reports nothing, since
 * page furniture (a seal, a badge, a banner) is what a "largest" or "first"
 * image heuristic picks. `og:image` is never used: on candidate sites it is
 * a share card, not a portrait.
 */

/** One image on a page, resolved against the page's own URL. */
export interface PageImage {
  src: string;
  alt: string;
}

/**
 * Every `<img>` on the page, with its `src` and `alt`. A lazily loaded image
 * has a placeholder in `src` and the real file in `data-src`, so both are
 * emitted, `data-src` first; the picker decides on the name, not the order.
 * Every published `srcset` rendition is read too: an original can exceed the
 * decoder's byte or pixel limit while a smaller rendition is a usable portrait.
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
    const renditions = srcsetUrls(attr("srcset") ?? "");
    for (const src of [attr("data-src"), attr("data-lazy-src"), attr("src"), ...renditions]) {
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

/** A comma inside a URL (WordPress's `?resize=499,600`) is not a separator. */
function srcsetUrls(srcset: string): string[] {
  const urls: string[] = [];
  let rest = srcset.trim();
  while (rest) {
    rest = rest.replace(/^[\s,]+/, "");
    const url = /^\S+/.exec(rest)?.[0];
    if (!url) break;
    urls.push(url.replace(/,+$/, ""));
    rest = rest.slice(url.length);
    if (!url.endsWith(",")) {
      const separator = rest.indexOf(",");
      rest = separator < 0 ? "" : rest.slice(separator + 1);
    }
  }
  return urls;
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
  return splitCaseBoundaries(s).toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function splitCaseBoundaries(value: string): string {
  return value.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2");
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
  return `${img.alt} ${file}`;
}

/**
 * Every name-matching image on the page, in page order. A page often carries
 * several renditions of one person, and the first may be below
 * `MIN_PORTRAIT_EDGE`; a decoding caller walks this list.
 */
export function pickPortraits(name: string, all: readonly PageImage[]): PickedPortrait[] {
  const normalized = (value: string) => splitCaseBoundaries(value.normalize("NFKC"))
    .toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const want = normalized(name);
  if (!want) return [];
  const out: PickedPortrait[] = [];
  const seen = new Set<string>();
  for (const img of all) {
    if (looksLikeFurniture(img)) continue;
    const haystack = imageHaystack(img);
    if (` ${normalized(haystack)} `.includes(` ${want} `)) {
      if (seen.has(img.src)) continue;
      seen.add(img.src);
      out.push({ src: img.src, alt: img.alt, why: "Publisher labels this image with the full source name" });
    }
  }
  return out;
}

