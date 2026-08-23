/**
 * **RUNG 4, WIDENED: A GITHUB-HOSTED CORPUS IS REACHABLE BY `git`, WHERE THE
 * SAME BYTES OVER HTTP ARE REFUSED.**
 * (Built 2026-08-23, the questionnaire-and-corpora brief, item 2. RULING 88 —
 * this route did not exist at session start.)
 *
 * ## How it was conceived, stated because RULING 88 asks
 *
 * The brief declared the environment: no live network except `github.com`,
 * which is reachable. `scripts/fetch-official-photos.mts` had exactly one route
 * to the portraits — `https://unitedstates.github.io/images/congress/450x550/…`
 * — a GitHub PAGES host, which is a different host from `github.com` and is
 * refused here. The two serve **the same bytes out of the same repository**.
 *
 * So the question that produced this file was: *the wall is around a host, not
 * around the data — what other road reaches the same repository?* (RULING 90's
 * fourth obligation, in as many words.) The answer is `git`, and it was one
 * command away.
 *
 * **Measured on adoption, both roads, same file, same minute:**
 *
 * ```
 * curl -s -o /dev/null -w "%{http_code}" \
 *   https://unitedstates.github.io/images/congress/450x550/C000127.jpg   → 000
 * git clone --filter=blob:none --no-checkout https://github.com/unitedstates/images.git
 * git show HEAD:congress/450x550/C000127.jpg                             → 114,839 bytes, JPEG 450x550
 * ```
 *
 * ## What it generalises to, which is the part worth keeping
 *
 * **Every corpus published as a GitHub repository**, not these two. The
 * technique is host-agnostic within `github.com` and content-agnostic: a
 * blobless partial clone costs a few hundred kilobytes, `git ls-tree` gives a
 * complete file listing with NO blob transfer at all — which is a free
 * enumeration of the corpus, and enumeration is what a count assertion needs —
 * and `git show` pulls exactly the blobs actually wanted.
 *
 * It is also strictly BETTER than the HTTP route even where HTTP works, for a
 * reason that has nothing to do with walls: a clone is pinned to a commit, so a
 * read is reproducible and a `collectedAt` is anchored to an immutable tree
 * rather than to whatever the CDN was serving that afternoon.
 *
 * ## The two standing prohibitions are untouched
 *
 * Nothing here authenticates, spoofs an egress or defeats a challenge. It is a
 * public repository fetched by its own publisher's supported protocol.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface CorpusHandle {
  /** `owner/repo`. */
  slug: string;
  /** Where the working clone lives. */
  dir: string;
  /** The commit every read in this session is anchored to. */
  sha: string;
  /** `https://github.com/owner/repo/tree/<sha>` — a reader can open it. */
  treeUrl: string;
}

function git(dir: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

/**
 * Clone (or reuse) a blobless partial clone and pin it to its current head.
 *
 * `--filter=blob:none --no-checkout` is the whole trick: the tree arrives, the
 * file contents do not, and `git show` fetches a blob on demand. Enumerating
 * 1,297 portraits therefore costs no image bytes at all.
 */
export function openCorpus(input: {
  slug: string;
  cacheDir: string;
}): CorpusHandle {
  const dir = join(input.cacheDir, input.slug.replace("/", "__"));
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(input.cacheDir, { recursive: true });
    execFileSync(
      "git",
      [
        "clone",
        "--filter=blob:none",
        "--no-checkout",
        `https://github.com/${input.slug}.git`,
        dir,
      ],
      { stdio: "pipe", encoding: "utf8" },
    );
  }
  const sha = git(dir, ["rev-parse", "HEAD"]).trim();
  return {
    slug: input.slug,
    dir,
    sha,
    treeUrl: `https://github.com/${input.slug}/tree/${sha}`,
  };
}

/**
 * Every path under `prefix`, from the tree alone.
 *
 * **This is the count-assertion instrument** (RULING 100): the corpus states
 * its own size here, for free, before a single blob is transferred — so an
 * extraction that comes back with fewer has something to fail against rather
 * than a number nobody could check.
 */
export function listPaths(handle: CorpusHandle, prefix: string): string[] {
  const out = git(handle.dir, ["ls-tree", "-r", "HEAD", "--name-only", prefix]);
  return out.split("\n").filter((line) => line.trim() !== "");
}

/** Read a text file at the pinned commit. */
export function readTextFile(handle: CorpusHandle, path: string): string {
  return git(handle.dir, ["show", `HEAD:${path}`]);
}

/**
 * Read a binary file at the pinned commit.
 *
 * `execFileSync` with a `buffer` encoding, because a JPEG through a string
 * round-trip is a corrupted JPEG and the corruption is silent.
 */
export function readBinaryFile(handle: CorpusHandle, path: string): Buffer {
  return execFileSync("git", ["-C", handle.dir, "show", `HEAD:${path}`], {
    maxBuffer: 256 * 1024 * 1024,
  });
}

/**
 * The repository's own `LICENSE`, read from the repository rather than assumed.
 *
 * The brief's instruction, and it is the right one: *do not assume public
 * domain because the organisation name suggests it.* `unitedstates/*` sounds
 * governmental and is a community project.
 */
export function readLicense(handle: CorpusHandle): { path: string; text: string } | null {
  for (const path of ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "UNLICENSE"]) {
    try {
      return { path, text: readTextFile(handle, path) };
    } catch {
      continue;
    }
  }
  return null;
}

/** The licence's own first identifying line, for the register. Never inferred. */
export function licenceIdentifier(text: string): string | null {
  const patterns: ReadonlyArray<[RegExp, string]> = [
    [/^\s*Creative Commons Legal Code\s*\n\s*CC0 1\.0 Universal/m, "CC0 1.0 Universal"],
    [/\bCC0 1\.0 Universal\b/, "CC0 1.0 Universal"],
    [/\bApache License\s*\n?\s*Version 2\.0/, "Apache-2.0"],
    [/\bMIT License\b/, "MIT"],
    [/\bGNU GENERAL PUBLIC LICENSE\b[\s\S]{0,80}Version 3/, "GPL-3.0"],
    [/\bThis is free and unencumbered software released into the public domain\b/, "Unlicense"],
  ];
  for (const [pattern, id] of patterns) {
    if (pattern.test(text)) return id;
  }
  return null;
}
