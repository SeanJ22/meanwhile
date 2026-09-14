import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import test from "node:test";

import {
  admittedRuntimeChildEnvironment,
  runtimeAuthorityEnvelope,
  runtimeAuthorityIssue,
  type RuntimeAuthorityEnvelope,
  type RuntimeCheckoutFacts,
} from "../lib/civic-data/runtime-authority.ts";

const ROOT = realpathSync(process.cwd());
const SHA = "a".repeat(40);
const PID = 4312;

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
