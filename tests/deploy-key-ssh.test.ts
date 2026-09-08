import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  DEPLOY_KEY_SECRET,
  GITHUB_HOST_KEYS,
  SYNCED_PATH_FRAGMENTS,
  ephemeralRoot,
  isGitHubTarget,
  judgeKeyShape,
  knownHostsContent,
  materialiseDeployKey,
  normaliseKeyMaterial,
  quoteForSshCommand,
  refuseUnsafeKeyRoot,
  sshUrlForGitHub,
} from "../lib/ops/deploy-key-ssh.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOWS = join(ROOT, ".github", "workflows");

/**
 * THE DEPLOY-KEY CUTOVER (2026-08-26, RULING 165).
 *
 * `lib/ops/deploy-key-ssh.ts` carries the diagnosis. This carries the proof.
 *
 * **NO REAL PRIVATE KEY IS GENERATED, WRITTEN OR READ ANYWHERE IN THIS FILE,
 * and that is a deliberate constraint rather than an omission.** The placeholder
 * below has the STRUCTURE of an OpenSSH private key — the BEGIN and END lines
 * the module actually checks for — and a body that is a run of `x`. It cannot
 * authenticate to anything. Generating a throwaway keypair to make the test
 * feel more real would put private-key material into a test run, a temp folder
 * and potentially a CI log, which is exactly the class of leak RULING 127 was
 * adopted over. What the module decides is SHAPE and PLACEMENT, and a
 * structural placeholder exercises every one of those decisions.
 */
const PLACEHOLDER_KEY =
  "-----BEGIN OPENSSH PRIVATE KEY-----\n" +
  "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n" +
  "-----END OPENSSH PRIVATE KEY-----\n";

/* ---- 1. where the push is going ------------------------------------------ */

test("RULING 165: the deploy key is required by the DESTINATION, not by the environment", () => {
  // GitHub, in every shape a remote arrives in.
  assert.equal(isGitHubTarget("https://github.com/SeanJ22/meanwhile.git"), true);
  assert.equal(isGitHubTarget("https://x-access-token:TOKEN@github.com/SeanJ22/meanwhile.git"), true);
  assert.equal(isGitHubTarget("git@github.com:SeanJ22/meanwhile.git"), true);
  assert.equal(isGitHubTarget("ssh://git@github.com/SeanJ22/meanwhile.git"), true);

  // Not GitHub — and these must NOT demand a key, or the guard's own
  // both-directions proof could never run on a machine that correctly holds
  // no private key.
  assert.equal(isGitHubTarget("/tmp/origin.git"), false);
  assert.equal(isGitHubTarget("C:/scratch/origin.git"), false);
  assert.equal(isGitHubTarget("file:///tmp/origin.git"), false);
  assert.equal(isGitHubTarget(null), false);

  // A lookalike host is not github.com. This is the case a substring check
  // would have got wrong.
  assert.equal(isGitHubTarget("https://github.com.evil.example/SeanJ22/x.git"), false);
  assert.equal(isGitHubTarget("https://notgithub.com/SeanJ22/x.git"), false);
});

test("RULING 165: every GitHub remote shape resolves to the same SSH URL", () => {
  const expected = "git@github.com:SeanJ22/meanwhile.git";
  for (const input of [
    "https://github.com/SeanJ22/meanwhile.git",
    "https://github.com/SeanJ22/meanwhile",
    "https://x-access-token:TOKEN@github.com/SeanJ22/meanwhile.git",
    "git@github.com:SeanJ22/meanwhile.git",
    "ssh://git@github.com/SeanJ22/meanwhile.git",
  ]) {
    assert.equal(sshUrlForGitHub(input), expected, `${input} should resolve to ${expected}`);
  }
  assert.equal(sshUrlForGitHub("/tmp/origin.git"), null, "a local path is not a GitHub remote");
});

/* ---- 2. fail closed on the secret ---------------------------------------- */

test("RULING 165: an ABSENT secret is refused, and the message names the secret", () => {
  const v = judgeKeyShape(undefined);
  assert.equal(v.ok, false);
  assert.ok(v.reason.includes(DEPLOY_KEY_SECRET), "the refusal names PUSH_DEPLOY_KEY");
  assert.ok(
    /nothing to push|no-op|skip/i.test(v.reason) === false,
    "a missing credential must never be described as nothing to push",
  );
});

test("RULING 165: an EMPTY secret is refused and named as what a missing secret looks like", () => {
  // This is the one that matters most: in GitHub Actions an unset secret
  // interpolates to "", so an empty string IS the missing-secret case and a
  // check that only tested for `undefined` would sail straight past it.
  for (const empty of ["", "   ", "\n\n"]) {
    const v = judgeKeyShape(empty);
    assert.equal(v.ok, false, `"${JSON.stringify(empty)}" must be refused`);
    assert.ok(v.reason.includes(DEPLOY_KEY_SECRET));
  }
});

test("RULING 165: the PUBLIC half pasted into the secret is refused, and says so", () => {
  const publicHalf =
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPydQBh7kIz2jM5Ty0EnfsvQLCRlPUueQj3xAEVjKngK wtp-scheduled-pushers";
  const v = judgeKeyShape(publicHalf);
  assert.equal(v.ok, false);
  assert.ok(/PUBLIC half/i.test(v.reason), "the likeliest setup mistake is named, not merely refused");
});

test("RULING 165: a structurally valid key is accepted", () => {
  assert.equal(judgeKeyShape(PLACEHOLDER_KEY).ok, true);
});

test("RULING 165: no refusal message can carry key material", () => {
  // The refusals are built from constants and never interpolate the input.
  // Proved by handing in a marker and asserting it does not come back out.
  const marker = "SECRET-MATERIAL-MARKER-9d3f";
  for (const input of [marker, `-----BEGIN OPENSSH PRIVATE KEY-----\n${marker}`, `${marker}\n-----END X PRIVATE KEY-----`]) {
    const v = judgeKeyShape(input);
    assert.ok(!v.reason.includes(marker), `the refusal for ${input.slice(0, 20)}… leaked its input`);
  }
});

test("RULING 165: a key pasted without its trailing newline is repaired", () => {
  // ssh reports a key missing its final newline as `invalid format`, which
  // reads like corruption rather than one absent character. Web forms eat it
  // routinely, so this removes a whole class of setup failure from Sean's side.
  const stripped = PLACEHOLDER_KEY.trimEnd();
  assert.ok(!stripped.endsWith("\n"));
  assert.ok(normaliseKeyMaterial(stripped).endsWith("-----END OPENSSH PRIVATE KEY-----\n"));
  // CRLF from a Windows paste is normalised too.
  assert.ok(!normaliseKeyMaterial(PLACEHOLDER_KEY.replace(/\n/g, "\r\n")).includes("\r"));
});

/* ---- 3. where the key file may live -------------------------------------- */

test("RULING 165: a key root inside the repository is REFUSED", () => {
  const reason = refuseUnsafeKeyRoot(join(ROOT, "scratch"), ROOT);
  assert.ok(reason, "a root inside the working tree must be refused");
  assert.ok(/inside the repository/i.test(reason as string));
});

test("RULING 165: a key root inside a synced folder is REFUSED, by name", () => {
  // RULING 127: a value written to a synced folder must be assumed read, and
  // rotation is then the only fix. The cheaper fix is never writing it there.
  for (const fragment of SYNCED_PATH_FRAGMENTS) {
    const root = process.platform === "win32" ? `G:\\${fragment}\\tmp` : `/mnt/${fragment}/tmp`;
    const reason = refuseUnsafeKeyRoot(root, ROOT);
    assert.ok(reason, `${root} must be refused`);
    assert.ok(reason!.includes(fragment), "the refusal names which synced folder it matched");
  }
});

test("RULING 165: a relative key root is refused rather than resolved", () => {
  assert.ok(refuseUnsafeKeyRoot("tmp/keys", ROOT), "a relative root is not a place we know");
});

test("RULING 165: the ordinary ephemeral root is accepted", () => {
  assert.equal(refuseUnsafeKeyRoot(tmpdir(), ROOT), null);
});

test("RULING 165: RUNNER_TEMP is preferred, because the runner destroys it whatever we do", () => {
  assert.equal(ephemeralRoot({ RUNNER_TEMP: "/runner/_temp" }), "/runner/_temp");
  assert.equal(ephemeralRoot({ RUNNER_TEMP: "  " }), tmpdir(), "blank falls back rather than writing to ''");
  assert.equal(ephemeralRoot({}), tmpdir());
});

/* ---- 4. host verification is pinned, never disabled ---------------------- */

test("RULING 165: host verification is PINNED and the disable flags are absent", () => {
  const scratch = mkdtempSync(join(tmpdir(), "wtp-key-host-"));
  try {
    const handle = materialiseDeployKey({ raw: PLACEHOLDER_KEY, repoRoot: ROOT, env: { RUNNER_TEMP: scratch } });
    try {
      assert.ok(
        handle.sshCommand.includes("-o StrictHostKeyChecking=yes"),
        "strict host key checking is on",
      );
      // The shortcut this rules out, in every spelling. Making an unattended
      // SSH push work by turning off host verification turns every push into
      // an unauthenticated one.
      for (const shortcut of ["StrictHostKeyChecking=no", "StrictHostKeyChecking=accept-new", "UserKnownHostsFile=/dev/null"]) {
        assert.ok(!handle.sshCommand.includes(shortcut), `${shortcut} must never appear`);
      }
      assert.ok(handle.sshCommand.includes("-o BatchMode=yes"), "RULING 146 — it can never prompt");
      assert.ok(handle.sshCommand.includes("-o IdentitiesOnly=yes"), "only the key we just wrote is offered");

      const known = readFileSync(handle.knownHostsPath, "utf8");
      assert.equal(GITHUB_HOST_KEYS.length, 3, "GitHub publishes three host keys");
      for (const key of GITHUB_HOST_KEYS) {
        assert.ok(known.includes(`github.com ${key}`), "every published host key is pinned");
      }
    } finally {
      handle.cleanup();
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("RULING 165: the pinned known_hosts is a real known_hosts, one host per line", () => {
  const lines = knownHostsContent().trim().split("\n");
  assert.equal(lines.length, GITHUB_HOST_KEYS.length);
  for (const line of lines) assert.match(line, /^github\.com (ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa) [A-Za-z0-9+/=]+$/);
});

test("RULING 165: a key path with a space survives GIT_SSH_COMMAND's word splitting", () => {
  // Git parses GIT_SSH_COMMAND with shell-like splitting. An unquoted
  // `C:\Program Files\...` becomes two arguments and ssh reports an error about
  // a host called `Files`, which sends every reader to the wrong place.
  const quoted = quoteForSshCommand("C:\\Users\\a b\\Temp\\id_deploy");
  assert.equal(quoted, '"C:/Users/a b/Temp/id_deploy"');
});

/* ---- 5. the key file: where it lands, and that it leaves ----------------- */

test("RULING 165: the key lands outside the repo, 0600, and cleanup removes it", () => {
  const scratch = mkdtempSync(join(tmpdir(), "wtp-key-life-"));
  try {
    const handle = materialiseDeployKey({ raw: PLACEHOLDER_KEY, repoRoot: ROOT, env: { RUNNER_TEMP: scratch } });

    assert.ok(existsSync(handle.keyPath), "the key was written");
    assert.ok(
      !handle.keyPath.toLowerCase().startsWith(ROOT.toLowerCase()),
      "the key is NOT inside the repository — one `git add .` away from being committed",
    );
    assert.ok(handle.keyPath.startsWith(scratch), "it is in the ephemeral root it was given");

    if (process.platform !== "win32") {
      // Windows has no POSIX mode; ssh does not enforce the check there either.
      assert.equal(statSync(handle.keyPath).mode & 0o777, 0o600, "owner-only");
    }

    // The material round-trips exactly, so a real key is not corrupted in transit.
    assert.equal(readFileSync(handle.keyPath, "utf8"), PLACEHOLDER_KEY);

    handle.cleanup();
    assert.ok(!existsSync(handle.keyPath), "cleanup removed the key");
    assert.ok(!existsSync(handle.knownHostsPath), "cleanup removed the whole directory");
    handle.cleanup(); // idempotent — a `finally` after a throw must not throw itself
    assert.equal(readdirSync(scratch).length, 0, "nothing of ours is left behind");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("RULING 165: materialising with an unusable secret THROWS and writes nothing", () => {
  const scratch = mkdtempSync(join(tmpdir(), "wtp-key-refuse-"));
  try {
    assert.throws(
      () => materialiseDeployKey({ raw: "", repoRoot: ROOT, env: { RUNNER_TEMP: scratch } }),
      (e: Error) => e.message.includes(DEPLOY_KEY_SECRET),
    );
    assert.equal(readdirSync(scratch).length, 0, "a refused key leaves no directory behind");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

/* ---- 6. the secret is actually plumbed into all eight pushers ------------ */

test("RULING 165: every workflow that pushes main passes PUSH_DEPLOY_KEY to the push step", () => {
  /*
   * THE CUTOVER'S BEHAVIOUR LIVES IN ONE FILE, BUT THE SECRET REFERENCE CANNOT.
   * `${{ secrets.* }}` is only expressible in workflow YAML, so each pusher
   * carries one plumbing line. This turns those eight lines into a guarded
   * invariant rather than eight places to drift: a ninth pusher added without
   * the secret fails HERE, by name, rather than at 3 AM with a permission error.
   */
  const offenders: string[] = [];
  const checked: string[] = [];

  for (const file of readdirSync(WORKFLOWS).filter((f) => f.endsWith(".yml"))) {
    const text = readFileSync(join(WORKFLOWS, file), "utf8");
    const body = text
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    if (!/node\s+scripts\/push-main\.mjs/.test(body)) continue;

    checked.push(file);
    if (!/PUSH_DEPLOY_KEY:\s*\$\{\{\s*secrets\.PUSH_DEPLOY_KEY\s*\}\}/.test(body)) {
      offenders.push(
        `${file} runs scripts/push-main.mjs but never passes PUSH_DEPLOY_KEY. Under the ` +
          "Deploy-keys bypass the default GITHUB_TOKEN cannot write main, so this workflow " +
          "would go red at the push with a permission error.",
      );
    }
  }

  // RULING 159 — zero is a result that must be EARNED. A selector that matched
  // nothing would otherwise report a clean sweep of an empty set.
  assert.equal(
    checked.length,
    7,
    // SEVEN after RCD-4/RCD-5 retired the FEC and LegiScan tracked-file
    // pushers. Routine civic data now moves through the production data plane.
    `expected 7 scheduled pushers, found ${checked.length}: ${checked.join(", ")}. ` +
      "If a pusher was added or removed, move this number in the same diff.",
  );
  assert.deepEqual(offenders, [], offenders.join("\n"));
});
