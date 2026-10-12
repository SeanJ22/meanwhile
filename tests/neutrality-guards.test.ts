import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { tsFilesUnder } from "./read-code.ts";
import * as schema from "../lib/db/schema.ts";

/**
 * The product never tells anyone how to vote, and the search log never joins the subscription store. Both guards
 * scan what exists, so a new declaration walks straight into them.
 */

/** Every .ts file under lib/, recursively. */
const libFiles = () => tsFilesUnder("lib");

/** interface/type blocks whose name matches, with their body text. */
function declaredShapes(
  source: string,
  namePattern: RegExp,
): Array<{ name: string; body: string }> {
  const shapes: Array<{ name: string; body: string }> = [];
  const decl = /(?:interface|type)\s+([A-Za-z0-9_]+)[^{=]*[{=]/g;
  for (const m of source.matchAll(decl)) {
    if (!namePattern.test(m[1])) continue;
    // Take the block up to the matching close brace, shallowly — good enough
    // for the flat record shapes this repo declares.
    const start = source.indexOf("{", m.index ?? 0);
    if (start < 0) continue;
    let depth = 0;
    let end = start;
    for (; end < source.length; end++) {
      if (source[end] === "{") depth++;
      if (source[end] === "}") depth--;
      if (depth === 0) break;
    }
    shapes.push({ name: m[1], body: source.slice(start, end + 1) });
  }
  return shapes;
}

test("no candidate or measure record grows a ranking key", () => {
  // A score/rank/match key on a candidate or measure record is one map() away from a ranking UI.
  const forbidden =
    /^\s*(score|rank|rating|match|fit|grade|alignment|recommendation)\s*[?:]/im;

  const offenders: string[] = [];
  for (const file of libFiles()) {
    const source = readFileSync(file, "utf8");
    // `candida` catches Candidacy as well as Candidate.
    for (const shape of declaredShapes(
      source,
      /candida|contest|measure|ballot|election/i,
    )) {
      const hit = forbidden.exec(shape.body);
      if (hit) offenders.push(`${file} ${shape.name}: ${hit[1]}`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("; "));
});

test("no committed ballot data record carries a ranking key", () => {
  // The same rule at the data layer: JSON has no types to scan.
  const forbiddenKey =
    /^(score|rank|rating|match|fit|grade|alignment|recommendation)$/i;
  const dir = join(process.cwd(), "data", "ballot");
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const parsed: unknown = JSON.parse(readFileSync(join(dir, name), "utf8"));
    const walk = (value: unknown, path: string) => {
      if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${path}[${i}]`));
      } else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) {
          assert.ok(
            !forbiddenKey.test(k),
            `${name} ${path}.${k} is a ranking-shaped key`,
          );
          walk(v, `${path}.${k}`);
        }
      }
    };
    walk(parsed, name);
  }
});

/** The search log and the subscription store never join: no shared column, no foreign key, no mapping table. */
function tablesMatching(pattern: RegExp): Array<{ name: string; columns: string[] }> {
  const found: Array<{ name: string; columns: string[] }> = [];
  for (const [name, value] of Object.entries(schema)) {
    if (!pattern.test(name)) continue;
    if (value == null || typeof value !== "object") continue;
    // Through unknown: a concrete PgTable's mapped type has no string index
    // signature, but its runtime own-keys are exactly the column properties
    // this guard wants.
    const columns = Object.keys(value as unknown as Record<string, unknown>).filter(
      (k) => !k.startsWith("_") && !k.startsWith("$"),
    );
    if (columns.length > 0) found.push({ name, columns });
  }
  return found;
}

test("the search log and the subscription store share no key", () => {
  const searchTables = tablesMatching(/search/i);
  const subscriptionTables = tablesMatching(/subscri|notif/i);

  // Benign structural columns both sides may carry without becoming joinable.
  const structural = new Set(["id", "createdAt", "created_at"]);

  for (const s of searchTables) {
    for (const sub of subscriptionTables) {
      const shared = s.columns.filter(
        (c) => sub.columns.includes(c) && !structural.has(c),
      );
      assert.deepEqual(
        shared,
        [],
        `${s.name} and ${sub.name} share columns: ${shared.join(", ")}`,
      );
    }
  }
});

test("the search log carries no identifier of any kind", () => {
  // The row must be impossible to resolve to a person.
  const identifier =
    /email|phone|token|subscriber|account|device|session|fingerprint|user_?id|ip_?addr/i;

  for (const table of tablesMatching(/search/i)) {
    const hits = table.columns.filter((c) => identifier.test(c));
    assert.deepEqual(
      hits,
      [],
      `${table.name} carries identifier-shaped columns: ${hits.join(", ")}`,
    );
  }
});
