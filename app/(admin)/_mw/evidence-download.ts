/** Reassemble an explicitly requested private RAW capture below Netlify's response cap. */
export async function readVerifiedAdminEvidence(path: string, origin: string, fetcher: typeof fetch = fetch):
  Promise<{ bytes: Uint8Array; filename: string }> {
  const url = new URL(path, origin);
  if (url.origin !== origin ||
      !/^\/api\/admin\/evidence\/[a-z][a-z0-9-]{1,120}\/[a-z][a-z0-9-]{1,120}\/(ar-[a-z0-9-]{1,120})$/.test(url.pathname) ||
      url.search || url.hash) throw new Error("INVALID_PRIVATE_EVIDENCE_PATH");
  const identity = url.pathname.match(/\/(ar-[a-z0-9-]{1,120})$/)?.[1];
  if (!identity) throw new Error("INVALID_PRIVATE_EVIDENCE_PATH");
  const first = await fetcher(url, { credentials: "same-origin", cache: "no-store" });
  let expectedLength: number;
  let expectedHash: string;
  let parts: number;
  let chunks: Uint8Array[];
  if (first.status === 409) {
    const plan = await first.json() as Record<string, unknown>;
    if (plan.code !== "CHUNKED_DOWNLOAD_REQUIRED" ||
        !Number.isSafeInteger(plan.byteLength) || (plan.byteLength as number) < 1 ||
        (plan.byteLength as number) > 32 * 1024 * 1024 ||
        plan.chunkBytes !== 4 * 1024 * 1024 ||
        !Number.isSafeInteger(plan.parts) ||
        plan.parts !== Math.ceil((plan.byteLength as number) / (plan.chunkBytes as number)) ||
        typeof plan.contentHash !== "string" || !/^sha256-[0-9a-f]{64}$/.test(plan.contentHash))
      throw new Error("PRIVATE_EVIDENCE_CHUNK_PLAN_INVALID");
    expectedLength = plan.byteLength as number;
    expectedHash = plan.contentHash;
    parts = plan.parts as number;
    chunks = [];
    for (let part = 0; part < parts; part++) {
      const partUrl = new URL(url);
      partUrl.searchParams.set("part", String(part));
      const response = await fetcher(partUrl, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok || response.headers.get("x-evidence-source") !== "verified-original-capture" ||
          response.headers.get("x-evidence-sha256") !== expectedHash ||
          response.headers.get("x-evidence-full-length") !== String(expectedLength) ||
          response.headers.get("x-evidence-parts") !== String(parts) ||
          response.headers.get("x-evidence-part") !== String(part) ||
          response.headers.get("x-evidence-byte-offset") !== String(part * 4 * 1024 * 1024))
        throw new Error("PRIVATE_EVIDENCE_PART_INVALID");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== Math.min(4 * 1024 * 1024, expectedLength - part * 4 * 1024 * 1024))
        throw new Error("PRIVATE_EVIDENCE_PART_LENGTH_MISMATCH");
      chunks.push(bytes);
    }
  } else {
    if (!first.ok || first.headers.get("x-evidence-source") !== "verified-original-capture")
      throw new Error("PRIVATE_EVIDENCE_UNAVAILABLE");
    expectedLength = Number(first.headers.get("x-evidence-full-length"));
    expectedHash = first.headers.get("x-evidence-sha256") ?? "";
    parts = Number(first.headers.get("x-evidence-parts"));
    if (!Number.isSafeInteger(expectedLength) || expectedLength < 1 ||
        expectedLength > 4 * 1024 * 1024 || parts !== 1 ||
        !/^sha256-[0-9a-f]{64}$/.test(expectedHash)) throw new Error("PRIVATE_EVIDENCE_METADATA_INVALID");
    chunks = [new Uint8Array(await first.arrayBuffer())];
  }
  const complete = new Uint8Array(expectedLength);
  let cursor = 0;
  for (const chunk of chunks) { complete.set(chunk, cursor); cursor += chunk.length; }
  if (cursor !== expectedLength) throw new Error("PRIVATE_EVIDENCE_LENGTH_MISMATCH");
  const hashBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", complete.buffer));
  const actualHash = `sha256-${Array.from(hashBytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
  if (actualHash !== expectedHash) throw new Error("PRIVATE_EVIDENCE_HASH_MISMATCH");
  return { bytes: complete, filename: `${identity}.bin` };
}

/** Only an explicit Admin click should call this; availability never triggers a download. */
export async function downloadVerifiedAdminEvidence(path: string, fetcher: typeof fetch = fetch): Promise<void> {
  const { bytes, filename } = await readVerifiedAdminEvidence(path, window.location.origin, fetcher);
  const file = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(file).set(bytes);
  const objectUrl = URL.createObjectURL(new Blob([file], { type: "application/octet-stream" }));
  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.rel = "noopener noreferrer";
    link.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}
