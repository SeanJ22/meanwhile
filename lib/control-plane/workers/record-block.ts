/** Source-local record boundaries; pure so publication and isolated replay agree. */
export interface RecordBlock { readonly start: number; readonly end: number }

export const PERSON_NAME_FIELDS = ["name", "candidateName", "personName", "officialName", "fullName"] as const;
export function personNameField(fields: Readonly<Record<string, unknown>>): string | null {
  return PERSON_NAME_FIELDS.find(field => typeof fields[field] === "string" && String(fields[field]).trim()) ?? null;
}

/** Keep UTF-16 offsets while hiding content that never belongs to a visible record. */
function visibleSource(text: string): string {
  return text.replace(/<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, value => " ".repeat(value.length));
}

/** The row, list item or card enclosing a name, otherwise its paragraph. */
export function recordBlockAt(text: string, start: number, end: number): RecordBlock | null {
  const source = visibleSource(text);
  if (start < 0 || end <= start || end > text.length || source.slice(start, end).trim() === "") return null;
  const stack: { tag: string; start: number; record: boolean; paragraph: boolean }[] = [];
  const blocks: (RecordBlock & { record: boolean })[] = [];
  for (const match of source.matchAll(/<\/?([a-z][\w:-]*)\b[^>]*>/gi)) {
    const tag = match[1].toLowerCase();
    if (match[0].startsWith("</")) {
      const index = stack.findLastIndex(item => item.tag === tag);
      if (index < 0) continue;
      const item = stack[index];
      // Some rosters lay out entire people in separate table cells. A cell
      // with its own paragraphs/line breaks is a record, unlike a scalar
      // name cell whose office and email occupy neighbouring columns.
      if ((tag === "td" || tag === "th") && /<br\b|<(?:p|div|h[1-6])\b/i.test(source.slice(item.start + source.slice(item.start).indexOf(">") + 1, match.index))) item.record = true;
      stack.splice(index);
      const blockEnd = match.index + match[0].length;
      if ((item.record || item.paragraph) && item.start <= start && blockEnd >= end) blocks.push({ start: item.start, end: blockEnd, record: item.record });
    } else if (!/\/\s*>$/.test(match[0]) && !/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag)) {
      const className = /\bclass\s*=\s*(["'])(.*?)\1/i.exec(match[0])?.[2] ?? "";
      const record = /^(tr|li|article)$/.test(tag) || /(?:^|[\s_-])(?:card|person|profile|official|candidate|member)(?:$|[\s_-])/i.test(className);
      stack.push({ tag, start: match.index, record, paragraph: tag === "p" });
    }
  }
  // A paragraph inside a record is only one cell of it. Prefer the innermost
  // record container, including cards arranged side by side inside a table row.
  const records = blocks.filter(block => block.record);
  const chosen = (records.length ? records : blocks).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
  if (chosen) return { start: chosen.start, end: chosen.end };
  // Never fall back to the whole HTML page for a name outside a record.
  if (/<[a-z][^>]*>/i.test(source)) return null;
  let from = 0;
  for (const boundary of source.matchAll(/\r?\n[ \t]*\r?\n|^\[Page \d+\]\r?\n/gm)) {
    if (boundary.index >= end) return { start: from, end: boundary.index };
    if (boundary.index + boundary[0].length <= start) from = boundary.index + boundary[0].length;
    else if (boundary.index < end) return null;
  }
  return { start: from, end: text.length };
}

/** All distinct paragraphs/rows containing the exact name; no cross-row union. */
export function personRecordBlocks(text: string, name: string): readonly RecordBlock[] {
  const source = visibleSource(text);
  const found = new Map<string, RecordBlock>();
  for (let at = source.indexOf(name); at >= 0; at = source.indexOf(name, at + Math.max(1, name.length))) {
    const block = recordBlockAt(text, at, at + name.length);
    if (block) found.set(`${block.start}:${block.end}`, block);
  }
  return [...found.values()];
}
