import { createReadStream } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openZipFile } from "../sources/archive.ts";
import { decodeUtf8, streamCsvRecords } from "../sources/prl/streaming.ts";
import { readXlsxFileSheets } from "../census-geography/xlsx.ts";

async function* delimitedRows(bytes: AsyncIterable<Uint8Array>): AsyncGenerator<string[]> {
  const iterator = decodeUtf8(bytes)[Symbol.asyncIterator]();
  let header = "";
  try {
    while (!header.includes("\n")) {
      const next = await iterator.next();
      if (next.done) break;
      header += next.value;
      if (header.length > 1024 * 1024) throw new Error("REGISTRATION_SOURCE_HEADER_TOO_LARGE");
    }
    const delimiter = header.split(/\r?\n/, 1)[0].includes("\t") ? "\t" : ",";
    async function* text() {
      yield header.replace(/^\uFEFF/, "");
      for (let next = await iterator.next(); !next.done; next = await iterator.next()) yield next.value;
    }
    yield* streamCsvRecords(text(), delimiter, delimiter === "\t" ? null : '"');
  } finally { await iterator.return?.(); }
}

/** The country file stays on disk; each yielded row may be discarded before the next is read. */
export async function* registrationSourceTables(path: string): AsyncGenerator<{ readonly name: string; readonly rows: AsyncIterable<string[]> }> {
  const source = await open(path, "r");
  let zipped: boolean;
  try { const magic = Buffer.alloc(2); await source.read(magic, 0, 2, 0); zipped = magic[0] === 0x50 && magic[1] === 0x4b; }
  finally { await source.close(); }
  if (!zipped) { yield { name: "release.csv", rows: delimitedRows(createReadStream(path)) }; return; }
  const entries = await openZipFile(path, { maxEntries: 64, maxMemberBytes: 128 * 1024 * 1024, maxTotalBytes: 192 * 1024 * 1024 });
  const workbooks = entries.filter(entry => /\.xlsx$/i.test(entry.name));
  if (workbooks.length === 1) {
    const directory = await mkdtemp(join(tmpdir(), "meanwhile-government-workbook-"));
    const workbook = join(directory, "source.xlsx"), file = await open(workbook, "w");
    try {
      try {
        for await (const chunk of workbooks[0].stream()) {
          let offset = 0;
          while (offset < chunk.byteLength) { const part = await file.write(chunk, offset, chunk.byteLength - offset); if (!part.bytesWritten) throw new Error("REGISTRATION_WORKBOOK_WRITE_FAILED"); offset += part.bytesWritten; }
        }
      } finally { await file.close(); }
      yield* readXlsxFileSheets(workbook);
    } finally { await rm(directory, { recursive: true, force: true }); }
    return;
  }
  const tables = entries.filter(entry => /\.(csv|txt)$/i.test(entry.name));
  if (!tables.length || workbooks.length > 1) throw new Error("REGISTRATION_SOURCE_TABLE_MISSING");
  for (const entry of tables) yield { name: entry.name, rows: delimitedRows(entry.stream()) };
}
