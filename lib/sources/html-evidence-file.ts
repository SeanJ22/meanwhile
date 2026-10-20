import { createReadStream } from "node:fs";

const MAX_BLOCK = 16_000;
/** The same balanced source containers as htmlEvidenceBlocks, emitted from a fixed-size text window. */
export async function* readHtmlEvidenceFile(path: string): AsyncGenerator<{ kind: "BLOCK" | "LINK"; html: string }> {
  const stack: { tag: string; start: number }[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "", base = 0, scanned = 0;
  const tokens = /<\/?(table|tr|article|li|div|section|p|h[1-6]|a)\b[^>]*>/gi;
  for await (const chunk of createReadStream(path, { highWaterMark: 16 * 1024 })) {
    buffer += decoder.decode(chunk as Buffer, { stream: true });
    tokens.lastIndex = Math.max(0, scanned - base);
    let token: RegExpExecArray | null;
    while ((token = tokens.exec(buffer))) {
      const tag = token[1].toLowerCase(), start = base + token.index, end = base + tokens.lastIndex;
      scanned = end;
      if (!token[0].startsWith("</")) { stack.push({ tag, start }); continue; }
      const index = stack.findLastIndex(open => open.tag === tag);
      if (index < 0) continue;
      const opening = stack[index]; stack.splice(index);
      if (end - opening.start <= MAX_BLOCK && opening.start >= base)
        yield { kind: tag === "a" ? "LINK" : "BLOCK", html: buffer.slice(opening.start-base, end-base) };
    }
    const incomplete = buffer.lastIndexOf("<") > buffer.lastIndexOf(">") ? buffer.lastIndexOf("<") : buffer.length;
    if (buffer.length-incomplete > MAX_BLOCK) throw new Error("HTML_SOURCE_TAG_TOO_LARGE");
    scanned = Math.max(scanned, base+incomplete);
    const keep = Math.max(0, scanned-base-MAX_BLOCK);
    buffer = buffer.slice(keep); base += keep;
    // An enclosing country-sized container can no longer yield a bounded block.
    // Its opening metadata is unnecessary; bounded children still retain their own stack entries.
    for (let index=stack.length-1;index>=0;index--) if (stack[index].start < base) stack.splice(index,1);
  }
  decoder.decode();
}
