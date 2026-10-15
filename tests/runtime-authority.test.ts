import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  admittedRuntimeChildEnvironment,
  withRoutineContract,
  assertRuntimeAuthority,
  GIT_READ_ATTEMPTS,
  inspectRuntimeCheckout,
  runtimeAuthorityEnvelope,
  runtimeAuthorityIssue,
  type GitRun,
  type RuntimeAuthorityEnvelope,
  type RuntimeCheckoutFacts,
  type RuntimeCheckoutReads,
} from "../lib/civic-data/runtime-authority.ts";

const ROOT = realpathSync(process.cwd());
const SHA = "a".repeat(40);
const PID = 4312;

test("staging ordinary child carries readable exact mutation authority and keeps its contract", async () => {
  const { assertRoutineDataStoreMutationAuthority, routineDataStoreCandidateAuthorityIssue } = await import("../lib/civic-data/store.ts");
  const parentEnv: NodeJS.ProcessEnv = { NODE_ENV: "development", WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local",
    DATABASE_URL: "postgresql://local:local@staging.invalid/reader",
    WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://local:local@staging.invalid/control",
    WTP_SANCTIONED_WRITE: "routine-civic-data-promotion" };
  for (const [capability, contract, sourceId, recordClass, scope] of [
    ["MANUAL_CONTRACT", "voting-sites", "voting-sites", "VOTING_SITE", "US-AZ+US-NH+US-NJ:2026-general:supported-jurisdictions"],
    ["ROUTINE_CONTRACT", "fec-funding", "fec-open-api", "FEC_FUNDING", "federal-supported"],
  ] as const) {
    const child = admittedRuntimeChildEnvironment({ parentEnv, capability, contract });
    const authority = assertRoutineDataStoreMutationAuthority(child);
    assert.equal(authority.capability, capability);
    assert.equal(authority.contract, contract);
    assert.equal(routineDataStoreCandidateAuthorityIssue({ id: "staging-child", sourceId, recordClass, scope }, authority, "candidate"), null);
    assert.throws(() => assertRuntimeAuthority({ capabilities: [capability], contract: "wrong-contract" }, child), /does not match/);
  }
  assert.throws(() => admittedRuntimeChildEnvironment({ parentEnv: { ...parentEnv, WTP_DB_ROLE: "production" }, capability: "ROUTINE_SUPERVISOR" }), /local/);
  assert.throws(() => admittedRuntimeChildEnvironment({ parentEnv: { ...parentEnv, WTP_CONTROL_PLANE_DATABASE_URL: "" }, capability: "ROUTINE_SUPERVISOR" }), /staging database/);
});

const envelope = (overrides: Partial<RuntimeAuthorityEnvelope> = {}): RuntimeAuthorityEnvelope => ({
  repo: ROOT,
  sha: SHA,
  capability: "ROUTINE_CONTRACT",
  contract: "fec-funding",
  parentPid: PID,
  nonce: "b".repeat(64),
  ...overrides,
});

const checkout = (overrides: Partial<RuntimeCheckoutFacts> = {}): RuntimeCheckoutFacts => ({
  repositoryRoot: ROOT,
  headSha: SHA,
  clean: true,
  detached: true,
  headOnOriginMain: true,
  readable: true,
  ...overrides,
});

function issue(
  admitted: RuntimeAuthorityEnvelope | null,
  facts: RuntimeCheckoutFacts = checkout(),
  contract: string | null = "fec-funding",
): string | null {
  return runtimeAuthorityIssue({
    envelope: admitted,
    expectation: { capabilities: ["ROUTINE_CONTRACT"], contract, immediateParentPid: PID },
    checkout: facts,
    cwd: ROOT,
  });
}

test("exact clean detached origin/main child with immediate-parent and contract admission passes", () => {
  assert.equal(issue(envelope()), null);
});

test("branch, dirty tree, wrong SHA, wrong parent and wrong contract each fail closed", () => {
  assert.match(issue(envelope(), checkout({ detached: false })) ?? "", /attached/);
  assert.match(issue(envelope(), checkout({ clean: false })) ?? "", /not clean/);
  assert.match(issue(envelope(), checkout({ headSha: "c".repeat(40) })) ?? "", /not admitted SHA/);
  assert.match(issue(envelope({ parentPid: PID + 1 })) ?? "", /not immediate parent/);
  assert.match(issue(envelope({ contract: "nh-members" })) ?? "", /not fec-funding/);
  assert.match(issue(envelope({ capability: "MANUAL_CONTRACT" })) ?? "", /not one of/);
  assert.match(issue(null) ?? "", /absent or malformed/);
});

test("child delegation rotates nonce and narrows capability/contract to one parent PID", () => {
  const parentEnv = {
    NODE_ENV: "test" as const,
    WTP_RUNTIME_AUTHORITY_REPO: ROOT,
    WTP_RUNTIME_AUTHORITY_SHA: SHA,
    WTP_RUNTIME_AUTHORITY_CAPABILITY: "ROUTINE_SUPERVISOR",
    WTP_RUNTIME_AUTHORITY_PARENT_PID: "7",
    WTP_RUNTIME_AUTHORITY_NONCE: "d".repeat(64),
  };
  const child = admittedRuntimeChildEnvironment({
    parentEnv,
    capability: "ROUTINE_CONTRACT",
    contract: "fec-funding",
    parentPid: PID,
    nonce: "e".repeat(64),
  });
  const parsed = runtimeAuthorityEnvelope(child);
  assert.equal(parsed?.capability, "ROUTINE_CONTRACT");
  assert.equal(parsed?.contract, "fec-funding");
  assert.equal(parsed?.parentPid, PID);
  assert.equal(parsed?.nonce, "e".repeat(64));
  assert.notEqual(parsed?.nonce, parentEnv.WTP_RUNTIME_AUTHORITY_NONCE);
});

test("temporary importer capability cannot satisfy an ordinary source-child expectation", () => {
  assert.match(issue({ ...envelope(), capability: "TRUSTED_LKG_IMPORT", contract: null } as unknown as RuntimeAuthorityEnvelope) ?? "", /not one of/);
});

test("retired importer capability is refused at the raw environment parser", () => {
  const retired = {
    WTP_RUNTIME_AUTHORITY_REPO: ROOT,
    WTP_RUNTIME_AUTHORITY_SHA: SHA,
    WTP_RUNTIME_AUTHORITY_CAPABILITY: "TRUSTED_LKG_IMPORT",
    WTP_RUNTIME_AUTHORITY_PARENT_PID: String(PID),
    WTP_RUNTIME_AUTHORITY_NONCE: "f".repeat(64),
  };
  assert.equal(runtimeAuthorityEnvelope(retired), null);
  assert.match(issue(runtimeAuthorityEnvelope(retired)) ?? "", /absent or malformed/);
});

const CONFIG_RACE = Object.assign(new Error("Command failed: git status --porcelain=v1 --untracked-files=all"), {
  status: 128,
  stderr: "warning: unable to access 'C:/Users/seanj/dev/we-the-people/.git/config': Permission denied\n" +
    "fatal: unknown error occurred while reading the configuration files\n",
});
const answered = (value: string): GitRun => () => value;
const exited = (status: number): GitRun => () => { throw Object.assign(new Error(`exit ${status}`), { status, stderr: "" }); };
const counted = (runs: readonly GitRun[]) => {
  let calls = 0;
  const run: GitRun = () => runs[Math.min(calls++, runs.length - 1)]!();
  return { run, calls: () => calls };
};
function reads(overrides: Partial<RuntimeCheckoutReads> = {}): RuntimeCheckoutReads {
  return {
    repositoryRoot: answered(ROOT),
    head: answered(SHA),
    status: answered(""),
    branch: exited(1),
    isAncestorOfOriginMain: () => answered(""),
    ...overrides,
  };
}
const noPause = () => undefined;

test("a read that fails to answer during a shared-config rewrite is read again and admits on the answer", () => {
  const status = counted([() => { throw CONFIG_RACE; }, answered("")]);
  const facts = inspectRuntimeCheckout(ROOT, { reads: reads({ status: status.run }), pause: noPause });
  assert.equal(status.calls(), 2);
  assert.equal(facts.readable, true);
  assert.equal(facts.clean, true);
  assert.equal(issue(envelope(), facts), null);
  assert.equal(facts.recoveredReads?.length, 1, "the first failure is kept, not swallowed");
  assert.match(facts.recoveredReads![0]!, /git status exited 128 \(.*unknown error occurred while reading the configuration files\) on attempt 1/);
});

test("a read that never answers refuses and names the read, its exit and Git's words", () => {
  const status = counted([() => { throw CONFIG_RACE; }]);
  const facts = inspectRuntimeCheckout(ROOT, { reads: reads({ status: status.run }), pause: noPause });
  assert.equal(status.calls(), GIT_READ_ATTEMPTS);
  assert.equal(facts.readable, false);
  const refused = issue(envelope(), facts) ?? "";
  assert.match(refused, /^runtime checkout facts are unreadable: git status exited 128 \(/);
  assert.match(refused, new RegExp(`on ${GIT_READ_ATTEMPTS} of ${GIT_READ_ATTEMPTS} attempts`));
  // A spawn that never ran and a stopped read are failures to answer too.
  const spawn = inspectRuntimeCheckout(ROOT, { pause: noPause, reads: reads({
    head: () => { throw Object.assign(new Error("spawnSync git EAGAIN"), { code: "EAGAIN" }); } }) });
  assert.match(issue(envelope(), spawn) ?? "", /git rev-parse HEAD did not run \(EAGAIN\)/);
  const stopped = inspectRuntimeCheckout(ROOT, { pause: noPause, reads: reads({
    head: () => { throw Object.assign(new Error("spawnSync git ETIMEDOUT"), { status: null, signal: "SIGTERM" }); } }) });
  assert.match(issue(envelope(), stopped) ?? "", /git rev-parse HEAD was stopped by SIGTERM/);
});

test("an answer is a fact and is never read again: dirty, attached and off origin/main still refuse at once", () => {
  const dirty = counted([answered(" M lib/x.ts")]);
  const dirtyFacts = inspectRuntimeCheckout(ROOT, { reads: reads({ status: dirty.run }), pause: noPause });
  assert.equal(dirty.calls(), 1);
  assert.match(issue(envelope(), dirtyFacts) ?? "", /not clean/);

  const attached = counted([answered("main")]);
  assert.match(issue(envelope(), inspectRuntimeCheckout(ROOT, { reads: reads({ branch: attached.run }), pause: noPause })) ?? "", /attached/);
  assert.equal(attached.calls(), 1);

  const detached = counted([exited(1)]);
  assert.equal(inspectRuntimeCheckout(ROOT, { reads: reads({ branch: detached.run }), pause: noPause }).detached, true);
  assert.equal(detached.calls(), 1, "symbolic-ref's exit 1 is the detached answer");

  const offMain = counted([exited(1)]);
  const offFacts = inspectRuntimeCheckout(ROOT, { reads: reads({ isAncestorOfOriginMain: () => offMain.run }), pause: noPause });
  assert.equal(offMain.calls(), 1, "merge-base's exit 1 is the not-an-ancestor answer");
  assert.equal(offFacts.readable, true);
  assert.match(issue(envelope(), offFacts) ?? "", /not proven on origin\/main/);

  const brokenAncestry = inspectRuntimeCheckout(ROOT, { reads: reads({ isAncestorOfOriginMain: () => exited(128) }), pause: noPause });
  assert.match(issue(envelope(), brokenAncestry) ?? "", /unreadable: git merge-base --is-ancestor HEAD origin\/main exited 128/,
    "an ancestry read that failed is unreadable, not a claim about origin/main");
});

test("the real Git reads of a clean detached worktree answer on the first attempt", (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "runtime-authority-git-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const main = join(base, "main");
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  execFileSync("git", ["init", "-q", main]);
  writeFileSync(join(main, "a.txt"), "a\n");
  git(main, "add", "a.txt");
  git(main, "-c", "user.email=test@example.invalid", "-c", "user.name=test", "commit", "-qm", "c");
  git(main, "update-ref", "refs/remotes/origin/main", "HEAD");
  const runtime = join(base, "runtime");
  git(main, "worktree", "add", "-q", "--detach", runtime, "HEAD");
  const facts = inspectRuntimeCheckout(runtime);
  assert.deepEqual(
    { readable: facts.readable, clean: facts.clean, detached: facts.detached, onMain: facts.headOnOriginMain, head: facts.headSha },
    { readable: true, clean: true, detached: true, onMain: true, head: git(main, "rev-parse", "HEAD") },
  );
  assert.deepEqual(facts.recoveredReads, []);
  assert.equal(facts.unreadable, null);
  writeFileSync(join(runtime, "stray.txt"), "x\n");
  assert.equal(inspectRuntimeCheckout(runtime).clean, false, "an untracked file is still a dirty runtime");
});

test("the capture conversion child writes held people, vote and directory versions under its own admission, and nothing else", async () => {
  const { assertRoutineDataStoreMutationAuthority, routineDataStoreCandidateAuthorityIssue } = await import("../lib/civic-data/store.ts");
  const parentEnv: NodeJS.ProcessEnv = { NODE_ENV: "development", WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local",
    DATABASE_URL: "postgresql://local:local@staging.invalid/reader",
    WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://local:local@staging.invalid/control",
    WTP_SANCTIONED_WRITE: "routine-civic-data-promotion" };
  const authority = assertRoutineDataStoreMutationAuthority(admittedRuntimeChildEnvironment({ parentEnv, capability: "CAPTURE_CONVERSION" }));
  assert.equal(authority.capability, "CAPTURE_CONVERSION");
  for (const [sourceId, recordClass, scope] of [
    ["official-state-people", "STATE_LEGISLATOR", "US-NJ:people:official-state-people:v1"],
    ["plural-openstates", "STATE_LEGISLATOR", "US-NJ:openstates-people:v1"],
    ["plural-openstates-votes", "STATE_ROLL_CALL", "US-NJ:openstates-votes:v1"],
    ["congress-directory-project", "FEDERAL_DIRECTORY", "US:current-congress-directory"],
  ] as const) assert.equal(routineDataStoreCandidateAuthorityIssue({ id: "conversion", sourceId, recordClass, scope }, authority, "candidate"), null, sourceId);
  assert.match(routineDataStoreCandidateAuthorityIssue({ id: "conversion", sourceId: "fec-open-api", recordClass: "FEC_FUNDING", scope: "federal-supported" }, authority, "candidate") ?? "",
    /capture conversion cannot mutate fec-funding/);
  const conversion = (contract: string | null) => runtimeAuthorityIssue({ envelope: { ...envelope(), capability: "CAPTURE_CONVERSION", contract },
    expectation: { capabilities: ["CAPTURE_CONVERSION"], immediateParentPid: PID }, checkout: checkout(), cwd: ROOT });
  assert.equal(conversion(null), null);
  assert.match(conversion("fec-funding") ?? "", /may not carry a source contract/);
  assert.match(issue({ ...envelope(), capability: "CAPTURE_CONVERSION", contract: null }) ?? "", /not one of/, "it never satisfies a source child's expectation");
});


test("in-process body writes use their scoped contract while the supervisor keeps its authority", async () => {
  const { assertRoutineDataStoreMutationAuthority, routineDataStoreCandidateAuthorityIssue } = await import("../lib/civic-data/store.ts");
  const scoped = admittedRuntimeChildEnvironment({ capability: "ROUTINE_SUPERVISOR", parentEnv: {
    NODE_ENV: "development", WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local",
    DATABASE_URL: "postgresql://local:local@staging.invalid/reader",
    WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://local:local@staging.invalid/control",
    WTP_SANCTIONED_WRITE: "routine-civic-data-promotion",
  } });
  const saved = new Map(Object.keys(scoped).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(scoped)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await withRoutineContract("fec-funding", async () => {
      await Promise.resolve();
      const authority = assertRoutineDataStoreMutationAuthority();
      assert.equal(authority.contract, "fec-funding");
      assert.equal(routineDataStoreCandidateAuthorityIssue({ id: "scoped-body", sourceId: "fec-open-api", recordClass: "FEC_FUNDING", scope: "federal-supported" }, authority, "candidate"), null);
    });
    assert.equal(assertRoutineDataStoreMutationAuthority().capability, "ROUTINE_SUPERVISOR");
  } finally { for (const [key, value] of saved) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
