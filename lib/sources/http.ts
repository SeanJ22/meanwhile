/**
 * The retrieval discipline, shared by every adapter that speaks HTTP.
 *
 * Same manners as `lib/sources/legistar/client.ts`, factored out for the
 * adapters that arrived with the composite: identify yourself, go at a human
 * pace, honour `Retry-After`, and never parallelize against a single tenant.
 * Engineering manners, not hedging — see `CLAUDE.md` on public records.
 */

import { recordAcquiredResponse } from "./acquisition-trace.ts";
import {
  sourceAcquisitionSecondsRemaining,
  sourceAcquisitionSleep,
} from "./acquisition-deadline.ts";

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
  /**
   * What a real document from this URL must contain — **RULING 43, moved one
   * layer down, to the fetch (NH Hunt 3, 2026-08-21).**
   *
   * `accountedNormalize` made "documents in hand, nothing out, nothing
   * dropped" inexpressible at the NORMALIZE layer, and RULING 43 says in as
   * many words that the fetch layer remains uncovered. This is that gap, and
   * a scheduled job had already fallen into it: on 2026-08-21T13:12Z the
   * `ical` source reported `fetched 3, extracted 0, drops 0`, the zero-row
   * contract refused the result exactly as designed, and `Refresh meetings
   * snapshot` went red. The contract was right and the bug was upstream of
   * it — `parseIcs` was handed a 200 whose body carried no `VEVENT` at all,
   * so the drop loop never executed and there was nothing to count.
   *
   * `challengeIn` below catches a 200 that is a KNOWN interstitial. It cannot
   * catch a 200 that is a blank body, a truncated transfer, or an error page
   * this repo has not met — and each of those is a retrieval failure wearing
   * a successful status code. A document that fails this test is a **WALL**,
   * recorded on its rung and carried forward as a refusal, never handed
   * upward as an empty calendar.
   *
   * Two layers, because they answer different questions:
   *
   * - **Blank is universal and needs no configuration.** A whitespace-only
   *   200 is never a document, for any caller, in any format. Enforced below
   *   for every caller of this function whether or not they declare anything.
   * - **`expect` is the caller's own format**, declared where the caller
   *   knows it: `BEGIN:VCALENDAR` for an `.ics` feed. A caller that cannot
   *   name a marker still gets the blank check.
   */
  expect?: {
    /** What the format is called, so the wall names it in the reader's terms. */
    label: string;
    /** A marker every genuine document of this format carries. */
    marker: string;
  };
  /**
   * **THE ESCALATION LADDER, MADE REACHABLE BY A TEST** — A-003 (external
   * correctness audit of `336a3eb`, remediated 2026-08-24).
   *
   * The 403 escalation below is guarded by `!options.fetchImpl`, for a reason
   * that is entirely correct: a test's fake fetch is the thing under test and
   * must not be routed around. What that guard also did was make the whole
   * production retry path **unreachable by injection**, so the branch where
   * A-003 lived — a rung returning a body with no document check on it — could
   * not be exercised by any test in this repo.
   *
   * That is the chromium-pin shape (RULING 113): a step whose product nothing
   * observes. The pin was wrong on every platform for months because the only
   * thing that could have caught it was a check nobody had written; this was
   * wrong on one rung because the only thing that could have caught it was a
   * test nobody could write.
   *
   * So the seam is DECLARED rather than inferred. A caller that injects both a
   * `fetchImpl` and a `ladder` is deliberately driving the escalation with its
   * own doubles; a caller that injects only a `fetchImpl` still gets the old
   * behaviour, unchanged, and production — which injects neither — walks the
   * real rungs.
   */
  ladder?: {
    /** Rung 3: the same client with the full browser header set. */
    browserFetch?: typeof fetch;
    /** Rung 4: a different client, whose TLS fingerprint passes. */
    curl?: (
      url: string,
      headers: Record<string, string>,
      signal?: AbortSignal,
    ) => Promise<{
      status: number;
      contentType: string;
      text: string;
      /** Exact entity bytes and redirect destination, when the transport exposes them. */
      bytes?: Uint8Array;
      finalUrl?: string;
    }>;
  };
}

/**
 * Is this 200 a document at all?
 *
 * Returns the reason it is not, or `null` when it passes. Kept separate from
 * `politeGetText` so `tests/http-empty-success.test.ts` can hold it directly
 * against the bytes a server actually sent.
 */
export function notADocument(text: string, expect?: HttpOptions["expect"]): string | null {
  if (text.trim() === "") return "an empty body";
  if (expect && !text.includes(expect.marker)) {
    return `${expect.label} carrying no ${expect.marker}`;
  }
  return null;
}

/**
 * The browser profile's headers — a real Chrome's, with our identification
 * appended to the `User-Agent` so the step up the ladder does not cost the
 * contact address.
 */
/**
 * Identify this project in the headers RFC 9110 provides for it.
 *
 * ## The measurement that made this necessary (2026-08-26)
 *
 * Every rung of this ladder appends `we-the-people civic meeting index (…)` to
 * the `User-Agent`, deliberately, so an administrator reading a log has
 * somewhere to write. **The entire `*.nh.gov` family refuses that string.**
 * Isolated one variable at a time against three hosts, unanimously:
 *
 * ```
 * no headers at all                200
 * chrome UA only                   200
 * chrome UA + project suffix       403
 * project UA alone                 403
 * chrome UA + From: header         200
 * chrome UA + From + X-Purpose     200
 * full browser header set + From   200
 * ```
 *
 * Not the TLS fingerprint, which is what the note on `curlGetText` below
 * inferred from an earlier pair of hosts — `curl` carrying the same suffix is
 * refused too. **It is the substring, and nothing else.** Thirty-odd New
 * Hampshire state hosts, including `sos.nh.gov` and `revenue.nh.gov`, were
 * refusing this project specifically for saying who it was in the one field a
 * WAF pattern-matches hardest.
 *
 * `From` is the field HTTP defines for the requesting agent's email address,
 * and `X-Purpose` says what the request is for. Moving the identification
 * there is **more** honest than a suffix on a UA string, not less: it is
 * machine-readable, it is where an administrator's tooling would look for it,
 * and it says the same thing to the same person.
 *
 * **This does not replace the identified `User-Agent` and must not.** Some
 * hosts ALLOWLIST it — `states/nj/NOTES.md` records `morriscountyclerk.org`
 * and `states/az/NOTES.md` records `tucsonaz.gov` both refusing a
 * general-purpose fetcher and admitting this project by name. Dropping the
 * suffix globally would trade one family of hosts for another. It is a RUNG,
 * walked when the identified client is refused.
 */
export function identificationHeaders(): Record<string, string> {
  const contact = process.env.INGEST_CONTACT_EMAIL?.trim();
  return {
    ...(contact ? { From: contact } : {}),
    "X-Purpose": "we-the-people civic meeting index",
    "X-Contact": contact ?? "https://github.com/SeanJ22/we-the-people",
  };
}

/**
 * The browser header set with the project's name taken OUT of the `User-Agent`
 * and put into the fields built for it — rung 3b.
 *
 * Same manners, same disclosure, different envelope. See
 * `identificationHeaders` for the measurement.
 */
export function identifiedBrowserHeaders(): Record<string, string> {
  const { "User-Agent": _drop, ...rest } = browserProfileHeaders();
  return {
    ...rest,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    ...identificationHeaders(),
  };
}

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
export type CurlProcessRunner = (
  args: readonly string[],
  options: { readonly signal?: AbortSignal; readonly maxBuffer: number },
) => Promise<Buffer>;

async function nativeCurlProcess(
  args: readonly string[],
  options: { readonly signal?: AbortSignal; readonly maxBuffer: number },
): Promise<Buffer> {
  const { execFile } = await import("node:child_process");
  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      "curl",
      [...args],
      {
        maxBuffer: options.maxBuffer,
        encoding: "buffer",
        signal: options.signal,
      },
      (error, out) => (error ? reject(error) : resolve(out as Buffer)),
    );
  });
}

export async function curlGetText(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
  runProcess: CurlProcessRunner = nativeCurlProcess,
): Promise<{
  status: number;
  contentType: string;
  text: string;
  bytes: Uint8Array;
  finalUrl: string;
}> {
  const args = ["-s", "-S", "-L", "--compressed", "-w", "\n%{http_code}\t%{content_type}\t%{url_effective}"];
  const remainingSeconds = sourceAcquisitionSecondsRemaining(signal);
  if (remainingSeconds !== null) args.push("--max-time", String(remainingSeconds));
  for (const [key, value] of Object.entries(headers)) {
    args.push("-H", `${key}: ${value}`);
  }
  args.push(url);

  const stdout = await runProcess(args, {
    maxBuffer: 32 * 1024 * 1024,
    signal,
  });
  signal?.throwIfAborted();

  const cut = stdout.lastIndexOf(0x0a);
  if (cut < 0) {
    throw new SourceHttpError(`curl returned no response trailer for ${url}`, 0, url, 4);
  }
  const [code, contentType = "", finalUrl = url] = stdout.subarray(cut + 1).toString("utf8").split("\t");
  const status = Number(code);
  if (!Number.isFinite(status)) {
    throw new SourceHttpError(`curl returned no status for ${url}`, 0, url, 4);
  }
  if (status < 200 || status >= 300) {
    throw new SourceHttpError(`HTTP ${status} for ${url}`, status, url);
  }
  const body = stdout.subarray(0, cut);
  return {
    status,
    contentType,
    text: body.toString("utf8"),
    bytes: new Uint8Array(body),
    finalUrl,
  };
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
  /*
   * The Turnstile host counts only as a script the page loads. A resource hint
   * is not a challenge: Chandler, AZ's real City Clerk page (2026-09-24, 210 KB,
   * 33 sittings) carries `<link rel="preconnect" href="https://challenges.cloudflare.com">`
   * for its forms, and reading the bare host as a wall marked it refused.
   */
  {
    name: "Cloudflare managed challenge",
    test: /window\._cf_chl_opt|<script\b[^>]*challenges\.cloudflare\.com|Performing security verification/i,
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
 * **THE ONE FINALIZER EVERY TRANSPORT RUNG PASSES THROUGH** — A-003.
 *
 * Before this existed there were four places a successful body could be
 * returned from `politeGetText`, and only two of them asked whether the body
 * was a document. The two that did not were both inside the 403 escalation:
 *
 * - a rung-3 browser-header 200 was checked with `challengeIn` and NOT with
 *   `notADocument`, so a blank body or an `.ics` URL answering with an HTML
 *   error page was returned as a document;
 * - the rung-4 `curl` fallback was returned raw, with neither check.
 *
 * **So document validity depended on WHICH RUNG happened to succeed** — the
 * same URL, the same bytes, judged or not judged according to how far up the
 * ladder the request had gone. That is not a missing check in one branch; it
 * is a contract that only some code paths were party to.
 *
 * The fix is structural rather than three more call sites: there is exactly
 * one place a body becomes a return value, and it is this function. A rung
 * that wants to succeed has to come through here.
 *
 * @param rung Which rung obtained this body, so a refusal names it honestly.
 */
export function readValidatedResponse(
  url: string,
  rung: number,
  response: {
    status: number;
    contentType: string;
    text: string;
    bytes?: Uint8Array;
    finalUrl?: string;
  },
  expect?: HttpOptions["expect"],
): { status: number; contentType: string; text: string } {
  const wall = challengeIn(response.text);
  if (wall !== null) {
    throw new SourceHttpError(
      `${wall} at ${url} — HTTP ${response.status} carrying a challenge page rather ` +
        "than the document. This is a WALL, not an empty page.",
      response.status,
      url,
      rung,
    );
  }
  const notDoc = notADocument(response.text, expect);
  if (notDoc !== null) {
    throw new SourceHttpError(
      `HTTP ${response.status} from ${url} with ${notDoc} — a status is not a document. ` +
        `This is a WALL on rung ${rung}, not an empty source.`,
      response.status,
      url,
      rung,
    );
  }
  if (response.bytes) {
    recordAcquiredResponse({
      requestedUrl: url,
      finalUrl: response.finalUrl || url,
      httpStatus: response.status,
      bytes: response.bytes,
    });
  }
  return {
    status: response.status,
    contentType: response.contentType,
    text: response.text,
  };
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
  /*
   * A-003 · WHETHER THE LADDER IS WALKED, DECIDED ONCE.
   *
   * `!options.fetchImpl` was tested at two separate escalation sites, which is
   * how one of them acquired a return path the other did not have. It is one
   * named condition now, and it is `true` in production (nothing is injected)
   * and `true` for a test that deliberately supplies the rungs it wants driven.
   */
  const escalates = !options.fetchImpl || options.ladder !== undefined;
  const browserFetch = options.ladder?.browserFetch ?? impl;
  const curl = options.ladder?.curl ?? curlGetText;
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
      options.signal?.throwIfAborted();
      const here = {
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        text,
      };
      const wall = challengeIn(text);
      if (!wall) {
        // A-003: one finalizer, and this rung goes through it like every other.
        return readValidatedResponse(url, browser ? 3 : 2, here, options.expect);
      }
      // A 200 that is not the page. Step to the other client — same rung as
      // the 403 path — and if that is challenged too, say so out loud rather
      // than handing an empty document upward as a successful read.
      if (browser && escalates) {
        // Rung 4 answers on its own terms and gets the same question asked of
        // it, by the same function. A document check that only guarded one of
        // two return paths would be a guard with a door beside it — which is
        // exactly what A-003 found on the 403 path below.
        return readValidatedResponse(
          url,
          4,
          await curl(url, headers, options.signal),
          options.expect,
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
    if (escalates && response.status === 403) {
      if (!browser) {
        const withBrowserHeaders = await browserFetch(url, {
          headers: {
            ...browserProfileHeaders(),
            ...(options.accept ? { Accept: options.accept } : {}),
          },
          signal: options.signal,
        });
        if (withBrowserHeaders.ok) {
          const text = await withBrowserHeaders.text();
          options.signal?.throwIfAborted();
          /*
           * A-003 · THIS RETURN WAS THE DEFECT.
           *
           * It read `if (!challengeIn(text)) return {…}` — a KNOWN
           * interstitial was caught and everything else was handed upward as
           * a document. A blank body, a truncated transfer, or an `.ics` URL
           * answering with an HTML error page all passed, and passed ONLY
           * here: the same bytes arriving on rung 2 were refused by
           * `notADocument` two screens above.
           *
           * The failure that makes it concrete: a host that 403s the index
           * client and answers the browser headers with an empty 200 would
           * hand `parseIcs` an empty string. `accountedNormalize` would then
           * refuse the zero-row result and turn the whole refresh red for a
           * parser that did nothing wrong — or, with one drop recorded
           * anywhere, would have passed silently, which is A-002.
           */
          if (challengeIn(text) === null) {
            return readValidatedResponse(
              url,
              3,
              {
                status: withBrowserHeaders.status,
                contentType: withBrowserHeaders.headers.get("content-type") ?? "",
                text,
              },
              options.expect,
            );
          }
        }
      }
      /*
       * RUNG 3b — SAY WHO WE ARE SOMEWHERE THE FILTER IS NOT READING.
       * (2026-08-26, the descent-resume session.)
       *
       * Walked before rung 4 because it is the cheaper question and, on the
       * host family that produced it, the only one that works: `*.nh.gov`
       * refuses rung 2, rung 3 AND rung 4, because all three carry
       * `we-the-people civic meeting index` inside the `User-Agent`, and that
       * substring is the whole of the wall. A clean UA plus `From:` and
       * `X-Purpose:` is admitted by every one of them.
       *
       * Thirty-odd New Hampshire state hosts sat behind this, and a private
       * curl-only client in this session's census walk had already reported
       * 23 governments "unreachable" because of it. Not a wall around the
       * data — a wall around our own name, in the one header a WAF reads
       * first.
       */
      const identified = await browserFetch(url, {
        headers: {
          ...identifiedBrowserHeaders(),
          ...(options.accept ? { Accept: options.accept } : {}),
        },
        signal: options.signal,
      });
      if (identified.ok) {
        const text = await identified.text();
        options.signal?.throwIfAborted();
        if (challengeIn(text) === null) {
          return readValidatedResponse(
            url,
            3,
            {
              status: identified.status,
              contentType: identified.headers.get("content-type") ?? "",
              text,
            },
            options.expect,
          );
        }
      }

      // Rung 4, and it used to be returned RAW — neither `challengeIn` nor
      // `notADocument` ever saw it. A different client's 200 is a status like
      // any other status (A-003).
      return readValidatedResponse(
        url,
        4,
        await curl(
          url,
          browser ? headers : browserProfileHeaders(),
          options.signal,
        ),
        options.expect,
      );
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
    await sourceAcquisitionSleep(waitMs, options.signal);
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
 * One polite GET returning BYTES — a PDF, an image, a spreadsheet.
 * (2026-08-27, the coverage-truth session.)
 *
 * **Why this is here and not private to `pnpm pdf:read`.** Every other
 * retrieval in this repository is identified, spaced and laddered by this
 * module, and a binary fetched by a script's own `fetch` call is a second
 * client with its own failure modes and its own idea of who we are. The CAWCD
 * board publishes its 2026 meeting schedule as a PDF and links it from its own
 * meetings page; reading that link is a retrieval like any other.
 *
 * **It walks rung 2 and rung 3 and stops there, and that is stated rather than
 * hidden.** `politeGetText` escalates to rung 4 (`curl`, a different TLS stack)
 * by re-issuing the request through a text client, which cannot carry bytes
 * back intact. A host that refuses both rungs here is a WALL on rung 3 — the
 * error says so, with the rung — and the next session escalates from there.
 * That is the ladder's own bargain: **a wall names the rung it stopped at, so
 * it never costs a second session the same climb** (RULING 184 — a blocked
 * route is never a blocked fact).
 */
export async function politeGetBytes(
  url: string,
  options: HttpOptions = {},
): Promise<{ status: number; contentType: string; bytes: Uint8Array; rung: number }> {
  const impl = options.fetchImpl ?? fetch;
  let lastStatus = 0;

  for (const [rung, headers] of [
    [2, { "User-Agent": sourceUserAgent(), Accept: options.accept ?? "*/*" }],
    [3, { ...browserProfileHeaders(), ...(options.accept ? { Accept: options.accept } : {}) }],
  ] as const) {
    const response = await impl(url, { headers, signal: options.signal });
    lastStatus = response.status;
    if (!response.ok) continue;
    const bytes = new Uint8Array(await response.arrayBuffer());
    options.signal?.throwIfAborted();
    /*
     * A ZERO-BYTE 200 IS A FAILED RETRIEVAL, NOT AN EMPTY DOCUMENT.
     * The same rule `readValidatedResponse` applies to text, and the same
     * reason: an operation that can return nothing must be asked what it
     * returned, and a caller handed an empty buffer will report that the
     * document says nothing.
     */
    if (bytes.length === 0) {
      throw new SourceHttpError(
        `${url} answered HTTP ${response.status} with ZERO bytes. That is a failed ` +
          "retrieval, never an empty document.",
        response.status,
        url,
        rung,
      );
    }
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      bytes,
      rung,
    };
  }

  throw new SourceHttpError(
    `HTTP ${lastStatus} for ${url} on rungs 2 and 3. This is a WALL on rung 3, not an ` +
      "absent document — rungs 4 and above are unwalked by this client.",
    lastStatus,
    url,
    3,
  );
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
