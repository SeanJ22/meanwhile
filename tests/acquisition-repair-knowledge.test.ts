import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { buildScoutToolkit } from "../lib/control-plane/scheduler/scout-tools.ts";
import { RESEARCH_BOUNDS } from "../lib/control-plane/scheduler/research-policy.ts";
import { isScheduled, scheduleObligation } from "../lib/control-plane/scheduler/obligation.ts";
import type { ScoutToolContext } from "../lib/control-plane/scheduler/scout-contract.ts";
import type { FieldManualEntry } from "../lib/control-plane/field-manual.ts";

const hash = (text: string) => `sha256-${createHash("sha256").update(text).digest("hex")}`;
const manual: FieldManualEntry = { id: "fm:az-method", role: "SHARED", kind: "PLAYBOOK", title: "AZ source methods",
  summary: "A summary that omits the useful later passage", states: ["az"], recordClasses: ["OFFICIAL_ROSTER"],
  platforms: [], outcome: "REFERENCE", url: null, source: "docs/az-method.md", observedAt: null, tier: null,
  payload: { path: "docs/az-method.md", bytes: 7000, excerpt: "First 400 chars only" } };
const full = `${"intro ".repeat(900)}OFFICIAL PROFILE HREF IS THE REPLAYABLE ROSTER ROUTE`;
const held = "<table><tr><td>Official office contact</td></tr></table>";
const obligation = scheduleObligation({ id: "freshness:test:az", recordClass: "OFFICIAL_ROSTER", subjectId: "az:city:sierra-vista",
  routeId: null, active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }, Date.parse("2026-09-28T08:00:00Z"));
if (!isScheduled(obligation)) throw new Error("TEST_OBLIGATION_NOT_SCHEDULED");

test("a later worker opens full handed method and saved sanitized bytes with measured receipts", async () => {
  let network = 0; let docReads = 0; let vaultReads = 0;
  const ctx: ScoutToolContext = { obligation, route: null, providerId: null, attemptId: "at:test", workItemId: "wi:test",
    routeTaskId: "rt:test", holder: "test", vault: async () => { throw new Error("no writes"); },
    spaceOut: async () => {}, bound: RESEARCH_BOUNDS.perDispatch, now: () => "2026-09-28T08:00:00Z",
    inherited: { artifactIds: ["ar:prior"], summary: manual.summary, manualEntries: [manual] },
    openOne: async () => { network++; throw new Error("network must not run"); },
    readManualDocument: async path => { assert.equal(path, "docs/az-method.md"); docReads++; return full; },
    readHeldArtifact: async id => { assert.equal(id, "ar:prior"); vaultReads++; return { artifactId: id,
      contentHash: hash(held), text: held, acquiredByAttemptId: "at:prior", canonicalUrl: "https://example.gov/roster",
      retrievedAt: "2026-09-27T00:00:00Z", sourceId: "example.gov", methodRouteId: "scout:fetch_public" }; },
  };
  const toolkit = buildScoutToolkit(ctx);
  const input = { rung: "other:knowledge-replay", why: "recover held source method before another network call" };
  const catalog = await toolkit.call("find_manual", { ...input, query: "AZ source methods" }, null);
  assert.equal(catalog.ok, true);
  assert.match(catalog.forModel, /fm:az-method/);
  const method = await toolkit.call("read_manual", { ...input, entryId: manual.id, offset: 5200 }, null);
  assert.equal(method.ok, true);
  assert.match(method.forModel, /OFFICIAL PROFILE HREF/);
  assert.equal(method.knowledgeRead?.kind, "MANUAL_ENTRY");
  assert.equal(method.knowledgeRead?.contentHash, hash(full));
  const artifact = await toolkit.call("read_held", { ...input, artifactId: "ar:prior", offset: 0 }, null);
  assert.equal(artifact.ok, true);
  assert.match(artifact.forModel, /Official office contact/);
  assert.equal(artifact.knowledgeRead?.kind, "HELD_ARTIFACT");
  assert.equal(artifact.knowledgeRead?.contentHash, hash(held));
  assert.equal((await toolkit.call("read_manual", { ...input, entryId: "fm:unhanded", offset: 0 }, null)).ok, false);
  assert.equal((await toolkit.call("read_held", { ...input, artifactId: "ar:unhanded", offset: 0 }, null)).ok, false);
  assert.deepEqual([network, docReads, vaultReads], [0, 1, 1]);
});

test("a later Scout locates a deep ordinary table in handed bytes without blind page reads or network", async () => {
  const deep = `${"<div>navigation</div>".repeat(5_000)}<table><tr><th>Staff</th><th>Title</th><th>Phone</th></tr><tr><td>Mayor</td><td>Mayor</td><td>(520) 439-2140</td></tr></table>`;
  let reads = 0;
  const ctx: ScoutToolContext = { obligation, route: null, providerId: null, attemptId: "at:deep", workItemId: "wi:deep",
    routeTaskId: "rt:deep", holder: "test", vault: async () => { throw new Error("no writes"); },
    spaceOut: async () => {}, bound: RESEARCH_BOUNDS.perDispatch, now: () => "2026-09-28T08:00:00Z",
    inherited: { artifactIds: ["ar:deep"], summary: "held official HTML", manualEntries: [] },
    openOne: async () => { throw new Error("network must not run"); },
    readHeldArtifact: async () => { reads++; return { artifactId: "ar:deep", contentHash: hash(deep), text: deep,
      acquiredByAttemptId: "at:prior", canonicalUrl: "https://example.gov/roster", retrievedAt: "2026-09-27T00:00:00Z",
      sourceId: "example.gov", methodRouteId: "scout:fetch_public", provenance: { artifactId: "ar:deep",
        canonicalUrl: "https://example.gov/roster", retrievedAt: "2026-09-27T00:00:00Z", permission: "ALLOWED",
        methodRouteId: "scout:fetch_public", httpStatus: 200 } }; },
  };
  const found = await buildScoutToolkit(ctx).call("read_held", { artifactId: "ar:deep", query: "<th>Staff</th>",
    rung: "other:held-roster", why: "locate the official roster table in retained bytes" }, null);
  assert.equal(found.ok, true);
  assert.match(found.forModel, /HELD_LITERAL_MATCH/);
  assert.match(found.forModel, /<th>Staff<\/th>/);
  assert.match(found.forModel, /HELD_VAULT_ENVELOPE.*permission ALLOWED/);
  assert.ok(found.provenance);
  assert.equal(found.provenance[0]?.artifactId, "ar:deep");
  assert.ok((found.knowledgeRead?.offset ?? 0) > 80_000);
  assert.equal(reads, 1);
});
