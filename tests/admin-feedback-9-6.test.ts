import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { plainCount, plainDuration, plainMeaning } from "../lib/control-plane/plain-words.ts";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/* -------------------------------------------------------------------------- */
/* Fragment links                                                             */
/* -------------------------------------------------------------------------- */

/** A fragment with no matching id is a silent no-op in every browser, so every console fragment must be a rendered id. */
const ADMIN_SOURCE_DIRS = ["app"] as const;

function adminFiles(): string[] {
  return filesThatWouldBeCommitted({ cwd: ROOT, paths: [...ADMIN_SOURCE_DIRS] }).filter((f) => /\.tsx?$/.test(f));
}

function adminSource(): string {
  return adminFiles().map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");
}

/** Every fragment an admin link names: the literal id, or the fixed prefix of a built one. */
function fragmentLinks(): { readonly from: string; readonly line: string; readonly id: string; readonly built: boolean }[] {
  const out: { from: string; line: string; id: string; built: boolean }[] = [];
  for (const f of adminFiles().filter((p) => p.startsWith("app/(admin)/"))) {
    for (const line of readFileSync(join(ROOT, f), "utf8").split("\n")) {
      if (!/\bhref=/.test(line)) continue;
      for (const m of line.matchAll(/#([a-z][\w-]*?)(\$\{|[`"'])/g)) out.push({ from: f, line: line.trim(), id: m[1], built: m[2] === "${" });
    }
  }
  return out;
}

test("every fragment the console sends the owner to is an id something renders", () => {
  const source = adminSource();
  const links = fragmentLinks();
  assert.ok(links.some((l) => l.id === "v6-main"), "the sweep found none of the console's fragment links, so it is not looking at them");
  const dead = links.filter((l) => (l.built ? !source.includes(`id={\`${l.id}\${`) : !source.includes(`id="${l.id}"`)));
  assert.deepEqual(
    dead.map((l) => `${l.from}: #${l.id}${l.built ? "…" : ""}`),
    [],
    "these links point at fragments no element renders, so they silently do nothing. " +
      "This is the exact defect the owner found on the merged Admin C — #decisions and #receipts were both dead.",
  );
});

test("a fragment target clears the sticky header rather than landing under it", () => {
  const layout = readFileSync(join(ROOT, "app", "(admin)", "layout.tsx"), "utf8");
  assert.match(
    layout,
    /\.reveal-target[^}]*scroll-margin-top/,
    "arriving at an anchor that the sticky console header covers is arriving nowhere the owner can see",
  );
});

/* -------------------------------------------------------------------------- */
/* Plain counts and durations                                                  */
/* -------------------------------------------------------------------------- */

test("a count agrees with its noun, and a duration is in seconds", () => {
  assert.equal(plainCount(1, "document kept", "documents kept"), "1 document kept");
  assert.equal(plainCount(2, "document kept", "documents kept"), "2 documents kept");
  assert.match(plainDuration(1552), /^1\.6 seconds$/);
  assert.match(plainDuration(839), /^0\.8 seconds$/);
});

/* -------------------------------------------------------------------------- */
/* Console publication                                                        */
/* -------------------------------------------------------------------------- */

test("the console is published before the first cycle, not only after one", () => {
  const runner = readFileSync(join(ROOT, "scripts", "pilot-runner.mts"), "utf8");
  const loopAt = runner.indexOf("while (cycle < CYCLES)");
  assert.ok(loopAt > 0);
  const before = runner.slice(0, loopAt);
  assert.match(
    before,
    /publishConsole\(\);/,
    "nothing republishes the console until a whole cycle has finished, so a runner that just came up on new code " +
      "leaves every readiness panel quarantined for up to a full cycle — which is exactly what the owner walked into",
  );
});
