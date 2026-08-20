import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * PROMPT C ITEM 1a — `tsc --noEmit` had never once run on a checkout that had
 * not already been built, and every "tsc clean" in every prior session report
 * was therefore measured on a working tree carrying generated files.
 *
 * The cause was one annotation. `app/layout.tsx` was written
 * `({ children }: LayoutProps<"/">)`, and `LayoutProps` is a global Next
 * emits into `.next/types` during a build; `tsconfig.json` includes
 * `.next/types/**\/*.ts` to pick it up. On a developer's machine `.next` is
 * lying around from the last build, so the check passed. On a fresh clone it
 * fails with `error TS2304: Cannot find name 'LayoutProps'` — which is what
 * the Linux gates job reported the first time it ran, on 2026-08-20.
 *
 * The workflow half of the fix is asserted in `tests/push-main.test.ts`: the
 * type check runs in the `gates` job, and that job does not build. This is
 * the source half. It fails if any first-party file annotates against one of
 * the generated globals again, because the next such annotation would make
 * the fresh-checkout gate red and the tempting repair — move the check back
 * behind a build — is the thing that hid the defect in the first place.
 *
 * The globals are named rather than pattern-matched: Next's generated
 * `.next/types/routes.d.ts` declares exactly these, and a list that names
 * them fails with a message a reader can act on.
 */
const GENERATED_GLOBALS = [
  "LayoutProps",
  "PageProps",
  "RouteContext",
  "LayoutSlotProps",
] as const;

/** Directories whose sources ship, plus the scripts the deploy type-checks. */
const SWEPT = ["app", "components", "hooks", "lib", "scripts", "tests"];

const SOURCE = /\.(ts|tsx|mts|mjs)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(full, out);
    } else if (SOURCE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

test("no first-party file annotates against a Next-generated global type", () => {
  const offenders: string[] = [];

  for (const root of SWEPT) {
    for (const file of walk(join(ROOT, root))) {
      // This file quotes the bad annotation verbatim in its own header, which
      // is the only honest way to say what it is guarding against.
      if (file.endsWith(`clean-typecheck.test.ts`)) continue;
      const text = readFileSync(file, "utf8");
      for (const name of GENERATED_GLOBALS) {
        /*
         * The USE, not the mention. Every one of these names appears in prose
         * in this file and in two workflow-adjacent comments, and a sweep that
         * flagged the word would flag its own explanation. A generated global
         * is only dangerous where it is used as a type — after a `:` or in a
         * generic position — so that is what is matched.
         */
        const used = new RegExp(`[:<|&,(]\\s*${name}\\s*<`, "g");
        for (const hit of text.matchAll(used)) {
          const line = text.slice(0, hit.index).split("\n").length;
          // RULING 14: the report reads the same on Windows and on Linux.
          offenders.push(
            `${relative(ROOT, file).split(sep).join("/")}:${line}: ${name}`,
          );
        }
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "these annotate against a type Next generates into .next/types, so " +
      "`tsc --noEmit` cannot run on a checkout that has not been built. " +
      "Write the props type out instead — app/layout.tsx is the pattern. Do " +
      "NOT repair this by moving the type check behind a build.",
  );
});

test("app/layout.tsx writes its own props type", () => {
  const text = readFileSync(join(ROOT, "app", "layout.tsx"), "utf8");
  assert.match(
    text,
    /export default function RootLayout\(\{\s*children,?\s*\}: \{\s*children: ReactNode;?\s*\}\)/,
    "the root layout's props are declared here, not imported from a build " +
      "artifact — this is the file whose annotation made the type check " +
      "unrunnable on a fresh clone",
  );
});
