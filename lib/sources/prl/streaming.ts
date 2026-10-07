/**
 * Streaming parsers for files too large to hold in memory. Records span as many
 * physical lines as their quoted prose contains, so both parsers are quote/brace
 * aware, are fed text chunks, yield one record at a time and are linear in the
 * input. The full-text `.json` members are one top-level array of objects.
 */

/** A source of decoded text chunks (e.g. an inflating zip member). */
export type TextChunks = AsyncIterable<string>;

/**
 * Yield CSV records (arrays of cell strings) from a chunk stream. Handles
 * quoted fields, escaped `""` quotes, and embedded commas and newlines. The
 * first yielded record is the header.
 */
export async function* streamCsvRecords(chunks: TextChunks): AsyncGenerator<string[]> {
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  // A `"` seen inside a quoted field is undecided until the next character:
  // `""` is an escaped quote, anything else closes the field. That next
  // character may be in the next chunk, so the decision is parser state, not a
  // look-ahead into the current chunk.
  let pendingQuote = false;
  for await (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      const c = chunk[i];
      if (pendingQuote) {
        pendingQuote = false;
        if (c === '"') {
          cell += '"'; // an escaped quote; the field stays open
          continue;
        }
        quoted = false; // the prior quote closed the field; fall through to handle c
      } else if (quoted) {
        if (c === '"') pendingQuote = true;
        else cell += c;
        continue;
      }
      if (c === '"') quoted = true;
      else if (c === ",") {
        row.push(cell);
        cell = "";
      } else if (c === "\n") {
        row.push(cell);
        yield row;
        row = [];
        cell = "";
      } else if (c !== "\r") cell += c;
    }
  }
  // Flush a final record that had no trailing newline.
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    yield row;
  }
}

/** Map a header row and a data row into a keyed record. */
export function recordFromRow(header: readonly string[], row: readonly string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (let i = 0; i < header.length; i += 1) record[header[i]] = row[i] ?? "";
  return record;
}

/** Yield keyed records from a CSV chunk stream, skipping the header row. */
export async function* streamCsvObjects(chunks: TextChunks): AsyncGenerator<Record<string, string>> {
  let header: string[] | null = null;
  for await (const row of streamCsvRecords(chunks)) {
    if (header === null) {
      header = row;
      continue;
    }
    yield recordFromRow(header, row);
  }
}

/**
 * Yield each top-level object of a JSON array from a chunk stream. Tracks
 * string, escape and brace depth so embedded braces, brackets, commas and
 * newlines inside string values never split an object. Linear: every character
 * is examined once, and the buffer is trimmed to at most one in-flight object.
 */
export async function* streamJsonArrayObjects(chunks: TextChunks): AsyncGenerator<unknown> {
  let buf = "";
  let scan = 0; // next index in buf to examine
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objStart = -1; // index in buf where the current top-level object began
  let consumed = 0; // everything before this index in buf is finished
  for await (const chunk of chunks) {
    buf += chunk;
    for (; scan < buf.length; scan += 1) {
      const c = buf[scan];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') {
        inString = true;
      } else if (c === "{") {
        if (depth === 0) objStart = scan;
        depth += 1;
      } else if (c === "}") {
        depth -= 1;
        if (depth === 0 && objStart >= 0) {
          yield JSON.parse(buf.slice(objStart, scan + 1));
          consumed = scan + 1;
          objStart = -1;
        }
      }
    }
    // Trim everything already consumed (or before the in-flight object).
    const keepFrom = objStart >= 0 ? objStart : consumed;
    if (keepFrom > 0) {
      buf = buf.slice(keepFrom);
      scan -= keepFrom;
      if (objStart >= 0) objStart -= keepFrom;
      consumed = Math.max(0, consumed - keepFrom);
    }
  }
}

/** Adapt a byte/string async iterable to decoded UTF-8 text chunks. */
export async function* decodeUtf8(chunks: AsyncIterable<Uint8Array | string>): TextChunks {
  const decoder = new TextDecoder("utf-8");
  for await (const chunk of chunks) {
    yield typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
  }
  const tail = decoder.decode();
  if (tail) yield tail;
}
