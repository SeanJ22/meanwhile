import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * The .gov registry is a link-ladder rung (where a government might publish), never a coverage denominator: a
 * government with no .gov domain is absent from it, one government may hold several domains, and a domain is not a
 * body.
 */

const ROOT = process.cwd();

test("DOMAINS ARE NOT A DENOMINATOR: no coverage surface reads the .gov registry", () => {
  const fetcher = readFileSync(join(ROOT, "scripts", "fetch-dotgov.mts"), "utf8");
  assert.match(fetcher, /Census of Governments/);
  for (const dir of ["lib/registry", "lib/meetings", "components/map"]) {
    const offenders: string[] = [];
    const walk = (path: string) => {
      for (const entry of readdirSync(join(ROOT, path))) {
        const full = join(ROOT, path, entry);
        if (statSync(full).isDirectory()) {
          walk(join(path, entry));
          continue;
        }
        if (!/\.tsx?$/.test(entry)) continue;
        if (/dotgov/i.test(readFileSync(full, "utf8"))) offenders.push(join(path, entry));
      }
    };
    walk(dir);
    assert.deepEqual(
      offenders,
      [],
      `the .gov registry is being read by a coverage surface: ${offenders.join(", ")}`,
    );
  }
});
