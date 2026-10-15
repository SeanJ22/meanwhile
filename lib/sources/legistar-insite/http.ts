import { fetchSource, runWithSourceFetch } from "../fetch-source.ts";
import {
  SourceHttpError,
  readValidatedResponse,
  sourceUserAgent,
} from "../http.ts";

/** `Crawl-delay: 2`, as published at https://legistar.com/robots.txt, in the directive's own units. */
export const INSITE_CRAWL_DELAY_SECONDS = 2;
export const INSITE_SPACING_MS = INSITE_CRAWL_DELAY_SECONDS * 1000;

/** A response's own cache validators, as served; null where the host sends none. */
export interface DocumentValidators {
  readonly etag: string | null;
  readonly lastModified: string | null;
}

function validatorsOf(response: Response): DocumentValidators {
  return { etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") };
}

export class InSiteSession {
  private readonly jar = new Map<string, Map<string, string>>();
  private readonly impl: typeof fetch;
  private readonly signal?: AbortSignal;
  private readonly followRedirects: boolean;

  /** Every URL this session actually retrieved, in order. Reported, never guessed. */
  readonly retrieved: string[] = [];

  constructor(options: {
    fetchImpl?: typeof fetch;
    spacingMs?: number;
    signal?: AbortSignal;
    followRedirects?: boolean;
  } = {}) {
    this.impl = options.fetchImpl ?? ((input, init) => runWithSourceFetch({ spacingMs: options.spacingMs ?? INSITE_SPACING_MS }, () => fetchSource(input, init)));
    this.signal = options.signal;
    this.followRedirects = options.followRedirects ?? true;

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
    this.signal?.throwIfAborted();
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

  async getBytes(
    url: string,
    accept = "*/*",
  ): Promise<{ status: number; contentType: string; finalUrl: string; bytes: Uint8Array } & DocumentValidators> {
    this.signal?.throwIfAborted();
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
    return { status: response.status, contentType: response.headers.get("content-type") ?? "", finalUrl: response.url || url, bytes, ...validatorsOf(response) };
  }

  async head(url: string, accept = "*/*"): Promise<({ status: number; contentType: string; contentLength: number | null } & DocumentValidators) | null> {
    this.signal?.throwIfAborted();
    try {
      const response = await this.impl(url, {
        method: "HEAD",
        headers: this.headers(url, { Accept: accept }),
        signal: this.signal,
        ...(this.followRedirects ? {} : { redirect: "manual" as const }),
      });
      this.store(response, url);
      await response.body?.cancel().catch(() => undefined);
      this.retrieved.push(`HEAD ${url}`);
      const length = Number(response.headers.get("content-length"));
      return {
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        contentLength: response.headers.has("content-length") && Number.isFinite(length) ? length : null,
        ...validatorsOf(response),
      };
    } catch {
      this.signal?.throwIfAborted();
      return null;
    }
  }

  async postForm(
    url: string,
    form: Record<string, string>,
  ): Promise<{ status: number; contentType: string; text: string }> {
    this.signal?.throwIfAborted();
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
