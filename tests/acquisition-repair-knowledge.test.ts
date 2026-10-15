import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { buildScoutToolkit } from "../lib/control-plane/scheduler/scout-tools.ts";
import { RESEARCH_BOUNDS } from "../lib/control-plane/scheduler/research-policy.ts";
import { isScheduled, scheduleObligation } from "../lib/control-plane/scheduler/obligation.ts";
import type { ScoutToolContext } from "../lib/control-plane/scheduler/scout-contract.ts";

const hash = (text: string) => `sha256-${createHash("sha256").update(text).digest("hex")}`;
const held = "<table><tr><td>Official office contact</td></tr></table>";
const obligation = scheduleObligation({ id: "freshness:test:az", recordClass: "OFFICIAL_ROSTER", subjectId: "az:city:sierra-vista",
  routeId: null, active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }, Date.parse("2026-09-28T08:00:00Z"));
if (!isScheduled(obligation)) throw new Error("TEST_OBLIGATION_NOT_SCHEDULED");

test("a later worker opens handed saved bytes without network and refuses unhanded ids", async () => {
  let network = 0; let vaultReads = 0;
  const ctx: ScoutToolContext = { obligation, route: null, providerId: null, attemptId: "at:test", workItemId: "wi:test",
    routeTaskId: "rt:test", holder: "test", vault: async () => { throw new Error("no writes"); },
    spaceOut: async () => {}, bound: RESEARCH_BOUNDS.perDispatch, now: () => "2026-09-28T08:00:00Z",
    handed: { artifactIds: ["ar:prior"] },
    openOne: async () => { network++; throw new Error("network must not run"); },
    readHeldArtifact: async id => { assert.equal(id, "ar:prior"); vaultReads++; return { artifactId: id,
      contentHash: hash(held), text: held, acquiredByAttemptId: "at:prior", canonicalUrl: "https://example.gov/roster",
      retrievedAt: "2026-09-27T00:00:00Z", sourceId: "example.gov", methodRouteId: "scout:fetch_public" }; },
  };
  const toolkit = buildScoutToolkit(ctx);
  const artifact = await toolkit.call("read_held", { artifactId: "ar:prior", offset: 0 });
  assert.equal(artifact.ok, true);
  assert.match(artifact.forModel, /Official office contact/);
  assert.equal((await toolkit.call("read_held", { artifactId: "ar:unhanded", offset: 0 })).ok, false);
  const { readHeldArtifact: _heldReader, ...withoutHeldReader } = ctx;
  assert.equal((await buildScoutToolkit(withoutHeldReader).call("read_held", { artifactId: "ar:prior" })).ok, false);
  assert.deepEqual([network, vaultReads], [0, 1]);
});

test("a later hunter locates a deep ordinary table in handed bytes without blind page reads or network", async () => {
  const deep = `${"<div>navigation</div>".repeat(5_000)}<table><tr><th>Staff</th><th>Title</th><th>Phone</th></tr><tr><td>Mayor</td><td>Mayor</td><td>(520) 439-2140</td></tr></table>`;
  let reads = 0;
  const ctx: ScoutToolContext = { obligation, route: null, providerId: null, attemptId: "at:deep", workItemId: "wi:deep",
    routeTaskId: "rt:deep", holder: "test", vault: async () => { throw new Error("no writes"); },
    spaceOut: async () => {}, bound: RESEARCH_BOUNDS.perDispatch, now: () => "2026-09-28T08:00:00Z",
    handed: { artifactIds: ["ar:deep"] },
    openOne: async () => { throw new Error("network must not run"); },
    readHeldArtifact: async () => { reads++; return { artifactId: "ar:deep", contentHash: hash(deep), text: deep,
      acquiredByAttemptId: "at:prior", canonicalUrl: "https://example.gov/roster", retrievedAt: "2026-09-27T00:00:00Z",
      sourceId: "example.gov", methodRouteId: "scout:fetch_public", provenance: { artifactId: "ar:deep",
        canonicalUrl: "https://example.gov/roster", retrievedAt: "2026-09-27T00:00:00Z", permission: "ALLOWED",
        methodRouteId: "scout:fetch_public", httpStatus: 200 } }; },
  };
  const found = await buildScoutToolkit(ctx).call("read_held", { artifactId: "ar:deep", query: "<th>Staff</th>" });
  assert.equal(found.ok, true);
  assert.match(found.forModel, /"<th>Staff<\/th>" found at character (\d+)/);
  assert.ok(Number(/found at character (\d+)/.exec(found.forModel)?.[1]) > 80_000);
  assert.match(found.forModel, /<th>Staff<\/th><th>Title<\/th><th>Phone<\/th>/);
  assert.equal(reads, 1);
});
