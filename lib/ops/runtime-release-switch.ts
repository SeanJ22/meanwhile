/**
 * New code loads without stopping the runner. The parent restarts only when its own code changed; otherwise new
 * children start from the staged checkout. Host state lives in Git-ignored paths, linked from the staged checkout back
 * to the running one and carried back before the staged checkout is removed. Enabled by WTP_RELEASE_QUICK_SWITCH=1.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, appendFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

import { COMPUTED_IMPORT_REACH, moduleReferences, resolveSpecifier } from "../../scripts/ci-affected-tests.mjs";
import type { AsyncRunCommand } from "./runtime-release-stage.ts";

const GIT_TIMEOUT_MS = 2 * 60_000;

/** The parent runner's entry point; its import closure is the parent's own code. */
export const PARENT_ENTRY = "scripts/pilot-runner.mts";

/** Files outside the import graph whose change still means the parent must reload. */
export const PARENT_PACKAGE_FILES: readonly string[] = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc"];

export interface ParentCodeDecision {
  readonly changed: boolean;
  /** Changed files the parent loaded, or the reason the closure could not be trusted. */
  readonly why: readonly string[];
}

/**
 * Every tracked file the parent loads at `root`'s checked-out commit. A
 * computed import with no known reach makes the closure unknown (null), and the
 * caller must restart the parent.
 */
export function parentImportClosure(root: string, tracked: ReadonlySet<string>, entry: string = PARENT_ENTRY):
  { readonly files: ReadonlySet<string>; readonly reaches: readonly string[] } | { readonly unknown: string } {
  const seen = new Set<string>();
  const reaches: string[] = [];
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(?:[cm]?[jt]sx?)$/.test(file)) continue;
    const references = moduleReferences(readFileSync(join(root, file), "utf8"));
    for (const spec of references.specs) {
      const resolved = resolveSpecifier(file, spec, tracked);
      if (resolved.kind === "file") stack.push(resolved.path);
    }
    if (references.computed.length > 0) {
      const reach = COMPUTED_IMPORT_REACH.get(file);
      if (reach === undefined) return { unknown: `${file} loads code by a computed name` };
      reaches.push(reach);
    }
  }
  return { files: seen, reaches };
}

/** Whether the change from the parent's loaded commit to `targetSha` touches the parent's own code. */
export async function parentCodeChanged(input: {
  readonly root: string;
  readonly parentSha: string;
  readonly targetSha: string;
  readonly run: AsyncRunCommand;
}): Promise<ParentCodeDecision> {
  const diff = await input.run("git", ["diff", "--name-only", "--no-renames", input.parentSha, input.targetSha], { cwd: input.root, timeoutMs: GIT_TIMEOUT_MS });
  if (diff.status !== 0) return { changed: true, why: ["the change between the two releases could not be read"] };
  const changed = diff.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const listed = await input.run("git", ["ls-files", "-z"], { cwd: input.root, timeoutMs: GIT_TIMEOUT_MS });
  if (listed.status !== 0) return { changed: true, why: ["the running checkout's files could not be listed"] };
  const tracked = new Set(listed.stdout.split("\0").filter(Boolean));
  const closure = parentImportClosure(input.root, tracked);
  if ("unknown" in closure) return { changed: true, why: [closure.unknown] };
  const why = changed.filter(path => PARENT_PACKAGE_FILES.includes(path) || closure.files.has(path) ||
    closure.reaches.some(reach => path.startsWith(reach)));
  return { changed: why.length > 0, why };
}

async function ignoredEntries(dir: string, run: AsyncRunCommand): Promise<string[] | null> {
  const listed = await run("git", ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"], { cwd: dir, timeoutMs: GIT_TIMEOUT_MS });
  if (listed.status !== 0) return null;
  return listed.stdout.split("\0").map(entry => entry.replace(/\/$/, "")).filter(Boolean);
}

/** Paths the staged checkout must never share with the running one. */
function ownedByCheckout(path: string): boolean {
  return path === "node_modules" || path.startsWith("node_modules/") || path === ".next" || path.startsWith(".next/");
}

/**
 * Link every Git-ignored path of the running checkout into the staged one. The
 * directory that holds the staged checkouts (`.runtime`) is linked entry by
 * entry, so no link points back into itself.
 */
export async function linkRuntimeState(input: {
  readonly root: string;
  readonly directory: string;
  readonly run: AsyncRunCommand;
}): Promise<{ readonly linked: readonly string[] } | { readonly failed: string }> {
  const entries = await ignoredEntries(input.root, input.run);
  if (entries === null) return { failed: "the running checkout's host state could not be listed" };
  const [holder, holderChild] = relative(input.root, input.directory).split(/[\\/]/);
  const linked: string[] = [];
  const link = (path: string): void => {
    const target = join(input.directory, path);
    if (existsSync(target) || lstatExists(target)) return;
    mkdirSync(dirname(target), { recursive: true });
    const source = join(input.root, path);
    symlinkSync(source, target, lstatSync(source).isDirectory() ? "dir" : "file");
    linked.push(path);
  };
  try {
    for (const path of entries) {
      if (ownedByCheckout(path) || isAbsolute(path) || path.startsWith("..")) continue;
      if (path === holder) {
        for (const name of readdirSync(join(input.root, path))) {
          if (name === holderChild) continue;
          link(join(path, name));
        }
        continue;
      }
      link(path);
    }
  } catch (error) {
    return { failed: `host state could not be linked (${error instanceof Error ? error.message : String(error)})` };
  }
  // A link is a file to Git, not a directory, so a directory pattern such as
  // `/data/control-plane/vault/` does not cover it. The staged checkout says so
  // in the shared exclude file; the running checkout is unaffected.
  const common = await input.run("git", ["rev-parse", "--git-common-dir"], { cwd: input.root, timeoutMs: GIT_TIMEOUT_MS });
  if (common.status === 0 && common.stdout.trim() !== "") {
    const commonDir = common.stdout.trim();
    const exclude = join(isAbsolute(commonDir) ? commonDir : join(input.root, commonDir), "info", "exclude");
    const present = existsSync(exclude) ? new Set(readFileSync(exclude, "utf8").split(/\r?\n/)) : new Set<string>();
    const lines = linked.filter(path => !path.startsWith(`${holder}/`)).map(path => `/${path.replace(/\\/g, "/")}`).filter(line => !present.has(line));
    if (lines.length > 0) {
      mkdirSync(dirname(exclude), { recursive: true });
      appendFileSync(exclude, `${lines.join("\n")}\n`, "utf8");
    }
  }
  return { linked };
}

function lstatExists(path: string): boolean {
  try { lstatSync(path); return true; } catch { return false; }
}

/**
 * Before a staged checkout is removed, move anything a child created in its
 * ignored paths back to the running checkout, unless the running checkout
 * already has that path. Links are left alone; they point at the running
 * checkout already.
 */
export async function carryBackRuntimeState(input: {
  readonly root: string;
  readonly directory: string;
  readonly run: AsyncRunCommand;
}): Promise<readonly string[]> {
  if (!existsSync(input.directory)) return [];
  const entries = await ignoredEntries(input.directory, input.run);
  if (entries === null) return [];
  const moved: string[] = [];
  const carry = (path: string): void => {
    const from = join(input.directory, path);
    const stat = lstatSync(from, { throwIfNoEntry: false });
    if (stat === undefined) return;
    if (stat.isSymbolicLink()) return;
    const to = join(input.root, path);
    if (lstatExists(to)) {
      // Both sides hold this directory: carry what only the staged side has.
      if (stat.isDirectory() && lstatSync(to).isDirectory()) for (const name of readdirSync(from)) carry(join(path, name));
      return;
    }
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
    moved.push(path);
  };
  for (const path of entries) {
    if (ownedByCheckout(path)) continue;
    try { carry(path); } catch { /* a path that cannot move stays with the staged copy */ }
  }
  return moved;
}
