import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");

const CHARACTERIZATIONS = [
  "affiliate of",
  "-aligned",
  "aligned with",
  "progressive group",
  "conservative group",
  "liberal group",
  "right-wing",
  "left-wing",
  "dark money",
  "front group",
  "special interest",
];

test("funding surfaces never characterize an organization", () => {
  const files: string[] = [];
  for (const dir of [
    join(ROOT, "components", "funding"),
    join(ROOT, "lib", "funding"),
  ]) {
    for (const name of readdirSync(dir)) {
      if (/\.(ts|tsx)$/.test(name)) files.push(join(dir, name));
    }
  }
  assert.ok(files.length >= 3, "the funding surfaces exist and were scanned");
  for (const file of files) {
    const source = readFileSync(file, "utf8").toLowerCase();
    for (const banned of CHARACTERIZATIONS) {
      assert.ok(
        !source.includes(banned),
        `${file}: contains "${banned}" — organizations render as filed, never characterized`,
      );
    }
  }
});
