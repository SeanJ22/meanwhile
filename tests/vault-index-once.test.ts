import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { observeCyclePhases } from "../lib/control-plane/scheduler/cycle-phases.ts";
import { cycleVault } from "../lib/control-plane/scheduler/vault.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";

test("a noted step is timed in the phases without moving the phase clock", () => {
  let clock = 0;
  const observed = observeCyclePhases({} as never, () => clock);
  clock = 100;
  observed.note("vault-index", 40);
  clock = 250;
  const phase = observed.finish("dispatch");
  assert.deepEqual(observed.phases.map(p => [p.name, p.durationMs]), [["vault-index", 40], ["dispatch", 250]]);
  assert.equal(phase.durationMs, 250);
});

test("the round streams its held-key index only when needed and shares it across exact artifact reads", async context => {
  const source = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.equal(source.match(/\bcycleVault\(/g)?.length, 1);
  assert.doesNotMatch(source, /\bindexVault\(/);
  const root = await mkdtemp(join(tmpdir(), "rh01-vault-index-"));
  const original = DurableEvidenceStore.prototype.visitKeys;
  let listings = 0;
  context.mock.method(DurableEvidenceStore.prototype, "visitKeys", async function(this: DurableEvidenceStore, ...args: Parameters<typeof original>) {
    listings++;
    return original.apply(this, args);
  });
  const vault = cycleVault(root);
  try {
    const capture = (n: number) => recordAcquisition({ canonicalUrl: `https://example.gov/${n}`,
      retrievedAt: "2026-10-01T12:00:00.000Z", httpStatus: 200, contentType: "text/plain",
      sourceId: "example.gov", methodRouteId: "public-page", workItemId: `wi-${n}`, attemptId: `at-${n}`,
      permission: "ALLOWED", transport: "REACHABLE" }, `body ${n}`).artifact;
    const first = capture(1), second = capture(2);
    await vault.put(first, "body 1");
    await vault.put(second, "body 2");
    assert.equal(listings, 0, "writing a cycle never loads the country's vault index");
    assert.equal(await vault.readHeld({ ...first, artifactId: first.id }), "body 1");
    assert.equal(await vault.readHeld({ ...second, artifactId: second.id }), "body 2");
    assert.equal(await vault.readHeld({ ...first, artifactId: first.id, attemptId: "at-other" }), null,
      "a cached key cannot substitute another Attempt's capture");
    assert.equal(listings, 1);
    assert.equal(Array.isArray(vault.ledger), false);
  } finally { await vault.close(); await rm(root, { recursive: true, force: true }); }
});
