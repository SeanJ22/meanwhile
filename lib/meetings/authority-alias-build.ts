import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { gzipSync } from "node:zlib";
import { sha256OfJson } from "./edge-artifacts.ts";
import type { ReaderArtifactStore } from "./edge-store.ts";

interface Ref { readonly key: string; readonly sha: string }
interface Spool { readonly path: string; append(text: string): Promise<void>; remove(): Promise<void> }
type Entry = readonly [string, Ref];
const digest = (tag: string) => {
  const state = /(?:state|territory|district):([a-z]{2})/i.exec(tag)?.[1] ?? /^government:(?:US-)?([a-z]{2}):/i.exec(tag)?.[1];
  return (state ? Buffer.from(state.toLowerCase()).toString("hex") : "0000") + createHash("sha256").update(tag).digest("hex");
};

async function* lines(path: string): AsyncGenerator<Entry> {
  const input = createReadStream(path, { highWaterMark: 32 * 1024 });
  const reader = createInterface({ input, crlfDelay: Infinity });
  try { for await (const line of reader) yield JSON.parse(line) as Entry; }
  finally { reader.close(); input.destroy(); }
}

type Append = (channel: string, tag: string, ref: Ref) => Promise<void>;
export async function withAuthorityIndexWriter<T>(store: ReaderArtifactStore,
  run: (append: Append, finish: () => Promise<ReadonlyMap<string, Ref>>) => Promise<T>): Promise<T> {
  const live = new Set<Spool>();
  const temporary = async (): Promise<Spool> => {
    const spoolDirectory = await mkdtemp(join(tmpdir(), "reader-index-"));
    const spoolPath = join(spoolDirectory, "entries");
    await writeFile(spoolPath, "");
    const spool: Spool = { path: spoolPath, append: text => appendFile(spoolPath, text), remove: async () => {
      await rm(spoolDirectory, { recursive: true, force: true }); live.delete(spool);
    } };
    live.add(spool);
    return spool;
  };
  const put = async (value: unknown): Promise<Ref> => ({ key: await store.putImmutable(gzipSync(Buffer.from(JSON.stringify(value))), "json.gz"), sha: sha256OfJson(value) });
  const build = async (source: Spool, depth: number): Promise<Ref> => {
    const held = new Map<string, Map<string, Ref>>();
    for await (const [tag, ref] of lines(source.path)) {
      const refs = held.get(tag) ?? new Map<string, Ref>(); refs.set(ref.key, ref); held.set(tag, refs);
      if (held.size > 64) break;
    }
    if (held.size <= 64) {
      const ref = await put({ entries: Object.fromEntries([...held].sort(([a], [b]) => a.localeCompare(b))
        .map(([tag, refs]) => [tag, [...refs.values()].sort((a, b) => a.key.localeCompare(b.key))])) });
      await source.remove(); return ref;
    }
    if (depth >= 68) throw new Error("READER_INDEX_HASH_COLLISION");
    const buckets = new Map<string, { spool: Spool; buffer: string }>();
    for await (const entry of lines(source.path)) {
      const prefix = digest(entry[0])[depth];
      let target = buckets.get(prefix);
      if (!target) { target = { spool: await temporary(), buffer: "" }; buckets.set(prefix, target); }
      target.buffer += JSON.stringify(entry) + "\n";
      if (target.buffer.length >= 32 * 1024) { await target.spool.append(target.buffer); target.buffer = ""; }
    }
    for (const target of buckets.values()) if (target.buffer) await target.spool.append(target.buffer);
    await source.remove();
    const children: Record<string, Ref> = {};
    for (const [prefix, target] of [...buckets].sort(([a], [b]) => a.localeCompare(b))) children[prefix] = await build(target.spool, depth + 1);
    return buckets.size === 1 ? Object.values(children)[0] : put({ depth, children });
  };
  try {
    const channels = new Map<string, { spool: Spool; buffer: string }>();
    const append: Append = async (channel, tag, ref) => {
      let target = channels.get(channel);
      if (!target) { target = { spool: await temporary(), buffer: "" }; channels.set(channel, target); }
      target.buffer += JSON.stringify([tag, ref]) + "\n";
      if (target.buffer.length >= 64 * 1024) { await target.spool.append(target.buffer); target.buffer = ""; }
    };
    return await run(append, async () => {
      const roots = new Map<string, Ref>();
      for (const [channel, target] of channels) {
        if (target.buffer) await target.spool.append(target.buffer);
        roots.set(channel, await build(target.spool, 0));
      }
      return roots;
    });
  } finally { for (const spool of live) await spool.remove(); }
}

export async function writeAuthorityIndices(entries: AsyncIterable<readonly [string, string, Ref]>, store: ReaderArtifactStore): Promise<ReadonlyMap<string, Ref>> {
  return withAuthorityIndexWriter(store, async (append, finish) => {
    for await (const [channel, tag, ref] of entries) await append(channel, tag, ref);
    return finish();
  });
}
