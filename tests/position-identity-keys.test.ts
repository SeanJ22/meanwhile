import assert from "node:assert/strict";
import test from "node:test";

import { positionIdentityKeys, type PositionIdentityReaders } from "../lib/identity/position-identity-keys.ts";
import { ReaderPersonIdentityError } from "../lib/identity/reader-person.ts";

const ok = async () => undefined;
const readers = (over: Partial<PositionIdentityReaders> = {}): PositionIdentityReaders => ({
  refreshRegistry: ok, refreshFederal: ok, refreshBallot: ok,
  relatedAuthorities: () => ({ federal: false, ballot: false }),
  personKeys: (subject) => [subject],
  ...over,
});

test("a registry that cannot be read resolves to the subject's own key", async () => {
  const keys = await positionIdentityKeys("official-1", readers({ refreshRegistry: async () => { throw new Error("STORE_UNREACHABLE"); } }));
  assert.deepEqual(keys, ["official-1"]);
});

test("the federal and selected state ballot projections refresh before identity resolves, only when the chain needs them", async () => {
  const calls: string[] = [];
  const base = { refreshFederal: async () => { calls.push("federal"); }, refreshBallot: async () => { calls.push("ballot"); } };
  await positionIdentityKeys("congress:A1", readers(base));
  await positionIdentityKeys("local-1", readers(base));
  await positionIdentityKeys("local-2", readers({ ...base, relatedAuthorities: () => ({ federal: false, ballot: true }) }));
  assert.deepEqual(calls, ["federal", "ballot"]);
});

test("a needed projection that failed to load never turns into a refusal", async () => {
  const keys = await positionIdentityKeys("congress:A1", readers({
    refreshFederal: async () => { throw new Error("STORE_UNREACHABLE"); },
    personKeys: () => { throw new ReaderPersonIdentityError(); },
  }));
  assert.deepEqual(keys, ["congress:A1"]);
});

test("a real identity conflict, with every projection in hand, is still refused", async () => {
  await assert.rejects(positionIdentityKeys("congress:A1", readers({ personKeys: () => { throw new ReaderPersonIdentityError(); } })), ReaderPersonIdentityError);
});

test("a store error while resolving keys falls back to the subject's own key", async () => {
  const keys = await positionIdentityKeys("local-1", readers({ personKeys: () => { throw new Error("STORE_UNREACHABLE"); } }));
  assert.deepEqual(keys, ["local-1"]);
});
