/**
 * **THE CONTROL QUERY — RULING 68, made shared.**
 * (Built in `scripts/ad-library.mts` on 2026-08-22; extracted here the same
 * day, NJ Hunt 2 item 3.)
 *
 * ## What it is for
 *
 * Ask a host for something that CANNOT EXIST, and keep the answer. Any real
 * response indistinguishable from that answer is the host talking about itself,
 * not about the thing asked for.
 *
 * The measurement that forced this:
 *
 *   bsky.app/profile/janebradstreet.bsky.social ....... 200, 5,989 bytes
 *   bsky.app/profile/zzqxwvnonexistent99.bsky.social .. 200, 5,989 bytes
 *   instagram.com/janebradstreet/ .................... 200, 615,870 bytes
 *   instagram.com/zzqxwvnonexistent99/ ............... 200, 615,886 bytes
 *   concordmonitor.com/?s=Bradstreet ................. 200, 195,196 bytes
 *   concordmonitor.com/?s=Zzqxwvnonexistent .......... 200, 195,170 bytes
 *
 * Three hosts, three shapes of one lie — an SPA shell, a login wall, and a
 * no-results page that echoes the query into its own HTML so a substring test
 * for the surname passes. All three answer 200. Without a control, one session
 * reported `HIT` on **16 of 16 people** for two routes, which is not a discovery
 * — a 100% hit rate on guessed identifiers across sixteen different people is a
 * measurement of the instrument. Thirty-two fabricated findings, caught by one
 * command.
 *
 * ## Why it lives here rather than in the tool that found it
 *
 * `CLAUDE.md`: a named instance is an example of a class-wide defect, fixed at
 * the SHARED CODE PATH. The shape has now been recorded seven times in this
 * repo — an empty RSS feed read as working, a zero-match join read as a clean
 * build, a scripted edit that edited nothing and exited 0, a portal answering
 * 200 with zero meetings, an Apptegy page missing the byline it was fetched
 * for, a state roster SPA serving one shell for every member, and these three.
 * Leaving the remedy inside the one script that happened to discover it
 * guarantees the eighth.
 *
 * ## What it does NOT claim
 *
 * A response that clears the control is DISTINGUISHABLE from the host's
 * boilerplate. That is all. It is not evidence that the page belongs to the
 * person whose identifier was guessed — see `HIT` versus `LEAD` below, which is
 * a separate and stricter question.
 */

/** An identifier no host can hold. Deliberately unpronounceable and unique. */
export const CONTROL_IDENTIFIER = "zzqxwvnonexistent99";

/**
 * How close to the control a response may sit and still be called different.
 *
 * 2%. Instagram's login wall varied by 16 bytes in 615 KB between two requests
 * seconds apart, so an exact-equality test would have called it a find.
 */
export const SHELL_TOLERANCE = 0.02;

export type ProbeOutcome =
  /** A real answer, distinguishable from the host's boilerplate. */
  | "HIT"
  /**
   * A page exists at a GUESSED identifier and whose it is has not been
   * established. Work for a human. It is never counted as a find, and it never
   * moves a field toward exhaustion — sixteen of these reported as HIT is what
   * RULING 68 was adopted over.
   */
  | "LEAD"
  /** The host answered, and said nothing this query did not already contain. */
  | "EMPTY"
  /**
   * A wall, a missing credential, a rate limit. NEVER an absence: no field may
   * move toward `VERIFIED_ABSENT` on a route we were not allowed to walk.
   */
  | "REFUSED";

export interface ProbeResponse {
  status: number;
  /** The response body's length in bytes. */
  length: number;
}

export type Fetcher = (url: string) => Promise<ProbeResponse>;

/**
 * A control-query probe against one host family.
 *
 * `make` takes an identifier and returns the URL to ask for it. The SAME
 * function is used for the control and for the real query, which is what makes
 * the comparison valid — a control fetched from a different path measures a
 * different page.
 */
export class ControlledProbe {
  /*
   * Fields declared and assigned explicitly rather than as constructor
   * parameter properties: this repo's tests run under Node's type-STRIPPING
   * loader, which does not transform syntax, and a parameter property is
   * syntax. It fails at module load, so the guard for a module written that way
   * never runs at all — which is the shape RULING 62 exists to catch.
   */
  private readonly cache = new Map<string, number>();
  private readonly fetcher: Fetcher;
  private readonly control: string;

  constructor(fetcher: Fetcher, control: string = CONTROL_IDENTIFIER) {
    this.fetcher = fetcher;
    this.control = control;
  }

  /** The host's own answer for a name that cannot exist. `-1` when it refuses. */
  async controlSize(make: (identifier: string) => string): Promise<number> {
    const url = make(this.control);
    const key = new URL(url).hostname;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const r = await this.fetcher(url);
    const size = r.status === 200 ? r.length : -1;
    this.cache.set(key, size);
    return size;
  }

  /**
   * Ask for a real identifier, having first asked for one that cannot exist.
   *
   * `guessed` decides the ceiling on the answer, and it is the whole of RULING
   * 68's second half: where the identifier was GUESSED rather than confirmed
   * from a source, the best available outcome is `LEAD`. A page at a guessed
   * handle is a page; whose it is remains unestablished, and calling it a HIT
   * puts an unverified identity next to a real person's name.
   */
  async probe(
    make: (identifier: string) => string,
    identifier: string,
    opts: { guessed: boolean },
  ): Promise<{ outcome: ProbeOutcome; url: string; control: number; detail: string; length: number }> {
    const control = await this.controlSize(make);
    const url = make(identifier);
    const r = await this.fetcher(url);
    if (r.status === 0 || r.status === 403 || r.status === 429 || r.status >= 500) {
      return {
        outcome: "REFUSED",
        url,
        control,
        length: r.length,
        detail: `${url} refused (${r.status || "network"}) — a wall, never an absence`,
      };
    }
    if (r.status !== 200) {
      return {
        outcome: "EMPTY",
        url,
        control,
        length: r.length,
        detail: `${url} answered HTTP ${r.status}`,
      };
    }
    if (!beyondControl(r.length, control)) {
      return {
        outcome: "EMPTY",
        url,
        control,
        length: r.length,
        detail:
          `${url} answered 200 with ${r.length} B, indistinguishable from this host's own answer for a name ` +
          `that cannot exist (${control} B). That is the host talking about itself.`,
      };
    }
    return {
      outcome: opts.guessed ? "LEAD" : "HIT",
      url,
      control,
      length: r.length,
      detail:
        `${url} answered 200 with ${r.length} B against a ${control} B control` +
        (opts.guessed
          ? " — a page exists at a GUESSED identifier and whose it is has NOT been established"
          : ""),
    };
  }
}

/**
 * Is this response distinguishable from the host's answer for a name that
 * cannot exist?
 *
 * A control that did not answer 200 is recorded as `-1`, and in that case any
 * 200 IS a real difference — the host answers for real names and not for
 * invented ones, which is the behaviour a control is looking for.
 */
export function beyondControl(size: number, control: number): boolean {
  if (control < 0) return true;
  return Math.abs(size - control) > control * SHELL_TOLERANCE;
}

/**
 * Does a search response merely ECHO the query back?
 *
 * The third shape, and the one a byte comparison alone can miss: a no-results
 * page that prints "no results for Bradstreet" contains the surname, so a
 * substring test passes on a page that says the opposite of what the test
 * concluded. A hit must appear somewhere other than in the echo of the query.
 *
 * Returns true when EVERY occurrence of the term sits inside a phrase that
 * reads as the site restating the question or reporting nothing found.
 */
export function isQueryEcho(body: string, term: string): boolean {
  if (!term) return false;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(escaped, "i").test(body)) return false;

  /*
   * The echo is REMOVED and the body asked again, rather than each occurrence
   * being judged by what sits near it.
   *
   * A proximity window cannot do this job: on a real results page the heading
   * "Search results for Bradstreet" is a couple of dozen characters from the
   * first genuine headline, so any window wide enough to catch the echo also
   * catches the article — and the test then calls a page full of coverage an
   * empty one. Cutting the echo out and asking whether the term SURVIVES is
   * exact, and it degrades the right way: an echo phrase this list does not
   * know simply leaves the term in place and the page reads as a real hit,
   * which is the safe direction for a check that decides whether we found
   * something about a named person.
   */
  const ECHO_PHRASES = [
    "no (?:results|posts|matches|articles|stories|items)(?: found)?(?: for)?",
    "nothing (?:found|matched)",
    "0 results",
    "did not match",
    "search results for",
    "you searched for",
    "showing results for",
    "results for",
    "sorry,?",
  ];
  const stripped = body.replace(
    new RegExp(`(?:${ECHO_PHRASES.join("|")})\\s*[:\\-–]?\\s*[""']?${escaped}[""']?`, "gi"),
    " ",
  );
  return !new RegExp(escaped, "i").test(stripped);
}
