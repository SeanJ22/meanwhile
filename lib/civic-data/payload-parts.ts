import { civicPayloadBytes, isCivicPayloadPart, partitionCivicPayload } from "./payload-codec.ts";

type Part = { readonly hash: string; readonly payload: unknown };

export interface CivicPayloadPartIO {
  readonly existing: (hashes: readonly string[]) => Promise<readonly string[]>;
  readonly write: (parts: readonly Part[]) => Promise<void>;
  readonly read: (hashes: readonly string[]) => Promise<readonly Part[]>;
}

type Node = { kind?: string; chunks?: unknown[]; groups?: unknown[]; order?: unknown; value?: unknown };

/** The refs directly inside a value, not inside the parts they name. */
function refsIn(value: unknown, into: Set<string>): Set<string> {
  if (isCivicPayloadPart(value)) into.add(value.$civicPayloadPart);
  else if (Array.isArray(value)) for (const child of value) refsIn(child, into);
  else if (value && typeof value === "object") for (const child of Object.values(value)) refsIn(child, into);
  return into;
}

/* Parts are immutable by hash, so the most recently read are kept, up to a fixed size. */
const CACHED_PART_BYTES = 64 * 1024 * 1024;

export class CivicPayloadParts {
  private readonly io: CivicPayloadPartIO;
  private readonly cached = new Map<string, { readonly payload: unknown; readonly size: number }>();
  private cachedBytes = 0;
  constructor(io: CivicPayloadPartIO) { this.io = io; }

  private remember(part: Part): void {
    const size = civicPayloadBytes(part.payload);
    if (size > CACHED_PART_BYTES / 8 || this.cached.has(part.hash)) return;
    this.cached.set(part.hash, { payload: part.payload, size });
    this.cachedBytes += size;
    for (const [hash, held] of this.cached) {
      if (this.cachedBytes <= CACHED_PART_BYTES) break;
      this.cached.delete(hash); this.cachedBytes -= held.size;
    }
  }

  private async read(hashes: readonly string[]): Promise<readonly Part[]> {
    const hit = hashes.flatMap(hash => {
      const held = this.cached.get(hash);
      if (!held) return [];
      this.cached.delete(hash); this.cached.set(hash, held);
      return [{ hash, payload: held.payload }];
    });
    const missing = hashes.filter(hash => !this.cached.has(hash));
    const read = missing.length ? await this.io.read(missing) : [];
    read.forEach(part => this.remember(part));
    return [...hit, ...read];
  }

  async store(input: unknown, inlineFields?: readonly string[]): Promise<unknown> {
    const plan = partitionCivicPayload(input, inlineFields);
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

  /** Reads parts eight at a time and assembles each as soon as its children are in. */
  async load(input: unknown): Promise<unknown> {
    const decoded = new Map<string, unknown>();
    const build = (value: unknown): unknown => {
      if (isCivicPayloadPart(value)) {
        if (!decoded.has(value.$civicPayloadPart)) throw new Error("CIVIC_PAYLOAD_PART_MISSING");
        return decoded.get(value.$civicPayloadPart);
      }
      if (Array.isArray(value)) return value.map(build);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, build(child)]));
      return value;
    };
    const assemble = (payload: unknown): unknown => {
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return build(payload);
      const node = payload as Node;
      if (node.kind === "string") return node.chunks!.map(build).join("");
      if (node.kind === "object") return build(node.value);
      if (node.kind === "array") {
        const groups = node.groups!.map(group => build(group) as unknown[]);
        const positions = groups.map(() => 0);
        return (JSON.parse(build(node.order) as string) as number[]).map(group => groups[group][positions[group]++]);
      }
      return build(payload);
    };
    const resolve = async (values: readonly unknown[]): Promise<void> => {
      const hashes = [...values.reduce<Set<string>>((into, value) => refsIn(value, into), new Set())].filter(hash => !decoded.has(hash));
      for (let at = 0; at < hashes.length; at += 8) {
        const wanted = hashes.slice(at, at + 8);
        const parts = await this.read(wanted);
        if (wanted.some(hash => !parts.some(part => part.hash === hash))) throw new Error("CIVIC_PAYLOAD_PART_MISSING");
        await resolve(parts.map(part => part.payload));
        for (const part of parts) decoded.set(part.hash, assemble(part.payload));
      }
    };
    await resolve([input]);
    return build(input);
  }
}
