import assert from "node:assert/strict";
import test from "node:test";

import { outOfScope, repairBrief, repairScope } from "../lib/control-plane/workers/adapter-repair-scope.ts";

const paths = [
  "lib/sources/iqm2/index.ts", "lib/sources/iqm2/parse.ts", "lib/sources/iqm2/README.md",
  "lib/sources/ical/index.ts", "lib/sources/composite/wiring.ts", "lib/sources/platform-adapters/x.ts",
  "tests/iqm2-calendar.test.ts", "tests/composite.test.ts", "tests/unrelated.test.ts",
];
const texts: Record<string, string> = {
  "tests/iqm2-calendar.test.ts": 'import "../lib/sources/iqm2/index.ts"',
  "tests/composite.test.ts": "composite", "tests/unrelated.test.ts": "nothing",
  "lib/sources/iqm2/index.ts": "export const a = 1", "lib/sources/iqm2/parse.ts": "export const b = 2",
};
const readText = (p: string) => { if (p in texts) return texts[p]!; throw new Error("missing"); };
const example = { savedBytes: "<html>calendar</html>", failure: "no meetings parsed", savedAt: "2026-10-04T00:00:00Z" };

test("a repair is given one kind's folder, the failing example and that kind's own tests", () => {
  const r = repairScope({ kind: "iqm2", example, paths, readText });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.scope.files.map((f) => f.path), ["lib/sources/iqm2/index.ts", "lib/sources/iqm2/parse.ts"]);
  assert.deepEqual(r.scope.testFiles, ["tests/composite.test.ts", "tests/iqm2-calendar.test.ts"]);
  const brief = repairBrief(r.scope);
  assert.match(brief, /may change only files under lib\/sources\/iqm2\//);
  assert.match(brief, /no meetings parsed/);
  assert.doesNotMatch(brief, /lib\/sources\/ical/);
});

test("a repair may write only inside the folder, the kind's fixtures and those tests", () => {
  const r = repairScope({ kind: "iqm2", example, paths, readText });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(outOfScope(r.scope, [
    "lib/sources/iqm2/parse.ts", "lib/sources/iqm2/new-file.ts", "tests/fixtures/iqm2/page.html", "tests/iqm2-calendar.test.ts",
  ]), []);
  assert.deepEqual(outOfScope(r.scope, [
    "lib/sources/ical/index.ts", "lib/sources/composite/wiring.ts", "tests/unrelated.test.ts", "lib/sources/iqm2/../ical/index.ts", "/etc/passwd", ["lib", "sources", "ical", "index.ts"].join(String.fromCharCode(92)),
  ]).length, 6);
});

test("shared plumbing, a missing folder, an unchecked kind, or no example is refused by name", () => {
  assert.equal(repairScope({ kind: "composite", example, paths, readText }).ok, false);
  assert.equal(repairScope({ kind: "nope", example, paths, readText }).ok, false);
  const unchecked = repairScope({ kind: "ical", example, paths, readText });
  assert.equal(unchecked.ok, false);
  assert.match(unchecked.ok ? "" : unchecked.why, /cannot be checked by this kind's tests alone/);
  const empty = repairScope({ kind: "iqm2", example: { savedBytes: " ", failure: "x" }, paths, readText });
  assert.equal(empty.ok, false);
});
