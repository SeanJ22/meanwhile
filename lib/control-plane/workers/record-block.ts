/** Source-local record boundaries; pure so publication and isolated replay agree. */
export interface RecordBlock { readonly start: number; readonly end: number }

export const PERSON_NAME_FIELDS = ["name", "candidateName", "personName", "officialName", "fullName"] as const;
export function personNameField(fields: Readonly<Record<string, unknown>>, recordClass?: string): string | null {
  const field = PERSON_NAME_FIELDS.find(key => typeof fields[key] === "string" && String(fields[key]).trim()) ?? null;
  if (field !== "name" || !recordClass) return field;
  // A district or a published-link inventory also has a name. It is not a
  // person record; its deterministic decoder already ties its own fields.
  return /(?:ROSTER|PERSON|CANDIDATE|OFFICEHOLDER|OFFICIAL)/.test(recordClass) ||
    ["email", "phone", "office", "role"].some(key => key in fields) ? field : null;
}

/** Keep UTF-16 offsets while hiding content that never belongs to a visible record. */
function visibleSource(text: string): string {
  return text.replace(/<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, value => " ".repeat(value.length));
}

/** Structural record containers, retaining offsets in the captured page. */
function structuralBlocks(text: string): (RecordBlock & { record: boolean })[] {
  const source = visibleSource(text);
  const stack: { tag: string; start: number; record: boolean; paragraph: boolean }[] = [];
  const blocks: (RecordBlock & { record: boolean; cellRow?: number })[] = [];
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
      const cellRow = /^(td|th)$/.test(tag) ? stack.findLast(parent => parent.tag === "tr")?.start : undefined;
      stack.splice(index);
      const blockEnd = match.index + match[0].length;
      if (item.record || item.paragraph) blocks.push({ start: item.start, end: blockEnd, record: item.record, ...(cellRow !== undefined ? { cellRow } : {}) });
    } else if (!/\/\s*>$/.test(match[0]) && !/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag)) {
      const className = /\bclass\s*=\s*(["'])(.*?)\1/i.exec(match[0])?.[2] ?? "";
      const record = /^(tr|li|article)$/.test(tag) || className.split(/\s+/).some(token => /^(?:card|person|profile|official|candidate|member)$|-(?:card|profile)$/i.test(token));
      stack.push({ tag, start: match.index, record, paragraph: /^(?:p|h[1-6])$/.test(tag) });
    }
  }
  // A div or line break used only to format the name cell does not turn it
  // into an entire person record. Side-by-side person cells repeat that
  // structure within the same row; ordinary scalar columns remain one row.
  return blocks.filter(block => block.cellRow === undefined || blocks.filter(other => other.cellRow === block.cellRow).length > 1);
}

/** The row, list item or card enclosing a name, otherwise its paragraph. */
export function recordBlockAt(text: string, start: number, end: number): RecordBlock | null {
  const source = visibleSource(text);
  if (start < 0 || end <= start || end > text.length || source.slice(start, end).trim() === "") return null;
  if (source.lastIndexOf("<", start) > source.lastIndexOf(">", start)) return null;
  const blocks = structuralBlocks(text).filter(block => block.start <= start && block.end >= end);
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
export function personRecordBlocks(text: string, name: string, contains?: (name: string, text: string) => boolean): readonly RecordBlock[] {
  const source = visibleSource(text);
  const found = new Map<string, RecordBlock>();
  const escaped = name.trim().split(/\s+/).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  if (!escaped) return [];
  for (const match of source.matchAll(new RegExp(escaped, "g"))) {
    const block = recordBlockAt(text, match.index, match.index + match[0].length);
    if (block) found.set(`${block.start}:${block.end}`, block);
  }
  if (contains) {
    const matches = structuralBlocks(text).filter(block => contains(name, text.slice(block.start, block.end)));
    const records = matches.filter(block => block.record);
    for (const block of matches) {
      // A name formatted across tags/entities still anchors its own row.
      // Exclude an outer container when a smaller record holds the same name,
      // and a paragraph when it is only part of a matching record.
      if (block.record ? records.some(other => other !== block && other.start >= block.start && other.end <= block.end)
        : records.some(other => other.start <= block.start && other.end >= block.end)) continue;
      found.set(`${block.start}:${block.end}`, block);
    }
  }
  return [...found.values()];
}

/** At most this many dropped fields are named in one detective brief. */
const OUTSIDE_BLOCK_BRIEF_LIMIT = 20;

/** A field found only outside its person's own row was dropped and never publishes; the next investigation is a detective with each dropped field in its brief. The kept record is not held. */
export function outsideRecordBlockBriefs(findings: readonly { readonly code: string; readonly detail: string; readonly field?: string }[]): string[] {
  const lines = new Set<string>();
  for (const finding of findings) {
    if (finding.code !== "FIELD_OUTSIDE_RECORD_BLOCK") continue;
    let held: { name?: unknown; value?: unknown; quote?: unknown; sourceUrl?: unknown } = {};
    try { held = JSON.parse(finding.detail) as typeof held; } catch { /* an unstructured detail still names the field */ }
    const text = (value: unknown) => typeof value === "string" && value.trim() ? JSON.stringify(value.slice(0, 200)) : null;
    const name = text(held.name), value = text(held.value), quote = text(held.quote), url = typeof held.sourceUrl === "string" ? held.sourceUrl : null;
    lines.add(`Field ${finding.field ?? "unknown"}${name ? ` for ${name}` : ""} was dropped because ${value ? `the value ${value}` : "its value"} sits outside that person's own record` +
      `${quote ? ` (quoted ${quote})` : ""}${url ? ` on ${url}` : ""}. Find this person's own value in their row, card or paragraph, or a newer source; never take it from another person's row.`);
    if (lines.size >= OUTSIDE_BLOCK_BRIEF_LIMIT) break;
  }
  return [...lines];
}
