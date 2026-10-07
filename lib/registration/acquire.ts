/**
 * Census of Governments, confirmed byte for byte. Registration derives every state's governments from
 * the committed reference (`data/derived/registration/`). Each routine run confirms census.gov still
 * serves the exact bytes it was built from, without downloading them when it can:
 *
 * ```
 *   304 Not Modified     nothing changed since the pinned Last-Modified; no body is read
 *   200, other date      the file changed: refused on its headers, body unread
 *   200, pinned date     the server ignored the condition; the body is read and held to the
 *                        pinned size and hash
 * ```
 *
 * A different size, hash or date is a new Census vintage (or a damaged transfer), refused by name. The
 * response is read only under the acquisition deadline's signal, capped at twice the pinned size, and
 * accepted only from census.gov over HTTPS.
 *
 * `@freshness-reads-here` — `retrievedAt` is stamped the moment census.gov answers this run's request.
 */
import { createHash } from "node:crypto";

import { readPublisherBody, requestPublisher, sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import {
  REGISTRATION_SOURCE_BYTES,
  REGISTRATION_SOURCE_LAST_MODIFIED,
  REGISTRATION_SOURCE_SHA256,
  REGISTRATION_SOURCE_URL,
} from "./publication.ts";

export interface RegistrationSourceReceipt {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly retrievedAt: string;
  readonly sha256: string;
  readonly bytes: number;
  /**
   * How the pinned bytes were confirmed: hashed from the body census.gov sent, or confirmed by
   * census.gov answering 304 against the Last-Modified the pinned bytes were served with.
   */
  readonly confirmedBy: "BYTES_HASHED" | "NOT_MODIFIED_SINCE_PIN";
}

const LABEL = "Census of Governments (2022)";

/** The identified User-Agent that registration reads, and the reference extractors behind them, send. */
export function registrationUserAgent(): string {
  const contact = process.env.INGEST_CONTACT_EMAIL?.trim();
  return `we-the-people registration (${contact ? `contact: ${contact}` : "https://github.com/SeanJ22/we-the-people"})`;
}

/** Closes a body this run will not read, so the connection is not held open for it. */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    /* already closed */
  }
}

export async function acquireRegistrationSource(options: { readonly signal: AbortSignal; readonly fetchImpl?: typeof fetch; readonly now?: () => Date }): Promise<RegistrationSourceReceipt> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await requestPublisher(LABEL, () =>
    fetchImpl(REGISTRATION_SOURCE_URL, {
      headers: { "user-agent": registrationUserAgent(), "if-modified-since": REGISTRATION_SOURCE_LAST_MODIFIED },
      signal: options.signal,
    }),
  );
  const retrievedAt = (options.now ?? (() => new Date()))().toISOString();
  const finalUrl = response.url || REGISTRATION_SOURCE_URL;
  let host = "";
  try {
    const u = new URL(finalUrl);
    host = u.protocol === "https:" ? u.hostname : "";
  } catch {
    host = "";
  }
  if (host !== "www2.census.gov") {
    await discard(response);
    throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", `${LABEL}: the response came from ${finalUrl}, not census.gov over HTTPS.`);
  }
  if (response.status === 304) {
    await discard(response);
    return {
      requestedUrl: REGISTRATION_SOURCE_URL,
      finalUrl,
      httpStatus: 304,
      retrievedAt,
      sha256: REGISTRATION_SOURCE_SHA256,
      bytes: REGISTRATION_SOURCE_BYTES,
      confirmedBy: "NOT_MODIFIED_SINCE_PIN",
    };
  }
  if (!response.ok) {
    await discard(response);
    throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", `${LABEL}: census.gov answered HTTP ${response.status}.`);
  }
  const lastModified = response.headers.get("last-modified");
  if (lastModified !== null && lastModified !== REGISTRATION_SOURCE_LAST_MODIFIED) {
    await discard(response);
    throw sourceAcquisitionFailure(
      "PUBLISHER_DOCUMENT_INVALID",
      `${LABEL}: census.gov reports the file last modified ${lastModified}, not the pinned vintage's ${REGISTRATION_SOURCE_LAST_MODIFIED}; its body was not read. A new Census vintage is registered only after the reference is rebuilt from it.`,
    );
  }
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > 2 * REGISTRATION_SOURCE_BYTES) {
    await discard(response);
    throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `${LABEL}: census.gov declares ${declared} bytes, far from the pinned ${REGISTRATION_SOURCE_BYTES}; a new vintage needs the reference rebuilt.`);
  }
  const body = new Uint8Array(await readPublisherBody(LABEL, () => response.arrayBuffer()));
  const sha256 = createHash("sha256").update(body).digest("hex");
  if (body.byteLength !== REGISTRATION_SOURCE_BYTES || sha256 !== REGISTRATION_SOURCE_SHA256) {
    throw sourceAcquisitionFailure(
      "PUBLISHER_DOCUMENT_INVALID",
      `${LABEL}: census.gov served ${body.byteLength} bytes with sha256 ${sha256}, not the pinned ${REGISTRATION_SOURCE_BYTES} bytes ${REGISTRATION_SOURCE_SHA256}. A new Census vintage is registered only after the reference is rebuilt from it.`,
    );
  }
  return { requestedUrl: REGISTRATION_SOURCE_URL, finalUrl, httpStatus: response.status, retrievedAt, sha256, bytes: body.byteLength, confirmedBy: "BYTES_HASHED" };
}
