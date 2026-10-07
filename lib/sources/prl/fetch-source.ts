import { createHash } from "node:crypto";
import { createInflateRaw } from "node:zlib";

import { OUTBOUND_USER_AGENT } from "../../geo/outbound-agent.ts";
import { decodeUtf8, type TextChunks } from "./streaming.ts";
import type { PrlDataset } from "./inventory.ts";
import type { PrlSourceOpen } from "./ingest.ts";

/**
 * Acquires a dataset's bytes and streams its one member through the inflater.
 * Nothing is written to disk: the compressed archive is held in memory and the
 * multi-gigabyte member is stream-inflated. The sha256 is of the exact
 * compressed bytes, so a later run can tell whether the source moved.
 */

interface ZipLocalHeader {
  readonly method: number;
  readonly dataStart: number;
  readonly name: string;
}

/** Parse the first local file header of a zip from its leading bytes. */
export function parseZipLocalHeader(head: Buffer): ZipLocalHeader {
  if (head.length < 30 || head.readUInt32LE(0) !== 0x04034b50) {
    throw new Error("PRL response is not a ZIP archive");
  }
  const method = head.readUInt16LE(8);
  const nameLength = head.readUInt16LE(26);
  const extraLength = head.readUInt16LE(28);
  const name = head.subarray(30, 30 + nameLength).toString("utf8");
  if (name.includes("..") || /^[\\/]/.test(name)) throw new Error(`PRL ZIP member name is unsafe: ${JSON.stringify(name)}`);
  return { method, dataStart: 30 + nameLength + extraLength, name };
}

/** Yield decoded text chunks of a zip member from its in-memory compressed bytes. */
function inflateMember(compressed: Buffer, method: number): TextChunks {
  async function* bytes(): AsyncGenerator<Uint8Array> {
    if (method === 0) {
      yield compressed; // stored, not deflated
      return;
    }
    const inflate = createInflateRaw();
    inflate.end(compressed);
    for await (const chunk of inflate) yield chunk as Uint8Array;
  }
  return decodeUtf8(bytes());
}

/**
 * Open a dataset's source: fetch the bytes into memory, hash them, and return a
 * streaming text source over the (inflated) member. A plain CSV is streamed as
 * itself; a zip is verified to hold one supported member first.
 */
export async function openPrlSource(dataset: PrlDataset, fetchImpl: typeof fetch = fetch): Promise<PrlSourceOpen> {
  const response = await fetchImpl(dataset.url, { headers: { "user-agent": OUTBOUND_USER_AGENT }, redirect: "follow" });
  if (!response.ok) {
    throw new Error(`PRL answered HTTP ${response.status} ${response.statusText} for ${dataset.url}`);
  }
  const compressed = Buffer.from(await response.arrayBuffer());
  const sourceSha256 = createHash("sha256").update(compressed).digest("hex");
  const finalUrl = response.url || dataset.url;

  if (dataset.format === "csv") {
    async function* raw(): AsyncGenerator<Uint8Array> {
      yield compressed;
    }
    return { textChunks: decodeUtf8(raw()), sourceSha256, finalUrl, member: dataset.file };
  }

  const header = parseZipLocalHeader(compressed);
  if (header.method !== 0 && header.method !== 8) {
    throw new Error(`PRL ZIP for ${dataset.id} uses unsupported method ${header.method}`);
  }
  return {
    textChunks: inflateMember(compressed.subarray(header.dataStart), header.method),
    sourceSha256,
    finalUrl,
    member: header.name,
  };
}
