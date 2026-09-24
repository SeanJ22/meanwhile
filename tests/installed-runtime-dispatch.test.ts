import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  installedRuntimeChildPlan,
  parseInstalledRuntimePayload,
} from "../scripts/installed-runtime-dispatch.mts";

const ROOT = process.cwd();

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

test("the installed dispatcher admits one exact registered manual contract", () => {
  const payload = parseInstalledRuntimePayload(encoded({
    mode: "manual-promote",
    args: ["--contract=congress-rollcalls", "--window=12"],
  }));
  const plan = installedRuntimeChildPlan(payload);
  assert.equal(plan.capability, "MANUAL_CONTRACT");
  assert.equal(plan.contract, "congress-rollcalls");
  assert.deepEqual(plan.scriptArgs, [
    "--experimental-strip-types",
    "scripts/fetch-votes.mts",
    "--promote",
    "--window=12",
  ]);
});

test("unknown, missing, and duplicated manual contracts are refused", () => {
  assert.throws(
    () => installedRuntimeChildPlan({ mode: "manual-promote", args: [] }),
    /OWNER_MANUAL_CONTRACT_REQUIRED_ONCE/,
  );
  assert.throws(
    () => installedRuntimeChildPlan({ mode: "manual-promote", args: ["--contract=not-registered"] }),
    /OWNER_MANUAL_CONTRACT_UNKNOWN/,
  );
  assert.throws(
    () => installedRuntimeChildPlan({
      mode: "manual-promote",
      args: ["--contract=prl", "--contract=voting-sites"],
    }),
    /OWNER_MANUAL_CONTRACT_REQUIRED_ONCE/,
  );
});

test("the owner window cannot impersonate the standing clock", () => {
  assert.throws(
    () => installedRuntimeChildPlan({ mode: "window", args: ["--shadow", "--trigger=RUNNER_CLOCK"] }),
    /OWNER_WINDOW_CANNOT_IMPERSONATE_CLOCK/,
  );
  assert.throws(
    () => installedRuntimeChildPlan({ mode: "window", args: ["--trigger=MANUAL"] }),
    /OWNER_WINDOW_REQUIRES_SHADOW_OR_WAKEUP/,
  );
  const plan = installedRuntimeChildPlan({ mode: "window", args: ["--shadow", "--trigger=MANUAL"] });
  assert.equal(plan.capability, "NIGHTLY_RESEARCH");
  assert.equal(plan.contract, null);
  assert.ok(plan.scriptArgs.includes("scripts/nightly-window.mts"));
});

test("payload parsing has a closed mode set and no control-line arguments", () => {
  for (const value of [
    null,
    "not base64!",
    encoded({ mode: "shell", args: ["whoami"] }),
    encoded({ mode: "agent-bridge-job", args: ["--provider=codex\n--command=whoami"] }),
    encoded({ mode: "agent-bridge-job", args: "--provider=codex" }),
  ]) {
    assert.throws(() => parseInstalledRuntimePayload(value), /OWNER_COMMAND_PAYLOAD_INVALID/);
  }
});

test("package production doors either disappear or enter the installed dispatcher", () => {
  const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }).scripts;
  for (const retired of [
    "pilot:run",
    "routine:civic-data",
    "intake:tripwire",
    "pilot:pause-note",
    "freshness:shadow:pg",
    "owner:publish",
    "readiness:publish",
    "console:publish",
    "acs:population",
    "acs:population:promote",
    "dotgov:fetch",
    "fec:fetch",
    "fec:promote",
    "nh:members:promote",
    // Pima Legistar outcomes moved to the standing clock; the owner alias is gone.
    "outcomes:ingest",
    "ingest",
  ]) {
    assert.equal(scripts[retired], undefined, `${retired} restores a direct production child`);
  }

  for (const wrapped of [
    "agent-bridge:job",
    "agent-bridge:review",
    "window:run",
    "civic-data:promote-manual",
    "congress:fetch",
    "registry:promote",
    "votes:fetch",
    "key-votes:positions",
    "jurisdictions:promote",
    "money:az",
    "money:nh",
    "money:nj",
    "money:az:pima",
    "voting-sites:fetch",
    "prl:fetch",
    "official-actions:promote",
  ]) {
    assert.match(
      scripts[wrapped] ?? "",
      /^node scripts\/installed-runtime-command\.mjs /,
      `${wrapped} bypasses the installed runtime dispatcher`,
    );
  }
});

test("active adapter guidance cannot restore retired direct production doors", () => {
  const adapterPaths = [
    "scripts/fetch-fec.mts",
    "scripts/fetch-dotgov.mts",
    "scripts/nh-gencourt-members.mts",
    "scripts/legistar-outcomes-ingest.mts",
  ];
  const forbiddenDirectAlias = /\b(?:fec:fetch|fec:promote|dotgov:fetch|nh:members:promote|outcomes:ingest)\b/;
  for (const path of adapterPaths) {
    const source = readFileSync(join(ROOT, path), "utf8");
    assert.doesNotMatch(source, forbiddenDirectAlias, `${path} tells an operator to bypass installed authority`);
    assert.match(source, /installed runtime dispatcher/, `${path} does not name the permanent production door`);
  }

  const credentialWalk = readFileSync(join(ROOT, "scripts", "api-keys-walk.mts"), "utf8");
  assert.doesNotMatch(
    credentialWalk,
    /fetch-legiscan\.mts|refresh-legiscan-snapshot\.yml|LegiScan[^\n]*(?:daily|weekly) schedule/i,
    "the active credential walk recreates the retired LegiScan authority graph",
  );
  assert.match(credentialWalk, /LEGISCAN_API_KEY — intentionally not spent in production/);
  assert.match(credentialWalk, /NOT A PRODUCTION CALLER/);
});

test("the host controller validates installed authority and the exact parent before dispatch", () => {
  const source = readFileSync(join(ROOT, "scripts", "pilot-task.ps1"), "utf8");
  const at = source.indexOf('"owner-command" {');
  assert.ok(at >= 0, "pilot-task has no owner-command action");
  const tail = source.slice(at);
  const end = tail.search(/\n {4}"install" \{/);
  assert.ok(end > 0);
  const block = tail.slice(0, end);
  const resolveAt = block.indexOf("Resolve-ActiveRuntimeOrThrow");
  const identityAt = block.indexOf("Read-OnlyVerifiedRunnerOrThrow");
  const invokeAt = block.indexOf("Invoke-RuntimeNodeWithAuthority");
  assert.ok(resolveAt >= 0 && identityAt > resolveAt && invokeAt > identityAt);
  assert.match(block, /scripts\\installed-runtime-dispatch\.mts/);
  assert.match(block, /Capability "OWNER_DISPATCH"/);
  assert.doesNotMatch(block, /Invoke-Expression|Start-Process|cmd\.exe|--command=/i);

  const researchPolicy = readFileSync(join(ROOT, "lib", "control-plane", "scheduler", "research-policy.ts"), "utf8");
  assert.match(researchPolicy, /\.runtime\/ops\/runner-relaunch-proof\.json/);
  assert.doesNotMatch(researchPolicy, /(?<!\.runtime\/)data\/ops\/runner-relaunch-proof\.json/);
});
