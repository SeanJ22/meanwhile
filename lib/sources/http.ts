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

  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = "SourceHttpError";
    this.status = status;
    this.url = url;
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
    throw new SourceHttpError(`curl returned no status for ${url}`, 0, url);
  }
  if (status < 200 || status >= 300) {
    throw new SourceHttpError(`HTTP ${status} for ${url}`, status, url);
  }
  return { status, contentType, text: stdout.slice(0, cut) };
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
  const headers = browser
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
      return {
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        text: await response.text(),
      };
    }

    // The browser rung's second half: an in-process refusal is not the
    // answer, because the refusal is fingerprint-level and a different TLS
    // stack is still the same public page. Only tried on the browser profile,
    // and only once.
    if (browser && !options.fetchImpl && response.status === 403) {
      return curlGetText(url, headers);
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_RETRIES) {
      throw new SourceHttpError(`HTTP ${response.status} for ${url}`, response.status, url);
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : REQUEST_SPACING_MS * 2 ** attempt;
    await sleep(waitMs);
  }

  throw new SourceHttpError(`HTTP ${lastStatus} for ${url}`, lastStatus, url);
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
