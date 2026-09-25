/**
 * The InSite portal's own transport — a GET, an ASP.NET postback, and the
 * pacing the vendor asks for.
 *
 * ## Why this is here rather than in `lib/sources/http.ts`
 *
 * `CLAUDE.md`: *adding a source means adding a directory, never editing shared
 * ingestion logic.* Nothing else in this repository posts a form. The shared
 * client is a GET client with a ladder, and widening it to carry a request body
 * so that one adapter can drive one vendor's dropdown would put this tenant's
 * quirks in every other adapter's path.
 *
 * What it does NOT re-implement: identification and document validation. The
 * User-Agent comes from `sourceUserAgent()` and every response goes through
 * `readValidatedResponse()`, so a 200 carrying a challenge page or a blank body
 * is a WALL on its rung here exactly as it is everywhere else — never an empty
 * calendar handed upward.
 *
 * ## Pacing
 *
 * `legistar.com`'s apex robots.txt publishes `Crawl-delay: 2`. The tenant hosts
 * (`pima.legistar.com`, `mesa.legistar.com`) return 404 for robots.txt and so
 * publish no rules of their own — read 2026-08-28. A 404 is not permission to
 * go faster than the vendor asked on its own name, so the whole vendor is paced
 * at the apex's stated delay. Two seconds between requests, serialized, one
 * tenant at a time.
 */
import {
  SourceHttpError,
  readValidatedResponse,
  sourceUserAgent,
} from "../http.ts";
import { sourceAcquisitionSleep } from "../acquisition-deadline.ts";

/**
 * `Crawl-delay: 2`, as published at https://legistar.com/robots.txt and read
 * 2026-08-28. Stated in the units the directive uses so the number can be
 * checked against the source rather than trusted.
 */
export const INSITE_CRAWL_DELAY_SECONDS = 2;
export const INSITE_SPACING_MS = INSITE_CRAWL_DELAY_SECONDS * 1000;

/**
 * One tenant's session for the length of one fetch.
 *
 * Calendar.aspx is a stateful WebForm: the postback that changes the date
 * range is only accepted alongside the `ASP.NET_SessionId` and the
 * `__VIEWSTATE` that were issued together. A jar per fetch keeps that pairing
 * honest and keeps nothing between runs.
 */
export class InSiteSession {
  /**
   * Cookies by the host that set them. A portal's ASP.NET session goes back to that portal only: since
   * 2026-09-25 a minutes link may sit on the vendor's document host, and a session is never handed to a host
   * that did not issue it.
   */
  private readonly jar = new Map<string, Map<string, string>>();
  private readonly spacingMs: number;
  private readonly impl: typeof fetch;
  private readonly signal?: AbortSignal;
  private readonly followRedirects: boolean;
  private lastAt = 0;

  /** Every URL this session actually retrieved, in order. Reported, never guessed. */
  readonly retrieved: string[] = [];

  constructor(options: {
    fetchImpl?: typeof fetch;
    spacingMs?: number;
    signal?: AbortSignal;
    /**
     * False for an optional read that must end on the exact URL it was
     * registered for: a redirect is then answered as a refusal naming where
     * the page moved, and is never followed (2026-09-24).
     */
    followRedirects?: boolean;
  } = {}) {
    this.impl = options.fetchImpl ?? fetch;
    this.signal = options.signal;
    this.followRedirects = options.followRedirects ?? true;
    // An injected fetch is a test's own double: it must not sleep, and the
    // suite must never wait two seconds per fixture.
    this.spacingMs = options.spacingMs ?? (options.fetchImpl ? 0 : INSITE_SPACING_MS);
  }

  private static hostOf(url: string): string {
    try {
      return new URL(url).host.toLowerCase();
    } catch {
      return "";
    }
  }

  private cookieHeader(url: string): string {
    const cookies = this.jar.get(InSiteSession.hostOf(url));
    return cookies ? [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ") : "";
  }

  private store(response: Response, url: string): void {
    const lines =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];
    const host = InSiteSession.hostOf(response.url || url);
    for (const line of lines) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const cookies = this.jar.get(host) ?? new Map<string, string>();
      cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      this.jar.set(host, cookies);
    }
  }

  private async pace(): Promise<void> {
    const wait = this.lastAt + this.spacingMs - Date.now();
    if (wait > 0) await sourceAcquisitionSleep(wait, this.signal);
    this.signal?.throwIfAborted();
    this.lastAt = Date.now();
  }

  private headers(url: string, extra: Record<string, string> = {}): Record<string, string> {
    const cookie = this.cookieHeader(url);
    return {
      "User-Agent": sourceUserAgent(),
      ...(cookie ? { Cookie: cookie } : {}),
      ...extra,
    };
  }

  async get(
    url: string,
    accept = "*/*",
  ): Promise<{ status: number; contentType: string; text: string }> {
    await this.pace();
    const response = await this.impl(url, {
      headers: this.headers(url, { Accept: accept }),
      signal: this.signal,
      ...(this.followRedirects ? {} : { redirect: "manual" as const }),
    });
    this.store(response, url);
    const movedTo = !this.followRedirects && response.status >= 300 && response.status < 400
      ? response.headers.get("location")
      : null;
    if (movedTo) {
      await response.body?.cancel().catch(() => undefined);
      throw new SourceHttpError(
        `HTTP ${response.status} for ${url}: the page moved to ${new URL(movedTo, url).href}, ` +
          "which is not the route this read is registered for, so the move was not followed",
        response.status,
        url,
        2,
      );
    }
    if (!response.ok) {
      throw new SourceHttpError(`HTTP ${response.status} for ${url}`, response.status, url, 2);
    }
    this.retrieved.push(url);
    const text = await response.text();
    this.signal?.throwIfAborted();
    return readValidatedResponse(url, 2, {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      text,
    });
  }

  /**
   * A document's exact bytes (NH332, 2026-09-25): the minutes PDF on the
   * portal host. Paced and identified like every other read here; a non-2xx
   * status throws, and the caller judges the bytes (a PDF with no text layer
   * is a failed extraction, never an empty document).
   */
  async getBytes(
    url: string,
    accept = "*/*",
  ): Promise<{ status: number; contentType: string; finalUrl: string; bytes: Uint8Array }> {
    await this.pace();
    const response = await this.impl(url, {
      headers: this.headers(url, { Accept: accept }),
      signal: this.signal,
      ...(this.followRedirects ? {} : { redirect: "manual" as const }),
    });
    this.store(response, url);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new SourceHttpError(`HTTP ${response.status} for ${url}`, response.status, url, 2);
    }
    this.retrieved.push(url);
    const bytes = new Uint8Array(await response.arrayBuffer());
    this.signal?.throwIfAborted();
    if (bytes.byteLength === 0) {
      throw new SourceHttpError(`HTTP ${response.status} for ${url} carried zero bytes`, response.status, url, 2);
    }
    return { status: response.status, contentType: response.headers.get("content-type") ?? "", finalUrl: response.url || url, bytes };
  }

  /**
   * The postback. `form` is sent verbatim: every field the page rendered, with
   * the caller's overrides already applied — an ASP.NET page that receives a
   * subset of its own fields answers with the page it already had, which is
   * how a silent no-op looks exactly like a successful filter change.
   */
  async postForm(
    url: string,
    form: Record<string, string>,
  ): Promise<{ status: number; contentType: string; text: string }> {
    await this.pace();
    const response = await this.impl(url, {
      method: "POST",
      headers: this.headers(url, {
        Accept: "text/html,application/xhtml+xml",
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: url,
      }),
      body: new URLSearchParams(form).toString(),
      signal: this.signal,
    });
    this.store(response, url);
    if (!response.ok) {
      throw new SourceHttpError(`HTTP ${response.status} for ${url}`, response.status, url, 2);
    }
    this.retrieved.push(`POST ${url}`);
    const text = await response.text();
    this.signal?.throwIfAborted();
    return readValidatedResponse(url, 2, {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      text,
    });
  }
}
