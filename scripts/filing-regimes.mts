/** Publish sourced jurisdiction registries as data, one JSONL record at a time. */
import { createReadStream, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { filingRegimePath, loadFilingRegimeRegistry } from "../lib/control-plane/campaign-finance/filing-regime.ts";

const argument = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const input = argument("input"), root = argument("root") ?? process.cwd();
if (!input) throw new Error("Pass --input=<sourced per-jurisdiction registry JSONL>. Each line must contain one jurisdiction and its regimes.");
const selected = argument("jurisdictions")?.split(",").map(code => code.trim().toUpperCase());
for (const code of selected ?? []) filingRegimePath(code, root);
for await (const line of createInterface({ input: createReadStream(input), crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  const raw = JSON.parse(line);
  const jurisdiction = raw.jurisdictions?.[0]?.jurisdiction;
  if (selected && !selected.includes(jurisdiction)) continue;
  const registry = loadFilingRegimeRegistry(raw, input);
  if (registry.jurisdictions.length !== 1 || registry.regimes.some(regime => regime.jurisdiction !== jurisdiction)) {
    throw new Error("A filing-regime input line must hold exactly one jurisdiction and its own regimes.");
  }
  const path = filingRegimePath(jurisdiction, root);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(raw, null, 2) + "\n");
  renameSync(temporary, path);
  console.log(`${jurisdiction}: ${registry.regimes.length} sourced filing regimes; ${path}`);
}
