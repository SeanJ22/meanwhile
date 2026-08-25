/**
 * **A GENERAL WEB INDEX THIS PROJECT CAN ACTUALLY WALK.**
 * (The final pass, 2026-08-25.)
 *
 * ## What was believed, and what was measured
 *
 * NJ Hunt 4 recorded DuckDuckGo walling after six queries and Bing and Yahoo
 * after roughly 170, and ended by recommending a paid search API. RULING 83 was
 * adopted over that recommendation. The wall itself was real and correctly
 * measured — and it was measured on **three engines**, all of which front the
 * same two or three indexes.
 *
 * Re-walked 2026-08-25, which is what RULING 52 requires of any recorded wall:
 * *no branch result is permanent.*
 *
 * | Engine | Status | Bytes | Control differed | Verdict |
 * | --- | ---: | ---: | :---: | --- |
 * | `html.duckduckgo.com` | 202 | 14,201 | — | the challenge interstitial, constant across every query — the host talking about itself |
 * | `startpage.com` | 200 | 22,098 | **no** | byte-identical for a real query and for one that cannot exist. A JavaScript shell, and RULING 68 refuses it |
 * | `search.brave.com` | 200 | 181,173 | yes | answers, and names the person asked about |
 * | `www.mojeek.com` | 200 | 20,062 | yes | answers, names the person 19 times, and control returns 11,420 B |
 * | `ecosia.org` | 403 | 4,467 | — | refuses this client |
 *
 * **Mojeek runs its own crawler and its own index** — it is not a front end for
 * one of the majors, which is why it answers where three fronts of the same
 * index do not. That is RULING 52's tree in one line: a branch declares what it
 * goes *through*, and independence is counted over distinct dependencies rather
 * than over names.
 *
 * ## THE CONTROL IS MANDATORY AND IT IS WHAT DISQUALIFIED STARTPAGE
 *
 * A search engine answering 200 tells you nothing; three of the five above do.
 * The question is whether the body is ABOUT the thing asked for, and the only
 * way to know is to ask for something that cannot exist and require a different
 * answer (RULING 68). Startpage returned the same 22,098 bytes for
 * `"Nancy Verga" Morris Plains` and for `zzqxwvnonexistent99` — a shell that
 * would have produced a "no result" for every candidate on the ballot and read
 * as a walked route.
 *
 * ## A WALL IS A RECORDED MOVE, NOT A SKIPPED ONE
 *
 * These engines rate-limit, and the pool rotates rather than hammering: a
 * refusal moves to the next engine and is recorded with its status and its date.
 * Under RULING 144 a walled move still counts toward a protocol, carrying its
 * rung history — and the absence it helps build expires the day that wall falls,
 * which is exactly what happened to the wall this module was written over.
 */

/** One engine, and what it is a front for. */
export interface SearchEngine {
  id: string;
  /** Whose index this actually queries — independence is counted over these. */
  index: string;
  /** The literal URL for a query. */
  url: (query: string) => string;
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
    id: "mojeek",
    index: "Mojeek's own crawler",
    url: (q) => `https://www.mojeek.com/search?q=${encodeURIComponent(q)}`,
    refuses: (s) => s !== 200,
  },
  {
    id: "4get",
    index: "a 4get instance, which federates several independent crawlers",
    url: (q) => `https://4get.ca/web?s=${encodeURIComponent(q)}`,
    refuses: (s) => s !== 200,
  },
  {
    id: "brave",
    index: "Brave's own index",
    url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
    refuses: (s) => s !== 200,
  },
];

/**
 * Engines measured and REFUSED, kept here rather than deleted.
 *
 * A route that stops working keeps its id with a dated note (RULING 61), and a
 * route that never worked is worth as much: the next session that thinks of
 * Startpage can see it was tried, on what date, and why the answer was no.
 */
export const SEARCH_POOL_REFUSED: ReadonlyArray<{ id: string; measuredOn: string; why: string }> = [
  {
    id: "duckduckgo-html",
    measuredOn: "2026-08-25",
    why: "HTTP 202 with a constant ~14 KB challenge interstitial on every query — the host talking about itself. A check written against 4xx reads this as a search that found nothing.",
  },
  {
    id: "startpage",
    measuredOn: "2026-08-25",
    why: "HTTP 200, and byte-identical (22,098 B) for a real query and for an identifier that cannot exist. It fails the control query, so a 'no result' from it would be indistinguishable from a wall.",
  },
  {
    id: "ecosia",
    measuredOn: "2026-08-25",
    why: "HTTP 403 to this client.",
  },
];

/** The identifier used to ask an engine for something that cannot exist. */
export const SEARCH_CONTROL_QUERY = "zzqxwvnonexistent99 zzqxwvnonexistent98";

/**
 * **THE CONTROL FOR A SEARCH ENGINE IS CONTENT, NOT SIZE.**
 *
 * The site probe compares byte counts, because a host's answer for a page that
 * cannot exist is usually its 404 furniture and a real page is bigger. That
 * reasoning does not carry to a search engine: a results page and a no-results
 * page are the same template with a different middle, and the difference can be
 * under a percent. Measured 2026-08-25, `4get.ca` returned **7,228 B** for a
 * real query and **7,274 B** for one that cannot exist — the control page was
 * LARGER — while the real one named the subject eight times.
 *
 * So the control asks the question a control is actually for: does the engine's
 * answer contain the thing asked about, and does its answer for an identifier
 * that cannot exist NOT contain it? An engine serving a JavaScript shell fails
 * both halves, which is what disqualified Startpage and searx.be — each returned
 * byte-identical bodies naming nobody.
 *
 * The subject term is the SURNAME rather than the full name, because engines
 * break a quoted phrase across markup and a full-name test would report a miss
 * on a page that plainly names the person.
 */
export function namesSubject(body: string, controlBody: string, subject: string): boolean {
  const term = subject.toLowerCase();
  if (term.length < 3) return false;
  return body.toLowerCase().includes(term) && !controlBody.toLowerCase().includes(term);
}
