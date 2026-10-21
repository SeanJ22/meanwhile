/** Exact archive hashes resolve to original source fingerprints after credential redaction. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../data/ballot/ba01-source-redactions.json", import.meta.url), "utf8")) as {
  captures: Record<string, {
    rawSha256: string; sanitizedSha256: string;
    rawDecodedSha256: string; sanitizedDecodedSha256: string;
    embeddedBodies: { rawSha256: string; sanitizedSha256: string }[];
  }>;
};
const originals = new Map<string, Set<string>>();
for (const capture of Object.values(manifest.captures)) {
  for (const [sanitized, original] of [
    [capture.sanitizedSha256, capture.rawSha256],
    [capture.sanitizedDecodedSha256, capture.rawDecodedSha256],
    ...capture.embeddedBodies.map(body => [body.sanitizedSha256, body.rawSha256]),
  ]) {
    const values = originals.get(sanitized) ?? new Set<string>();
    values.add(original);
    originals.set(sanitized, values);
  }
}

/** Return an original fingerprint only when the exact sanitized bytes are pinned. */
export function captureSha256(bytes: string | Uint8Array): string {
  const digest = createHash("sha256").update(bytes).digest("hex");
  const candidates = originals.get(digest);
  if (!candidates) return digest;
  if (candidates.size !== 1) throw new Error("Ambiguous original capture fingerprint");
  return candidates.values().next().value!;
}
