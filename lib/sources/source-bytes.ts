/** Bounded complete source bytes. Limits apply while reading, before allocation or parsing. */
export async function readCompleteResponse(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("SOURCE_BYTE_BOUND_INVALID");
  const refused = async (reason: string): Promise<never> => {
    await response.body?.cancel().catch(() => {});
    throw new Error(`SOURCE_RESPONSE_INCOMPLETE:${reason}`);
  };
  if (response.status === 206) return refused("partial content");
  const encoded = response.headers.get("content-encoding");
  const declaredText = response.headers.get("content-length");
  const declared = declaredText !== null && /^\d+$/.test(declaredText) ? Number(declaredText) : null;
  if (declared !== null && (!Number.isSafeInteger(declared) || declared > maxBytes)) return refused("declared byte bound exceeded");
  const chunks: Uint8Array[] = []; let size = 0;
  const reader = response.body?.getReader();
  if (reader) {
    try {
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) throw new Error("SOURCE_RESPONSE_INCOMPLETE:streamed byte bound exceeded");
        chunks.push(chunk.value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
  }
  if ((!encoded || encoded === "identity") && declared !== null && size !== declared) throw new Error("SOURCE_RESPONSE_INCOMPLETE:content length mismatch");
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
