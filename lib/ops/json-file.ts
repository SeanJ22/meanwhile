import { closeSync, createReadStream, mkdtempSync, openSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

export async function readJsonFile(file: string, options: {
  streamArray?: (path: readonly string[]) => boolean;
  onRow?: (path: readonly string[], row: unknown) => void;
  onChunk?: (chunk: Uint8Array) => void;
} = {}): Promise<unknown> {
  type Frame = { value: Record<string, unknown> | unknown[]; path: string[]; phase: string; key: string; index: number; stream: boolean };
  const frames: Frame[] = [];
  let root: unknown, done = false, token = "", quoted = false, escaped = false;
  const stringParts: string[] = [], stringBoundary = /["\\]/g;
  const invalid = () => { throw new SyntaxError("Invalid JSON file."); };
  const expectsValue = () => !frames.length ? !done : ["first", "value"].includes(frames.at(-1)!.phase);
  const valuePath = () => {
    const parent = frames.at(-1);
    return parent ? [...parent.path, Array.isArray(parent.value) ? String(parent.index) : parent.key] : [];
  };
  const accept = (value: unknown) => {
    const parent = frames.at(-1);
    if (!parent) { if (done) invalid(); root = value; done = true; return; }
    if (parent.phase === "key" || parent.phase === "first-key") {
      if (typeof value !== "string") invalid();
      parent.key = value as string; parent.phase = "colon"; return;
    }
    if (!expectsValue()) invalid();
    if (Array.isArray(parent.value)) {
      if (parent.stream) options.onRow?.(parent.path, value);
      else parent.value.push(value);
      parent.index++;
    } else Object.defineProperty(parent.value, parent.key, { value, enumerable: true, configurable: true, writable: true });
    parent.phase = "comma";
  };
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for await (const chunk of createReadStream(file)) {
    options.onChunk?.(chunk);
    const text = decoder.decode(chunk, { stream: true });
    let index = 0;
    while (index < text.length) {
      if (quoted) {
        const start = index;
        if (escaped) { escaped = false; index++; }
        stringBoundary.lastIndex = index;
        while (true) {
          const boundary = stringBoundary.exec(text);
          if (!boundary) { stringParts.push(text.slice(start)); index = text.length; break; }
          if (boundary[0] === '"') {
            index = boundary.index + 1;
            stringParts.push(text.slice(start, index));
            accept(JSON.parse(stringParts.join("")));
            stringParts.length = 0; quoted = false;
            break;
          }
          if (boundary.index + 1 === text.length) {
            stringParts.push(text.slice(start)); escaped = true; index = text.length;
            break;
          }
          stringBoundary.lastIndex = boundary.index + 2;
        }
        continue;
      }
      const char = text[index++];
      if (token && /[\s,\]}:]/.test(char)) { accept(JSON.parse(token)); token = ""; }
      if (/\s/.test(char)) continue;
      const frame = frames.at(-1);
      if (char === '"') {
        if (token || !(expectsValue() || frame?.phase === "key" || frame?.phase === "first-key")) invalid();
        stringParts.push(char); quoted = true;
      } else if (char === "{" || char === "[") {
        if (token || !expectsValue()) invalid();
        const path = valuePath();
        frames.push({ value: char === "[" ? [] : {}, path, phase: char === "[" ? "first" : "first-key", key: "", index: 0,
          stream: char === "[" && (options.streamArray?.(path) ?? false) });
      } else if (char === "}" || char === "]") {
        if (!frame || (char === "]") !== Array.isArray(frame.value) || !["first", "first-key", "comma"].includes(frame.phase)) invalid();
        frames.pop(); accept(frame!.value);
      } else if (char === ":") {
        if (frame?.phase !== "colon") invalid();
        frame!.phase = "value";
      } else if (char === ",") {
        if (frame?.phase !== "comma") invalid();
        frame!.phase = Array.isArray(frame!.value) ? "value" : "key";
      } else {
        if (!expectsValue()) invalid();
        token += char;
      }
    }
  }
  decoder.decode();
  if (token && !quoted) accept(JSON.parse(token));
  if (quoted || frames.length || !done) invalid();
  return root;
}

export async function withJsonArraySpool<T>(file: string, options: {
  streamArray: (path: readonly string[]) => boolean;
  onRow: (path: readonly string[], row: unknown) => void;
  onChunk?: (chunk: Uint8Array) => void;
}, run: (header: unknown, rows: AsyncIterable<readonly [readonly string[], unknown]>) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "reviewed-json-")), spool = join(directory, "rows.ndjson");
  let fd: number | undefined = openSync(spool, "wx");
  try {
    const header = await readJsonFile(file, { streamArray: options.streamArray, onChunk: options.onChunk, onRow(path, row) {
      options.onRow(path, row);
      writeSync(fd!, JSON.stringify([path, row]) + "\n");
    } });
    closeSync(fd); fd = undefined;
    async function* rows(): AsyncGenerator<readonly [readonly string[], unknown]> {
      const stream = createReadStream(spool), lines = createInterface({ input: stream, crlfDelay: Infinity });
      try { for await (const line of lines) yield JSON.parse(line); }
      finally { lines.close(); stream.destroy(); }
    }
    return await run(header, rows());
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(directory, { recursive: true, force: true });
  }
}
