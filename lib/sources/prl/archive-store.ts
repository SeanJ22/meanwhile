import { createHash, createHmac } from "node:crypto";
import { posix } from "node:path";
import { readCompleteResponse } from "../source-bytes.ts";

/**
 * The routine's object store for the large raw PRL rows, which may not enter
 * Postgres. They land as bounded partition objects; only a small receipt (keys
 * and a high-water mark) reaches the database.
 *
 * No filesystem writer lives here, so the standing runner cannot bypass the
 * production data plane. `S3ArchiveStore` is an S3-compatible SigV4 client for
 * a Neon storage bucket; the on-disk twin is `archive-store-local.ts`.
 */

export interface PrlObjectMeta {
  readonly key: string;
  readonly size: number;
  readonly etag?: string;
  readonly contentType?: string;
}

export interface PrlArchiveStore {
  readonly kind: "local-file" | "s3";
  put(key: string, body: Uint8Array, contentType?: string): Promise<PrlObjectMeta>;
  get(key: string): Promise<Uint8Array | null>;
  head(key: string): Promise<PrlObjectMeta | null>;
  list(prefix: string): Promise<PrlObjectMeta[]>;
}

/** A key is a `/`-joined path of safe segments — never absolute, never `..`. */
export function assertSafeObjectKey(key: string): void {
  if (!key || key.startsWith("/") || key.includes("..") || key.includes("\\") || [...key].some((c) => c.charCodeAt(0) < 0x20)) {
    throw new Error(`PRL_ARCHIVE_KEY_UNSAFE:${JSON.stringify(key)}`);
  }
}

// ---------------------------------------------------------------------------
// AWS Signature V4 (verified against the published test vector)
// ---------------------------------------------------------------------------

const sha256Hex = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Uint8Array | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();

export interface SigV4Input {
  readonly method: string;
  readonly url: string;
  readonly region: string;
  readonly service: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Header name → value. `host` and `x-amz-date` are added if absent. */
  readonly headers: Record<string, string>;
  /** Hex sha256 of the body, or `UNSIGNED-PAYLOAD`. */
  readonly payloadHash: string;
  /** ISO basic instant `YYYYMMDDTHHMMSSZ`; defaulted to now. */
  readonly amzDate?: string;
}

/**
 * Produce the SigV4 `Authorization` header value and the signed headers.
 * Exported so a test can hold it to the published AWS test vector.
 */
export function signatureV4(input: SigV4Input): { authorization: string; amzDate: string; signedHeaders: string } {
  const url = new URL(input.url);
  const amzDate = input.amzDate ?? new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = { ...input.headers };
  const lowerKeys = new Set(Object.keys(headers).map((k) => k.toLowerCase()));
  if (!lowerKeys.has("host")) headers["host"] = url.host;
  if (!lowerKeys.has("x-amz-date")) headers["x-amz-date"] = amzDate;

  const canonicalHeaderList = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, " ")] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const signedHeaders = canonicalHeaderList.map(([name]) => name).join(";");
  const canonicalHeaders = canonicalHeaderList.map(([name, value]) => `${name}:${value}\n`).join("");

  const canonicalQuery = [...url.searchParams.entries()]
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalPath = url.pathname
    .split("/")
    .map((segment) => encodeRfc3986(decodeURIComponent(segment)))
    .join("/") || "/";

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, amzDate, signedHeaders };
}

/** RFC 3986 encoding: like encodeURIComponent but also escapes `!*'()`. */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// ---------------------------------------------------------------------------
// S3-compatible store (Neon storage bucket vehicle)
// ---------------------------------------------------------------------------

export interface S3ArchiveConfig {
  /** Base endpoint, e.g. `https://<project>.storage.<region>.neon.tech`. */
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Path-style addressing (`/<bucket>/<key>`); Neon buckets use path style. */
  readonly pathStyle?: boolean;
}

export class S3ArchiveStore implements PrlArchiveStore {
  readonly kind = "s3" as const;
  private readonly config: S3ArchiveConfig;
  constructor(config: S3ArchiveConfig) {
    this.config = config;
  }

  private objectUrl(key: string): string {
    if (key !== "") assertSafeObjectKey(key);
    const base = new URL(this.config.endpoint);
    const encodedKey = key.split("/").map(encodeRfc3986).join("/");
    if (this.config.pathStyle ?? true) {
      base.pathname = posix.join(base.pathname, this.config.bucket, encodedKey);
    } else {
      base.host = `${this.config.bucket}.${base.host}`;
      base.pathname = posix.join(base.pathname, encodedKey);
    }
    return base.toString();
  }

  private async send(method: string, key: string, body?: Uint8Array, query?: string): Promise<Response> {
    const url = this.objectUrl(key) + (query ? `?${query}` : "");
    const payloadHash = body ? sha256Hex(body) : "UNSIGNED-PAYLOAD";
    const headers: Record<string, string> = { "x-amz-content-sha256": payloadHash };
    const { authorization, amzDate } = signatureV4({
      method, url, region: this.config.region, service: "s3",
      accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey,
      headers, payloadHash,
    });
    return fetch(url, {
      method,
      signal: AbortSignal.timeout(30_000),
      headers: { ...headers, "x-amz-date": amzDate, authorization, host: new URL(url).host },
      body: body ? Buffer.from(body) : undefined,
    });
  }

  async put(key: string, body: Uint8Array, contentType?: string): Promise<PrlObjectMeta> {
    assertSafeObjectKey(key);
    const response = await this.send("PUT", key, body);
    if (!response.ok) throw new Error(`PRL_ARCHIVE_S3_PUT_FAILED:${response.status}:${await response.text().catch(() => "")}`);
    return { key, size: body.byteLength, etag: response.headers.get("etag") ?? undefined, contentType };
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertSafeObjectKey(key);
    const response = await this.send("GET", key);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`PRL_ARCHIVE_S3_GET_FAILED:${response.status}`);
    return readCompleteResponse(response, 8 * 1024 * 1024);
  }

  async head(key: string): Promise<PrlObjectMeta | null> {
    assertSafeObjectKey(key);
    const response = await this.send("HEAD", key);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`PRL_ARCHIVE_S3_HEAD_FAILED:${response.status}`);
    return { key, size: Number(response.headers.get("content-length") ?? 0), etag: response.headers.get("etag") ?? undefined };
  }

  async list(prefix: string): Promise<PrlObjectMeta[]> {
    if (prefix !== "") assertSafeObjectKey(prefix);
    const out: PrlObjectMeta[] = [];
    const tokens = new Set<string>();
    let token: string | null = null;
    do {
      const response = await this.send("GET", "", undefined, `list-type=2&prefix=${encodeRfc3986(prefix)}` + (token ? `&continuation-token=${encodeRfc3986(token)}` : ""));
      if (!response.ok) throw new Error(`PRL_ARCHIVE_S3_LIST_FAILED:${response.status}`);
      const xml = await response.text();
      if (!/<ListBucketResult\b/.test(xml)) throw new Error("PRL_ARCHIVE_S3_LIST_INVALID");
      for (const match of xml.matchAll(/<Contents>[\s\S]*?<Key>([^<]+)<\/Key>[\s\S]*?<Size>(\d+)<\/Size>[\s\S]*?<\/Contents>/g)) {
        const key = decodeXml(match[1]); assertSafeObjectKey(key);
        if (!key.startsWith(prefix)) throw new Error("PRL_ARCHIVE_S3_LIST_WRONG_PREFIX");
        out.push({ key, size: Number(match[2]) });
      }
      if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
      const rawToken = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1];
      token = rawToken ? decodeXml(rawToken) : null;
      if (!token || tokens.has(token)) throw new Error("PRL_ARCHIVE_S3_LIST_CURSOR_INVALID");
      tokens.add(token);
    } while (token);
    if (new Set(out.map(row => row.key)).size !== out.length) {
      throw new Error("PRL_ARCHIVE_S3_LIST_DUPLICATE");
    }
    return out;
  }
}

function decodeXml(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export class PrlArchiveNotConfiguredError extends Error {
  constructor() {
    super("PRL_ARCHIVE_S3_NOT_CONFIGURED: set PRL_ARCHIVE_S3_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY to the Neon bucket");
    this.name = "PrlArchiveNotConfiguredError";
  }
}

/**
 * Resolve the Neon bucket S3 store from the environment, or throw when it is not
 * configured. The standing runner uses this — and only this — so no filesystem
 * writer is on its import path. A non-routine caller that wants an on-disk
 * fallback uses `resolvePrlArchiveStore` in `archive-store-local.ts` instead.
 */
export function resolveS3ArchiveStore(env: NodeJS.ProcessEnv = process.env): S3ArchiveStore {
  const endpoint = env.PRL_ARCHIVE_S3_ENDPOINT;
  const bucket = env.PRL_ARCHIVE_S3_BUCKET;
  const accessKeyId = env.PRL_ARCHIVE_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.PRL_ARCHIVE_S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new PrlArchiveNotConfiguredError();
  return new S3ArchiveStore({
    endpoint, bucket, accessKeyId, secretAccessKey,
    region: env.PRL_ARCHIVE_S3_REGION ?? "us-east-2",
    pathStyle: env.PRL_ARCHIVE_S3_PATH_STYLE !== "false",
  });
}
