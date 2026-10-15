import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

let cachedHead: { cwd: string; environment: string; paths: string[]; signature: string; sha: string } | null = null;

function fileSignature(paths: readonly string[]): string | null {
  try {
    return paths.map(path => {
      try {
        const stat = statSync(path, { bigint: true });
        return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
      } catch (error) {
        if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return "missing";
        throw error;
      }
    }).join("|");
  } catch { return null; }
}

function headDependencies(cwd: string, gitDirectory: string, commonDirectory: string): string[] {
  const commonFile = join(gitDirectory, "commondir");
  const paths = [commonFile, join(commonDirectory, "packed-refs"), join(commonDirectory, "config"),
    join(gitDirectory, "config.worktree"), join(commonDirectory, "reftable", "tables.list"), join(gitDirectory, "reftable", "tables.list")];
  let ref = join(gitDirectory, "HEAD");
  for (let depth = 0; depth < 8; depth++) {
    paths.push(ref);
    let contents: string;
    try { contents = readFileSync(ref, "utf8").trim(); }
    catch (error) { if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) break; throw error; }
    if (!contents.startsWith("ref: ")) break;
    ref = resolve(commonDirectory, contents.slice(5));
  }
  for (let directory = cwd;; directory = dirname(directory)) {
    paths.push(join(directory, ".git"));
    if (directory === dirname(directory)) break;
  }
  return paths;
}

/** The commit this process runs against, or null when the tree cannot be named. */
export function headSha(cwd: string = process.cwd()): string | null {
  cwd = resolve(cwd);
  const environment = JSON.stringify(Object.entries(process.env).filter(([key]) => key.startsWith("GIT_")).sort());
  if (cachedHead?.cwd === cwd && cachedHead.environment === environment &&
      fileSignature(cachedHead.paths) === cachedHead.signature) return cachedHead.sha;
  cachedHead = null;
  try {
    const [gitDirectory, commonDirectory] = execFileSync("git", ["rev-parse", "--absolute-git-dir", "--path-format=absolute", "--git-common-dir"], { cwd, encoding: "utf8" }).trim().split("\n");
    const paths = headDependencies(cwd, gitDirectory, commonDirectory);
    const signature = fileSignature(paths);
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
    if (signature !== null && signature === fileSignature(paths)) cachedHead = { cwd, environment, paths, signature, sha };
    return sha;
  } catch {
    return null;
  }
}

/** Whether `descendant`'s history contains `ancestor`; false when git cannot answer. */
export function containsCommit(
  ancestor: string,
  descendant: string,
  cwd: string = process.cwd(),
): boolean {
  if (ancestor === descendant) return true;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}
