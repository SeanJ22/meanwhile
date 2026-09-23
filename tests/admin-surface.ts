/**
 * **ONE ADMIN SURFACE IS SEVERAL FILES; A GUARD READS THE SURFACE.**
 * (Admin Pass C, 2026-09-06; re-pointed for the Admin redesign, 2026-09-23.)
 *
 * A `.tsx` cannot be imported under a plain `node --test`, so most admin guards
 * in this suite read page source as TEXT and assert regexes against it. That
 * works, and it has one failure mode: a guard that names ONE file goes
 * green-by-absence or red-by-relocation on a change that moved a line rather
 * than deleted it.
 *
 * So a guard names a SURFACE and this module resolves it to every file that
 * composes it, concatenated. A section that moves inside its own surface keeps
 * its guard; a section that is deleted still fails it. The file list is never
 * hand-kept, because a hand-kept list is the same defect one level up.
 *
 * Admin redesign, 2026-09-23: the long Pilot health home page and its
 * `admin/sections/` directory were replaced by the Fleet area's tabs (Now,
 * Work, Money, Is it learning, Fix list), and the per-state readiness panel by
 * the Readiness area. A surface is now WALKED BY IMPORT, starting from the tab
 * list the shell itself draws (`app/(admin)/_mw/scope.ts`):
 *
 * ```
 *   home        the Fleet area: every Fleet tab's page — the old home's
 *               sections now live across these tabs
 *   readiness   the Readiness area: one state's page, and every Readiness
 *               tab's page
 *   research    the runner and research detail page, which kept its content
 * ```
 *
 * From each entry page the walk follows every import into `app/(admin)/` and
 * into `lib/control-plane/admin-view/` (the redesign builds its owner-facing
 * sentences in those view models, so a guard over the words must read them
 * too), minus the shell and the shared primitives every screen draws — they
 * have their own guards, and a surface is what is particular to it. Adding a
 * tab to the shell adds its page to the surface with no edit here.
 *
 * NOT a test file: no `test()` calls, so `tests/guard-census.json` counts no
 * guards here.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import { FLEET_TABS, READINESS_TABS } from "../app/(admin)/_mw/scope.ts";

export type Surface = "home" | "research" | "readiness";

/**
 * The shell every redesigned screen renders in, the primitives it and the
 * pages that kept their content share, and the data readers. Every surface
 * reaches these, so none of them is part of any one surface.
 */
const SHARED: readonly string[] = [
  "app/(admin)/_mw/shell.tsx",
  "app/(admin)/_mw/header-controls.tsx",
  "app/(admin)/_mw/ui.tsx",
  "app/(admin)/_mw/blocks.tsx",
  "app/(admin)/_mw/scope.ts",
  "app/(admin)/_mw/page-base.ts",
  "app/(admin)/_mw/load-shell.ts",
  "app/(admin)/console-ui.tsx",
  "app/(admin)/console-nav.tsx",
  "app/(admin)/status-ui.tsx",
  "app/(admin)/charts.tsx",
];
const SHARED_DIRS: readonly string[] = ["app/(admin)/_mw/data/"];

/** Where a walked import may lead: the console's own code and the redesign's view models. */
const WALKED_ROOTS: readonly string[] = ["app/(admin)/", "lib/control-plane/admin-view/"];

/** The page file a route path lives at: `/admin/work` → `app/(admin)/admin/work/page.tsx`. */
function pageFor(path: string): string {
  return path === "/" ? "app/(admin)/page.tsx" : `app/(admin)${path}/page.tsx`;
}

function entries(surface: Surface): readonly string[] {
  switch (surface) {
    case "home":
      return FLEET_TABS.map((t) => pageFor(t.path));
    case "readiness":
      return ["app/(admin)/readiness/[state]/page.tsx", ...READINESS_TABS.map((t) => pageFor(t.path))];
    case "research":
      return ["app/(admin)/admin/research/page.tsx"];
  }
}

const toRel = (root: string, abs: string): string => relative(root, abs).split(sep).join("/");

/** Resolve one import specifier from one file, or null when it leaves the walked roots. */
function resolveImport(root: string, fromRel: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(root, specifier.slice(2));
  else if (specifier.startsWith(".")) base = join(root, dirname(fromRel), specifier);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (!/\.tsx?$/.test(candidate) || !existsSync(candidate)) continue;
    const rel = toRel(root, candidate);
    return WALKED_ROOTS.some((r) => rel.startsWith(r)) ? rel : null;
  }
  return null;
}

/** The value imports of one module (type-only imports carry no rendering). */
function importsOf(source: string): string[] {
  const out: string[] = [];
  // `[^;]` keeps one match inside one statement; a side-effect `import "x";` has no clause and is skipped.
  for (const m of source.matchAll(/^\s*import\s+(?!["'])(type\s+)?([^;]*?)\s+from\s+"([^"]+)";/gm)) {
    if (m[1]) continue;
    out.push(m[3]);
  }
  return out;
}

/**
 * The files that compose a surface: its entry pages, then everything they
 * reach by import inside the walked roots, minus the shared shell. Stable
 * order: entries first, then discovery order.
 */
export function surfaceFiles(root: string, surface: Surface): readonly string[] {
  for (const shared of SHARED) {
    if (!existsSync(join(root, shared))) throw new Error(`${shared} is listed as shared but does not exist — the exclusion list went stale`);
  }
  const isShared = (rel: string) => SHARED.includes(rel) || SHARED_DIRS.some((d) => rel.startsWith(d));
  const seen = new Set<string>();
  const order: string[] = [];
  const queue = [...entries(surface)];
  while (queue.length > 0) {
    const rel = queue.shift()!;
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (!existsSync(join(root, rel))) throw new Error(`the ${surface} surface names ${rel}, which does not exist`);
    order.push(rel);
    for (const spec of importsOf(readFileSync(join(root, rel), "utf8"))) {
      const next = resolveImport(root, rel, spec);
      if (next !== null && !isShared(next) && !seen.has(next)) queue.push(next);
    }
  }
  return order;
}

/**
 * One surface's whole source, concatenated with a marker between files so a
 * regex cannot accidentally span two of them.
 */
export function surfaceSource(root: string, surface: Surface): string {
  const files = surfaceFiles(root, surface);
  if (files.length === 0) throw new Error(`the ${surface} surface resolved to no files — the walk did not reach the tree`);
  return files.map((rel) => `/* ==== ${rel} ==== */\n${readFileSync(join(root, rel), "utf8")}`).join("\n/* ==== */\n");
}
