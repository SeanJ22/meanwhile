import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";

import { publishReaderEdgeArtifacts } from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { clearPromotedReadModelCache } from "../lib/civic-data/read-model.ts";
import { registryRuntimeFirstSeed, registryRuntimeReadState } from "../lib/registry/runtime-read-model.ts";
import { federalDirectoryFirstSeed, federalDirectoryReadState } from "../lib/officials/federal-directory-read-model.ts";
import { authorityVersionKey } from "../lib/registry/server.ts";

/**
 * **A COLD /ballot READS THE AUTHORITY FAMILIES FROM THE READER EDGE.** (R30,
 * 2026-09-25.)
 *
 * A cold /ballot server read about 50 MB from the database (measured on an
 * isolated copy, 2026-09-24), the registry runtime alone about 24 MB, while
 * the registry and the federal directory were already published on the reader
 * edge the map's routes read. The page never entered the edge. An earlier
 * attempt to route it there read MORE: its direct `refresh*FromPromoted`
 * preloads still read the database, and the edge's BOOTSTRAP next to the
 * database's PROMOTED of one version flipped the officeholder cache key.
 *
 * These tests render the real page with no database at all: DATABASE_URL names
 * an `.invalid` host (RFC 2606, it never resolves) and every Neon HTTP request
 * is answered here with no rows and counted by record class, so a family the
 * code reads from the database is seen even though nothing leaves the process.
 * The page's async components are then called from THIS test's context, as
 * React calls them from its render loop, never from inside the page function.
 */

for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL", "NETLIFY", "NETLIFY_BLOBS_CONTEXT", "NETLIFY_SITE_ID"]) delete process.env[key];

const REGISTRY_VERSION = "edge-test:ballot:registry";
const FEDERAL_VERSION = "edge-test:ballot:federal";

const edgeDir = mkdtempSync(join(tmpdir(), "wtp-ballot-edge-"));
after(() => rmSync(edgeDir, { recursive: true, force: true }));
{
  const published = await publishReaderEdgeArtifacts({
    formatVersion: 1,
    generatedAt: "2026-09-25T00:00:00.000Z",
    counts: { fresh: 0, carried: 0, total: 0, duplicatesCollapsed: 0 },
    sources: [],
    meetings: [],
    agendaDocuments: [],
  }, { sourceThrough: null, retrievedAt: null, promotedThrough: null }, {
    store: new LocalFileArtifactStore(edgeDir),
    authority: {
      "registry-runtime": { value: registryRuntimeFirstSeed().value, versionId: REGISTRY_VERSION },
      "federal-directory": { value: federalDirectoryFirstSeed().value, versionId: FEDERAL_VERSION },
      "state-legislators": {
        value: {
          "US-AZ": {
            formatVersion: 1,
            sourceId: "az-legislature",
            jurisdiction: "US-AZ",
            term: "2025-2026",
            generatedAt: "2026-09-25T00:00:00.000Z",
            roster: { formatVersion: 1, generatedAt: "2026-09-25", source: "edge-test", officeholders: [], divisions: [] },
          },
        },
        versionId: "edge-test:ballot:state-legislators",
      },
    },
  });
  assert.equal(published.status, "PUBLISHED", JSON.stringify(published));
}

// Every database request this process makes, by record class, answered with no rows.
type RenderPhase = "page" | "components";
let phase: RenderPhase = "page";
const databaseReads: { phase: RenderPhase; recordClass: string }[] = [];
process.env.DATABASE_URL = "postgresql://edge-test:edge-test@ep-ballot-edge-test.ballot-edge-test.invalid/none?sslmode=require";
const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("ballot-edge-test.invalid/")) throw new Error(`the ballot render fetched ${url}`);
  const body = JSON.parse(String(init?.body ?? "{}")) as { params?: unknown[]; queries?: { params?: unknown[] }[] };
  const queries = body.queries ?? [body];
  for (const query of queries) {
    const recordClass = (query.params ?? []).find((p): p is string => typeof p === "string" && /^[A-Z][A-Z_]+$/.test(p) && p !== "UNCHANGED_CONFIRMATION_V1");
    databaseReads.push({ phase, recordClass: recordClass ?? "UNKNOWN" });
  }
  const empty = { command: "SELECT", rowCount: 0, rows: [], fields: [] };
  return new Response(JSON.stringify(body.queries ? { results: queries.map(() => empty) } : empty), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

/** One cold render: the page, then every async component it returned, called from outside the page. */
async function renderBallot(zip: string): Promise<{ components: Map<string, number> }> {
  clearPromotedReadModelCache();
  databaseReads.length = 0;
  const { default: BallotPage } = await import("../app/ballot/page.tsx");
  phase = "page";
  const tree = await BallotPage({ searchParams: Promise.resolve({ zip }) });
  phase = "components";
  const components = new Map<string, number>();
  const walk = async (node: unknown): Promise<void> => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const child of node) await walk(child); return; }
    const element = node as { $$typeof?: symbol; type?: unknown; props?: Record<string, unknown> };
    if (element.$$typeof === undefined) return;
    if (typeof element.type === "function" && element.type.constructor.name === "AsyncFunction") {
      const name = element.type.name;
      components.set(name, (components.get(name) ?? 0) + 1);
      await walk(await (element.type as (props: unknown) => Promise<unknown>)(element.props ?? {}));
      return;
    }
    for (const value of Object.values(element.props ?? {})) await walk(value);
  };
  await walk(tree);
  return { components };
}

const EDGE_FAMILIES = ["REGISTRY_RUNTIME_BINDING", "FEDERAL_DIRECTORY", "STATE_LEGISLATOR"];

test("React renders the page's async components outside the page's context: they see its edge only when handed it", () => {
  // Next's own compiled React Flight server, with the react-server condition it runs under.
  const runtimeEdge = pathToFileURL(join(process.cwd(), "lib", "registry", "runtime-edge.ts")).href;
  const script = `
    import { createRequire } from "node:module";
    const load = createRequire(${JSON.stringify(pathToFileURL(join(process.cwd(), "package.json")).href)});
    const React = load("react");
    const { renderToPipeableStream } = load("next/dist/compiled/react-server-dom-webpack/server.node.js");
    const { enterReaderAuthorityEdge, withReaderAuthorityEdge, currentRegistryRuntimeEdge } = await import(${JSON.stringify(runtimeEdge)});
    const bundle = { registryRuntime: { value: {}, versionId: "flight-probe" } };
    const seen = () => currentRegistryRuntimeEdge()?.versionId ?? "none";
    async function Card({ readerEdge }) {
      await Promise.resolve();
      const plain = seen();
      const handed = await withReaderAuthorityEdge(readerEdge, async () => { await Promise.resolve(); return seen(); });
      return React.createElement("i", null, "card:" + plain + ":" + handed);
    }
    async function Page() {
      await Promise.resolve();
      enterReaderAuthorityEdge(bundle);
      await new Promise((resolve) => setTimeout(resolve, 1));
      return React.createElement("div", null, "page:" + seen() + ";", React.createElement(Card, { readerEdge: bundle }));
    }
    let out = "";
    const { Writable } = await import("node:stream");
    renderToPipeableStream(React.createElement(Page), {}).pipe(new Writable({
      write(chunk, _encoding, done) { out += chunk; done(); },
      final(done) { process.stdout.write(out); done(); },
    }));
  `;
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  const out = execFileSync(process.execPath, ["--conditions", "react-server", "--experimental-strip-types", "--input-type=module", "-e", script], { encoding: "utf8", env, cwd: process.cwd() });
  assert.match(out, /page:flight-probe;/, `the page's own reads see the edge it entered: ${out}`);
  assert.match(out, /card:none:flight-probe/, `a component sees the page's edge only through withReaderAuthorityEdge: ${out}`);
});

test("a cold /ballot?zip=85701 reads the registry, the federal directory and the state legislators from the edge, in the page and in every card", async () => {
  process.env.WTP_READER_EDGE_DIR = edgeDir;
  const { components } = await renderBallot("85701");
  assert.ok((components.get("BallotBattlecard") ?? 0) >= 10, `the render reached the cards: ${JSON.stringify([...components])}`);
  assert.ok((components.get("IncumbentName") ?? 0) >= 10, `the render reached the names: ${JSON.stringify([...components])}`);

  const edgeFamiliesFromDatabase = databaseReads.filter((read) => EDGE_FAMILIES.includes(read.recordClass));
  assert.deepEqual(edgeFamiliesFromDatabase, [], "a family the edge publishes was read from the database");
  assert.equal(registryRuntimeReadState().metadata?.versionId, REGISTRY_VERSION, "the registry was not served from the edge");
  assert.equal(federalDirectoryReadState().metadata?.versionId, FEDERAL_VERSION, "the federal directory was not served from the edge");

  // What still reads the database is exactly what the edge does not publish, once each, and none of it from a card.
  // CURATED_READER_RECORD is the verified campaign sites the standing runner publishes (candidate-campaign-sites-derived,
  // 2026-09-25), read beside the candidate profiles by the same preload.
  assert.deepEqual(
    databaseReads.map((read) => read.recordClass).sort(),
    ["BALLOT_CANDIDACY", "CANDIDATE_PROFILE", "CANDIDATE_PUBLICATION", "CURATED_READER_RECORD", "FEC_FUNDING", "STATE_CAMPAIGN_FINANCE"],
  );
  assert.deepEqual(databaseReads.filter((read) => read.phase === "components"), [], "a card read the database");
});

test("with no edge published, the same render reads those families from the database: the fallback stays", async () => {
  delete process.env.WTP_READER_EDGE_DIR;
  await renderBallot("85701");
  const classes = new Set(databaseReads.map((read) => read.recordClass));
  for (const family of ["REGISTRY_RUNTIME_BINDING", "FEDERAL_DIRECTORY"]) assert.ok(classes.has(family), `${family} was not read without an edge`);
  assert.match(registryRuntimeReadState().metadata?.versionId ?? "", /^bootstrap:/, "the database path served the registry");
});

test("one promoted version is one authority key, whether the edge primed it (BOOTSTRAP) or the database read it (PROMOTED)", () => {
  const read = (kind: string, versionId: string | null) => ({ kind, metadata: { versionId } });
  assert.equal(authorityVersionKey(read("BOOTSTRAP", "v1")), authorityVersionKey(read("PROMOTED", "v1")));
  assert.notEqual(authorityVersionKey(read("BOOTSTRAP", "v1")), authorityVersionKey(read("PROMOTED", "v2")), "a new version is a new key");
  assert.notEqual(authorityVersionKey(read("STORE_UNREACHABLE", "v1")), authorityVersionKey(read("PROMOTED", "v1")), "a failed read never shares a served key");
  // A first seed carries its own version id, so it never shares a promoted version's key.
  assert.notEqual(authorityVersionKey(read("BOOTSTRAP", registryRuntimeFirstSeed().versionId)), authorityVersionKey(read("PROMOTED", REGISTRY_VERSION)));
});
