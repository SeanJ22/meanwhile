import { inflateRawSync } from "node:zlib";
import type { VotingExtraction } from "./voting-source-types.ts";

export type VotingTable = { headers: string[]; rows: string[][]; title?: string; documentTitle?: string; lastUpdated?: string };
export function decodeVotingBytes(bytes: Uint8Array): string {
  return new TextDecoder(bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8").decode(bytes);
}
export function sourceText(value: string): string {
  return value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&#x([a-f0-9]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/[\t ]+/g, " ").replace(/ *\n */g, "\n").trim();
}
export function delimitedVotingRows(text: string, delimiter = ","): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (ch === delimiter && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function tableFromRows(rows: string[][], config: VotingExtraction = {}): VotingTable {
  if (config.headers) return { headers: config.headers, rows: rows.slice(config.headerRow ?? 0) };
  const header = config.headerRow ?? 0;
  return { headers: rows[header] ?? [], rows: rows.slice(header + 1) };
}
export function htmlTableFragments(html: string): { body: string; originalBody: string; at: number; attributes: string }[] {
  const tables: { body: string; originalBody: string; at: number; attributes: string }[] = [];
  const stack: { at: number; start: number; attributes: string; children: [number, number][] }[] = [];
  for (const tag of html.matchAll(/<\/?table\b[^>]*>/gi)) {
    if (!/^<\//.test(tag[0])) stack.push({ at: tag.index, start: tag.index + tag[0].length, attributes: tag[0], children: [] });
    else {
      const open = stack.pop(); if (!open) continue;
      const originalBody = html.slice(open.start, tag.index);
      let body = originalBody;
      for (const [from, to] of open.children.reverse()) body = body.slice(0, from - open.start) + body.slice(to - open.start);
      tables.push({ body, originalBody, at: open.at, attributes: open.attributes });
      stack.at(-1)?.children.push([open.at, tag.index + tag[0].length]);
    }
  }
  return tables.sort((a, b) => a.at - b.at);
}
export function htmlVotingTables(html: string): VotingTable[] {
  return htmlTableFragments(html).flatMap(tableMarkup => {
    const spans = new Map<number, { remaining: number; value: string }>();
    const rows = [...tableMarkup.body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(tr => {
      const row: string[] = [];
      for (const [index, span] of spans) { row[index] = span.value; span.remaining--; if (!span.remaining) spans.delete(index); }
      let at = 0;
      for (const td of tr[1]!.matchAll(/<t[hd]\b([^>]*)>([\s\S]*?)<\/t[hd]>/gi)) {
        while (row[at] !== undefined) at++;
        const value = sourceText(td[2]!), colspan = Math.max(1, Number(td[1]!.match(/colspan=["']?(\d+)/i)?.[1] ?? 1)), rowspan = Math.max(1, Number(td[1]!.match(/rowspan=["']?(\d+)/i)?.[1] ?? 1));
        for (let n = 0; n < colspan; n++) { row[at + n] = value; if (rowspan > 1) spans.set(at + n, { remaining: rowspan - 1, value }); }
        at += colspan;
      }
      return Array.from({ length: row.length }, (_, i) => row[i] ?? "");
    }).filter(r => r.some(Boolean));
    const table = tableFromRows(rows);
    const preceding = html.slice(0, tableMarkup.at), headings = [...preceding.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)];
    const sectionLabels = [...preceding.matchAll(/<div\b[^>]*\balt=["']([^"']+)["'][^>]*>/gi)];
    const title = sourceText(tableMarkup.body.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i)?.[1] ?? sectionLabels.at(-1)?.[1] ?? headings.at(-1)?.[1] ?? tableMarkup.attributes);
    return table.headers.length ? [{ ...table, title }] : [];
  });
}

/** XLSX is a ZIP of XML. Read the central directory, including data-descriptor ZIPs. */
function workbookFiles(bytes: Uint8Array): Map<string, string> {
  const zip = Buffer.from(bytes); let end = -1;
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 65557); at--) if (zip.readUInt32LE(at) === 0x06054b50) { end = at; break; }
  if (end < 0) throw new Error("Spreadsheet ZIP directory is missing");
  const count = zip.readUInt16LE(end + 10); let at = zip.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("Spreadsheet ZIP directory is malformed");
    const method = zip.readUInt16LE(at + 10), size = zip.readUInt32LE(at + 20), inflatedSize = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28), extraLength = zip.readUInt16LE(at + 30), commentLength = zip.readUInt16LE(at + 32), local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString();
    at += 46 + nameLength + extraLength + commentLength;
    if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
    if (inflatedSize > 64 * 1024 * 1024) throw new Error("Spreadsheet XML exceeds the document read limit");
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error(`Unsupported spreadsheet compression ${method}`);
    files.set(name, (method === 8 ? inflateRawSync(body, { maxOutputLength: 64 * 1024 * 1024 }) : body).toString("utf8"));
  }
  return files;
}
function attribute(xml: string, name: string): string | undefined { return xml.match(new RegExp(`\\b${name}=["']([^"']*)["']`))?.[1]; }
export function xlsxVotingTables(bytes: Uint8Array, config: VotingExtraction = {}): VotingTable[] {
  const files = workbookFiles(bytes);
  const shared = [...(files.get("xl/sharedStrings.xml") ?? "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(si => [...si[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t => sourceText(t[1]!)).join(""));
  const relationships = new Map([...(files.get("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b[^>]*\/>/g)].map(r => [attribute(r[0], "Id"), attribute(r[0], "Target")]));
  const sheets = [...(files.get("xl/workbook.xml") ?? "").matchAll(/<sheet\b[^>]*\/>/g)].map(s => ({ name: attribute(s[0], "name") ?? "", target: relationships.get(attribute(s[0], "r:id")) }));
  return sheets.filter(s => !config.sheet || s.name === config.sheet).flatMap(sheet => {
    if (!sheet.target) return [];
    const path = sheet.target.startsWith("/") ? sheet.target.slice(1) : `xl/${sheet.target}`;
    const xml = files.get(path); if (!xml) return [];
    const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(r => {
      const row: string[] = [];
      for (const cell of r[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attribute(cell[1]!, "r")?.match(/^[A-Z]+/)?.[0] ?? "A";
        let index = 0; for (const char of ref) index = index * 26 + char.charCodeAt(0) - 64;
        const value = cell[2]?.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
        row[index - 1] = attribute(cell[1]!, "t") === "s" ? shared[Number(value)] ?? "" : sourceText(attribute(cell[1]!, "t") === "inlineStr" ? cell[2] ?? "" : value);
      }
      return Array.from({ length: row.length }, (_, i) => row[i] ?? "");
    });
    const titleRows = rows.slice(0, config.headerRow ?? 0).flat().filter(Boolean);
    const documentTitle = titleRows.join(" ") || sheet.name;
    const lastUpdated = rows.flat().find(value => /^(?:last\s+)?updated\b/i.test(value))?.replace(/^(?:last\s+)?updated\s*/i, "");
    return [{ ...tableFromRows(rows, config), title: sheet.name, documentTitle, lastUpdated }];
  });
}

export async function pdfVotingTables(bytes: Uint8Array, config: VotingExtraction = {}): Promise<VotingTable[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false }).promise;
  const tables: VotingTable[] = [];
  try {
    const { rowsFromItems, cellsFromRow } = await import("../extract/tables.ts");
    const allRows: string[][] = [];
    let documentTitle: string | undefined, lastUpdated: string | undefined;
    for (let p = 1; p <= doc.numPages; p++) {
      const content = await (await doc.getPage(p)).getTextContent();
      const pageWords = content.items.filter(item => "str" in item).map(item => (item as { str: string }).str).join(" ");
      if (p === 1) documentTitle = pageWords.match(/[^.]{0,80}(?:20\d{2}[^.]{0,60}(?:election|polling|voting)|(?:election|polling|voting)[^.]{0,60}20\d{2})/i)?.[0]?.trim();
      lastUpdated ??= pageWords.match(/(?:last\s+)?updated[:\s]+([^;\n]{0,45}20\d{2})/i)?.[1]?.trim();
      const items = content.items.flatMap(item => {
        if (!("str" in item) || !item.str.trim()) return [];
        const y = item.transform[5]!;
        if ((config.pdfTop !== undefined && y > config.pdfTop) || (config.pdfBottom !== undefined && y < config.pdfBottom)) return [];
        return [{ x: item.transform[4]!, y, width: item.width, text: item.str }];
      });
      if (config.pdfCenteredRecords && config.pdfColumns?.length && config.pdfRecordStart) {
        const colIndex = config.pdfColumns.findIndex(c => c.name === config.pdfRecordStart!.column);
        const start = new RegExp(config.pdfRecordStart.pattern);
        const anchors = items.filter(item => item.x >= config.pdfColumns![colIndex]!.x - 2 && (colIndex + 1 >= config.pdfColumns!.length || item.x < config.pdfColumns![colIndex + 1]!.x - 2) && start.test(item.text.trim())).sort((a, b) => b.y - a.y);
        for (let a = 0; a < anchors.length; a++) {
          const upper = a === 0 ? anchors[a]!.y + 18 : (anchors[a - 1]!.y + anchors[a]!.y) / 2;
          const lower = a + 1 === anchors.length ? anchors[a]!.y - 18 : (anchors[a + 1]!.y + anchors[a]!.y) / 2;
          const cells = config.pdfColumns.map(() => "");
          for (const item of items.filter(item => item.y <= upper && item.y > lower).sort((a, b) => b.y - a.y || a.x - b.x)) {
            let col = 0; for (let c = 0; c < config.pdfColumns.length; c++) if (item.x >= config.pdfColumns[c]!.x - 2) col = c;
            cells[col] = `${cells[col]} ${item.text}`.trim();
          }
          allRows.push(cells);
        }
        continue;
      }
      const rows = rowsFromItems(items).map(row => {
        if (!config.pdfColumns?.length) return cellsFromRow(row);
        const cells = config.pdfColumns.map(() => "");
        for (const item of row) {
          let col = 0; for (let c = 0; c < config.pdfColumns.length; c++) if (item.x >= config.pdfColumns[c]!.x - 2) col = c;
          cells[col] = `${cells[col]} ${item.text}`.trim();
        }
        return cells;
      });
      allRows.push(...rows);
    }
    if (config.pdfColumns?.length && config.pdfRecordStart) {
      const index = config.pdfColumns.findIndex(c => c.name === config.pdfRecordStart!.column);
      const start = new RegExp(config.pdfRecordStart.pattern);
      const records: string[][] = [];
      for (const row of allRows) {
        if (start.test(row[index] ?? "")) records.push(row);
        else if (records.length) for (let c = 0; c < row.length; c++) if (row[c]) records[records.length - 1]![c] = `${records[records.length - 1]![c] ?? ""} ${row[c]}`.trim();
      }
      tables.push({ headers: config.pdfColumns.map(c => c.name), rows: records, documentTitle, lastUpdated });
    } else tables.push({ ...tableFromRows(allRows, { ...config, headers: config.headers ?? config.pdfColumns?.map(c => c.name) }), documentTitle, lastUpdated });
  } finally { await doc.cleanup(); }
  return tables;
}
