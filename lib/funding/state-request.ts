import { createHash } from "node:crypto";
import { sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { CampaignFinanceResource } from "./state-sources.ts";

export async function campaignSession(resource: CampaignFinanceResource, vault: EvidenceStore, response: (url: string) => Promise<Response>): Promise<CampaignFinanceResource> {
  const session = resource.session;
  if (!session) return resource;
  if (new URL(session.url).origin !== new URL(resource.url).origin) throw new Error("The campaign request session crosses its publisher.");
  const page = await response(session.url), reader = page.body?.getReader();
  if (!reader) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The campaign request form has no body.");
  const buffer = Buffer.allocUnsafe(4 * 1024 * 1024);
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (size + value.byteLength > buffer.length) { await reader.cancel(); throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The campaign request form exceeds one metadata page."); }
      buffer.set(value, size); size += value.byteLength;
    }
  } finally { reader.releaseLock(); }
  const bytes = buffer.subarray(0, size), hash = createHash("sha256").update(bytes).digest("hex");
  await vault.put(`project/meanwhile/source/campaign-finance-form/${hash}`, bytes, { contentHash: `sha256-${hash}`, contentType: "text/html", byteLength: size });
  const fields = { ...resource.body };
  if (session.tokenField) {
    const inputs = [...bytes.toString("utf8").matchAll(/<input\b[^>]*>/gi)];
    const token = inputs.flatMap(([tag]) => {
      const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map(match => [match[1].toLowerCase(), match[3]]));
      return attrs.name === session.tokenField && attrs.value ? [attrs.value] : [];
    });
    if (!token.length || new Set(token).size !== 1) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The campaign request form has no unambiguous public form token.");
    fields[session.tokenField] = token[0];
  }
  return { ...resource, body: fields, headers: { ...resource.headers,
    cookie: page.headers.getSetCookie().map(value => value.split(";")[0]).join("; "), referer: session.url } };
}
