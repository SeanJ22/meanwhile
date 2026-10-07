/**
 * Template chrome is not what a candidate said. A press-release rail or a
 * "Read More" list would credit a candidate with issues by virtue of their
 * website software, an asymmetry the product would manufacture inside a live
 * contest. Three independent means are applied:
 *
 * 1. **Structural** — `stripChromeHtml` removes `nav`, `header`, `footer`,
 *    `aside` and anything a role or class marks as navigation, a related-links
 *    rail or an index.
 * 2. **Repetition** — `repeatedBlocks` finds text appearing on three or more
 *    held pages of the SAME site. With fewer pages held the test cannot run,
 *    and the caller must say so.
 * 3. **Passage shape** — `looksLikeChrome` asks whether a passage is a list
 *    rather than a sentence, for rails inside `<main>` with no marking.
 */

/* ─────────────────────────── 1. structural ──────────────────────────── */

/** Elements whose content is chrome by definition. */
const CHROME_TAGS = ["nav", "header", "footer", "aside"] as const;

/**
 * Roles and class/id fragments that mark a container as chrome: a readable
 * list; anything it misses is caught by `looksLikeChrome`.
 */
const CHROME_MARKERS = [
  "navigation",
  "banner",
  "contentinfo",
  "complementary",
  "nav",
  "navbar",
  "mainnav",
  "sidebar",
  "breadcrumb",
  "breadcrumbs",
  "pagination",
  "site-header",
  "site-footer",
  "skip-link",
  "skip-links",
  "social",
  "social-links",
  "share",
  "sharing",
  "related",
  "related-posts",
  "recent-posts",
  "post-list",
  "press-list",
  "news-list",
  "newsroom-list",
  "archive-list",
];

/**
 * Markers match WHOLE class tokens, never substrings: substring matching let
 * `menu` strip entire theme layouts. A token must EQUAL a marker or be a marker
 * followed by a separator (`nav__list`, `sidebar-primary`); `submenu` and
 * `widget-area` do not match.
 */
const MARKERS = new Set(CHROME_MARKERS);
function hasChromeMarker(openingTag: string): boolean {
  const attrs = openingTag.matchAll(/(class|id|role|data-region)\s*=\s*["']([^"']*)["']/gi);
  for (const [, , value] of attrs) {
    for (const token of value.split(/\s+/)) {
      const bare = token.toLowerCase();
      if (MARKERS.has(bare)) return true;
      for (const marker of MARKERS) {
        if (bare.startsWith(`${marker}-`) || bare.startsWith(`${marker}__`)) return true;
      }
    }
  }
  return false;
}

/**
 * Remove one element and its contents wherever the opening tag matches. A
 * depth-counting scanner, because nested tags defeat both lazy and greedy
 * regexes.
 */
function dropElement(html: string, tag: string, requireMarker: boolean): string {
  const open = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  let out = "";
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = open.exec(html)) !== null) {
    if (match.index < cursor) continue;
    if (requireMarker && !hasChromeMarker(match[0])) continue;
    // Self-closing or void usage: nothing to scan for.
    if (match[0].endsWith("/>")) continue;

    out += html.slice(cursor, match.index);
    let depth = 1;
    const scan = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    scan.lastIndex = open.lastIndex;
    let end = html.length;
    let step: RegExpExecArray | null;
    while ((step = scan.exec(html)) !== null) {
      depth += step[1] === "/" ? -1 : 1;
      if (depth === 0) {
        end = scan.lastIndex;
        break;
      }
    }
    // A space, so two words either side of a removed block do not fuse.
    out += " ";
    cursor = end;
    open.lastIndex = end;
  }
  return out + html.slice(cursor);
}

/**
 * The page with its template chrome removed. Scripts and styles go first
 * (their contents can confuse a tag scanner), then chrome tags, then any
 * `div`/`section`/`ul` carrying a chrome marker.
 */
export function stripChromeHtml(html: string): string {
  let out = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  for (const tag of CHROME_TAGS) out = dropElement(out, tag, false);
  for (const tag of ["div", "section", "ul", "ol"]) out = dropElement(out, tag, true);
  return out;
}

/* ─────────────────────────── 2. repetition ──────────────────────────── */

/** Normalized for comparison only — never for display. */
function fingerprint(block: string): string {
  return block.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Blocks appearing on `minPages` or more pages of the same site, as
 * fingerprints (so a block differing only in a date still matches). It reports
 * whether it could run: too few pages is an unrun test, not a zero result.
 */
export function repeatedBlocks(
  pageTexts: readonly string[],
  minPages = 3,
): { ran: boolean; fingerprints: Set<string> } {
  if (pageTexts.length < minPages) return { ran: false, fingerprints: new Set() };
  const counts = new Map<string, number>();
  for (const text of pageTexts) {
    const seenHere = new Set<string>();
    for (const block of text.split(/(?<=[.!?])\s+|\n+/)) {
      const key = fingerprint(block);
      if (key.length < 20) continue;
      if (seenHere.has(key)) continue;
      seenHere.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const fingerprints = new Set<string>();
  for (const [key, n] of counts) if (n >= minPages) fingerprints.add(key);
  return { ran: true, fingerprints };
}

/* ──────────────────── 3. the passage-level reading ──────────────────── */

/**
 * Signals that a passage is a LIST rather than a statement. Each is a fact
 * about shape, never about content.
 */
const RAIL_SIGNALS: { name: string; test: (p: string) => boolean }[] = [
  { name: "read-more rail", test: (p) => /\bread more\b/i.test(p) },
  {
    name: "press-release header",
    test: (p) => /\bfor immediate release\b/i.test(p),
  },
  {
    name: "press index",
    test: (p) => (p.match(/\bpress release\b/gi) ?? []).length >= 1 && /\d{4}/.test(p),
  },
  {
    name: "contact or signature block",
    test: (p) => /\bcontact:/i.test(p) || /[\w.+-]+@[\w-]+\.[\w.]{2,}/.test(p),
  },
  {
    name: "date list",
    test: (p) =>
      (
        p.match(
          /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}/gi,
        ) ?? []
      ).length >= 2,
  },
  {
    name: "menu run",
    test: (p) =>
      /\b(home|about|issues|news|events|volunteer|donate|contact|media|press)\b[^.!?]{0,40}\b(home|about|issues|news|events|volunteer|donate|contact|media|press)\b[^.!?]{0,40}\b(home|about|issues|news|events|volunteer|donate|contact|media|press)\b/i.test(
        p,
      ),
  },
];

/**
 * Whether this passage is template chrome rather than the subject's words.
 * Returns the signal that fired, so every exclusion is inspectable.
 */
export function chromeSignal(passage: string): string | null {
  for (const signal of RAIL_SIGNALS) {
    if (signal.test(passage)) return signal.name;
  }
  return null;
}

export function looksLikeChrome(passage: string): boolean {
  return chromeSignal(passage) !== null;
}

/* ─────────────────── 4. the shared truncation helper ────────────────── */

/**
 * No reader-facing quotation may begin or end mid-word. Both ends snap OUT to
 * the nearest whitespace, and the ellipsis sits outside the word with a space.
 */
export function excerptAround(
  text: string,
  at: number,
  matchLength: number,
  windowChars: number,
): string {
  const half = Math.floor(windowChars / 2);
  let start = Math.max(0, at - half);
  let end = Math.min(text.length, at + matchLength + half);

  // Grow OUT to a boundary. Growing rather than shrinking keeps the matched
  // phrase whole even when the window lands inside it.
  while (start > 0 && !/\s/.test(text[start - 1])) start -= 1;
  while (end < text.length && !/\s/.test(text[end])) end += 1;

  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  const lead = start > 0 ? "… " : "";
  const tail = end < text.length ? " …" : "";
  return `${lead}${body}${tail}`;
}

/**
 * Whether a rendered quotation begins or ends mid-word.
 *
 * The guard's own definition, exported so the test and the helper cannot
 * disagree about what "mid-word" means.
 */
export function breaksAWord(quote: string): boolean {
  const trimmed = quote.trim();
  // An ellipsis must be followed/preceded by whitespace before the word.
  if (/^[…]\S/.test(trimmed)) return true;
  if (/\S[…]$/.test(trimmed)) return true;
  return false;
}
