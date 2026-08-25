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

/** One image on a page, resolved against the page's own URL. */
export interface PageImage {
  src: string;
  alt: string;
}

/**
 * Every `<img>` on the page, with its `src` and `alt`.
 *
 * `data-src` is read as well as `src`, because a lazily-loaded portrait carries
 * a placeholder in `src` and the real file in `data-src` — and a reader with
 * JavaScript sees the second one.
 */
export function imagesIn(html: string, base: string): PageImage[] {
  const out: PageImage[] = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src =
      /\bsrc\s*=\s*"([^"]+)"/i.exec(tag)?.[1] ??
      /\bsrc\s*=\s*'([^']+)'/i.exec(tag)?.[1] ??
      /\bdata-src\s*=\s*"([^"]+)"/i.exec(tag)?.[1] ??
      null;
    if (src === null) continue;
    const alt =
      /\balt\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? /\balt\s*=\s*'([^']*)'/i.exec(tag)?.[1] ?? "";
    try {
      out.push({ src: new URL(src, base).toString(), alt });
    } catch {
      /* a malformed src is not an image */
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
