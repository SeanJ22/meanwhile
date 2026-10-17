import type { FieldValue, GeneralizedCivicExtractionContract, RecordExtractionShape, RecordFieldMapping, WorkerEvidence } from "./types.ts";
import { isFieldValue } from "./types.ts";

export class RecordEvidenceRefusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
export interface RecordEvidenceCell {
  readonly value: FieldValue;
  readonly locator: string;
  readonly start: number;
  readonly end: number;
}
export interface RecordEvidenceInventory {
  readonly rows: readonly Readonly<Record<string, RecordEvidenceCell>>[];
  readonly declaredCount: number | null;
  readonly omittedFields?: readonly { rowIndex: number; field: string; code: string; detail: string }[];
}
const refuse = (code: string, detail: string): never => { throw new RecordEvidenceRefusal(code, detail); };
export const escapePointer = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");
export function valueAt(root: unknown, path: string): unknown {
  if (path === "") return root;
  if (!path.startsWith("/") || /~(?![01])/.test(path)) return undefined;
  let value = root;
  for (const token of path.slice(1).split("/")) {
    const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** Lexical ranges belong to occurrences, never a search for repeated value text. */
function jsonTokens(text: string): Map<string, { start: number; end: number }> {
  const out = new Map<string, { start: number; end: number }>();
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const quoted = () => { i++; while (i < text.length) { const c = text[i++]; if (c === "\\") i++; else if (c === '"') return; } };
  const visit = (path: string, depth: number): void => {
    if (depth > 64) refuse("JSON_NESTING_LIMIT", "Source evidence exceeds the bounded nesting depth.");
    ws(); const start = i;
    if (text[i] === "{") {
      i++; ws(); const keys = new Set<string>();
      while (text[i] !== "}") {
        const keyStart = i; quoted(); const key = JSON.parse(text.slice(keyStart, i)) as string;
        if (keys.has(key)) refuse("DUPLICATE_JSON_KEY", "Repeated object members cannot silently replace source evidence.");
        keys.add(key); ws(); i++; visit(`${path}/${escapePointer(key)}`, depth + 1); ws();
        if (text[i] !== ",") break; i++; ws();
      }
      i++;
    } else if (text[i] === "[") {
      i++; ws(); let n = 0;
      while (text[i] !== "]") { visit(`${path}/${n++}`, depth + 1); ws(); if (text[i] !== ",") break; i++; ws(); }
      i++;
    } else if (text[i] === '"') quoted();
    else while (i < text.length && !/[\s,}\]]/.test(text[i])) i++;
    out.set(path, { start, end: i });
  };
  visit("", 0); return out;
}
function convert(value: unknown, mapping: RecordFieldMapping): FieldValue {
  if (mapping.type === "SCALAR" && isFieldValue(value)) return value;
  if (mapping.type === "STRING" && typeof value === "string") return value;
  if (mapping.type === "NUMBER") {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value))) return Number(value);
  }
  if (mapping.type === "BOOLEAN") {
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "false") return value === "true";
  }
  return refuse("FIELD_TYPE_MISMATCH", "A mapped source field does not satisfy its explicit scalar type.");
}
function htmlText(raw: string): string {
  if (/<(?:script|style|template)\b/i.test(raw)) refuse("HTML_ACTIVE_CONTENT", "A data cell contains non-record script, style, or template content.");
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return raw.replace(/<[^>]*>/g, " ").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name.startsWith("#")) { const n = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1)); if (n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)) return String.fromCodePoint(n); }
    else if (Object.hasOwn(named, name.toLowerCase())) return named[name.toLowerCase()];
    return refuse("HTML_ENTITY_UNSUPPORTED", `Unsupported entity ${match} requires a different extraction method.`);
  }).replace(/\s+/g, " ").trim();
}
type RawCell = { value: string; start: number; end: number; raw?: string };
function htmlRows(text: string, tableIndex: number): RawCell[][] {
  if ([...text.matchAll(/<(script|style|template)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].some(match => /<table\b/i.test(match[2]))) refuse("HTML_TABLE_UNSUPPORTED", "Table-like text inside scripts or templates needs a DOM-aware extraction method.");
  const tables = [...text.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi)];
  const table = tables[tableIndex];
  if (!table || /<table\b/i.test(table[1])) return refuse("HTML_TABLE_UNSUPPORTED", "Expected a complete, non-nested table at the contracted index.");
  const rows: RawCell[][] = [];
  const matchedRows = [...table[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
  if ([...table[0].matchAll(/<tr\b/gi)].length !== matchedRows.length) refuse("HTML_ROW_INCOMPLETE", "A source table contains an incomplete row; it cannot be silently omitted.");
  for (const row of matchedRows) {
    const cells: RawCell[] = [];
    const matchedCells = [...row[0].matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)];
    if ([...row[0].matchAll(/<(?:td|th)\b/gi)].length !== matchedCells.length) refuse("HTML_CELL_INCOMPLETE", "A source row contains an incomplete cell; mapped positions are ambiguous.");
    for (const cell of matchedCells) {
      if (/\b(?:rowspan|colspan)\s*=/i.test(cell[2])) refuse("HTML_MERGED_CELL_UNSUPPORTED", "Merged cells require an explicit extraction method; positional values would be ambiguous.");
      const start = table.index! + row.index! + cell.index! + cell[0].indexOf(">") + 1;
      const end = start + cell[3].length;
      cells.push({ value: htmlText(cell[3]), start, end, raw: cell[3] });
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

// Visible fields create repair obligations; the parser must still prove each value against its source.
export function rosterTableFieldOmissions(evidence: WorkerEvidence, shape: RecordExtractionShape): readonly string[] {
  if (shape.format !== "HTML_TABLE" || shape.headerRows < 1) return [];
  const rows = htmlRows(evidence.text, shape.tableIndex);
  const headers = rows[shape.headerRows - 1];
  const members = rows.slice(shape.headerRows);
  if (!headers || !members.length) return [];
  const omissions: string[] = [];
  const phoneColumn = headers.findIndex(cell => /^(?:phone|office phone|contact phone|telephone)$/i.test(cell.value));
  if (phoneColumn >= 0 && members.every(row => Boolean(row[phoneColumn]?.value.trim())) &&
    !Object.entries(shape.fields).some(([name, field]) => name === "phone" && field.source === phoneColumn && field.attribute === undefined)) {
    omissions.push("phone");
  }
  // Only literal addresses present in every selected row are mappable by the tabular publisher.
  const emailColumn = headers.findIndex(cell => /^(?:e-?mail|(?:office|official) e-?mail)$/i.test(cell.value));
  if (emailColumn >= 0 && members.every(row => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(row[emailColumn]?.value.trim() ?? "")) &&
    !Object.entries(shape.fields).some(([name, field]) => name === "email" && field.source === emailColumn && field.attribute === undefined)) {
    omissions.push("email");
  }
  // Keep the publisher's wording as a note. A term column alone does not
  // establish current service, a start date, an end date, or a holdover rule.
  const termColumn = headers.findIndex(cell => /^(?:term|term dates?|term ends?|term expires?|term expiration|term of office)$/i.test(cell.value));
  if (termColumn >= 0 && members.every(row => Boolean(row[termColumn]?.value.trim())) &&
    !Object.entries(shape.fields).some(([name, field]) => name === "termNote" && field.source === termColumn && field.attribute === undefined)) {
    omissions.push("termNote");
  }
  const nameColumn = Object.entries(shape.fields).find(([name, field]) => name === "name" && typeof field.source === "number")?.[1].source;
  if (typeof nameColumn === "number" && members.every(row => {
    const anchors = [...(row[nameColumn]?.raw ?? "").matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi)];
    return anchors.length === 1 && Boolean(anchors[0]?.[2]);
  }) && !Object.entries(shape.fields).some(([name, field]) => name === "websiteUrl" && field.source === nameColumn && field.attribute === "href")) {
    omissions.push("websiteUrl");
  }
  return omissions;
}
interface XmlElement { name: string; parent: XmlElement | null; start: number; contentStart: number; contentEnd: number }
/** Balanced XML structure only; no entity, document-type, network or script execution. */
function xmlElements(text: string): XmlElement[] {
  const elements: XmlElement[] = []; const stack: XmlElement[] = []; let roots = 0; let i = 0;
  while (i < text.length) {
    if (text[i] !== "<") { const end = text.indexOf("<", i); const next = end === -1 ? text.length : end; if (!stack.length && text.slice(i, next).trim()) refuse("XML_MALFORMED", "Non-whitespace text exists outside the XML root."); i = next; continue; }
    if (text.startsWith("<!--", i) || text.startsWith("<?", i)) {
      const marker = text.startsWith("<!--", i) ? "-->" : "?>"; const end = text.indexOf(marker, i + 2);
      if (end === -1) refuse("XML_MALFORMED", "An XML comment or declaration is incomplete."); i = end + marker.length; continue;
    }
    if (text.startsWith("<!", i)) refuse("XML_SHAPE_UNSUPPORTED", "DTD, entities, and CDATA require a separate extraction method and are never expanded.");
    let end = i + 1; let quote: string | null = null;
    while (end < text.length) { const char = text[end]; if (quote) { if (char === quote) quote = null; } else if (char === '"' || char === "'") quote = char; else if (char === ">") break; end++; }
    if (end === text.length) refuse("XML_MALFORMED", "An XML tag is incomplete.");
    const tag = text.slice(i + 1, end); const close = /^\/([A-Za-z_][\w:.-]*)\s*$/.exec(tag);
    if (close) {
      const top = stack.pop(); if (!top || top.name !== close[1]) refuse("XML_MALFORMED", "XML closing tags do not balance their source elements."); top!.contentEnd = i;
    } else {
      const open = /^([A-Za-z_][\w:.-]*)(?:\s[\s\S]*?)?\s*(\/)?$/.exec(tag);
      if (!open || /</.test(tag)) refuse("XML_MALFORMED", "An unsupported XML tag cannot supply a record.");
      const element: XmlElement = { name: open![1], parent: stack.at(-1) ?? null, start: i, contentStart: end + 1, contentEnd: end + 1 };
      if (!element.parent) roots++; elements.push(element); if (!/\/\s*$/.test(tag)) stack.push(element);
    }
    i = end + 1;
  }
  if (stack.length || roots !== 1) refuse("XML_MALFORMED", "XML evidence requires exactly one complete root; partial captures remain incomplete.");
  return elements;
}
function delimitedRows(text: string, delimiter: string): RawCell[][] {
  const rows: RawCell[][] = []; let row: RawCell[] = []; let i = 0;
  while (i < text.length) {
    const start = i; let value = "";
    if (text[i] === '"') {
      i++; let closed = false;
      while (i < text.length) {
        if (text[i] === '"') { if (text[i + 1] === '"') i += 2; else { i++; closed = true; break; } }
        else i++;
      }
      if (!closed || (i < text.length && ![delimiter, "\r", "\n"].includes(text[i]))) refuse("DELIMITED_TEXT_MALFORMED", "A quoted source cell is incomplete or has trailing characters.");
      value = text.slice(start + 1, i - 1).replace(/""/g, '"');
    } else {
      while (i < text.length && ![delimiter, "\r", "\n"].includes(text[i])) { if (text[i] === '"') refuse("DELIMITED_TEXT_MALFORMED", "Unexpected quote in an unquoted source cell."); i++; }
      value = text.slice(start, i);
    }
    row.push({ value, start, end: i });
    if (text[i] === delimiter) { i++; if (i === text.length) row.push({ value: "", start: i, end: i }); continue; }
    rows.push(row); row = [];
    if (text[i] === "\r") i++; if (text[i] === "\n") i++;
  }
  if (row.length) rows.push(row);
  return rows;
}

/** A source decoder shared as grammar, with no producer result accepted as input. */
export function inventoryRecordEvidence(evidence: WorkerEvidence, shape: RecordExtractionShape,
  contract?: Pick<GeneralizedCivicExtractionContract, "requiredFields" | "identity" | "dateFields" | "recordClass">): RecordEvidenceInventory {
  const required = new Set([...(contract?.requiredFields ?? []), ...(contract?.identity.keyFields ?? []), ...(contract?.dateFields ?? [])]);
  const omittedFields: { rowIndex: number; field: string; code: string; detail: string }[] = [];
  const optional = (field: string) => contract !== undefined && !required.has(field);
  const absent = (rowIndex: number, field: string, code: string, detail: string) => {
    if (!optional(field)) refuse(code, detail);
    omittedFields.push({ rowIndex, field, code, detail });
  };
  const assignCell = (fields: Record<string, RecordEvidenceCell>, rowIndex: number, field: string, read: () => RecordEvidenceCell) => {
    try {
      const cell = read();
      if (contract?.recordClass === "OFFICIAL_ROSTER" && field === "email" && cell.value !== null && cell.value !== "" &&
        (typeof cell.value !== "string" || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(cell.value.trim()))) {
        refuse("OFFICIAL_EMAIL_NOT_VISIBLE_ADDRESS", `Record ${rowIndex} maps an Email cell without a literal address.`);
      }
      fields[field] = cell;
    } catch (error) {
      if (!(error instanceof RecordEvidenceRefusal) || !optional(field) || ![
        "FIELD_TYPE_MISMATCH", "SOURCE_FIELD_MISSING", "EMPTY_SOURCE_CELL", "HTML_PROFILE_FIELD_MISSING",
        "HTML_LINK_AMBIGUOUS", "HTML_LINK_MISSING", "HTML_LINK_INVALID", "XML_FIELD_AMBIGUOUS", "OFFICIAL_EMAIL_NOT_VISIBLE_ADDRESS",
      ].includes(error.code)) throw error;
      absent(rowIndex, field, error.code, error.message);
    }
  };
  if (shape?.format === "UNSUPPORTED") refuse("SOURCE_SHAPE_UNSUPPORTED", `${shape.mediaType}: ${shape.reason}`);
  if (!shape || !shape.fields || Object.keys(shape.fields).length === 0) refuse("EXTRACTION_MAPPING_MISSING", "An explicit nonempty source field mapping is required.");
  if (Object.values(shape.fields).some(mapping => mapping.attribute !== undefined &&
    (shape.format !== "HTML_TABLE" || mapping.attribute !== "href" || typeof mapping.source !== "number")))
    refuse("FIELD_MAPPING_INVALID", "A link attribute is supported only on an HTML table column.");
  if (shape.format === "HTML_PROFILE") {
    // Mask active content without shifting UTF-16 offsets used to prove each value against its source.
    const inert = evidence.text.replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, match => " ".repeat(match.length));
    const hasClass = (attrs: string, wanted: string): boolean => {
      const declared = /\bclass\s*=\s*(["'])(.*?)\1/i.exec(attrs)?.[2];
      return declared?.split(/\s+/).includes(wanted) ?? false;
    };
    const elements = (tag: "h2" | "ul", className: string) =>
      [...inert.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi"))]
        .filter(match => hasClass(match[1]!, className));
    const heading = elements("h2", "detail-title");
    const details = elements("ul", "detail-list");
    if (heading.length !== 1 || details.length !== 1) refuse("HTML_PROFILE_AMBIGUOUS", "One visible profile heading and one detail list are required.");
    const values = new Map<string, { value: string; start: number; end: number }>();
    const put = (key: string, raw: string, start: number, end: number) => {
      if (values.has(key)) refuse("HTML_PROFILE_AMBIGUOUS", `Repeated profile field ${key} has no unique source span.`);
      values.set(key, { value: htmlText(raw), start, end });
    };
    const h = heading[0]!;
    const headingStart = h.index! + h[0].indexOf(">") + 1;
    put("heading:detail-title", h[2]!, headingStart, headingStart + h[2]!.length);
    const list = details[0]!;
    const items = [...list[2]!.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)];
    if ([...list[2]!.matchAll(/<li\b/gi)].length !== items.length)
      refuse("HTML_PROFILE_INCOMPLETE", "A profile detail list contains an incomplete item.");
    for (const li of items) {
      const spans = [...li[0].matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span\s*>/gi)];
      const label = spans.filter(span => hasClass(span[1]!, "detail-list-label"));
      const value = spans.filter(span => hasClass(span[1]!, "detail-list-value"));
      if (label.length !== 1 || value.length !== 1) refuse("HTML_PROFILE_AMBIGUOUS", "A profile detail needs one label and one value span.");
      const key = `detail:${htmlText(label[0]![2]!).replace(/:\s*$/, "")}`;
      const span = value[0]!;
      const start = list.index! + list[0].indexOf(">") + 1 + li.index! + span.index! + span[0].indexOf(">") + 1;
      put(key, span[2]!, start, start + span[2]!.length);
    }
    const fields: Record<string, RecordEvidenceCell> = Object.create(null);
    for (const [field, mapping] of Object.entries(shape.fields)) {
      const source = mapping.source;
      if (typeof source !== "string" || !/^(?:heading:detail-title|detail:[A-Za-z][A-Za-z ]{0,79})$/.test(source)) {
        throw new RecordEvidenceRefusal("HTML_PROFILE_MAPPING_INVALID", "Profile fields need an exact heading:detail-title or detail:Label source selector.");
      }
      assignCell(fields, 0, field, () => {
        const scalar = values.get(source);
        if (!scalar?.value) throw new RecordEvidenceRefusal("HTML_PROFILE_FIELD_MISSING", `The visible profile has no ${source} value.`);
        return { value: convert(scalar.value, mapping), locator: `/profile/${escapePointer(source)}`,
          start: scalar.start, end: scalar.end };
      });
    }
    return { rows: [fields], declaredCount: null, omittedFields };
  }
  if (shape.format === "TEXT_BLOCKS") {
    const labels = Object.values(shape.fields).map(mapping => mapping.source);
    if (!shape.recordStart?.trim() || shape.recordStart.length > 4096 ||
      (shape.recordEnd !== undefined && (!shape.recordEnd.trim() || shape.recordEnd.length > 4096)) ||
      labels.some(label => typeof label !== "string" || !label.trim() || label.length > 4096) || new Set(labels).size !== labels.length) {
      return refuse("TEXT_BLOCK_MAPPING_INVALID", "Record boundaries and distinct field labels must be actual bounded literal source text.");
    }
    const starts: number[] = [];
    for (let at = evidence.text.indexOf(shape.recordStart); at !== -1; at = evidence.text.indexOf(shape.recordStart, at + shape.recordStart.length)) starts.push(at);
    return { declaredCount: null, omittedFields, rows: starts.map((start, index) => {
      let end = starts[index + 1] ?? evidence.text.length;
      if (shape.recordEnd !== undefined) {
        const found = evidence.text.indexOf(shape.recordEnd, start + shape.recordStart.length);
        if (found < 0 || found >= end) refuse("TEXT_BLOCK_END_MISSING", `Record ${index} lacks its contracted ending.`);
        end = found;
      }
      const positions = Object.entries(shape.fields).flatMap(([field, mapping]) => {
        const label = mapping.source as string;
        const found = evidence.text.indexOf(label, start);
        const again = found < 0 ? -1 : evidence.text.indexOf(label, found + label.length);
        if (found < start || found >= end) { absent(index, field, "SOURCE_FIELD_MISSING", `Record ${index} lacks a label for ${field}.`); return []; }
        if (again >= 0 && again < end) refuse("TEXT_FIELD_AMBIGUOUS", `Record ${index} needs exactly one label for ${field}.`);
        return [{ field, mapping, found, valueStart: found + label.length }];
      }).sort((a, b) => a.found - b.found);
      const fields: Record<string, RecordEvidenceCell> = Object.create(null);
      for (let i = 0; i < positions.length; i++) {
        const cell = positions[i];
        let valueStart = cell.valueStart, valueEnd = positions[i + 1]?.found ?? end;
        while (valueStart < valueEnd && /\s/.test(evidence.text[valueStart])) valueStart++;
        while (valueEnd > valueStart && /\s/.test(evidence.text[valueEnd - 1])) valueEnd--;
        assignCell(fields, index, cell.field, () => {
          if (valueStart >= valueEnd) refuse("EMPTY_SOURCE_CELL", `Record ${index} has no source value for ${cell.field}.`);
          return { value: convert(evidence.text.slice(valueStart, valueEnd), cell.mapping), locator: `/blocks/${index}/${escapePointer(cell.field)}`, start: valueStart, end: valueEnd };
        });
      }
      return fields;
    }) };
  }
  if (shape.format === "JSON_RECORDS") {
    let root: unknown; try { root = JSON.parse(evidence.text); } catch { return refuse("JSON_MALFORMED", "The captured source is not complete valid JSON."); }
    const tokens = jsonTokens(evidence.text); const rows = valueAt(root, shape.rowsPointer);
    if (!Array.isArray(rows)) return refuse("JSON_ROWS_MISSING", "The contracted source pointer does not identify a record array.");
    const headerRows = shape.headerRows ?? 0;
    if (!Number.isSafeInteger(headerRows) || headerRows < 0 || headerRows > rows.length) return refuse("TABLE_SCOPE_INVALID", "JSON table header rows must be explicitly bounded by the retained array.");
    const count = shape.countPointer === undefined ? null : valueAt(root, shape.countPointer);
    if (count !== null && (!Number.isSafeInteger(count) || Number(count) < 0)) refuse("DECLARED_COUNT_INVALID", "The declared source count is not a nonnegative safe integer.");
    return { declaredCount: count as number | null, omittedFields, rows: rows.slice(headerRows).map((row, bodyIndex) => {
      const index = bodyIndex + headerRows;
      const fields: Record<string, RecordEvidenceCell> = Object.create(null);
      for (const [field, mapping] of Object.entries(shape.fields)) {
        if (typeof mapping.source !== "string" || !mapping.source.startsWith("/")) refuse("FIELD_MAPPING_INVALID", "JSON field mappings require a relative member pointer.");
        assignCell(fields, bodyIndex, field, () => {
          const locator = `${shape.rowsPointer}/${index}${mapping.source}`; const token = tokens.get(locator);
          if (!token) refuse("SOURCE_FIELD_MISSING", `Row ${index} lacks mapped field ${field}.`);
          return { value: convert(valueAt(row, mapping.source as string), mapping), locator, ...token! };
        });
      }
      return fields;
    }) };
  }
  if (shape.format === "XML_RECORDS") {
    if (!/^[A-Za-z_][\w.-]*$/.test(shape.rowTag) || /<!DOCTYPE|<!ENTITY/i.test(evidence.text)) refuse("XML_SHAPE_UNSUPPORTED", "XML row tags must be simple names and external entities are never resolved.");
    const elements = xmlElements(evidence.text);
    const rows = elements.filter(element => element.name === shape.rowTag).map((row, index) => {
      const fields: Record<string, RecordEvidenceCell> = Object.create(null);
      for (const [field, mapping] of Object.entries(shape.fields)) {
        if (typeof mapping.source !== "string" || !/^[A-Za-z_][\w.-]*$/.test(mapping.source)) refuse("FIELD_MAPPING_INVALID", "XML mappings name a direct text child of the contracted record element.");
        assignCell(fields, index, field, () => {
          const tag = mapping.source as string;
          const matches = elements.filter(element => element.parent === row && element.name === tag);
          if (matches.length !== 1 || elements.some(element => element.parent === matches[0])) refuse("XML_FIELD_AMBIGUOUS", `Record ${index} needs exactly one direct text child for ${field}.`);
          const start = matches[0].contentStart; const end = matches[0].contentEnd;
          if (start === end) refuse("EMPTY_SOURCE_CELL", "An empty XML element cannot support an extracted scalar.");
          return { value: convert(htmlText(evidence.text.slice(start, end)), mapping), locator: `/${shape.rowTag}/${index}/${tag}`, start, end };
        });
      }
      return fields;
    });
    return { rows, declaredCount: null, omittedFields };
  }
  if (shape.format !== "HTML_TABLE" && shape.format !== "DELIMITED_TEXT") return refuse("SOURCE_SHAPE_UNSUPPORTED", "This source format has no deterministic extraction method.");
  if (!Number.isSafeInteger(shape.headerRows) || shape.headerRows < 0 || (shape.format === "HTML_TABLE" && (!Number.isSafeInteger(shape.tableIndex) || shape.tableIndex < 0))) refuse("TABLE_SCOPE_INVALID", "Table selection and header row count must be explicit nonnegative integers.");
  const rows = shape.format === "HTML_TABLE" ? htmlRows(evidence.text, shape.tableIndex) : delimitedRows(evidence.text, shape.delimiter);
  return { declaredCount: null, omittedFields, rows: rows.slice(shape.headerRows).map((row, index) => {
    const fields: Record<string, RecordEvidenceCell> = Object.create(null);
    for (const [field, mapping] of Object.entries(shape.fields)) {
      if (typeof mapping.source !== "number" || !Number.isSafeInteger(mapping.source) || mapping.source < 0) refuse("FIELD_MAPPING_INVALID", "Tabular mappings require a zero-based column index.");
      assignCell(fields, index, field, () => {
        const cell = row[Number(mapping.source)];
        if (!cell || cell.end <= cell.start) refuse("SOURCE_FIELD_MISSING", `Row ${index} lacks mapped field ${field}.`);
        let value = cell.value;
        if (mapping.attribute !== undefined) {
          if (shape.format !== "HTML_TABLE" || mapping.attribute !== "href" || !cell.raw) refuse("FIELD_MAPPING_INVALID", "Link attributes require an HTML table cell.");
          const links = [...cell.raw!.matchAll(/<a\b([^>]*)>/gi)];
          if (links.length !== 1) refuse("HTML_LINK_AMBIGUOUS", `Row ${index} needs exactly one source link for ${field}.`);
          const href = /\bhref\s*=\s*(["'])(.*?)\1/i.exec(links[0][1]);
          const hrefValue = href?.[2];
          if (!hrefValue) refuse("HTML_LINK_MISSING", `Row ${index} lacks a source link for ${field}.`);
          const decoded = htmlText(hrefValue!);
          let url: URL;
          try { url = new URL(decoded, evidence.canonicalUrl); } catch { return refuse("HTML_LINK_INVALID", `Row ${index} has an invalid source link for ${field}.`); }
          if (url.protocol !== "https:" || url.username || url.password) refuse("HTML_LINK_INVALID", `Row ${index} has a non-public source link for ${field}.`);
          value = url.href;
        }
        return { value: convert(value, mapping), start: cell.start, end: cell.end,
          locator: `/${shape.format === "HTML_TABLE" ? `tables/${shape.tableIndex}/` : ""}rows/${index + shape.headerRows}/cells/${mapping.source}${mapping.attribute ? `/@${mapping.attribute}` : ""}` };
      });
    }
    return fields;
  }) };
}
export function recordIdentity(fields: Readonly<Record<string, FieldValue>>, identity: GeneralizedCivicExtractionContract["identity"]): string {
  if (!identity.namespace || identity.keyFields.length === 0 || new Set(identity.keyFields).size !== identity.keyFields.length) refuse("IDENTITY_CONTRACT_INVALID", "Stable identity requires a namespace and distinct source key fields.");
  const values = identity.keyFields.map(field => {
    const value = fields[field];
    if ((typeof value !== "string" && typeof value !== "number") || (typeof value === "string" && !value.trim()) || !isFieldValue(value)) return refuse("IDENTITY_FIELD_MISSING", `Stable identity lacks ${field}.`);
    return encodeURIComponent(`${typeof value}:${value}`);
  });
  return `${identity.namespace}:${values.join(":")}`;
}
export function assertGeneralizedScope(contract: GeneralizedCivicExtractionContract, evidence: WorkerEvidence): void {
  if (!contract.subjectId || !contract.recordClass || !contract.completenessScope.trim() || !contract.jurisdiction.country || !contract.jurisdiction.state || !contract.jurisdiction.canonicalId || !Number.isSafeInteger(contract.methodVersion) || contract.methodVersion < 1) refuse("CONTRACT_SCOPE_MISSING", "Canonical subject, jurisdiction, record class, denominator scope, and method version are required.");
  const scope = contract.sourceScope;
  if (!scope.publisher || !scope.observationArtifactIds.length || scope.sourceId !== evidence.sourceId || !scope.routeIds.includes(evidence.methodRouteId) || !scope.canonicalUrls.includes(evidence.canonicalUrl)) refuse("SOURCE_SCOPE_MISMATCH", "The held artifact must bind to the exact observed publisher, source, route, and URL scope.");
  if (!/^sha256-[0-9a-f]{64}$/.test(evidence.contentHash) || !evidence.artifactId || !evidence.acquiredByAttemptId || !Number.isFinite(Date.parse(evidence.retrievedAt))) refuse("ARTIFACT_PROVENANCE_MISSING", "Evidence requires machine-issued immutable identity, acquisition Attempt, and retrieval timestamp.");
  if (contract.extraction.format !== "UNSUPPORTED" && (contract.requiredFields.length === 0 || [...contract.requiredFields, ...contract.identity.keyFields].some(field => !Object.hasOwn(contract.extraction.fields, field)))) refuse("REQUIRED_MAPPING_MISSING", "Required and identity fields must be explicitly mapped from source evidence.");
  if (contract.extraction.format !== "UNSUPPORTED" && ((contract.expectedSourceDate !== null && !contract.dateFields?.length) || (contract.dateFields ?? []).some(field => !Object.hasOwn(contract.extraction.fields, field)))) refuse("DATE_MAPPING_MISSING", "An expected source date requires explicitly mapped date fields.");
}
