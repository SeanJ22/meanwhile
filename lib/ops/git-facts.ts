import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

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

function directoryUrl(path: string): URL {
  const url = pathToFileURL(path);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function headDependencies(cwd: string, gitDirectory: string, commonDirectory: string): string[] {
  const gitUrl = directoryUrl(gitDirectory);
  const commonUrl = directoryUrl(commonDirectory);
  const paths = [new URL("commondir", gitUrl), new URL("packed-refs", commonUrl), new URL("config", commonUrl),
    new URL("config.worktree", gitUrl), new URL("reftable/tables.list", commonUrl), new URL("reftable/tables.list", gitUrl)];
  let refName = "HEAD";
  let refPath = new URL("HEAD", gitUrl);
  for (let depth = 0; depth < 8; depth++) {
    paths.push(refPath);
    try {
      refName = execFileSync("git", ["symbolic-ref", "--quiet", "--no-recurse", refName], { cwd, encoding: "utf8" }).trim();
    } catch (error) {
      if ((error as { status?: number }).status === 1) break;
      throw error;
    }
    refPath = pathToFileURL(execFileSync("git", ["--git-dir", gitDirectory, "rev-parse", "--git-path", refName], { cwd, encoding: "utf8" }).trim());
  }
  for (let directory = directoryUrl(cwd);;) {
    paths.push(new URL(".git", directory));
    const parent = new URL("../", directory);
    if (directory.href === parent.href) break;
    directory = parent;
  }
  return paths.map(path => fileURLToPath(path));
}

/** The commit this process runs against, or null when the tree cannot be named. */
export function headSha(cwd: string = process.cwd()): string | null {
  cwd = fileURLToPath(pathToFileURL(cwd));
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
