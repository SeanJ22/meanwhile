import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import type { Capability } from "../../lib/core/capability.ts";

const SOURCES = new URL("../../lib/sources/", import.meta.url);
async function codeIn(path: URL): Promise<URL[]> {
  const found: URL[] = [];
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) found.push(...await codeIn(new URL(`${entry.name}/`, path)));
    else if (/\.(ts|mjs)$/.test(entry.name) && !entry.name.includes(".test.")) found.push(new URL(entry.name, path));
  }
  return found;
}

/** Each reader of a kind of website installed here, versioned by its code, so a changed reader is a new event and an unchanged one is not. */
export async function installedParsers(): Promise<readonly Capability[]> {
  const found: Capability[] = [];
  const add = async (name: string, files: readonly URL[]) => {
    const hash = createHash("sha256");
    for (const file of files) hash.update(file.pathname).update(await readFile(file));
    found.push({ kind: "parser", name, platform: name, because: `a new reader for ${name}`, version: hash.digest("hex").slice(0, 16) });
  };
  for (const entry of await readdir(SOURCES, { withFileTypes: true }))
    if (entry.isDirectory() && entry.name !== "platform-adapters") await add(entry.name, await codeIn(new URL(`${entry.name}/`, SOURCES)));
  const adapters = new URL("platform-adapters/", SOURCES);
  for (const entry of await readdir(adapters, { withFileTypes: true }).catch(() => []))
    if (entry.isDirectory()) await add(entry.name, await codeIn(new URL(`${entry.name}/`, adapters)));
    else if (/\.(ts|mjs)$/.test(entry.name) && !entry.name.includes(".test.")) await add(entry.name.replace(/\.(ts|mjs)$/, ""), [new URL(entry.name, adapters)]);
  return found;
}
