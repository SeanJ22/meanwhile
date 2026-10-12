#!/usr/bin/env node
/**
 * Validate the standing runner's immutable launch boundary. It reads no
 * environment-file bytes; the only environment fact it returns is the resolved
 * path. The checkout must be a clean repository root, detached at the exact
 * deployed SHA, and that commit must already be on `origin/main`.
 */

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const FULL_SHA = /^[0-9a-f]{40}$/i;

/**
 * Check the runner's startup reads against its explicitly configured production destination.
 * @param {Record<string, string | undefined>} env
 */
export function assertProductionDatabaseTarget(env = process.env) {
  if (env.WTP_RUNTIME_MODE !== "production") return;
  const refuse = () => { throw new Error("PRODUCTION_DATABASE_TARGET_REFUSED: DATABASE_URL must match the approved production reader and writer endpoint and database"); };
  const target = (connection) => {
    try {
      const url = new URL(connection);
      if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2) return refuse();
      // Neon pooled and direct connections reach the same endpoint; roles and passwords do not identify the database.
      const host = url.hostname.endsWith(".neon.tech") ? url.hostname.replace(/-pooler(?=\.)/, "") : url.hostname;
      return `${host}${url.pathname}`;
    } catch { return refuse(); }
  };
  const reader = target(env.WTP_PRODUCTION_DATABASE_URL_READONLY);
  if (target(env.DATABASE_URL) !== reader || target(env.WTP_PRODUCTION_DATABASE_URL_WRITE) !== reader) refuse();
}

/** Staging digests stay in their worktree; the shared production mirror is never a fallback. */
export function resolvePilotMirror(root, configured, staging) {
  if (!staging) return configured ?? "G:/My Drive/we-the-people";
  if (!configured?.trim()) return null;
  const target = resolve(root, configured);
  if (!isInside(resolve(root), target)) return null;
  const canonicalRoot = realpathSync(root);
  let ancestor = target;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const canonicalTarget = resolve(realpathSync(ancestor), relative(ancestor, target));
  const within = relative(canonicalRoot, canonicalTarget);
  return within === "" || (!isAbsolute(within) && within !== ".." && !within.startsWith(`..${sep}`)) ? target : null;
}

function git(cwd, args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (allowFailure) return null;
    const detail = error && typeof error === "object" && "stderr" in error
      ? String(error.stderr ?? "").trim()
      : "";
    throw new Error(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
}

function samePath(a, b) {
  const left = realpathSync(a);
  const right = realpathSync(b);
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function requireAbsoluteExistingPath(label, input, kind) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error(`${label} is required and must be an absolute path`);
  }
  if (!isAbsolute(input)) throw new Error(`${label} must be absolute: ${input}`);
  const absolute = resolve(input);
  if (!existsSync(absolute)) throw new Error(`${label} does not exist: ${absolute}`);
  const stat = statSync(absolute);
  if (kind === "directory" && !stat.isDirectory()) throw new Error(`${label} is not a directory: ${absolute}`);
  if (kind === "file" && !stat.isFile()) throw new Error(`${label} is not a file: ${absolute}`);
  return realpathSync(absolute);
}

/**
 * Return the three normalized launch facts or throw in the fail-closed
 * direction.  No secret value is opened, parsed, logged, or returned.
 */
export function validateRuntimeConfig(input) {
  const repoPath = requireAbsoluteExistingPath("repo path", input?.repoPath, "directory");
  const envFile = requireAbsoluteExistingPath("environment file", input?.envFile, "file");
  const expectedSha = String(input?.expectedSha ?? "").trim().toLowerCase();
  if (!FULL_SHA.test(expectedSha)) {
    throw new Error("expected deployed SHA must be the full 40-character hexadecimal commit id");
  }

  const root = git(repoPath, ["rev-parse", "--show-toplevel"]);
  if (!samePath(root, repoPath)) {
    throw new Error(`repo path must name the repository root exactly (git reported ${root})`);
  }
  for (const required of ["scripts/pilot-runner.mts", "scripts/pilot-runtime-config.mjs", "pnpm-lock.yaml"]) {
    if (!existsSync(resolve(repoPath, required))) throw new Error(`runtime checkout is missing ${required}`);
  }

  const dirty = git(repoPath, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (dirty !== "") {
    const count = dirty.split(/\r?\n/).filter(Boolean).length;
    throw new Error(`runtime checkout is not clean (${count} changed or untracked path${count === 1 ? "" : "s"})`);
  }

  const head = git(repoPath, ["rev-parse", "HEAD"]).toLowerCase();
  if (head !== expectedSha) {
    throw new Error(`runtime checkout HEAD ${head} does not equal expected deployed SHA ${expectedSha}`);
  }
  const branch = git(repoPath, ["symbolic-ref", "--quiet", "--short", "HEAD"], { allowFailure: true });
  if (branch !== null) {
    throw new Error(`runtime checkout must be detached at the deployed SHA, not attached to branch ${branch}`);
  }
  const onMain = git(repoPath, ["merge-base", "--is-ancestor", expectedSha, "origin/main"], { allowFailure: true });
  if (onMain === null) {
    throw new Error(`expected deployed SHA ${expectedSha} is not proven present on origin/main`);
  }

  if (isInside(repoPath, envFile)) {
    const rel = relative(repoPath, envFile).replaceAll("\\", "/");
    // Ask the exact deployed commit for this path: a file list cannot prove the secret is absent from that tree.
    const tracked = git(repoPath, ["cat-file", "-e", `HEAD:${rel}`], { allowFailure: true });
    if (tracked !== null) throw new Error("environment file is tracked by Git; a standing secret file may never be committed");
    const ignored = git(repoPath, ["check-ignore", "--quiet", "--", rel], { allowFailure: true });
    if (ignored === null) {
      throw new Error("an environment file inside the runtime checkout must be explicitly Git-ignored");
    }
  }

  return Object.freeze({ repoPath, envFile, expectedSha });
}

function value(argv, name) {
  const index = argv.indexOf(name);
  return index < 0 ? null : argv[index + 1] ?? null;
}

function main(argv) {
  const result = validateRuntimeConfig({
    repoPath: value(argv, "--repo"),
    envFile: value(argv, "--env-file"),
    expectedSha: value(argv, "--expected-sha"),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`RUNTIME_CONFIG_REFUSED: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
