import { inflateRawSync } from "node:zlib";

function readZipEntries(bytes: Buffer): Map<string, Buffer> {
  const EOCD_SIG = 0x06054b50;
  const CDIR_SIG = 0x02014b50;
  const LOCAL_SIG = 0x04034b50;
  // Find the End Of Central Directory record by scanning backwards (its own
  // record is 22 bytes; a trailing comment can add up to 65535 more).
  let eocd = -1;
  const minScan = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= minScan; i--) {
    if (bytes.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("xlsx: not a ZIP (no end-of-central-directory record)");
  const entryCount = bytes.readUInt16LE(eocd + 10);
  let off = bytes.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>();
  for (let e = 0; e < entryCount; e++) {
    if (bytes.readUInt32LE(off) !== CDIR_SIG) throw new Error("xlsx: corrupt central directory");
    const method = bytes.readUInt16LE(off + 10);
    const compSize = bytes.readUInt32LE(off + 20);
    const nameLen = bytes.readUInt16LE(off + 28);
    const extraLen = bytes.readUInt16LE(off + 30);
    const commentLen = bytes.readUInt16LE(off + 32);
    const localOff = bytes.readUInt32LE(off + 42);
    const name = bytes.toString("utf8", off + 46, off + 46 + nameLen);
    if (bytes.readUInt32LE(localOff) !== LOCAL_SIG) throw new Error(`xlsx: corrupt local header for ${name}`);
    const lNameLen = bytes.readUInt16LE(localOff + 26);
    const lExtraLen = bytes.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = bytes.subarray(dataStart, dataStart + compSize);
    entries.set(name, method === 0 ? Buffer.from(comp) : inflateRawSync(comp));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

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
export function readXlsxFirstSheet(bytes: Buffer): string[][] {
  const entries = readZipEntries(bytes);
  const shared = parseSharedStrings(entries.get("xl/sharedStrings.xml")?.toString("utf8"));
  const sheetXml = entries.get(firstWorksheetPart(entries))?.toString("utf8");
  if (!sheetXml) throw new Error("xlsx: worksheet part is empty");

  const rows: string[][] = [];
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
    rows.push(row);
  }
  return rows;
}
