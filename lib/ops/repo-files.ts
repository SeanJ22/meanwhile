import { execFileSync } from "node:child_process";

/** What a gate must look at: what would be committed now, not what already was. */

/** Where `git` is asked from. Callers pass the repository root. */
export interface RepoFilesOptions {
  cwd: string;
  /** Limit to these pathspecs, exactly as `git ls-files` takes them. */
  paths?: readonly string[];
}

/** Every file a commit made now would contain, repo-relative, POSIX-separated; `-z` so a newline in a name cannot split an entry. */
export function filesThatWouldBeCommitted(options: RepoFilesOptions): string[] {
  const normalize = (out: string) =>
    out
      .split("\0")
      .filter(Boolean)
      .map((p) => p.replace(/\\/g, "/"));
  const out = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", ...(options.paths ?? [])],
    { encoding: "utf8", cwd: options.cwd, maxBuffer: 1e9 },
  );
  // `--cached` names paths whose index entry is about to be deleted too. Such
  // a path is not in the tree `git add -A` would commit and, more importantly,
  // cannot be read from the working tree. Subtract Git's deleted set before a
  // caller opens the denominator; this keeps a deletion visible as an absence
  // instead of turning every read-based gate into ENOENT.
  const deleted = new Set(
    normalize(
      execFileSync("git", ["ls-files", "-z", "--deleted", ...(options.paths ?? [])], {
        encoding: "utf8",
        cwd: options.cwd,
        maxBuffer: 1e9,
      }),
    ),
  );
  return normalize(out)
    .filter((p) => !deleted.has(p))
    // `--cached` and `--others` can each name the same path in some states;
    // a gate counting its input must not count one file twice.
    .filter((p, i, all) => all.indexOf(p) === i);
}

/** The TypeScript sources under given directories, as one shared walk. */
export function sourceFilesUnder(
  cwd: string,
  dirs: readonly string[],
  extensions: readonly string[] = [".ts", ".tsx"],
): string[] {
  return filesThatWouldBeCommitted({ cwd, paths: dirs }).filter((p) =>
    extensions.some((ext) => p.endsWith(ext)),
  );
}
