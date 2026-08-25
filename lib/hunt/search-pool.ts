/**
 * **A GENERAL WEB INDEX THIS PROJECT MAY WALK.**
 * (The final pass, 2026-08-25.)
 *
 * ## THE FIRST QUESTION IS PERMISSION, NOT REACHABILITY
 *
 * This module was first written with Mojeek and Brave in the pool, because both
 * answered and both passed a control query. **Both carry `Disallow: /search` in
 * their `robots.txt`, and `/search` is exactly the path a query goes to.** They
 * were removed the same session, and the reason is recorded rather than the
 * removal being quietly made.
 *
 * `CLAUDE.md` names four limits on an otherwise unrestricted mandate, and one of
 * them is that an access control is never circumvented. RULING 52 says the same
 * thing in the tree's vocabulary: *a `robots.txt` disallow gets a COMPLIANT
 * ROUTE to the same information.* And the 2026-08-24 session had already
 * recorded both hosts in `docs/sources.md` as **not walked at any rung** for
 * precisely this reason — the record was right and a later session walked them
 * anyway.
 *
 * **A HOST THAT DISALLOWS IS NOT A WALL, AND THE TWO MUST NEVER BE RECORDED
 * ALIKE.** A wall is a host refusing us; a disallow is a host telling us not to
 * ask. A wall expires and is re-walked on its cadence (RULING 53). A disallow is
 * honoured until the host changes it, and re-testing it on a clock would be
 * asking the same question after being told no.
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
  /** The `robots.txt` line that permits the path this uses, quoted. */
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

/** Why a host is not in the pool. The two reasons are not the same reason. */
export type ExclusionKind =
  /** Its `robots.txt` disallows the path a query uses. Honoured, never retested on a clock. */
  | "DISALLOWED"
  /** It refuses us, or answers with something that is not a result set. Expires under RULING 53. */
  | "WALLED"
  /** It answers, and its answer is indistinguishable from its answer to an impossible query. */
  | "FAILS_CONTROL";

/**
 * Engines measured and NOT in the pool, kept here rather than deleted.
 *
 * A route that stops working keeps its id with a dated note (RULING 61), and a
 * route that was never permitted is worth as much: the next session that thinks
 * of Mojeek can see it was considered, on what date, and that the answer was a
 * `Disallow` rather than a wall — which is a decision, not an obstacle.
 */
export const SEARCH_POOL_EXCLUDED: ReadonlyArray<{
  id: string;
  kind: ExclusionKind;
  measuredOn: string;
  why: string;
}> = [
  {
    id: "mojeek",
    kind: "DISALLOWED",
    measuredOn: "2026-08-25",
    why: "`https://www.mojeek.com/robots.txt` carries `User-agent: *` / `Disallow: /search`, and `/search` is the query path. It ANSWERS — 200, naming the subject 44 times, control 11,420 B — which is exactly why the record has to say DISALLOWED rather than walled: the host is not refusing us, it is telling us not to ask, and those get opposite treatment.",
  },
  {
    id: "brave",
    kind: "DISALLOWED",
    measuredOn: "2026-08-25",
    why: "`https://search.brave.com/robots.txt` allows `/search?conversation=` and then `Disallow: /search`. A plain web query is the disallowed form.",
  },
  {
    id: "ecosia",
    kind: "DISALLOWED",
    measuredOn: "2026-08-25",
    why: "`Disallow: /search`, and it answered 403 to this client besides. Either alone is sufficient.",
  },
  {
    id: "startpage",
    kind: "DISALLOWED",
    measuredOn: "2026-08-25",
    why: "`Disallow: /sp/`, which is the query path. It also returned BYTE-IDENTICAL bodies (22,098 B) for a real query and for an identifier that cannot exist — a JavaScript shell — so it would have failed the control too.",
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
 * Does the engine's answer name the subject, where its answer to an impossible
 * query does not?
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
