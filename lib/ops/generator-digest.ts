/**
 * **A GENERATOR FIX IS INCOMPLETE UNTIL ITS OUTPUT IS REGENERATED AND
 * DIFFED** — RULING 102, 2026-08-23.
 *
 * ## The half of RULING 92 that had no completion condition
 *
 * RULING 92 says: fix the generator, never the artifact. It is correct and it
 * caught things. It also has no end.
 *
 * `data/hunt/nj-morris-municipal-sites.json` pointed five municipalities at the
 * wrong government's website — `morris_township` at Morris Plains',
 * `chatham_township` at Chatham Borough's — **with its generator already
 * fixed**. Somebody had done the RULING 92 thing, correctly, and stopped. The
 * committed output stayed wrong, every downstream hunt read it as current, and
 * nothing anywhere went red, because "fix the generator" was satisfied the
 * moment the generator was fixed.
 *
 * So the rule gets an end: **the generator's own source is digested, the
 * digest is committed beside the artifact, and a generator whose digest has
 * moved fails the build until its artifact is regenerated and the digest
 * re-recorded.** Fixing a generator now costs a regeneration, which is what
 * finishing the job always was.
 *
 * ## Why the digest is over the generator, not over the artifact
 *
 * An artifact hash tells you the artifact changed. It cannot tell you the
 * artifact SHOULD have changed — which is the entire question here. A network
 * generator's output legitimately moves when a government moves its website,
 * so demanding a stable artifact would fail on the world rather than on a
 * defect. The generator's SOURCE moves only when somebody edits it, and that
 * is exactly the event after which the output is owed a re-run.
 *
 * ## What "the generator's source" means
 *
 * The entry script plus every repo-local module it imports, transitively.
 * A fix that lands in `lib/hunt/wikipedia.ts` moves the digest of every
 * generator that reads it, which is correct: those artifacts are downstream of
 * the fix whether or not anyone remembered they were.
 *
 * Package versions are deliberately NOT in the digest. An upgrade that changes
 * an artifact is a real event, but folding it in here would turn every
 * `pnpm up` into a repo-wide regeneration and the guard would be disabled
 * within a week.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/** Repo-relative, forward-slashed, so a digest is identical on Windows and Linux. */
export function repoPath(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join("/");
}

/**
 * Resolve a `pnpm <name>` command to the script file it runs.
 *
 * Returns null for a command this cannot resolve — a shell pipeline, a binary,
 * a script whose entry is not a repo file. Null is REPORTED by the caller, not
 * treated as "nothing to check": an unresolvable generator is a generator with
 * no completion condition, which is the state this ruling exists to end.
 */
export function entryFor(root: string, command: string): string | null {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  // `corepack pnpm nj:wire --index x.json` → the script name is the first
  // token after pnpm that is not a flag.
  const tokens = command.trim().split(/\s+/);
  const at = tokens.findIndex((t) => t === "pnpm");
  if (at === -1) return null;
  const name = tokens[at + 1];
  if (name === undefined) return null;
  const body = pkg.scripts[name];
  if (body === undefined) return null;
  // `tsx scripts/nj-wire.mts` / `node scripts/tracker.mjs views`
  const file = body.split(/\s+/).find((t) => /\.(?:mts|ts|mjs|js|cjs)$/.test(t));
  if (file === undefined) return null;
  const abs = join(root, file);
  return existsSync(abs) ? abs : null;
}

const IMPORT = /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s*["']([^"']+)["']/g;
const BARE_IMPORT = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
const DYNAMIC = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

const EXTENSIONS = [".ts", ".mts", ".tsx", ".mjs", ".js", ".cjs", ".json"];

function resolveLocal(fromFile: string, spec: string, root: string): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("@/")) return null;
  const base = spec.startsWith("@/") ? join(root, spec.slice(2)) : resolve(dirname(fromFile), spec);
  if (existsSync(base) && !existsSync(join(base, "index.ts"))) {
    // A file path that already carries its extension.
    if (/\.[a-z]+$/.test(base)) return base;
  }
  for (const ext of EXTENSIONS) {
    // `./x.ts` written as `./x.js` (NodeNext), and `./x` written bare.
    const swapped = base.replace(/\.(?:js|mjs)$/, ext);
    if (existsSync(swapped) && /\.[a-z]+$/.test(swapped)) return swapped;
    if (existsSync(base + ext)) return base + ext;
  }
  for (const ext of EXTENSIONS) {
    const idx = join(base, `index${ext}`);
    if (existsSync(idx)) return idx;
  }
  return existsSync(base) && /\.[a-z]+$/.test(base) ? base : null;
}

/**
 * Every repo file a generator's behaviour depends on, entry first, sorted.
 *
 * Sorted so the digest is order-independent: a re-ordered import list is not a
 * behaviour change and must not read as one.
 */
export function sourceClosure(root: string, entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    const key = repoPath(root, file);
    if (seen.has(key)) continue;
    seen.add(key);
    let src: string;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (file.endsWith(".json")) continue;
    for (const re of [IMPORT, BARE_IMPORT, DYNAMIC]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const next = resolveLocal(file, m[1], root);
        if (next !== null) queue.push(next);
      }
    }
  }
  return [...seen].sort();
}

export interface GeneratorDigest {
  /** sha256 over every source file in the closure, name and bytes. */
  digest: string;
  /** How many files went into it — a census, so a collapsed walk is visible. */
  files: number;
  /** The entry, repo-relative. */
  entry: string;
}

/**
 * Digest a generator.
 *
 * The FILE NAMES are hashed alongside the bytes: a module renamed with
 * identical contents is a change to what runs, and a digest over bytes alone
 * would miss it.
 */
export function digestGenerator(root: string, entry: string): GeneratorDigest {
  const files = sourceClosure(root, entry);
  const h = createHash("sha256");
  for (const file of files) {
    h.update(file);
    h.update("\0");
    try {
      h.update(readFileSync(join(root, file)));
    } catch {
      h.update("<unreadable>");
    }
    h.update("\0");
  }
  return { digest: h.digest("hex"), files: files.length, entry: repoPath(root, entry) };
}

export type StaleVerdict =
  /** The generator has not moved since the artifact was last regenerated. */
  | "CURRENT"
  /** The generator's source changed and the artifact was not regenerated. */
  | "STALE"
  /** No digest has ever been recorded for this artifact. */
  | "UNRECORDED"
  /**
   * The command could not be resolved to a repo file, so no completion
   * condition can be computed. Named rather than skipped.
   */
  | "UNRESOLVABLE";

export interface StaleCheck {
  path: string;
  command: string;
  verdict: StaleVerdict;
  recorded: string | null;
  current: string | null;
  files: number;
}

/** Compare one artifact's recorded generator digest against the tree. */
export function checkArtifact(
  root: string,
  artifact: { path: string; command: string },
  recorded: string | null,
): StaleCheck {
  const entry = entryFor(root, artifact.command);
  if (entry === null) {
    return {
      path: artifact.path,
      command: artifact.command,
      verdict: "UNRESOLVABLE",
      recorded,
      current: null,
      files: 0,
    };
  }
  const { digest, files } = digestGenerator(root, entry);
  const verdict: StaleVerdict =
    recorded === null ? "UNRECORDED" : recorded === digest ? "CURRENT" : "STALE";
  return { path: artifact.path, command: artifact.command, verdict, recorded, current: digest, files };
}
