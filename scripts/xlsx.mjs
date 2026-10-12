/**
 * Spreadsheet read and write, with a built-in ZIP codec (an .xlsx is a ZIP of XML parts).
 *
 * The writer emits `inlineStr` cells; Excel rewrites saved workbooks with a shared-string
 * table, so the reader reads `sharedStrings.xml` whenever it is present.
 * Archive timestamps come from `pnpm stamp`, never the wall clock, so output is byte-stable.
 */

import { deflateRawSync } from "node:zlib";
import { readZipEntries } from "../lib/sources/archive.ts";

/* ------------------------------------------------------------------- zip --- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

/** DOS date/time from the stamped day at noon — deterministic, never the clock. */
function dosStamp(stampedToday) {
  const [y, m, d] = stampedToday.split("-").map(Number);
  return {
    time: (12 << 11) | (0 << 5) | 0,
    date: ((y - 1980) << 9) | (m << 5) | d,
  };
}

export function zip(entries, stampedToday) {
  const { time, date } = dosStamp(stampedToday);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const comp = deflateRawSync(data, { level: 9 });

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    locals.push(local, comp);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);

    offset += local.length + comp.length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, cd, eocd]);
}

/**
 * Every entry in a ZIP, by name, decompressed.
 *
 * Walks the central directory: a local header can carry a zero length with the
 * real one in a trailing data descriptor.
 */
export function unzip(buffer) {
  return new Map(readZipEntries(buffer).map(entry => [entry.name, entry.data]));
}

/* ------------------------------------------------------------------ xlsx --- */

/** Escape for XML, and drop the control characters XML 1.0 forbids (one makes the workbook unopenable). */
// Keep these as escapes, never literal bytes.
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/** Excel refuses a cell over this, and refuses the whole FILE because of it. */
export const CELL_CAP = 32_767;

export function xml(s) {
  return String(s ?? "")
    .replace(XML_FORBIDDEN, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unxml(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

export function colRef(n) {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) {
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  }
  return s;
}

function colIndex(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function sheetXml(header, rows, widths) {
  const lastCol = colRef(header.length);
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  parts.push(
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
  );
  // Freeze the header so a long tab stays readable while scrolling.
  parts.push(
    '<sheetViews><sheetView workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      "</sheetView></sheetViews>",
  );
  parts.push("<cols>");
  widths.forEach((w, i) => {
    parts.push(`<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`);
  });
  parts.push("</cols>");
  parts.push("<sheetData>");

  const cell = (r, c, v, style) =>
    `<c r="${colRef(c)}${r}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;

  parts.push(
    `<row r="1" ht="28" customHeight="1">${header.map((h, i) => cell(1, i + 1, h, 1)).join("")}</row>`,
  );
  rows.forEach((row, ri) => {
    const r = ri + 2;
    parts.push(`<row r="${r}">${row.map((v, i) => cell(r, i + 1, v, 2)).join("")}</row>`);
  });

  parts.push("</sheetData>");
  parts.push(`<autoFilter ref="A1:${lastCol}${rows.length + 1}"/>`);
  parts.push("</worksheet>");
  return Buffer.from(parts.join(""), "utf8");
}

const STYLES = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2">' +
    '<font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
    "</fonts>" +
    '<fills count="3">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill>' +
    "</fills>" +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    "</cellXfs>" +
    "</styleSheet>",
  "utf8",
);

/**
 * A workbook from `[{ name, header, rows, widths }]`.
 *
 * `rows` is an array of arrays of strings, aligned to `header`.
 */
export function buildWorkbook(sheets, stampedToday) {
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("") +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    "</Types>";

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    sheets
      .map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("") +
    "</sheets></workbook>";

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    "</Relationships>";

  const entries = [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRels, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbook, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRels, "utf8") },
    { name: "xl/styles.xml", data: STYLES },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: sheetXml(s.header, s.rows, s.widths),
    })),
  ];

  return zip(entries, stampedToday);
}

/* ---------------------------------------------------------------- reader --- */

function sharedStringsOf(files) {
  const part = files.get("xl/sharedStrings.xml");
  if (!part) return [];
  const text = part.toString("utf8");
  const out = [];
  // One <si> per shared string; its text may be split across many <t> runs, so join them all.
  for (const si of text.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let s = "";
    for (const t of si[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += unxml(t[1]);
    out.push(s);
  }
  return out;
}

/**
 * Every sheet in a workbook, as `{ name, rows }` where `rows[0]` is the header.
 * Excel omits empty cells, so gaps are filled to keep every row the header's width.
 */
export function readWorkbook(buffer) {
  const files = unzip(buffer);
  const shared = sharedStringsOf(files);

  const workbookXml = files.get("xl/workbook.xml");
  if (!workbookXml) throw new Error("not an xlsx — xl/workbook.xml is missing");
  const relsXml = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const relTarget = new Map();
  for (const m of relsXml.matchAll(/<Relationship\s([^>]*)\/>/g)) {
    const id = /Id="([^"]+)"/.exec(m[1])?.[1];
    const target = /Target="([^"]+)"/.exec(m[1])?.[1];
    if (id && target) relTarget.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }

  const sheets = [];
  let ordinal = 0;
  for (const m of workbookXml.toString("utf8").matchAll(/<sheet\s([^>]*)\/>/g)) {
    ordinal += 1;
    const attrs = m[1];
    const name = unxml(/name="([^"]*)"/.exec(attrs)?.[1] ?? `Sheet${ordinal}`);
    const rid = /r:id="([^"]+)"/.exec(attrs)?.[1];
    const target = (rid && relTarget.get(rid)) || `worksheets/sheet${ordinal}.xml`;
    const part = files.get(`xl/${target}`);
    if (!part) throw new Error(`sheet "${name}" names a part that is not in the file`);
    sheets.push({ name, rows: parseSheet(part.toString("utf8"), shared) });
  }
  return sheets;
}

function parseSheet(text, shared) {
  const rows = [];
  let width = 0;
  for (const rowM of text.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cellM of rowM[1].matchAll(/<c\s([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellM[1];
      const inner = cellM[3] ?? "";
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /t="([^"]*)"/.exec(attrs)?.[1] ?? "n";
      const at = ref ? colIndex(ref) - 1 : cells.length;
      while (cells.length < at) cells.push("");

      let value = "";
      if (type === "s") {
        const idx = Number(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "-1");
        value = shared[idx] ?? "";
      } else if (type === "inlineStr") {
        let s = "";
        for (const t of inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += unxml(t[1]);
        value = s;
      } else if (type === "str") {
        value = unxml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
      } else {
        value = unxml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
      }
      cells.push(value);
    }
    width = Math.max(width, cells.length);
    rows.push(cells);
  }
  for (const r of rows) while (r.length < width) r.push("");
  return rows;
}

/* ------------------------------------------------------------------- csv --- */

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/** Always quoted. A tracker cell holds commas, quotes and newlines routinely. */
export function toCsv(header, rows) {
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return (
    [header.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n") + "\n"
  );
}
