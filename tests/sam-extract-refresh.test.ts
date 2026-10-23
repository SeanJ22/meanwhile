import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FederalMoneySection } from "../components/funding/federal-money-section.tsx";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { routineTaskDue, routineTaskFromContract } from "../lib/civic-data/runner.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { publishFederalMoneyPartition, publishFederalMoneyProgress } from "../lib/federal-money/edge-publication.ts";
import type { FederalMoneyStateProgress } from "../lib/federal-money/candidate.ts";
import type { FederalMoneyPartitionChange } from "../lib/federal-money/partitions.ts";
import { readFederalMoneyForPlace } from "../lib/federal-money/reader.ts";
import { refreshFederalMoney } from "../lib/federal-money/refresh.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";

test("SAM extract notices publish to cards on both daily admissions without duplicate records", async t => {
  const root = await mkdtemp(join(tmpdir(), "sam-extract-refresh-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new MemoryRoutineDataStore(), evidenceStore = new MemoryEvidenceStore(), artifactStore = new LocalFileArtifactStore(join(root, "reader"));
  const template = JSON.parse(await readFile(new URL("./fixtures/federal-money/sam-official-example.json", import.meta.url), "utf8"));
  template.coreData.physicalAddress.stateOrProvinceCode = "CA";
  const divisionId = "ocd-division/country:us/state:ca", bodyId = `${divisionId}#synthetic-recipient`;
  let clock = "2026-10-23T01:00:00.000Z", downloads = 0;
  t.mock.method(Date, "now", () => Date.parse(clock));
  const filters: (string | null)[] = [], pending = new Map<string, boolean>();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/entities")) {
      filters.push(url.searchParams.get("updateDate"));
      const token = `synthetic-${filters.length}`;
      pending.set(token, url.searchParams.get("samRegistered") === "Yes");
      assert.equal(init?.method ?? "GET", "GET");
      return new Response(`Extract File will be available for download with POST url: https://api.sam.gov/entity-information/v3/download-entities?token=${token}&api_key=REPLACE_WITH_API_KEY in some time.`);
    }
    assert.equal(init?.method, "POST");
    downloads++;
    const entityData = pending.get(url.searchParams.get("token")!) ? [template] : [];
    return new Response(gzipSync(JSON.stringify({ totalRecords: entityData.length, entityData })));
  };
  const input = { source: "sam-gov-entities" as const, store, states: ["CA"], now: () => clock,
    acquireOptions: { evidenceStore, cacheRoot: join(root, "cache"), samGovApiKey: "synthetic-test-key", fetch },
    identities: async () => ({ divisions: [{ ocdId: divisionId, geoid: "06", divisionType: "state" }], bodies: [],
      governments: [{ id: bodyId, nativeIds: { uei: template.entityRegistration.ueiSAM }, bodyIds: [],
        associations: [{ divisionId, layer: "state", geoid: "06", basis: "SOURCE_CODE" as const }] }] }),
    onPartition: (change: FederalMoneyPartitionChange) => publishFederalMoneyPartition({ ...change, store: artifactStore }),
    onProgress: (row: FederalMoneyStateProgress, checkedAt: string) => publishFederalMoneyProgress({ store: artifactStore, source: "sam-gov-entities", state: row.state, checkedAt, complete: row.status === "COMPLETE", reason: row.reason }) };
  const first = await refreshFederalMoney(input);
  assert.ok(first.outcome.promoted, first.outcome.candidate.failureDetail ?? "");
  assert.equal(first.projection.counts.loaded, 1);
  const task = routineTaskFromContract(requiredRoutineContract("sam-gov-entities"));
  const firstClock = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
  assert.equal(routineTaskDue(task, firstClock, Date.parse(clock) + task.cadenceMs - 1), false);
  clock = "2026-10-24T01:00:00.000Z";
  assert.equal(routineTaskDue(task, firstClock, Date.parse(clock)), true);
  const second = await refreshFederalMoney(input);
  assert.ok(second.outcome.promoted, second.outcome.candidate.failureDetail ?? "");
  assert.equal(second.projection.counts.loaded, 1);
  assert.equal(downloads, 4, "each admission downloads both registered and unregistered changes");
  assert.deepEqual(filters, [null, null, "[10/23/2026,10/24/2026]", "[10/23/2026,10/24/2026]"]);
  const data = await readFederalMoneyForPlace({ divisionId, bodyId }, { artifactStore });
  const held = data.sources.find(row => row.source === "sam-gov-entities")!;
  assert.equal(held.status, "HELD"); assert.equal(held.records.length, 1);
  const html = renderToStaticMarkup(createElement(FederalMoneySection, { divisionId, bodyId, data }));
  assert.match(html, /Federal registration/); assert.match(html, /9TH CIRCUIT COURT OF APPEALS/);
});
