/**
 * WALKING A LEVEL AS A TREE, AND COUNTING IT.
 * (2026-08-26, the descent session. **RULING 169** — a walk is counted or it
 * did not happen.)
 *
 * The link extraction and the body detection live here rather than in the
 * script because they are the two things worth testing without a network: a
 * walk that mis-reads a page's links walks the wrong tree, and a walk that
 * cannot tell a governing body from a press release counts effort as coverage.
 *
 * **Body detection is deliberately RECALL-FIRST.** RULING 57 says a body is
 * NAMED FIRST and hunted second, and the cost of the two mistakes is not
 * symmetric: a false positive is a catalog row somebody reads and deletes, and
 * a false negative is a township water authority nobody ever hears of again.
 */

/** A link as the walk saw it — the href resolved, and the words a reader saw. */
export interface FoundLink {
  readonly url: string;
  readonly text: string;
}

/**
 * Every link in a page, absolute, de-duplicated, in document order.
 *
 * Regex rather than a DOM parse on purpose: this runs against pages served by a
 * dozen unrelated vendors, several of which emit HTML no strict parser accepts,
 * and a parser that throws on one page stops a walk that a regex would finish.
 * The failure mode is over-collection, which the caller then declines and
 * COUNTS — visible — rather than under-collection, which is silent.
 */
export function extractLinks(html: string, base: string): readonly FoundLink[] {
  const out: FoundLink[] = [];
  const seen = new Set<string>();
  const rx = /<a\b[^>]*?href\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(html)) !== null) {
    const raw = (m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (!raw) continue;
    if (/^(#|javascript:|mailto:|tel:|data:)/i.test(raw)) continue;
    let abs: string;
    try {
      abs = new URL(raw, base).toString();
    } catch {
      continue;
    }
    const clean = abs.split("#")[0];
    if (seen.has(clean)) continue;
    seen.add(clean);
    const text = m[5]
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim();
    out.push({ url: clean, text });
  }
  return out;
}

/**
 * Words that name a GOVERNMENT BODY rather than a page about one.
 *
 * RULING 57's twig list is the design brief here: the cemetery trustees, the
 * village district, the fire precinct and the transfer station advisory group
 * are the ones nobody else covers, so they are the ones this must catch.
 */
const BODY_WORDS = [
  "board",
  "commission",
  "committee",
  "council",
  "authority",
  "district",
  "trustees",
  "supervisors",
  "selectmen",
  "aldermen",
  "assembly",
  "legislature",
  "senate",
  "house of representatives",
  "court",
  "precinct",
  "department",
  "agency",
  "bureau",
  "division",
  "office of",
  "council of governments",
  "planning board",
  "zoning",
  "school board",
  "library",
  "fire district",
  "water district",
  "sanitary",
  "irrigation",
  "hospital district",
  "improvement district",
  "taxing district",
  "township",
  "borough",
  "village",
  "municipal",
  "county",
] as const;

/**
 * Words whose presence means this is a PAGE ABOUT a body, not the body.
 *
 * Without these the walk counts a news story mentioning the council as a
 * council. That is the RULING 100 partial pointed at discovery: some of a page
 * is about a body and the whole page is not one.
 */
const NOT_A_BODY = [
  "news",
  "press release",
  "privacy",
  "accessibility",
  "sitemap",
  "login",
  "sign in",
  "subscribe",
  "facebook",
  "twitter",
  "instagram",
  "youtube",
  "linkedin",
  "copyright",
  "disclaimer",
  "translate",
  "search results",
  "employment",
  "job openings",
  "pay online",
  "contact us",
  /*
   * ADDED 2026-08-26 after the first live New Jersey walk, and recorded here
   * rather than smoothed away: `njlm.org/Jobs.aspx` returned **154 candidate
   * bodies**, because a municipal job board lists one posting per municipality
   * and every posting carries the word "Township".
   *
   * Recall-first is the right default (RULING 57) and this is what paying for
   * it looks like. The calibration belongs in a list that can be argued with,
   * never in a session's head — and the walk reports CANDIDATES rather than
   * bodies precisely so a miscalibration reads as noise to sift instead of as
   * coverage this product does not have.
   */
  "jobs",
  "job posting",
  "careers",
  "apply now",
  "vacancy",
  "vacancies",
  "request for proposal",
  "rfp",
  "bid opening",
  "magazine",
  "webinar",
  "conference",
  "donate",
  "award",
  "scholarship",
] as const;

/**
 * Decode a URL for reading WITHOUT throwing.
 *
 * `decodeURIComponent` throws `URI malformed` on a stray `%` — and government
 * sites emit them constantly in query strings and legacy slugs. A walk that
 * died on one href would report every level after it as zero, which is a
 * broken walk wearing a clean number (RULING 159).
 */
function readable(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

export interface BodySignal {
  readonly isBody: boolean;
  /** Which word decided it, so a false positive is arguable rather than mysterious. */
  readonly basis: string;
}

export function looksLikeBody(link: FoundLink): BodySignal {
  const hay = `${link.text} ${readable(link.url)}`.toLowerCase();
  for (const bad of NOT_A_BODY) {
    if (hay.includes(bad)) return { isBody: false, basis: `excluded by "${bad}"` };
  }
  /* A bare word in a URL slug is weak evidence; a word in the LINK TEXT a
   * reader actually saw is what a person would go by. Text wins, and the URL
   * is only consulted when the text is too short to say anything. */
  const text = link.text.toLowerCase();
  for (const w of BODY_WORDS) {
    if (text.includes(w)) return { isBody: true, basis: `link text contains "${w}"` };
  }
  /*
   * THE SLUG FALLBACK READS THE PATH, NEVER THE HOST.
   * (Fixed 2026-08-26, found by reading the first NJ walk's output rather than
   * its count.)
   *
   * The first version matched against the whole URL, so on
   * `rockawaytownship.org` every short link text matched "township" **in the
   * hostname** — and a month view emits one link per day. **214 of that tier's
   * candidates were calendar day numbers**, sitting under a total that looked
   * like the descent working.
   *
   * That is RULING 100's partial in a detector: a count that reconciles is not
   * a count that is correct, and only opening the file could tell. The host
   * says which government's site this is, never which body a link names.
   *
   * A single digit is also not a name in any case, so the fallback now requires
   * two characters of something before it will speak at all.
   */
  if (text.length <= 3 && !/^\d+$/.test(text)) {
    let path: string;
    try {
      const u = new URL(link.url);
      path = readable(`${u.pathname}${u.search}`).toLowerCase();
    } catch {
      return { isBody: false, basis: "unparseable url and link text too short to judge" };
    }
    for (const w of BODY_WORDS) {
      if (path.includes(w)) return { isBody: true, basis: `url PATH contains "${w}" (link text too short to judge)` };
    }
  }
  return { isBody: false, basis: "no body word in link text" };
}

/**
 * Is this link worth following at all?
 *
 * Off-host links are followed only when the host is one the walk was already
 * given permission for — RULING 148 is enforced by the caller, and this is the
 * cheap filter in front of it so the permission check is not asked about every
 * asset on the page.
 */
export function isWalkable(url: string): { ok: boolean; reason: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "unparseable" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, reason: `protocol ${u.protocol} is not a web page` };
  }
  if (/\.(pdf|jpe?g|png|gif|svg|webp|ico|css|js|zip|docx?|xlsx?|pptx?|mp[34]|mov|woff2?|ttf|eot)$/i.test(u.pathname)) {
    return { ok: false, reason: "an asset, not a document this walk reads" };
  }
  return { ok: true, reason: "walkable" };
}

/**
 * Is this a GOVERNMENT publisher?
 *
 * The same test the official-source rule already uses — the `.gov` and `.mil`
 * TLDs and RFC 1480's `.us` locality space — because an association's
 * compilation and a body's own publication are different classifications
 * (RULING 87, RULING 166) and the catalog has to say which.
 */
export function isGovernmentHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.endsWith(".gov") || h.endsWith(".mil") || /\.[a-z]{2}\.us$/.test(h);
  } catch {
    return false;
  }
}

/**
 * Does the body confirm this is the document asked for?
 *
 * RULING 93: `nj.gov/nj/gov/county/` answers **HTTP 200 with a styled "Page not
 * found"**, which a status check alone reads as success. A control string is
 * mandatory on a directory route for exactly that reason.
 */
export function controlHolds(html: string, control: string): boolean {
  return html.toLowerCase().includes(control.toLowerCase());
}
