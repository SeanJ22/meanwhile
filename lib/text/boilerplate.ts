/**
 * **Template chrome is not what a candidate said.** (F01-continued item 11,
 * 2026-08-19 — the author's RULING 9 and RULING 10.)
 *
 * ## What went wrong
 *
 * Analilia Mejia's card credited her with "health care and prescription
 * costs" on the strength of this:
 *
 * > …ess Release For Immediate Release: August 6, 2026 Contact: Beth
 * > Wiesinger | NJ11AMPress@Mail.House.Gov Read More Rep. Mejia and Rep.
 * > Dingell Sound Alarm on GOP Medicaid Cuts Threatening Healthcare Access
 * > For Millions August 4, 2026 Press Release For Immediate Release: August
 * > 4, 2026 Contact: Beth Wiesinger | NJ11AMPress@Mail.H…
 *
 * That is a press-release index rail at the foot of a page — a list of links
 * — and it also begins mid-word.
 *
 * ## Why it is a neutrality defect and not a formatting one
 *
 * A candidate whose site carries a "Read More" rail gets credited with issues
 * they never addressed, while a candidate on a simpler site shows "mentions 0
 * of them". That is an information asymmetry **the product manufactures
 * itself**, inside a live contest, and it is exactly what the equal-effort
 * rule exists to catch: no change may leave one candidate better rendered
 * than another because of what their website's software happens to be.
 *
 * It also degrades the thing being sold. An issue-mention signal that is
 * partly reading CMS templates is measuring website software alongside
 * candidate speech.
 *
 * ## Two independent means, and both are applied
 *
 * 1. **Structural** — `stripChromeHtml` removes `nav`, `header`, `footer`,
 *    `aside` and anything a role or class marks as navigation, a related-links
 *    rail or an index. Runs on every site regardless of how many pages of it
 *    are held.
 * 2. **Repetition** — `repeatedBlocks` finds text appearing on three or more
 *    held pages of the SAME site. Where fewer than three pages of a site are
 *    held the test cannot run, and the caller must say how many sites that
 *    was rather than letting structural exclusion quietly stand alone.
 *
 * And a third that is neither, because both of the above can be defeated by a
 * rail that lives inside `<main>` with no marking at all: `looksLikeChrome`
 * reads the PASSAGE and asks whether it is a list rather than a sentence.
 */

/* ─────────────────────────── 1. structural ──────────────────────────── */

/** Elements whose content is chrome by definition. */
const CHROME_TAGS = ["nav", "header", "footer", "aside"] as const;

/**
 * Roles and class/id fragments that mark a container as chrome.
 *
 * Deliberately a list rather than a cleverness: a reviewer can read it and
 * say whether it is right, and anything it misses is caught by
 * `looksLikeChrome` at the passage level rather than by a heuristic nobody
 * can audit.
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
 * **Markers match WHOLE class tokens, never substrings** — and the reason is a
 * measurement, not a preference.
 *
 * The first version matched anywhere inside the attribute, so `menu` hit 263
 * containers on `azleg.gov` (a WordPress theme whose entire layout is built
 * from `*menu*` classes) and `widget` hit 33. The page went from 7,652
 * extracted characters to 25 — the strip eating the document instead of its
 * chrome, which is the SAME asymmetry as under-stripping wearing the other
 * face: a candidate whose site happens to use those class names would render
 * as having said nothing.
 *
 * So: the attribute is split into tokens and a token must EQUAL a marker, or
 * be a marker followed by a separator (`nav__list`, `sidebar-primary`). A
 * token that merely CONTAINS one (`submenu`, `widget-area`) does not match.
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
 * Remove one element and its contents wherever the opening tag matches.
 *
 * Written as a scanner rather than a regex because nesting is real — a
 * `<footer>` inside a `<footer>` closes the wrong one under a lazy match, and
 * a greedy one eats the rest of the page. It counts depth.
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
 * The page with its template chrome removed.
 *
 * Order matters: scripts and styles first (their contents can contain markup
 * that confuses a tag scanner), then the chrome tags, then any `div`/`section`/
 * `ul` carrying a chrome marker.
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
 * Blocks appearing on `minPages` or more pages of the same site.
 *
 * Returns fingerprints, not the original text: the caller matches candidate
 * passages against these, and matching on the display form would miss a block
 * that differs only in a date or a punctuation mark.
 *
 * **It reports whether it could run.** With fewer than `minPages` pages held,
 * the test is not a zero result — it is an unrun test, and a caller that
 * cannot tell those apart will report structural exclusion as though both had
 * been applied.
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
 * Signals that a passage is a LIST rather than a statement.
 *
 * Each is a fact about shape, never about content: a press index repeats
 * "Read More", a release header repeats "For Immediate Release", a contact bar
 * carries an email address and a name and nothing else, and a rail carries
 * several dates in a row. None of them is an opinion about what the candidate
 * believes.
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
 *
 * Returns the SIGNAL that fired, so a sweep can report what it excluded and
 * why rather than a bare count — an exclusion nobody can inspect is a filter
 * that silently decides what a candidate said.
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
 * **RULING 10: no reader-facing quotation may begin or end mid-word.**
 *
 * The defect was `haystack.slice(at - 160, at + 160)`, which cuts wherever the
 * arithmetic lands — "Press Release" became "…ess Release". The ellipsis also
 * sat flush against the fragment, so the mark and the mutilation arrived
 * together and neither explained the other.
 *
 * This snaps both ends OUT to the nearest whitespace, so a quote can only ever
 * grow to a word boundary and never shrink into one, and puts the ellipsis
 * outside the word with a space.
 *
 * Fixed HERE rather than at the call site, deliberately: a truncation rule
 * enforced by each caller remembering it is a rule that holds until the next
 * caller.
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
