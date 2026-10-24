import { createReadStream } from "node:fs";

export interface ZipSourceMetadata {
  source?: string;
  typeSource?: string;
  vintage?: string | number;
}

/** Acquired ZIP files have a flat row object after their source metadata. */
export async function* zipSourceRows(path: string, metadata: ZipSourceMetadata = {}): AsyncGenerator<[string, readonly unknown[]]> {
  const pattern = /"(\d{5})"\s*:\s*(\[(?:[^"\[\]]|"(?:[^"\\]|\\.)*")*\])/g;
  let buffer = "", started = false;
  for await (const chunk of createReadStream(path, { encoding: "utf8" })) {
    buffer += chunk;
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null, consumed = 0;
    while ((match = pattern.exec(buffer))) {
      const prefix = buffer.slice(consumed,match.index);
      if (!started) {
        const header = JSON.parse(prefix + "}}") as ZipSourceMetadata;
        metadata.source = header.source; metadata.typeSource = header.typeSource; metadata.vintage = header.vintage;
        started = true;
      } else if (!/^\s*,\s*$/.test(prefix)) throw new Error("Invalid acquired ZIP row separator");
      consumed = pattern.lastIndex;
      yield [match[1],JSON.parse(match[2]) as readonly unknown[]];
    }
    buffer = buffer.slice(consumed);
  }
  if (!started || !/^\s*}\s*}\s*$/.test(buffer)) throw new Error("Incomplete acquired ZIP source");
}
