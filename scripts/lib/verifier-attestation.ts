import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import type {
  ReaderVerifierClosureAttestation,
  ReaderVerifierClosureAttestor,
} from "../../lib/civic-data/reader-verification.ts";

/** The module whose import closure holds every typed Reader verifier (static and dynamic imports). */
export const READER_VERIFIER_ENTRY = "lib/civic-data/reader-verification.ts";
/** What the closure's package imports resolve through: a dependency change is a code change. */
export const READER_VERIFIER_DEPENDENCY_MANIFESTS = ["package.json", "pnpm-lock.yaml"] as const;

const EXACT_SHA = /^[0-9a-f]{40}$/;

export interface GitAnswer {
  /** The exit status, or null when git could not run. */
  readonly status: number | null;
  readonly stdout: string;
}

export interface ReaderVerifierAttestorOptions {
  readonly root?: string;
  /** Repository-relative paths of the verifier's import closure at the executing checkout. */
  readonly closure?: () => Promise<readonly string[]>;
  /** Runs git in `root`. */
  readonly git?: (args: readonly string[]) => GitAnswer;
}

const IMPORT = /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s*["']([^"']+)["']/g;
const BARE_IMPORT = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
const DYNAMIC = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
const EXTENSIONS = [".ts", ".mts", ".tsx", ".mjs", ".js", ".cjs", ".json"];

/** A relative or `@/` import resolved to a repo file, or null for a package import. */
function resolveLocal(fromFile: string, spec: string, root: string): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("@/")) return null;
  const base = spec.startsWith("@/") ? join(root, spec.slice(2)) : resolve(dirname(fromFile), spec);
  if (existsSync(base) && !existsSync(join(base, "index.ts")) && /\.[a-z]+$/.test(base)) return base;
  for (const ext of EXTENSIONS) {
    // `./x.ts` written as `./x.js`, and `./x` written bare.
    const swapped = base.replace(/\.(?:js|mjs)$/, ext);
    if (existsSync(swapped) && /\.[a-z]+$/.test(swapped)) return swapped;
    if (existsSync(base + ext)) return base + ext;
  }
  for (const ext of EXTENSIONS) {
    const index = join(base, `index${ext}`);
    if (existsSync(index)) return index;
  }
  return existsSync(base) && /\.[a-z]+$/.test(base) ? base : null;
}

/** Every repo file the entry's static and dynamic imports reach, repo-relative with forward slashes, sorted. */
async function verifierImportClosure(root: string): Promise<readonly string[]> {
  const seen = new Set<string>();
  const queue = [join(root, READER_VERIFIER_ENTRY)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    const key = relative(root, file).split(sep).join("/");
    if (seen.has(key)) continue;
    seen.add(key);
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (file.endsWith(".json")) continue;
    for (const re of [IMPORT, BARE_IMPORT, DYNAMIC]) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(source)) !== null) {
        const next = resolveLocal(file, match[1]!, root);
        if (next !== null) queue.push(next);
      }
    }
  }
  return [...seen].sort();
}

/**
 * **The typed Reader code is the same bytes at two commits.**
 *
 * The closure is the import graph `readerSourceFingerprint` walks from
 * `lib/civic-data/reader-verification.ts` (every verifier and each typed Reader
 * it dynamically imports, with their static and dynamic imports and JSON), plus
 * the dependency manifests. Three git questions, each fail-closed:
 *
 *  1. every closure file is in the current commit's tree, so none of the code
 *     executing here can be missing from what the commit names;
 *  2. the executing checkout's closure files are exactly the current commit's;
 *  3. every closure file is byte-identical at the prior and current commits.
 *
 * If a closure file were identical but its imports differed, it would not be
 * identical; so the same files, the same bytes, give the same closure at both
 * commits. An unknown commit, a git failure or any difference answers "not
 * identical", and the typed Reader re-reads. One answer per commit pair.
 */
export function readerVerifierClosureAttestor(options: ReaderVerifierAttestorOptions = {}): ReaderVerifierClosureAttestor {
  const root = options.root ?? process.cwd();
  const git = options.git ?? ((args: readonly string[]): GitAnswer => {
    const run = spawnSync("git", [...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    return { status: run.status, stdout: run.stdout ?? "" };
  });
  const closure = options.closure ?? (() => verifierImportClosure(root));
  let files: Promise<readonly string[]> | null = null;
  const answers = new Map<string, Promise<ReaderVerifierClosureAttestation>>();

  const decide = async (prior: string, current: string): Promise<ReaderVerifierClosureAttestation> => {
    if (!EXACT_SHA.test(prior) || !EXACT_SHA.test(current)) {
      return { identical: false, detail: "a commit is not an exact 40-character SHA" };
    }
    let paths: readonly string[];
    try {
      paths = [...new Set([...await (files ??= closure()), ...READER_VERIFIER_DEPENDENCY_MANIFESTS])].sort();
    } catch (error) {
      files = null;
      return { identical: false, detail: `the verifier closure could not be walked (${error instanceof Error ? error.message : String(error)})` };
    }
    if (paths.length <= READER_VERIFIER_DEPENDENCY_MANIFESTS.length) {
      return { identical: false, detail: "the verifier closure is empty" };
    }
    const inCommit = git(["ls-tree", "-r", "--name-only", "-z", current, "--", ...paths]);
    const named = new Set(inCommit.stdout.split("\0").filter(Boolean));
    if (inCommit.status !== 0 || paths.some((path) => !named.has(path))) {
      return { identical: false, detail: `a verifier closure file is not in commit ${current}` };
    }
    if (git(["diff", "--quiet", current, "--", ...paths]).status !== 0) {
      return { identical: false, detail: `the executing checkout's verifier closure is not commit ${current}` };
    }
    const between = git(["diff", "--quiet", prior, current, "--", ...paths]).status;
    if (between !== 0) {
      return {
        identical: false,
        detail: between === 1 ? `the verifier closure changed after ${prior}` : `git could not compare ${prior} with ${current}`,
      };
    }
    return {
      identical: true,
      detail: `all ${paths.length} files of the typed Reader verifiers' import closure (${READER_VERIFIER_ENTRY}) ` +
        "and dependency manifests are byte-identical at both commits",
    };
  };

  return (prior, current) => {
    const key = `${prior}..${current}`;
    let answer = answers.get(key);
    if (answer === undefined) {
      answer = decide(prior, current);
      answers.set(key, answer);
    }
    return answer;
  };
}
