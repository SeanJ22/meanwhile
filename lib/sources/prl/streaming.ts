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
export async function* streamCsvRecords(chunks: TextChunks, delimiter = ",", quote: '"' | null = '"'): AsyncGenerator<string[]> {
  if (delimiter !== "," && delimiter !== "\t") throw new Error("DELIMITED_SOURCE_SEPARATOR_INVALID");
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  // A `"` seen inside a quoted field is undecided until the next character:
  // `""` is an escaped quote, anything else closes the field. That next
  // character may be in the next chunk, so the decision is parser state, not a
  // look-ahead into the current chunk.
  let pendingQuote = false;
  let closedQuote = false;
  let rowChars = 0;
  for await (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      const c = chunk[i];
      if (++rowChars > 4 * 1024 * 1024) throw new Error("PRL_CSV_RECORD_TOO_LARGE");
      if (pendingQuote) {
        pendingQuote = false;
        if (c === '"') {
          cell += '"'; // an escaped quote; the field stays open
          continue;
        }
        quoted = false; closedQuote = true; // the prior quote closed the field; fall through to handle c
      } else if (quoted) {
        if (c === '"') pendingQuote = true;
        else cell += c;
        continue;
      }
      if (closedQuote && c !== delimiter && c !== "\n" && c !== "\r") throw new Error("PRL_CSV_INVALID_QUOTE");
      if (c === quote) {
        if (cell.length) throw new Error("PRL_CSV_INVALID_QUOTE");
        quoted = true;
      }
      else if (c === delimiter) {
        row.push(cell);
        cell = ""; closedQuote = false;
      } else if (c === "\n") {
        row.push(cell);
        yield row;
        row = [];
        cell = ""; closedQuote = false; rowChars = 0;
      } else if (c !== "\r") cell += c;
    }
  }
  if (quoted && !pendingQuote) throw new Error("PRL_CSV_TRUNCATED_QUOTE");
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
  let state: "START" | "FIRST" | "VALUE" | "COMMA" | "END" = "START";
  let object = "", depth = 0, inString = false, escaped = false;
  for await (const chunk of chunks) {
    for (const char of chunk) {
      if (depth > 0) {
        object += char;
        if (object.length > 4 * 1024 * 1024) throw new Error("PRL_JSON_RECORD_TOO_LARGE");
        if (inString) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') inString = false;
        } else if (char === '"') inString = true;
        else if (char === "{" || char === "[") depth++;
        else if (char === "}" || char === "]") depth--;
        if (depth === 0) {
          yield JSON.parse(object, (key: string, value: unknown, context?: { source?: string }) => {
            if ((key === "id" || key.endsWith("_id")) && typeof value === "number") {
              if (!context?.source || !/^\d+$/.test(context.source)) throw new Error("PRL_NATIVE_NUMBER_INVALID");
              return context.source;
            }
            return value;
          });
          object = ""; state = "COMMA";
        }
        continue;
      }
      if (/\s/.test(char)) continue;
      if (state === "START" && char === "[") { state = "FIRST"; continue; }
      if ((state === "FIRST" || state === "VALUE") && char === "{") { object = "{"; depth = 1; continue; }
      if ((state === "FIRST" || state === "COMMA") && char === "]") { state = "END"; continue; }
      if (state === "COMMA" && char === ",") { state = "VALUE"; continue; }
      throw new Error("PRL_JSON_ARRAY_INVALID");
    }
  }
  if (state !== "END" || depth !== 0 || inString) throw new Error("PRL_JSON_ARRAY_TRUNCATED");
}

/** Adapt a byte/string async iterable to decoded UTF-8 text chunks. */
export async function* decodeUtf8(chunks: AsyncIterable<Uint8Array | string>): TextChunks {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for await (const chunk of chunks) {
    yield typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
  }
  const tail = decoder.decode();
  if (tail) yield tail;
}
