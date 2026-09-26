/**
 * **A GENERAL WEB INDEX THIS PROJECT MAY WALK.**
 * (The final pass, 2026-08-25.)
 *
 * ## ROBOTS.TXT IS RECORDED; AN ACCESS CONTROL IS WHAT KEEPS AN ENGINE OUT
 *
 * This module was first written with Mojeek and Brave in the pool, because both
 * answered and both passed a control query. Both carry `Disallow: /search` in
 * their `robots.txt`, and from 2026-08-25 that line alone kept them out.
 *
 * **Since the owner decision of 2026-09-25 it does not.** "Robots.txt alone must
 * not block acquisition." Each engine's robots reading is still recorded, and an
 * engine is excluded only for a reason that is not a robots line: an access
 * control on the query page (a CAPTCHA, a challenge, a 403, a 429 — never
 * solved, evaded or pushed through), or an answer that fails the control.
 * Re-measured 2026-09-25 through the research fetch: Mojeek now answers its
 * query path with a CAPTCHA page, and Brave with HTTP 429. Both stay out, as
 * WALLED, and a wall is re-measured on its cadence.
 *
 * ## What was measured, and on what date
 *
 * | Host | `robots.txt` on `/search` | Answered | Control differed | In the pool |
 * | --- | --- | :---: | :---: | :---: |
 * | `4get.ca` | `Disallow:` — empty, everything allowed | 200 | yes | **yes** |
 * | `www.mojeek.com` | **`Disallow: /search`** | 200 | yes | **no — disallowed** |
 * | `search.brave.com` | **`Disallow: /search`** | 200 | yes | **no — disallowed** |
 * | `html.duckduckgo.com` | `Allow: /` | 202 | — | no — a constant challenge page |
 * | `www.startpage.com` | `Disallow: /sp/` | 200 | **no** | no — disallowed, and a JS shell besides |
 * | `searx.be` | — | 200 | **no** | no — byte-identical for a real query and an impossible one |
 * | `www.ecosia.org` | `Disallow: /search` | 403 | — | no — disallowed |
 *
 * ## THE CONTROL IS CONTENT, NOT SIZE
 *
 * The site probe compares byte counts, because a host's answer for a page that
 * cannot exist is usually its 404 furniture. That reasoning does not carry to a
 * search engine: a results page and a no-results page are one template with a
 * different middle, and the difference can be under a percent. Measured
 * 2026-08-25, `4get.ca` returned **7,228 B** for a real query and **7,274 B**
 * for one that cannot exist — the control page was LARGER — while the real one
 * named the subject eight times. A 2% size tolerance would have thrown away the
 * only compliant index in the set.
 *
 * So the control asks what a control is for: does the answer contain the thing
 * asked about, and does the answer for an identifier that cannot exist not.
 *
 * ## A RATE LIMIT IS A WALL, AND IT IS A RECORDED MOVE
 *
 * Under RULING 144 a walled move still counts toward a stuck protocol, carrying
 * its rung history and its date — and the absence it helps build expires the day
 * that wall falls.
 */

/** One engine, and what it is a front for. */
export interface SearchEngine {
  id: string;
  /** Whose index this actually queries — independence is counted over these. */
  index: string;
  /** The literal URL for a query. */
  url: (query: string) => string;
  /** The `robots.txt` reading for the path this uses, quoted and dated. Recorded evidence, never a gate. */
  robots: string;
  /**
   * A status that means REFUSED rather than answered.
   *
   * DuckDuckGo's challenge is an HTTP **202**, not a 403, and a check written
   * against `>= 400` reads it as a successful search returning nothing.
   */
  refuses: (status: number) => boolean;
}

export const SEARCH_POOL: readonly SearchEngine[] = [
  {
    id: "4get",
    index: "a 4get instance, which federates several independent crawlers",
    url: (q) => `https://4get.ca/web?s=${encodeURIComponent(q)}`,
    robots: "`User-agent: *` / `Disallow:` — empty, so every path is permitted (read 2026-08-25)",
    refuses: (s) => s !== 200,
  },
];

/** Why a host is not in the pool. Never a robots.txt line alone (owner decision 2026-09-25). */
export type ExclusionKind =
  /** An access control answers the query (a CAPTCHA, a challenge, a 403, a 429), or something that is not a result set. Re-measured on its cadence; never bypassed. */
  | "WALLED"
  /** It answers, and its answer is indistinguishable from its answer to an impossible query. */
  | "FAILS_CONTROL";

/**
 * Engines measured and NOT in the pool, kept here rather than deleted.
 *
 * A route that stops working keeps its id with a dated note, so the next
 * session that thinks of Mojeek can see it was considered, on what date, and
 * what actually keeps it out. Each engine's robots.txt line is recorded in its
 * reason as evidence; it is never the reason.
 */
export const SEARCH_POOL_EXCLUDED: ReadonlyArray<{
  id: string;
  kind: ExclusionKind;
  measuredOn: string;
  why: string;
}> = [
  {
    id: "mojeek",
    kind: "WALLED",
    measuredOn: "2026-09-25",
    why: "An access control: re-measured 2026-09-25 through the research fetch, the query path `/search?q=` answered HTTP 200 with a CAPTCHA page (5,513 B, `<title>Captcha</title>`, \"JavaScript is required to complete this challenge\"), which is never solved or evaded. Its robots.txt `Disallow: /search` is recorded and is not the reason (owner decision 2026-09-25). On 2026-08-25 it had answered a real result page.",
  },
  {
    id: "brave",
    kind: "WALLED",
    measuredOn: "2026-09-25",
    why: "An access control: re-measured 2026-09-25 through the research fetch, `search.brave.com/search?q=` answered HTTP 429 (73,966 B) — a rate limit, honoured and never pushed through. Its robots.txt `Disallow: /search` is recorded and is not the reason. The same index reaches the project through the paid Brave API, under Admin's spending controls and the paid-research pause.",
  },
  {
    id: "ecosia",
    kind: "WALLED",
    measuredOn: "2026-08-25",
    why: "An access control: it answered HTTP 403 to this client (2026-08-25). Its robots.txt `Disallow: /search` is recorded and is not the reason.",
  },
  {
    id: "startpage",
    kind: "FAILS_CONTROL",
    measuredOn: "2026-08-25",
    why: "It returned BYTE-IDENTICAL bodies (22,098 B) for a real query and for an identifier that cannot exist — a JavaScript shell — so it fails the control. Its robots.txt `Disallow: /sp/` is recorded and is not the reason.",
  },
  {
    id: "searx-be",
    kind: "FAILS_CONTROL",
    measuredOn: "2026-08-25",
    why: "HTTP 200 with byte-identical bodies (11,354 B) for a real query and for one that cannot exist, naming nobody. A 'no result' from it would be indistinguishable from a wall.",
  },
  {
    id: "duckduckgo-html",
    kind: "WALLED",
    measuredOn: "2026-08-25",
    why: "`Allow: /`, so it is permitted — and it answers HTTP **202** with a constant ~14 KB challenge interstitial on every query, which is the host talking about itself. A check written against 4xx reads this as a search that found nothing.",
  },
];

/** The identifier used to ask an engine for something that cannot exist. */
export const SEARCH_CONTROL_QUERY = "zzqxwvnonexistent99 zzqxwvnonexistent98";

/**
 * THE ECHO STRIPPER, AND IT IS THE WHOLE OF WHY THE CONTROL WAS UNSOUND.
 * (2026-08-26, the sources-and-incumbency session.)
 *
 * **A search page repeats the query back at you before it has found anything.**
 * `4get.ca` puts it in the `<title>`, in the `<meta name="description">`, in the
 * search box's `value=`, and in six tab links (`/web?s=`, `/images?s=`,
 * `/videos?s=`, `/news?s=`, `/music?s=`, `/scraper?s=`). Ask it for
 * *Karen Ebel New Hampshire* and the word **Ebel appears eight times in a page
 * with zero results in it**, measured 2026-08-26.
 *
 * That is exactly what `docs/sources.md` recorded on 2026-08-25 as *"HTTP 200,
 * 7,228 B naming the subject 8 times, against a 7,274 B control"* and read as
 * the one compliant general index working. **It was eight echoes.** The control
 * was RULING 110's wrong-form search living inside the instrument built to
 * prevent wrong-form searches: it asked whether the letters appear, not whether
 * the page is ABOUT the subject.
 *
 * So the query's own echo is removed before the question is asked. What is left
 * is body text and result links, and a subject named THERE is a result.
 */
export function stripQueryEcho(body: string, subject: string): string {
  let out = body;
  // The document's own metadata about the query.
  out = out.replace(/<title[^>]*>[\s\S]*?<\/title>/gi, " ");
  out = out.replace(/<meta[^>]+name=["']description["'][^>]*>/gi, " ");
  out = out.replace(/<meta[^>]+property=["']og:[^"']*["'][^>]*>/gi, " ");
  // Any attribute value carrying the query — the input box, the tab links, the
  // autocomplete, and whatever else an interface echoes it into.
  const term = subject.trim();
  if (term.length > 0) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const plussed = escaped.replace(/\s+/g, "[+%20\\s]+");
    out = out.replace(new RegExp(`[a-zA-Z-]+=["'][^"']*${plussed}[^"']*["']`, "gi"), " ");
  }
  return out;
}

/**
 * Does the engine's answer name the subject, where its answer to an impossible
 * query does not?
 *
 * The subject term is the SURNAME rather than the full name, because engines
 * break a quoted phrase across markup and a full-name test would report a miss
 * on a page that plainly names the person.
 *
 * **The query's own echo is stripped first** — see `stripQueryEcho`. Without
 * that, every engine "names" every subject on every query, forever, including
 * on a page with nothing in it.
 */
export function namesSubject(body: string, controlBody: string, subject: string, query?: string): boolean {
  const term = subject.toLowerCase();
  if (term.length < 3) return false;
  const cleaned = stripQueryEcho(body, query ?? subject).toLowerCase();
  return cleaned.includes(term) && !controlBody.toLowerCase().includes(term);
}
