import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { walkFiles, hiddenOrVendored } from "./helpers/walk-files.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Next's generated globals live in `.next/types`, which a fresh checkout lacks; first-party code must not annotate against them.
const GENERATED_GLOBALS = [
  "LayoutProps",
  "PageProps",
  "RouteContext",
  "LayoutSlotProps",
] as const;

const SWEPT = ["app", "components", "hooks", "lib", "scripts", "tests"];

const SOURCE = /\.(ts|tsx|mts|mjs)$/;

function walk(dir: string): string[] {
  return walkFiles(dir, (n) => SOURCE.test(n), hiddenOrVendored);
}

test("no first-party file annotates against a Next-generated global type", () => {
  const offenders: string[] = [];

  for (const root of SWEPT) {
    for (const file of walk(join(ROOT, root))) {
      if (file.endsWith(`clean-typecheck.test.ts`)) continue;
      const text = readFileSync(file, "utf8");
      for (const name of GENERATED_GLOBALS) {
        const used = new RegExp(`[:<|&,(]\\s*${name}\\s*<`, "g");
        for (const hit of text.matchAll(used)) {
          const line = text.slice(0, hit.index).split("\n").length;
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
    /export default async function RootLayout\(\{\s*children,?\s*(?:modal,?\s*)?\}: \{\s*children: ReactNode;?\s*(?:\/\*\*[\s\S]*?\*\/\s*)?(?:modal: ReactNode;?\s*)?\}\)/,
    "the root layout's props are declared here, not imported from a build " +
      "artifact — this is the file whose annotation made the type check " +
      "unrunnable on a fresh clone",
  );
});
