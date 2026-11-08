import { civicPayloadBytes, partitionCivicPayload } from "./payload-codec.ts";
import { CivicPayloadReader, type Part } from "./payload-reader.ts";

export type { CivicPayloadPartIO } from "./payload-reader.ts";

/** The reader plus the write side, which hashes and so stays on the server. */
export class CivicPayloadParts extends CivicPayloadReader {
  async store(input: unknown, inlineFields?: readonly string[], referencedFields?: readonly string[]): Promise<unknown> {
    const plan = partitionCivicPayload(input, inlineFields, referencedFields);
    const known = new Set<string>();
    for (let offset = 0; offset < plan.parts.length; offset += 512) {
      for (const hash of await this.io.existing(plan.parts.slice(offset, offset + 512).map(part => part.hash))) known.add(hash);
    }
    let batch: Part[] = [];
    let size = 0;
    for (const part of plan.parts) {
      if (known.has(part.hash)) continue;
      const nextSize = civicPayloadBytes(part);
      if (batch.length && size + nextSize > 2 * 1024 * 1024) { await this.io.write(batch); batch = []; size = 0; }
      batch.push(part); size += nextSize;
    }
    if (batch.length) await this.io.write(batch);
    return plan.value;
  }
}
