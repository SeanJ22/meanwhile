/** Bounded, balanced source containers retain their table context. Nested
 * divs must not cut a member card off before its contact or portrait fields. */
export function htmlEvidenceBlocks(html: string): { html: string; ancestors: string[] }[] {
  const stack: { tag: string; start: number; opening: string }[] = [];
  const blocks: { html: string; ancestors: string[] }[] = [];
  for (const token of html.matchAll(/<\/?(table|tr|article|li|div|section|p|h[1-6])\b[^>]*>/gi)) {
    const tag = token[1].toLowerCase();
    if (!token[0].startsWith("</")) {
      stack.push({ tag, start: token.index!, opening: token[0] });
      continue;
    }
    const index = stack.findLastIndex(row => row.tag === tag);
    if (index < 0) continue;
    const opening = stack[index], end = token.index! + token[0].length;
    const ancestors = stack.slice(0, index).filter(row => row.tag === "table").map(row => row.opening);
    stack.splice(index);
    if (end - opening.start <= 16_000) blocks.push({ html: html.slice(opening.start, end), ancestors });
  }
  return blocks;
}
