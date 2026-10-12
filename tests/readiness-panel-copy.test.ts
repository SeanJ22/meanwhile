import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";

import { coverageStatusPill } from "../lib/control-plane/admin-view/coverage.ts";
import { plainCode } from "../lib/control-plane/plain-words.ts";
import { codeOf, sourceFilesUnder } from "./read-code.ts";

const ROOT = process.cwd();
const SHELL_CSS = "app/(admin)/_mw/admin-v6/v6.module.css";

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
}

test("plainCode keeps the two cell-state words the brief names", () => {
  assert.equal(plainCode("NOT_WALKED"), "Not checked yet");
  assert.equal(plainCode("ARGUED_ABSENT"), "Looked for, does not exist");
});

test("no machine constant leads on the readiness page", () => {
  for (const status of ["LIVE", "MANUAL", "KNOWN_UNCOVERED", "NO_SOURCE_FOUND", "NOT_ATTEMPTED", "SOMETHING_NEW"]) {
    assert.doesNotMatch(coverageStatusPill(status as never).pill, /_/, `${status} reaches the face as its enum`);
  }
});

test("the page's stylesheet carries the classes its markup uses", () => {
  // A class key nobody declared in the shell's CSS module renders as a class named "undefined".
  const css = src(SHELL_CSS);
  const declared = new Set([...css.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]));
  const users = sourceFilesUnder([".tsx"], "app", "(admin)")
    .map((abs) => relative(ROOT, abs).split(sep).join("/"))
    .filter((rel) => /from "[./]*(?:admin-v6\/)?v6\.module\.css"/.test(src(rel)));
  const missing: string[] = [];
  for (const rel of users) {
    for (const m of codeOf(rel).matchAll(/\bs\.([a-zA-Z_]\w*)\b/g)) if (!declared.has(m[1]) && !declared.has("legacy" + m[1][0].toUpperCase() + m[1].slice(1))) missing.push(`${rel}: s.${m[1]}`);
  }
  assert.deepEqual([...new Set(missing)], [], "these classes are rendered with no rule to style them");
});
