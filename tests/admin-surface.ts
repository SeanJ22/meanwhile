/**
 * **ONE ADMIN SURFACE IS SEVERAL FILES; A GUARD READS THE SURFACE.**
 * (Admin Pass C, 2026-09-06.)
 *
 * A `.tsx` cannot be imported under `node --test`, so every admin guard in this
 * suite reads page source as TEXT and asserts regexes against it. That works,
 * and it has one failure mode: the guards named ONE file each, and Admin C
 * split the 1,236-line home page into section components. Every one of those
 * guards would have gone green-by-absence or red-by-relocation on a change that
 * moved a line rather than deleted it.
 *
 * So a guard names a SURFACE and this module resolves it to every file that
 * composes it, concatenated. A section that moves inside its own surface keeps
 * its guard; a section that is deleted still fails it. The file list is walked
 * from the directory rather than hand-kept, because a hand-kept list is the
 * same defect one level up.
 *
 * NOT a test file: no `test()` calls, so `tests/guard-census.json` counts no
 * guards here.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every `.ts`/`.tsx` under a directory, recursively, in a stable order. */
function filesUnder(root: string, dir: string): string[] {
  const abs = join(root, dir);
  let entries: string[];
  try {
    entries = readdirSync(abs).sort();
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...filesUnder(root, rel));
    else if (/\.tsx?$/.test(entry)) out.push(rel);
  }
  return out;
}

/**
 * The files that compose each admin surface the guards assert about.
 *
 * The home page's sections live under `admin/sections/`; its decision island is
 * `admin/decisions.tsx`; its charts and shared primitives are separate because
 * they are shared with the other surfaces and have their own guards.
 */
export function surfaceFiles(root: string, surface: "home" | "research" | "readiness"): readonly string[] {
  switch (surface) {
    case "home":
      return [
        "app/(admin)/admin/page.tsx",
        "app/(admin)/admin/decisions.tsx",
        "app/(admin)/admin/deploy-fleet.tsx",
        ...filesUnder(root, "app/(admin)/admin/sections"),
      ];
    case "research":
      return ["app/(admin)/admin/research/page.tsx", "app/(admin)/admin/research/worker-fleet-panel.tsx"];
    case "readiness":
      return ["app/(admin)/readiness/[state]/page.tsx", "app/(admin)/readiness/[state]/readiness-panel.tsx"];
  }
}

/**
 * One surface's whole source, concatenated with a marker between files so a
 * regex cannot accidentally span two of them.
 */
export function surfaceSource(root: string, surface: "home" | "research" | "readiness"): string {
  const files = surfaceFiles(root, surface);
  if (files.length === 0) throw new Error(`the ${surface} surface resolved to no files — the sweep did not reach the tree`);
  return files.map((rel) => `/* ==== ${rel} ==== */\n${readFileSync(join(root, rel), "utf8")}`).join("\n/* ==== */\n");
}
