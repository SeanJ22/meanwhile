import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type JsonObject = Record<string, unknown>;
type Part = { readonly hash: string; readonly payload: unknown };
const object = (value: unknown): JsonObject => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const reference = (value: unknown): string | null => typeof object(value).$civicPayloadPart === "string" ? String(object(value).$civicPayloadPart) : null;

export class StreamedCivicPayload {
  private readonly cached = new Map<string, unknown>();
  private readonly directory: string;
  private readonly readParts: (hashes: readonly string[]) => Promise<readonly Part[]>;
  constructor(directory: string, readParts: (hashes: readonly string[]) => Promise<readonly Part[]>) { this.directory = directory; this.readParts = readParts; }

  private async part(hash: string): Promise<unknown> {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("STATE_BOOTSTRAP_PART_HASH_INVALID");
    if (this.cached.has(hash)) return this.cached.get(hash);
    let value: unknown;
    try { value = JSON.parse(await readFile(join(this.directory, `${hash}.json`), "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const held = (await this.readParts([hash])).find(part => part.hash === hash);
      if (!held) throw new Error(`STATE_BOOTSTRAP_PART_MISSING:${hash}`);
      value = held.payload;
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await writeFile(join(this.directory, `${hash}.json`), JSON.stringify(value), { mode: 0o600, flag: "wx" });
    }
    this.cached.set(hash, value);
    if (this.cached.size > 8) this.cached.delete(this.cached.keys().next().value!);
    return value;
  }

  async node(value: unknown): Promise<unknown> {
    const hash = reference(value);
    if (!hash) return value;
    const part = await this.part(hash);
    return object(part).kind === "object" ? object(part).value : part;
  }

  async load(value: unknown): Promise<unknown> {
    const hash = reference(value);
    if (hash) {
      const part = await this.part(hash), shape = object(part);
      if (shape.kind === "object") return this.load(shape.value);
      if (shape.kind === "string") {
        let text = "";
        for (const chunk of shape.chunks as unknown[]) text += String(await this.load(chunk));
        return text;
      }
      if (shape.kind === "array") {
        const rows: unknown[] = [];
        for await (const row of this.members(value)) rows.push(row);
        return rows;
      }
      return this.load(part);
    }
    if (Array.isArray(value)) {
      const rows: unknown[] = [];
      for (const child of value) rows.push(await this.load(child));
      return rows;
    }
    if (value !== null && typeof value === "object") {
      const rows: JsonObject = {};
      for (const [key, child] of Object.entries(value)) rows[key] = await this.load(child);
      return rows;
    }
    return value;
  }

  async *members(value: unknown): AsyncGenerator<unknown> {
    const node = await this.node(value);
    if (Array.isArray(node)) { for (const row of node) yield await this.load(row); return; }
    const shape = object(node);
    if (shape.kind !== "array") throw new Error("STATE_BOOTSTRAP_ARRAY_INVALID");
    const groups = shape.groups as unknown[], positions = groups.map(() => 0);
    const order = JSON.parse(String(await this.load(shape.order))) as number[];
    const held = new Map<number, unknown[]>();
    for (const index of order) {
      if (!Number.isInteger(index) || index < 0 || index >= groups.length) throw new Error("STATE_BOOTSTRAP_ARRAY_ORDER_INVALID");
      let group = held.get(index);
      if (!group) {
        const rows = await this.node(groups[index]);
        if (!Array.isArray(rows)) throw new Error("STATE_BOOTSTRAP_ARRAY_GROUP_INVALID");
        group = rows; held.set(index, group);
        if (held.size > 4) held.delete(held.keys().next().value!);
      }
      if (positions[index] >= group.length) throw new Error("STATE_BOOTSTRAP_ARRAY_POSITION_INVALID");
      yield await this.load(group[positions[index]++]);
    }
  }

  async *entries(value: unknown): AsyncGenerator<readonly [string, unknown]> {
    for (const [key, child] of Object.entries(object(await this.node(value)))) yield [key, await this.load(child)];
  }
}
