/** Runner-only extraction stays separate from evidence checks used by deployed routes. */
export async function votingPdfText(bytes: Uint8Array, url: string): Promise<{ text: string; method: "TEXT_LAYER" | "OCR" }> {
  const { extractTextLayer } = await import("../extract/text-layer.ts");
  const read = await extractTextLayer(new Uint8Array(bytes), url);
  if (read.items.length) return { text: read.items.map(page => page.text).join("\n"), method: "TEXT_LAYER" };
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error(read.reason);
  const { runOcr } = await import("../extract/ocr.ts");
  const ocr = await runOcr(bytes, url);
  if (!ocr.items.length) throw new Error(ocr.reason);
  return { text: ocr.items.map(page => page.text).join("\n"), method: "OCR" };
}
