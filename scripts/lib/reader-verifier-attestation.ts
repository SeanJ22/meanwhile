import { spawnSync } from "node:child_process";

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

async function verifierImportClosure(root: string): Promise<readonly string[]> {
  // Loaded only when a receipt is on an older commit: the census module and the
  // TypeScript parser it walks imports with are never loaded on a current pass.
  const { readerSourceFingerprint } = await import("../../lib/holdings/reader-census.ts");
  return readerSourceFingerprint(root, [READER_VERIFIER_ENTRY]).map(({ path }) => path);
}

/**
 * **The typed Reader code is the same bytes at two commits (R31, 2026-09-25).**
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
