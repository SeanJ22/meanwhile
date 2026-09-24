import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { publishReaderEdgeArtifacts } from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { readSnapshot } from "../lib/meetings/snapshot.ts";
import { enterReaderAuthorityEdge, currentRegistryRuntimeEdge } from "../lib/registry/runtime-edge.ts";
import { registryRuntimeFirstSeed, registryRuntimeReadState } from "../lib/registry/runtime-read-model.ts";
import { federalDirectoryFirstSeed, federalDirectoryReadState } from "../lib/officials/federal-directory-read-model.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

/**
 * **THE READER AUTHORITY EDGE IS ENTERED WHERE ITS READS RUN.** (2026-09-24,
 * C20/C22.)
 *
 * `enterReaderAuthorityEdge` is `AsyncLocalStorage.enterWith`. On Node 24 (the
 * runtime Netlify serves, NODE_VERSION 24) a store entered inside an async
 * helper never reaches promise reactions created from the caller: a first
 * version of C20 entered the edge inside such a helper, and every registry and
 * federal-directory read chained on it would have gone to the database again
 * ("none" where the old shape saw "EDGE"). Local runs never saw it, because
 * there was no edge. These tests publish a real local edge store
 * (`WTP_READER_EDGE_DIR`) and ask the real Ask and funding routes, so the reads
 * must come from it.
 */

delete process.env.ANTHROPIC_API_KEY;
for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL"]) delete process.env[key];
process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
await installRegistryRuntimeFirstSeeds();

const edgeDir = mkdtempSync(join(tmpdir(), "wtp-reader-edge-"));
const previousEdgeDir = process.env.WTP_READER_EDGE_DIR;
after(() => {
  if (previousEdgeDir === undefined) delete process.env.WTP_READER_EDGE_DIR;
  else process.env.WTP_READER_EDGE_DIR = previousEdgeDir;
  rmSync(edgeDir, { recursive: true, force: true });
});

async function publishEdge(registryVersion: string, federalVersion: string): Promise<void> {
  const snapshot = readSnapshot();
  assert.ok(snapshot, "the bundled meetings snapshot publishes the edge's meeting scopes");
  const result = await publishReaderEdgeArtifacts(snapshot, {
    sourceThrough: snapshot.generatedAt,
    retrievedAt: snapshot.generatedAt,
    promotedThrough: snapshot.generatedAt,
  }, {
    store: new LocalFileArtifactStore(edgeDir),
    now: new Date().toISOString(),
    authority: {
      "registry-runtime": { value: registryRuntimeFirstSeed().value, versionId: registryVersion },
      "federal-directory": { value: federalDirectoryFirstSeed().value, versionId: federalVersion },
    },
  });
  assert.equal(result.status, "PUBLISHED", JSON.stringify(result));
  process.env.WTP_READER_EDGE_DIR = edgeDir;
}

test("Node 24: an edge entered inside a helper never reaches the reads chained on it; entered by the caller, it does", async () => {
  const bundle = { registryRuntime: { value: registryRuntimeFirstSeed().value, versionId: "als-probe" } };
  const insideHelper = async () => {
    const entered = (async () => { await Promise.resolve(); enterReaderAuthorityEdge(bundle); })();
    return await entered.then(() => currentRegistryRuntimeEdge()?.versionId ?? "none");
  };
  const byCaller = async () => {
    await Promise.resolve();
    enterReaderAuthorityEdge(bundle);
    return await Promise.resolve().then(() => currentRegistryRuntimeEdge()?.versionId ?? "none");
  };
  assert.equal(await insideHelper(), "none", "if this now reads the edge, the runtime changed; the rule below still holds");
  assert.equal(await byCaller(), "als-probe");
});

test("Ask reads the registry and the federal directory from the edge it entered", async () => {
  await publishEdge("edge-test:registry:1", "edge-test:federal:1");
  const { POST, resetGroundedState } = await import("../app/api/ask/grounded/route.ts");
  resetGroundedState();
  const AZ = "ocd-division/country:us/state:az";
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://wtp.test", host: "wtp.test", "x-wtp-synthetic-run": "reader-edge-context-test" },
    body: JSON.stringify({ question: "is pima county voting on data centers", approximateLocation: "85701", surface: "MAP", ocdIds: [AZ, `${AZ}/county:pima`, `${AZ}/place:tucson`], today: "2026-09-24" }),
  }));
  assert.equal(response.status, 200);
  const payload = await response.json() as { trace: { preloads?: Record<string, number> } };
  assert.ok(Number.isFinite(payload.trace.preloads?.authorityEdge), "the edge was not fetched");
  assert.equal(registryRuntimeReadState().metadata?.versionId, "edge-test:registry:1", "the registry was read from the database, not the edge");
  assert.equal(federalDirectoryReadState().metadata?.versionId, "edge-test:federal:1", "the federal directory was read from the database, not the edge");
});

test("Campaign money reads the registry from the edge it entered, and names every read's time", async () => {
  await publishEdge("edge-test:registry:2", "edge-test:federal:2");
  const { GET } = await import("../app/api/funding/[target]/route.ts");
  const response = await GET(new Request("https://wtp.test/api/funding/congress%3AC001133"), {
    params: Promise.resolve({ target: "congress%3AC001133" }),
  });
  assert.ok([200, 503].includes(response.status));
  assert.equal(registryRuntimeReadState().metadata?.versionId, "edge-test:registry:2", "the registry was read from the database, not the edge");
  const timing = response.headers.get("server-timing") ?? "";
  for (const name of ["edgeManifest", "authorityEdge", "registry", "fec", "total"]) {
    assert.match(timing, new RegExp(`(?:^|, )${name};dur=\\d+`), `${name} is not timed: ${timing}`);
  }
});
