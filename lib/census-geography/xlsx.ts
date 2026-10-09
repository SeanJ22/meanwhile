import { readZipEntries } from "../sources/archive.ts";

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (_m, ent: string) => {
    if (ent === "amp") return "&";
    if (ent === "lt") return "<";
    if (ent === "gt") return ">";
    if (ent === "quot") return '"';
    if (ent === "apos") return "'";
    if (ent[0] === "#") {
      const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    }
    return _m;
  });
}

function extractText(fragment: string): string {
  let out = "";
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment)) !== null) out += decodeEntities(m[1]);
  return out;
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1] !== undefined ? extractText(m[1]) : "");
  return out;
}

/** Column index from a cell ref: "A"->0, "Z"->25, "AA"->26. */
function columnIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
    else break;
  }
  return n - 1;
}

function firstWorksheetPart(entries: Map<string, Buffer>): string {
  const wb = entries.get("xl/workbook.xml")?.toString("utf8");
  const rels = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8");
  if (wb && rels) {
    const sheet = wb.match(/<sheet\b[^>]*\sr:id="([^"]+)"/);
    if (sheet) {
      const rel = rels.match(new RegExp(`<Relationship\\b[^>]*\\bId="${sheet[1]}"[^>]*\\bTarget="([^"]+)"`));
      if (rel) {
        const target = rel[1].replace(/^\//, "").replace(/^xl\//, "");
        return `xl/${target}`;
      }
    }
  }
  for (const name of entries.keys()) {
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) return name;
  }
  throw new Error("xlsx: no worksheet part found");
}

/**
 * Read the first worksheet of an xlsx as a dense `string[][]` (rows in document
 * order; each row indexed by column, missing cells are ""). Values are decoded
 * strings; numeric cells keep their raw textual value (leading zeros in codes
 * that Excel stored as numbers must be restored by the caller).
 */
function* worksheetRows(sheetXml: string, shared: readonly string[]): Generator<string[]> {
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let rowM: RegExpExecArray | null;
  while ((rowM = rowRe.exec(sheetXml)) !== null) {
    const inner = rowM[1] ?? "";
    const row: string[] = [];
    let cellM: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    let seq = 0;
    while ((cellM = cellRe.exec(inner)) !== null) {
      const attrs = cellM[1] ?? "";
      const body = cellM[2] ?? "";
      const refM = attrs.match(/\br="([A-Z]+)\d+"/);
      const col = refM ? columnIndex(refM[1]) : seq;
      seq = col + 1;
      const typeM = attrs.match(/\bt="([^"]+)"/);
      const type = typeM ? typeM[1] : "";
      let value = "";
      if (type === "s") {
        const v = body.match(/<v[^>]*>([\s\S]*?)<\/v>/);
        value = v ? shared[Number(v[1])] ?? "" : "";
      } else if (type === "inlineStr") {
        value = extractText(body);
      } else {
        const v = body.match(/<v[^>]*>([\s\S]*?)<\/v>/);
        value = v ? decodeEntities(v[1]) : "";
      }
      row[col] = value;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = "";
    yield row;
  }
}

/** Iterate every named worksheet without materializing all national records.
 * Archive validation happens before the first row can be consumed. */
export function* readXlsxSheets(bytes: Buffer): Generator<{ name: string; rows: Iterable<string[]> }> {
  const entries = new Map(readZipEntries(bytes).map(entry => [entry.name, entry.data]));
  const shared = parseSharedStrings(entries.get("xl/sharedStrings.xml")?.toString("utf8"));
  const workbook = entries.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const relationships = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const targets = new Map<string, string>();
  for (const match of relationships.matchAll(/<Relationship\b([^>]+)\/?\>/g)) {
    const id = /\bId="([^"]+)"/.exec(match[1])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(match[1])?.[1];
    if (id && target && !/\bTargetMode="External"/.test(match[1])) targets.set(id, target.replace(/^\//, "").replace(/^xl\//, ""));
  }
  for (const match of workbook.matchAll(/<sheet\b([^>]+)\/?\>/g)) {
    const name = /\bname="([^"]+)"/.exec(match[1])?.[1];
    const id = /\br:id="([^"]+)"/.exec(match[1])?.[1];
    const target = id ? targets.get(id) : undefined;
    if (!name || !target || target.split("/").includes("..")) throw new Error("xlsx: invalid worksheet relationship");
    const xml = entries.get(`xl/${target}`)?.toString("utf8");
    if (!xml) throw new Error("xlsx: worksheet part is empty");
    yield { name: decodeEntities(name), rows: worksheetRows(xml, shared) };
  }
}

export function readXlsxFirstSheet(bytes: Buffer): string[][] {
  const first = readXlsxSheets(bytes).next().value;
  if (first) return [...first.rows];
  const entries = new Map(readZipEntries(bytes).map(entry => [entry.name, entry.data]));
  const xml = entries.get(firstWorksheetPart(entries))?.toString("utf8");
  if (!xml) throw new Error("xlsx: no worksheet");
  return [...worksheetRows(xml, parseSharedStrings(entries.get("xl/sharedStrings.xml")?.toString("utf8")))];
}
