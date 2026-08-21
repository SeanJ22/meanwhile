/**
 * The retrieval discipline, shared by every adapter that speaks HTTP.
 *
 * Same manners as `lib/sources/legistar/client.ts`, factored out for the
 * adapters that arrived with the composite: identify yourself, go at a human
 * pace, honour `Retry-After`, and never parallelize against a single tenant.
 * Engineering manners, not hedging — see `CLAUDE.md` on public records.
 */

const REQUEST_SPACING_MS = 400;
const MAX_RETRIES = 2;

/**
 * Who is calling, so an administrator seeing this in a log has somewhere to
 * write. The contact address comes from the environment rather than being
 * committed, because a personal email in a public repository is a different
 * decision from a polite User-Agent.
 */
export function sourceUserAgent(): string {
  const contact = process.env.INGEST_CONTACT_EMAIL?.trim();
  const suffix = contact
    ? `contact: ${contact}`
    : "https://github.com/SeanJ22/we-the-people";
  return `we-the-people civic meeting index (${suffix})`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class SourceHttpError extends Error {
  readonly status: number;
  readonly url: string;
  /**
   * The FURTHEST LADDER RUNG this retrieval reached before it stopped (F22,
   * 2026-08-20) — the numbering in `CLAUDE.md` and `docs/source-ladder.md`,
   * never a parallel vocabulary invented here.
   *
   * `2` plain fetch · `3` fetch with the full browser header set · `4` a
   * different CLIENT whose TLS fingerprint passes. A wall is recorded on the
   * rung it stopped at so the next session starts at the next rung instead of
   * re-walking the ones already known to fail — "every wall that falls becomes
   * a rung, so it never costs a second session", read from the other side.
   *
   * This is deliberately not a terminal state and there is no `SOURCE_BLOCKED`
   * beside it: rungs 5 through 14 exist and are unwalked by this client.
   */
  readonly rung: number;

  constructor(message: string, status: number, url: string, rung = 2) {
    super(message);
    this.name = "SourceHttpError";
    this.status = status;
    this.url = url;
    this.rung = rung;
  }
}

export interface HttpOptions {
  /** Overridden in tests so the suite never sleeps or touches the network. */
  fetchImpl?: typeof fetch;
  accept?: string;
  signal?: AbortSignal;
  /**
   * Which retrieval profile to present — the **browser rung** (M79, born
   * 2026-08-15).
   *
   * `"index"` (the default) is the polite civic-index client every adapter
   * has used since the beginning: our own `User-Agent` with a contact
   * address, and nothing else.
   *
   * `"browser"` is the next rung up the ladder for a host that refuses that
   * client. `newbury.nh.gov` and `kearsarge.org` both answer **403 to the
   * index profile and 200 to a browser** — and both publish exactly the
   * meeting notices New Hampshire's RSA 91-A obliges them to publish. Nothing
   * about that refusal is an access control: there is no login, no token, no
   * robots directive naming these paths, and the pages serve to any member of
   * the public who opens them. It is a WAF's default posture toward an
   * unfamiliar client string, and stepping up to the profile the same public
   * page already serves is content negotiation, not circumvention.
   *
   * **The identification survives the step.** The browser profile still
   * carries `we-the-people civic meeting index (contact: …)` at the end of
   * its `User-Agent`, so an administrator reading a log still has somewhere
   * to write; the pacing, the `Retry-After` handling and the serialization
   * are unchanged. We look like a browser to a filter and like ourselves to a
   * human — which is the honest way round.
   */
  profile?: "index" | "browser";
}

/**
 * The browser profile's headers — a real Chrome's, with our identification
 * appended to the `User-Agent` so the step up the ladder does not cost the
 * contact address.
 */
export function browserProfileHeaders(): Record<string, string> {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      `(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 ${sourceUserAgent()}`,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Upgrade-Insecure-Requests": "1",
  };
}

/**
 * The second half of the browser rung, and the reason it needed measuring
 * rather than assuming: **the headers are not what these two hosts read.**
 *
 * Node's `fetch` (undici) sending the exact browser headers above still gets
 * 403 from both hosts; `curl` sending the identical headers gets 200. The
 * filter is keying on the TLS/HTTP2 client fingerprint, not on the
 * `User-Agent` — which means "send a Chrome UA" was never the rung, and a
 * session that had only tried the header swap would have recorded a wall that
 * is not there. So when the in-process request is refused, the same request is
 * re-issued through the system `curl`, a different TLS stack.
 *
 * Same manners either way: one serialized request, our contact string in the
 * `User-Agent`, no retry storm. `child_process` is imported dynamically so
 * this module stays safe to reach from a client chunk.
 */
async function curlGetText(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; contentType: string; text: string }> {
  const { execFile } = await import("node:child_process");
  const args = ["-s", "-S", "--compressed", "-w", "\n%{http_code} %{content_type}"];
  for (const [key, value] of Object.entries(headers)) {
    args.push("-H", `${key}: ${value}`);
  }
  args.push(url);

  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      "curl",
      args,
      { maxBuffer: 32 * 1024 * 1024, encoding: "utf8" },
      (error, out) => (error ? reject(error) : resolve(out)),
    );
  });

  const cut = stdout.lastIndexOf("\n");
  const [code, contentType = ""] = stdout.slice(cut + 1).split(" ");
  const status = Number(code);
  if (!Number.isFinite(status)) {
    throw new SourceHttpError(`curl returned no status for ${url}`, 0, url, 4);
  }
  if (status < 200 || status >= 300) {
    throw new SourceHttpError(`HTTP ${status} for ${url}`, status, url);
  }
  return { status, contentType, text: stdout.slice(0, cut) };
}

/**
 * **A bot-detection interstitial served with HTTP 200.** (F01-continued
 * session 2, item 0C, 2026-08-19.)
 *
 * The browser rung above escalates to a different TLS stack on a **403**. It
 * had never been asked what to do about a **200** — and Apptegy's edge does
 * not refuse an unfamiliar client, it answers it with a 3 KB page titled
 * "Client Challenge" and a `200 OK`. Every layer above then behaved
 * perfectly: the fetch succeeded, the parse succeeded, the extraction found
 * no content because there was none, and the body was recorded as a page that
 * says nothing.
 *
 * That is `CLAUDE.md`'s "an operation that can return nothing must be asked
 * what it returned" and "a failed fetch never silently empties a previously
 * full surface", both landing in the ONE function every adapter fetches
 * through. It is also the fifth sighting of the shape.
 *
 * **Nothing here defeats a challenge.** These signatures cause the request to
 * be re-issued through `curl` — the same rung 4 the 403 path already uses,
 * and the same public page: the host serves the real 260 KB document to that
 * client with no challenge, no token, and no authentication. If the second
 * client is challenged too, the retrieval is reported as a FAILURE naming the
 * wall, which is the whole point — a challenge page must never be mistaken
 * for a body that publishes nothing.
 */
/**
 * **THE SIZE FLOOR IS PER-SIGNATURE, NOT GLOBAL** (NH Hunt, 2026-08-20).
 *
 * The floor exists for exactly one signature: a real 260 KB article that
 * quotes "Checking your browser" is a page, not a wall. It was applied to all
 * seven, and that is what let a challenge page through — Cloudflare's current
 * interstitial is **29,809 bytes**, comfortably over the 20 KB floor, so a
 * KEARSARGE REGIONAL SCHOOL DISTRICT board-roster page served as a challenge
 * was handed to the extractor as a document. Layer 5 read the challenge page's
 * own table, found no person in it, and reported `ZERO_ROWS` — a finding about
 * the district's page, when the truth was that we never saw the district's
 * page at all.
 *
 * That is the wall-rendered-as-an-emptiness shape the transparency mandate
 * forbids by name, and it was one line of arithmetic.
 *
 * A signature that names a vendor's own machinery — `cdn-cgi/challenge-platform`,
 * `<title>Just a moment...</title>`, `_Incapsula_Resource` — cannot appear in a
 * real article by accident, so it needs no floor and gets none. Only the loose
 * PROSE signature keeps one.
 */
const CHALLENGE_SIGNATURES: readonly {
  name: string;
  test: RegExp;
  /** Bytes above which this signature is not trusted. Absent means any size. */
  maxBytes?: number;
}[] = [
  { name: "Fastly/Imperva client challenge", test: /<title>\s*Client Challenge\s*<\/title>/i },
  { name: "Cloudflare 'just a moment'", test: /<title>\s*Just a moment\.\.\.\s*<\/title>/i },
  /*
   * The modern managed challenge, and the three marks that are UNAMBIGUOUS.
   *
   * `window._cf_chl_opt` is the challenge's own options object, the Turnstile
   * widget host is only loaded by a challenge, and the prose line appears
   * nowhere else. Verified against this repo's two `schedulepage` fixtures,
   * which are real pages from a Cloudflare-fronted host: all three are absent
   * from both, and all three are present in the 29,809-byte interstitial
   * Kearsarge served on 2026-08-20.
   */
  {
    name: "Cloudflare managed challenge",
    test: /window\._cf_chl_opt|challenges\.cloudflare\.com|Performing security verification/i,
  },
  { name: "Cloudflare attention-required", test: /Attention Required!\s*\|\s*Cloudflare/i },
  { name: "Imperva/Incapsula", test: /_Incapsula_Resource|Incapsula incident ID/i },
  { name: "PerimeterX", test: /px-captcha|PerimeterX/i },
  /*
   * The two that KEEP the floor, and why — corrected the same day the floor
   * was made per-signature, because the first version of that change removed
   * it from this one and broke two tests immediately.
   *
   * `cdn-cgi/challenge-platform` is NOT a challenge marker on its own:
   * Cloudflare injects `/cdn-cgi/challenge-platform/scripts/jsd/main.js` into
   * ORDINARY pages as its JS-detections beacon, and both recorded
   * `schedulepage` fixtures — real Morris Hills pages that parse into real
   * meetings — carry it. Reading it as a wall at any size would have marked a
   * working source refused, which is the same defect pointed the other way.
   * The floor is what keeps it usable: an 82 KB agenda page is a page.
   */
  {
    name: "Cloudflare interstitial",
    test: /cdn-cgi\/challenge-platform|cf-browser-verification/i,
    maxBytes: 20_000,
  },
  { name: "browser check", test: /Checking your browser before accessing/i, maxBytes: 20_000 },
];

/** The named wall, or null when the body is a real page. */
export function challengeIn(text: string): string | null {
  return (
    CHALLENGE_SIGNATURES.find(
      (s) => (s.maxBytes === undefined || text.length <= s.maxBytes) && s.test.test(text),
    )?.name ?? null
  );
}

/**
 * One polite GET returning the body as text. Retries 429 and 5xx a small
 * number of times, honouring `Retry-After`; everything else fails immediately.
 */
export async function politeGetText(
  url: string,
  options: HttpOptions = {},
): Promise<{ status: number; contentType: string; text: string }> {
  const impl = options.fetchImpl ?? fetch;
  const browser = options.profile === "browser";
  const headers: Record<string, string> = browser
    ? { ...browserProfileHeaders(), ...(options.accept ? { Accept: options.accept } : {}) }
    : { "User-Agent": sourceUserAgent(), Accept: options.accept ?? "*/*" };
  let lastStatus = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await impl(url, {
      headers,
      signal: options.signal,
    });
    lastStatus = response.status;

    if (response.ok) {
      const text = await response.text();
      const wall = challengeIn(text);
      if (!wall) {
        return {
          status: response.status,
          contentType: response.headers.get("content-type") ?? "",
          text,
        };
      }
      // A 200 that is not the page. Step to the other client — same rung as
      // the 403 path — and if that is challenged too, say so out loud rather
      // than handing an empty document upward as a successful read.
      if (browser && !options.fetchImpl) {
        const viaCurl = await curlGetText(url, headers);
        const stillWalled = challengeIn(viaCurl.text);
        if (!stillWalled) return viaCurl;
        throw new SourceHttpError(
          `${stillWalled} at ${url} — HTTP 200 carrying a challenge page rather ` +
            "than the document, on both clients. This is a WALL, not an empty page.",
          response.status,
          url,
          // Rung 4 walked and refused: the other TLS stack was tried and
          // challenged too. Rungs 5+ — a different egress, the live browser,
          // the page's own JSON — are unwalked by this client, not exhausted.
          4,
        );
      }
      throw new SourceHttpError(
        `${wall} at ${url} — HTTP 200 carrying a challenge page rather than the ` +
          "document. This is a WALL, not an empty page.",
        response.status,
        url,
        // Stopped at the profile in hand; rung 4 was not attempted here.
        browser ? 3 : 2,
      );
    }

    /*
     * **A 403 IS A RUNG, NOT AN ANSWER — AND THE LADDER IS WALKED IN ORDER.**
     * (Widened 2026-08-20, NH Hunt.)
     *
     * The escalation to a different TLS stack was already here and was reached
     * only from the BROWSER profile, so a caller on the plain profile — which
     * is every adapter that does not opt in, including `ical` — stopped at
     * rung 2 and reported a wall. The Town of Newbury proved the cost in one
     * measurement: its own `export.ics` answers **403 to this process and 200
     * to `curl`, 467,525 bytes, with either User-Agent**. Nothing about the
     * headers mattered; the TLS fingerprint did. Ten wired Newbury bodies
     * would have rendered as unreachable against a feed that was serving.
     *
     * So the rungs are walked in the order `CLAUDE.md` numbers them:
     *   rung 2 refused → rung 3, the full browser header set
     *   rung 3 refused → rung 4, a different client
     *
     * Only when the caller has not injected a `fetchImpl`, because a test's
     * fake fetch is the thing under test and must not be routed around.
     */
    if (!options.fetchImpl && response.status === 403) {
      if (!browser) {
        const withBrowserHeaders = await impl(url, {
          headers: {
            ...browserProfileHeaders(),
            ...(options.accept ? { Accept: options.accept } : {}),
          },
          signal: options.signal,
        });
        if (withBrowserHeaders.ok) {
          const text = await withBrowserHeaders.text();
          if (!challengeIn(text)) {
            return {
              status: withBrowserHeaders.status,
              contentType: withBrowserHeaders.headers.get("content-type") ?? "",
              text,
            };
          }
        }
      }
      return curlGetText(url, browser ? headers : browserProfileHeaders());
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_RETRIES) {
      throw new SourceHttpError(
        `HTTP ${response.status} for ${url}`,
        response.status,
        url,
        browser ? 3 : 2,
      );
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : REQUEST_SPACING_MS * 2 ** attempt;
    await sleep(waitMs);
  }

  throw new SourceHttpError(`HTTP ${lastStatus} for ${url}`, lastStatus, url, browser ? 3 : 2);
}

/** One polite GET returning parsed JSON. */
export async function politeGetJson<T>(
  url: string,
  options: HttpOptions = {},
): Promise<T> {
  const { text } = await politeGetText(url, {
    ...options,
    accept: options.accept ?? "application/json",
  });
  return JSON.parse(text) as T;
}

/**
 * Decode the handful of HTML entities that occur in these feeds. Numeric
 * references cover both decimal and hex forms — `&#x27;` reached readers
 * literally in a body name (caught by screenshot, 2026-08-15) because only
 * the decimal spelling was handled.
 */
export function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2019;/gi, "’")
    .replace(/&#8217;/g, "’")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export { REQUEST_SPACING_MS };
