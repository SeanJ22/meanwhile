import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { rows } = JSON.parse(readFileSync(join(root, "data/state-holdings/move-plan.json"), "utf8"));

/** Resolve current repository pointers without rewriting immutable source records. */
export function currentHoldingPaths(body) {
  for (const row of rows) body = body.replaceAll(row.oldPath, row.newPath);
  return body;
}
