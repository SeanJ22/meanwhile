/**
 * **THE CENSUS OF GOVERNMENTS, CONFIRMED BYTE FOR BYTE.** (2026-09-23.)
 *
 * Registration derives every state's governments from the committed reference
 * (`data/derived/registration/`), which was built from the 2022 Census of
 * Governments. Each routine run re-reads that file from census.gov and holds
 * it to the exact bytes the reference was built from: a different size or
 * hash is a new Census vintage (or a damaged transfer), refused by name, and
 * nothing moves until the reference is rebuilt from it.
 *
 * The response is read only under the acquisition deadline's signal, capped
 * at twice the pinned size, and accepted only from census.gov over HTTPS.
 */
import { createHash } from "node:crypto";

import { readPublisherBody, requestPublisher, sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import { REGISTRATION_SOURCE_BYTES, REGISTRATION_SOURCE_SHA256, REGISTRATION_SOURCE_URL } from "./publication.ts";

export interface RegistrationSourceReceipt {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly retrievedAt: string;
  readonly sha256: string;
  readonly bytes: number;
}

const LABEL = "Census of Governments (2022)";

function userAgent(): string {
  const contact = process.env.INGEST_CONTACT_EMAIL?.trim();
  return `we-the-people registration (${contact ? `contact: ${contact}` : "https://github.com/SeanJ22/we-the-people"})`;
}

export async function acquireRegistrationSource(options: { readonly signal: AbortSignal; readonly fetchImpl?: typeof fetch; readonly now?: () => Date }): Promise<RegistrationSourceReceipt> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await requestPublisher(LABEL, () => fetchImpl(REGISTRATION_SOURCE_URL, { headers: { "user-agent": userAgent() }, signal: options.signal }));
  const finalUrl = response.url || REGISTRATION_SOURCE_URL;
  let host = "";
  try {
    const u = new URL(finalUrl);
    host = u.protocol === "https:" ? u.hostname : "";
  } catch {
    host = "";
  }
  if (host !== "www2.census.gov") {
    throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", `${LABEL}: the response came from ${finalUrl}, not census.gov over HTTPS.`);
  }
  if (!response.ok) {
    throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", `${LABEL}: census.gov answered HTTP ${response.status}.`);
  }
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > 2 * REGISTRATION_SOURCE_BYTES) {
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
  return { requestedUrl: REGISTRATION_SOURCE_URL, finalUrl, httpStatus: response.status, retrievedAt: (options.now ?? (() => new Date()))().toISOString(), sha256, bytes: body.byteLength };
}
