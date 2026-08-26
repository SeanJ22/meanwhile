/**
 * PUSHING `main` AS A DEPLOY KEY, OVER SSH.
 * (2026-08-26, the deploy-key cutover session. RULING 165.)
 *
 * **Why this exists at all.** The scoped bypass RULING 162 was built against
 * was meant to be granted to the GitHub Actions app. It cannot be: a branch
 * ruleset's `Add bypass` list does not offer GitHub Actions as a selectable
 * actor — confirmed against the live UI on 2026-08-26, filtered on `actions`
 * under the Apps tab, zero suggestions. The community reports were right and
 * the documentation was not. So the bypass is granted to the **Deploy keys**
 * category instead, and the eight scheduled pushers stop using the default
 * `GITHUB_TOKEN` over HTTPS and push as a deploy key over SSH.
 *
 * **The bypass is CATEGORY-WIDE and its mode is `exempt`.** Every write-enabled
 * deploy key on this repository inherits it, and an exempt actor skips the
 * ruleset outright rather than being evaluated and waved through. There is
 * therefore nothing on the server between a scheduled job and `main`:
 * `lib/ops/push-allowlist.ts` is the whole of it. That file is unchanged by
 * this cutover and is not weakened by it — it gets more scrutiny now, not less.
 *
 * **THE CREDENTIAL RULE IS ABSOLUTE AND IT SHAPED EVERY DECISION BELOW.** On
 * 2026-08-25 a `curl -w '%{url_effective}'` printed nine credential values into
 * a transcript that mirrors to Drive, and all nine required rotation
 * (RULING 127). A private key is the same failure with a worse blast radius. So:
 *
 *   - **No value from `PUSH_DEPLOY_KEY` is ever returned, logged, thrown, or
 *     interpolated into a message.** Every diagnostic below describes the key's
 *     SHAPE — present, empty, missing its header — and never its content.
 *   - **The key file never lands inside the repository or any synced folder.**
 *     It goes to the runner's ephemeral temp space, and `refuseUnsafeKeyRoot`
 *     turns "not in the repo, not in Drive" from a habit into a check.
 *   - **It is removed on every path**, the failure path included. The caller
 *     holds the handle in a `try`/`finally`; nothing depends on the push
 *     succeeding.
 *
 * **HOST VERIFICATION IS PINNED, NEVER DISABLED.** The obvious way to make an
 * unattended SSH push work is `StrictHostKeyChecking=no`, and that turns every
 * push into an unauthenticated one. `GITHUB_HOST_KEYS` below is a DECLARED
 * constant read from GitHub's own `meta` endpoint, written into a `known_hosts`
 * file beside the key. A declared constant cannot be wrong in an environment
 * nobody tested; a value derived at run time from the host you are trying to
 * authenticate can.
 */

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

/**
 * Just enough of an environment to read one variable from.
 *
 * NOT `EnvLike`: that type requires `NODE_ENV`, so every caller and
 * every test would have to supply a variable none of this code reads. A reader
 * that needs one key should say so in its type.
 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

/** The secret the workflows pass, named once so a typo cannot diverge. */
export const DEPLOY_KEY_SECRET = "PUSH_DEPLOY_KEY";

/**
 * GitHub's published SSH host keys.
 *
 * READ 2026-08-26 from `https://api.github.com/meta` (`.ssh_keys`), which is
 * the authoritative publication. Transcribed here as a DECLARED constant rather
 * than fetched at push time on purpose: fetching the host key from the host you
 * are about to authenticate is not verification, it is a round trip.
 *
 * GitHub rotates these rarely and announces it. When they do, the push fails
 * loudly with a host-key mismatch — which is the correct behaviour and exactly
 * what disabling strict checking would have hidden — and this list is updated
 * in a diff somebody reads.
 */
export const GITHUB_HOST_KEYS: readonly string[] = [
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl",
  "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=",
  "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=",
];

/** The `known_hosts` content pinning github.com to the keys above. */
export function knownHostsContent(): string {
  return `${GITHUB_HOST_KEYS.map((k) => `github.com ${k}`).join("\n")}\n`;
}

/* -------------------------------------------------------------------------- */
/* WHERE THE PUSH IS GOING                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Is this push target GitHub?
 *
 * **This is the switch that decides whether a deploy key is REQUIRED**, and the
 * direction is deliberate. Pushing to github.com needs the key and fails closed
 * without it; pushing anywhere else — the bare repositories the guard's own
 * proofs run against — does not need one and must not demand one, or the proof
 * could never run on a machine that correctly holds no private key.
 *
 * It reads the URL rather than the environment. `CI` being set is a fact about
 * the runner; the destination is a fact about the push.
 */
export function isGitHubTarget(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.trim();
  if (/^git@github\.com:/i.test(u)) return true;
  if (/^ssh:\/\/git@github\.com[/:]/i.test(u)) return true;
  if (/^https?:\/\/([^@/]*@)?github\.com\//i.test(u)) return true;
  return false;
}

/**
 * The SSH URL for a GitHub remote, whatever shape it arrived in.
 *
 * Returns `null` when the input is not a GitHub remote — the caller must keep
 * "not GitHub" and "GitHub but unparseable" apart, so an unparseable GitHub URL
 * throws rather than quietly reading as a local push that needs no key.
 */
export function sshUrlForGitHub(url: string): string | null {
  const u = url.trim().replace(/\.git$/i, "").replace(/\/+$/, "");

  const scp = /^git@github\.com:(.+)$/i.exec(u);
  if (scp) return `git@github.com:${scp[1]}.git`;

  const ssh = /^ssh:\/\/git@github\.com(?::\d+)?\/(.+)$/i.exec(u);
  if (ssh) return `git@github.com:${ssh[1]}.git`;

  const https = /^https?:\/\/(?:[^@/]*@)?github\.com\/(.+)$/i.exec(u);
  if (https) return `git@github.com:${https[1]}.git`;

  return null;
}

/* -------------------------------------------------------------------------- */
/* IS THE SECRET USABLE                                                        */
/* -------------------------------------------------------------------------- */

export interface KeyShapeVerdict {
  readonly ok: boolean;
  /** Names the secret and describes the SHAPE of the problem. Never the value. */
  readonly reason: string;
}

/**
 * Is what arrived in `PUSH_DEPLOY_KEY` an OpenSSH private key at all?
 *
 * **Three refusals, and none of them may degrade to "nothing to push".** That
 * shape — a mechanism reporting success for work it did not do — has been
 * sighted in this repo enough times to have its own rulings (100, 113, 159).
 * A missing credential is a red run.
 *
 * The check is deliberately structural rather than cryptographic: header,
 * footer, and a body between them. Anything stricter would have to parse the
 * key, and parsing a private key means holding it in more places than one.
 */
export function judgeKeyShape(raw: string | undefined | null): KeyShapeVerdict {
  if (raw === undefined || raw === null) {
    return {
      ok: false,
      reason:
        `${DEPLOY_KEY_SECRET} is not set in this job's environment. The push cannot ` +
        `authenticate. Add \`${DEPLOY_KEY_SECRET}: \${{ secrets.${DEPLOY_KEY_SECRET} }}\` ` +
        "to the env of the step that runs scripts/push-main.mjs.",
    };
  }
  if (raw.trim().length === 0) {
    return {
      ok: false,
      reason:
        `${DEPLOY_KEY_SECRET} is set but EMPTY. In GitHub Actions an unset secret ` +
        "interpolates to an empty string, so this is what a missing repository secret " +
        "looks like from inside the job — not a key that failed to load.",
    };
  }

  const text = raw.trim();
  const header = /^-----BEGIN ([A-Z ]*)PRIVATE KEY-----$/m.exec(text);
  const footer = /^-----END ([A-Z ]*)PRIVATE KEY-----$/m.exec(text);
  if (!header || !footer) {
    return {
      ok: false,
      reason:
        `${DEPLOY_KEY_SECRET} does not look like an OpenSSH private key: the ` +
        "BEGIN/END PRIVATE KEY lines are not both present. The most common cause is " +
        "pasting the PUBLIC half (the one-line .pub file) into the secret — the public " +
        "half belongs in Settings -> Deploy keys, not here. See docs/deploy-key-setup.md.",
    };
  }
  if (header.index >= footer.index) {
    return { ok: false, reason: `${DEPLOY_KEY_SECRET} is malformed: its END line precedes its BEGIN line.` };
  }

  return { ok: true, reason: `${DEPLOY_KEY_SECRET} is present and has the shape of an OpenSSH private key.` };
}

/**
 * An OpenSSH private key file MUST end in a newline. `ssh-keygen` writes one;
 * a paste into a web form routinely loses it, and `ssh` then refuses the key
 * with `invalid format` — which reads like a corrupt key rather than a missing
 * character. Restoring it here costs nothing and removes a whole class of
 * support question from Sean's side of the setup.
 */
export function normaliseKeyMaterial(raw: string): string {
  const body = raw.replace(/\r\n/g, "\n").replace(/\s+$/, "");
  return `${body}\n`;
}

/* -------------------------------------------------------------------------- */
/* WHERE THE KEY FILE MAY LIVE                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Directory-name fragments that mean "this path is synced to somewhere else".
 *
 * RULING 127's finding was that a value written to a synced folder must be
 * assumed read, and RULING 108 established that the Drive mirror is a real
 * place things land on this author's machine. A private key written under one
 * of these is a rotation event, so it is refused rather than trusted to habit.
 */
export const SYNCED_PATH_FRAGMENTS: readonly string[] = [
  "my drive",
  "google drive",
  "googledrive",
  "onedrive",
  "dropbox",
  "icloud",
];

/**
 * Refuse a key root that is inside the repository or inside a synced folder.
 *
 * Returns a reason string when the root is unsafe, or `null` when it is fine.
 * A refusal, not a fallback: silently relocating would leave the caller
 * believing it had chosen the location it asked for.
 */
export function refuseUnsafeKeyRoot(root: string, repoRoot: string): string | null {
  if (!isAbsolute(root)) return `the key directory ${root} is not an absolute path`;

  const lower = root.toLowerCase();
  for (const fragment of SYNCED_PATH_FRAGMENTS) {
    if (lower.includes(fragment)) {
      return (
        `the key directory ${root} is inside a synced folder ("${fragment}"). A private key ` +
        "written to a synced folder must be assumed read, and rotation is then the only fix " +
        "(RULING 127). Set RUNNER_TEMP to an unsynced path."
      );
    }
  }

  const normalisedRoot = resolve(root).toLowerCase();
  const normalisedRepo = resolve(repoRoot).toLowerCase();
  if (normalisedRoot === normalisedRepo || normalisedRoot.startsWith(normalisedRepo + sep.toLowerCase())) {
    return (
      `the key directory ${root} is inside the repository at ${repoRoot}. A private key inside ` +
      "the working tree is one `git add .` away from being committed."
    );
  }

  return null;
}

/**
 * The ephemeral root to write the key under.
 *
 * `RUNNER_TEMP` on a GitHub runner: it is created per job and destroyed with
 * the runner, which is the strongest cleanup available and does not depend on
 * this process getting to its own `finally`. `os.tmpdir()` everywhere else.
 */
export function ephemeralRoot(env: EnvLike = process.env): string {
  const runner = env.RUNNER_TEMP?.trim();
  return runner && runner.length > 0 ? runner : tmpdir();
}

/* -------------------------------------------------------------------------- */
/* THE HANDLE                                                                  */
/* -------------------------------------------------------------------------- */

export interface DeployKeyHandle {
  /** Where the key was written. A path, never material. */
  readonly keyPath: string;
  readonly knownHostsPath: string;
  /** The value for `GIT_SSH_COMMAND`. Contains the key's PATH and no material. */
  readonly sshCommand: string;
  /** Idempotent. Safe to call from a `finally` after a throw. */
  readonly cleanup: () => void;
}

/**
 * Quote a path for the single command line `GIT_SSH_COMMAND` is parsed as.
 *
 * Windows runners are not the deploy target, but the author's machine is
 * Windows and the proofs run there, and `C:\Users\...\AppData\Local\Temp` has
 * both backslashes and, on plenty of machines, a space. Git parses
 * `GIT_SSH_COMMAND` with shell-like word splitting, so an unquoted path with a
 * space becomes two arguments and `ssh` reports a baffling error about a host
 * called `Files`.
 */
export function quoteForSshCommand(path: string): string {
  const forward = path.replace(/\\/g, "/");
  return `"${forward.replace(/"/g, '\\"')}"`;
}

/**
 * Write the key and the pinned `known_hosts` into a fresh ephemeral directory
 * and hand back the handle.
 *
 * THROWS on an unusable key or an unsafe root. Throwing rather than returning
 * a verdict is the fail-closed direction here: a caller that forgot to check a
 * returned flag would push with no credential and get a confusing permission
 * error; a caller that forgot to catch gets a red run naming the secret.
 *
 * Nothing thrown from here carries key material — the messages come from
 * `judgeKeyShape` and `refuseUnsafeKeyRoot`, both of which describe shape only.
 */
export function materialiseDeployKey(options: {
  readonly raw: string | undefined | null;
  readonly repoRoot: string;
  readonly env?: EnvLike;
}): DeployKeyHandle {
  const shape = judgeKeyShape(options.raw);
  if (!shape.ok) throw new Error(shape.reason);

  const root = ephemeralRoot(options.env ?? process.env);
  const unsafe = refuseUnsafeKeyRoot(root, options.repoRoot);
  if (unsafe) throw new Error(unsafe);

  // 0o700 on the directory as well as 0o600 on the file: ssh refuses a key
  // other users can read, and on a shared runner the directory is the wider
  // hole of the two.
  const dir = mkdtempSync(join(root, "wtp-deploy-key-"));
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Windows has no POSIX mode. The directory is already inside the user's own
    // temp space there, and ssh does not enforce the permission check on it.
  }

  const keyPath = join(dir, "id_deploy");
  const knownHostsPath = join(dir, "known_hosts");

  writeFileSync(keyPath, normaliseKeyMaterial(options.raw as string), { mode: 0o600 });
  writeFileSync(knownHostsPath, knownHostsContent(), { mode: 0o600 });
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    /* see above */
  }

  const sshCommand = [
    "ssh",
    "-i",
    quoteForSshCommand(keyPath),
    // Use ONLY this key. Without it ssh offers every identity the agent holds
    // first, and a runner with any other identity loaded can exhaust
    // MaxAuthTries before it ever reaches the one we just wrote.
    "-o IdentitiesOnly=yes",
    "-o IdentityAgent=none",
    // Pinned, never disabled. This is the line the shortcut would have deleted.
    "-o StrictHostKeyChecking=yes",
    `-o UserKnownHostsFile=${quoteForSshCommand(knownHostsPath)}`,
    // RULING 146 — nothing a session runs may be capable of prompting.
    "-o BatchMode=yes",
    "-o PasswordAuthentication=no",
  ].join(" ");

  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    rmSync(dir, { recursive: true, force: true });
  };

  return { keyPath, knownHostsPath, sshCommand, cleanup };
}
