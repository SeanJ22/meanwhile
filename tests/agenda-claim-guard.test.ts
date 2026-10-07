/**
 * No surface may say a clerk did not post, from our own empty record. `tests/agenda-sentence.test.ts`
 * pins the decider; this sweeps every reader-facing component source so that none renders a
 * publication claim of its own. Comments and test literals are stripped before matching.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** Every `.tsx`/`.ts` under the reader-facing trees. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Source with block comments, line comments and JSX text removed. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/**
 * The shapes that assert a publication state about a body.
 *
 * Each is a sentence a reader could meet that says something about what a
 * GOVERNMENT did, as opposed to what this product holds.
 */
const PUBLICATION_CLAIMS: readonly { pattern: RegExp; why: string }[] = [
  {
    pattern: /No agenda posted yet/i,
    why: "says a clerk has not posted, and every render site derived it from `!agendaUrl`",
  },
  {
    pattern: /No agenda has been published/i,
    why: "the ASK-07 sentence, in the same class",
  },
  {
    pattern: /has ?n[o']t (yet )?(been )?post(ed)?( an agenda)?/i,
    why: "a publication claim in the present perfect, whatever the subject",
  },
];

/** Where the decider lives, and the one file allowed to contain the sentences. */
const DECIDER = join("lib", "ask", "agenda-sentence.ts").replace(/\\/g, "/");

test("SWEEP-01: no reader surface asserts a publication state of its own", () => {
  const trees = ["components", "app"].map((d) => join(ROOT, d));
  const offenders: string[] = [];
  let scanned = 0;

  for (const tree of trees) {
    for (const file of sourceFiles(tree)) {
      scanned += 1;
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
      if (rel === DECIDER) continue;
      const code = withoutComments(readFileSync(file, "utf8"));
      for (const claim of PUBLICATION_CLAIMS) {
        if (claim.pattern.test(code)) {
          offenders.push(`${rel} — ${claim.why}`);
        }
      }
    }
  }

  // A sweep whose roots stopped resolving would find nothing.
  assert.ok(
    scanned >= 50,
    `the sweep read only ${scanned} component file(s) — it did not reach the tree, and a guard ` +
      "that read nothing reports clean",
  );

  assert.deepEqual(
    offenders,
    [],
    "a surface is asserting what a government did from what this product holds:\n  " +
      offenders.join("\n  "),
  );
});

test("SWEEP-01: both agenda surfaces go through the ONE decider", () => {
  // Both components route a null agenda link through the one decider.
  for (const rel of [
    "components/ui/meeting-row.tsx",
    "components/map/popup/agenda-section.tsx",
  ]) {
    const source = readFileSync(join(ROOT, rel), "utf8");
    assert.match(
      source,
      /agendaSentenceFor/,
      `${rel} renders an agenda gap and must ask the shared decider whose gap it is`,
    );
  }
});
