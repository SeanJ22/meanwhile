import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { relative } from "node:path";

import { ROOT, sourceFilesUnder } from "./read-code.ts";

/**
 * Every store subscriber in the tree hears its store. Two shapes are refused:
 *
 * 1. **An INERT SUBSCRIBE.** A `useSyncExternalStore` reader of a moving store
 *    handed a no-op subscribe cannot hear the same-tab event OR the cross-tab
 *    `storage` event.
 * 2. **THE PUBLISH INSIDE THE `try`.** A same-tab change event dispatched in the
 *    same `try` as `setItem` is skipped when the write is refused.
 *
 * A source sweep, not a render test: the surface left stale is the one nobody
 * thought about. Both assertions state a denominator and fail if it collapses,
 * because a sweep that looked at nothing reports green.
 */

/** The shipped client graph. `scripts/` drives browsers; `tests/` stubs them. */
function shippedSources(): string[] {
  return [
    ...sourceFilesUnder([".ts", ".tsx"], "app"),
    ...sourceFilesUnder([".ts", ".tsx"], "components"),
    ...sourceFilesUnder([".ts", ".tsx"], "hooks"),
    ...sourceFilesUnder([".ts", ".tsx"], "lib"),
  ];
}

/**
 * Files whose `useSyncExternalStore` is a HYDRATION FLAG rather than a store.
 *
 * `components/area/shuffled-facts.tsx` reads "has this hydrated yet?" — server
 * snapshot `false`, client snapshot `true`, and the value can never change
 * again. An inert subscribe is CORRECT there, and calling it a defect would be
 * the guard asserting a rule the code is right to break. Named one file at a
 * time so the exemption cannot widen by accident, and each name is checked
 * against disk below.
 */
const HYDRATION_FLAG_ONLY = ["components/area/shuffled-facts.tsx"];

const INERT_SUBSCRIBE = /(?:const|let)\s+\w+\s*=\s*\(\s*\)\s*=>\s*\(\s*\)\s*=>\s*\{\s*\}/;
const STORAGE_READ = /\b(?:local|session)Storage\b|getStoredReaction|getPick|getAllPicks|readSessionAddress/;

test("no storage-backed subscriber hands useSyncExternalStore an inert subscribe", () => {
  const files = shippedSources();
  let subscribers = 0;
  const inert: string[] = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (!/useSyncExternalStore\s*\(/.test(source)) continue;
    subscribers += 1;
    const rel = relative(ROOT, file).split("\\").join("/");
    if (HYDRATION_FLAG_ONLY.includes(rel)) continue;
    if (!INERT_SUBSCRIBE.test(source)) continue;
    // A subscribe that never fires is only a defect over a store that MOVES.
    if (STORAGE_READ.test(source)) inert.push(rel);
  }

  assert.ok(
    subscribers >= 10,
    `the sweep found only ${subscribers} useSyncExternalStore file(s); it should see every one`,
  );
  assert.deepEqual(
    inert,
    [],
    `a subscribe that never fires cannot deliver a same-tab write OR a cross-tab one: ${inert.join("; ")}`,
  );
});

test("every named hydration-flag exemption still exists and is still a flag", () => {
  /*
   * An exemption list that names a deleted file is an exemption nobody can see
   * is dead, and it is exactly how the next inert subscribe gets waved through
   * under an old name.
   */
  const files = shippedSources().map((f) => relative(ROOT, f).split("\\").join("/"));
  for (const named of HYDRATION_FLAG_ONLY) {
    assert.ok(files.includes(named), `exempted ${named} is not in the tree any more`);
    const source = readFileSync(`${ROOT}/${named}`, "utf8");
    assert.ok(
      !STORAGE_READ.test(source),
      `${named} is exempted as a hydration flag but now reads browser storage`,
    );
  }
});

test("no browser-storage write publishes from inside its own try block", () => {
  /*
   * The ordering defect, stated as a rule about text: a `setItem`/`removeItem`
   * and a publication in the SAME `try` means a refused store silences the
   * announcement. `commitStorageWrite` in `lib/state/subscribe-to-storage.ts`
   * owns the ordering.
   *
   * Blocks are cut at the `try {` and matched to their closing brace by depth
   * rather than by a regex, because a regex cannot count braces and would
   * either stop at the first `}` or run to the end of the file.
   */
  const files = shippedSources();
  let blocks = 0;
  const offenders: string[] = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const rel = relative(ROOT, file).split("\\").join("/");
    let index = source.indexOf("try {");
    while (index !== -1) {
      const body = blockAfter(source, index + "try ".length);
      blocks += 1;
      const writes = /\.(?:setItem|removeItem)\s*\(/.test(body);
      const publishes =
        /dispatchEvent\s*\(/.test(body) ||
        /publishToListeners\s*\(/.test(body) ||
        /publishStorageEvent\s*\(/.test(body) ||
        /\bfor\s*\(\s*const\s+\w+\s+of\s+listeners\s*\)/.test(body);
      if (writes && publishes) offenders.push(rel);
      index = source.indexOf("try {", index + 1);
    }
  }

  assert.ok(blocks >= 20, `the sweep read only ${blocks} try block(s); it should see every one`);
  assert.deepEqual(
    offenders,
    [],
    `a publish inside the write's own try is skipped when the store refuses: ${offenders.join("; ")}`,
  );
});

/** The text between a `{` at or after `from` and its matching `}`. */
function blockAfter(source: string, from: number): string {
  const open = source.indexOf("{", from);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return source.slice(open + 1);
}
