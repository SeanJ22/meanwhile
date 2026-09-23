import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { READER_SURFACES, datasetFamily, validateDatasetMapping } from "../lib/holdings/datasets.ts";
import { MODULE_DATASETS, moduleDatasetInputPaths, readModuleDataset } from "../lib/holdings/module-datasets.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import { CONTROL_PATH, INPUT_PATH, PLAN_PATH, TRACKED_FIRST_SEED_AUTHORITY_BOUNDARY, VAULT_PATH, canonicalDatasetPaths, checkManifests, expectedManifests, loadManifestContext, statesFromIdentity, writeManifests } from "../lib/holdings/manifest.ts";
import { sourceClosure } from "../lib/ops/generator-digest.ts";
import { classify, scanText } from "../scripts/doc-dates.mjs";

const SCRIPT = resolve("scripts/state-manifest.mts");
const BASE = "3f9a138fd39f6160659329e17c496d2dd99cee00";
const LAW_TITLES_PATH = "data/votes/law-titles-cache.json";
const LAW_TITLES_SHA256 = "eb0b9ce579c2d157dca57bde6cd7e55507c63be6e29b46d3514e669656940ce5";
const LAW_TITLES_CUTOVER = {
  formerPath: LAW_TITLES_PATH,
  frozenSha256: LAW_TITLES_SHA256,
  disposition: "RETIRED_TO_PRODUCTION_DATA_PLANE",
  formerContentDisposition: "NON_SERVING_ACQUISITION_SURPLUS",
  contractId: "federal-key-votes",
  recordClass: "FEDERAL_KEY_VOTE",
  scope: "US:reviewed-key-vote-selection:v1",
  servingSeedPaths: ["data/votes/key-votes-snapshot.json", "data/votes/key-vote-positions.json"],
  readerImplementation: "lib/votes/key-votes-projection.ts#readFederalKeyVotesProjection",
  reason: "The frozen tracked cache is historical evidence; official law and vote facts now advance through the exact production promotion contract.",
} as const;
function fixtureConsumers(root: string, datasetPath: string): void {
  const family = datasetFamily(datasetPath);
  assert.ok(family, `Fixture must name a registered dataset: ${datasetPath}`);
  for (const path of family.consumerPaths) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), "// fixture consumer; manifest tests validate paths without executing readers\n");
  }
}
function fixture(t: { after: (fn: () => void) => void }): string {
  const root = mkdtempSync(join(tmpdir(), "wtp-state-manifest-"));
  t.after(() => { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); rmSync(root, { recursive: true, force: true }); });
  const write = (path: string, value: unknown) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value)); };
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  for (const surface of READER_SURFACES) write(surface.path, "// fixture surface\n");
  write("lib/ballot/registry.ts", "// fixture consumer\n");
  write(PLAN_PATH, { schemaVersion: 1, baseSha: BASE, rows: [], exemptions: [], excluded: [] });
  const source = { store: "fixture", identity: "recorded fixture only", schemaVersion: 1, instrument: "fixture readback" };
  write(CONTROL_PATH, { formatVersion: 1, observed_at: "2026-09-01T00:00:00.000Z", source, obligations: [], occurrences: [], workItems: [], routeTasks: [], dispositions: [], artifacts: [] });
  write(VAULT_PATH, { formatVersion: 1, observed_at: "2026-08-31T00:00:00.000Z", source, objects: [] });
  write(INPUT_PATH, { formatVersion: 1, baseSha: BASE, generatedBy: "fixture", discoveredStates: ["az"], files: [], rule: "frozen fixture" });
  write("data/states/az/ballot/example.json", { election: { state: "AZ" }, contests: [{ id: "az:contest", ocdId: "ocd-division/country:us/state:az" }], candidacies: [{ id: "az:person", contestId: "az:contest" }] });
  return root;
}

function fileBytes(root: string, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, fileBytes(root, path)); else result[path] = readFileSync(join(root, path)).toString("base64");
  }
  return result;
}

function installLawTitlesCutover(root: string, overrides: Record<string, unknown> = {}): void {
  const input = JSON.parse(readFileSync(join(root, INPUT_PATH), "utf8"));
  input.files.push({ path: LAW_TITLES_PATH, basePath: LAW_TITLES_PATH, sha256: LAW_TITLES_SHA256, source: "SESSION_BASE" });
  input.authorityCutovers = [{ ...LAW_TITLES_CUTOVER, ...overrides }];
  writeFileSync(join(root, INPUT_PATH), JSON.stringify(input));
  const plan = JSON.parse(readFileSync(join(root, PLAN_PATH), "utf8"));
  plan.exemptions.push({ oldPath: LAW_TITLES_PATH, newPath: LAW_TITLES_PATH, disposition: "EXEMPT", sha256: LAW_TITLES_SHA256, referenceCount: 1, references: [{ path: "docs/repo-inventory.md", count: 1 }] });
  writeFileSync(join(root, PLAN_PATH), JSON.stringify(plan));
  for (const path of LAW_TITLES_CUTOVER.servingSeedPaths) {
    fixtureConsumers(root, path);
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), "{}\n");
  }
  const readerPath = join(root, "lib/votes/key-votes-projection.ts");
  mkdirSync(dirname(readerPath), { recursive: true });
  writeFileSync(readerPath, "const seeds = ['key-votes-snapshot.json', 'key-vote-positions.json'];\nexport async function readFederalKeyVotesProjection() { return seeds; }\n");
}

test("source UTC observations and scheduling deadlines preserve their dates without excusing authorship stamps", (t) => {
  const root = fixture(t);
  const control = JSON.parse(readFileSync(join(root, CONTROL_PATH), "utf8"));
  control.observed_at = "2026-09-03T01:06:49.779Z";
  control.obligations = [{ id: "az:deadline", subjectId: "ocd-division/country:us/state:az", recordClass: "meetings", nextDueAt: "2026-09-10T04:00:00.000Z", active: true }];
  writeFileSync(join(root, CONTROL_PATH), JSON.stringify(control));
  const manifest = expectedManifests(loadManifestContext(root)).get("docs/states/az.md")!;
  assert.ok(manifest.includes(control.observed_at));
  assert.ok(manifest.includes(control.obligations[0].nextDueAt));
  const checked = classify(scanText(manifest + "\nAuthored 2099-01-01\n"), [], "docs/states/az.md", "2026-09-02");
  assert.deepEqual(checked.failures.map((hit: { date: string }) => hit.date), ["2099-01-01"]);
});

test("state attribution decodes US identity tags and excludes Canadian and status values", () => {
  assert.deepEqual(statesFromIdentity("ocd-division/country:us/state:nh/county:merrimack"), ["nh"]);
  assert.deepEqual(statesFromIdentity("ocd-division/country:us/territory:pr"), ["pr"]);
  assert.deepEqual(statesFromIdentity("ballot-nj-morris:governor"), ["nj"]);
  assert.deepEqual(statesFromIdentity("curated:az/pima-community-college#governing"), ["az"]);
  assert.deepEqual(statesFromIdentity("statewide-nh-governor.png"), ["nh"]);
  assert.deepEqual(statesFromIdentity("ON"), []);
  assert.deepEqual(statesFromIdentity("ADAPTED"), []);
});

test("dataset-to-surface contract refuses absent datasets and absent reader surfaces", () => {
  const path = "data/states/az/ballot/example.json";
  assert.deepEqual(validateDatasetMapping([path], () => true), []);
  assert.ok(validateDatasetMapping([path], (p) => p !== path).some((p) => p.includes("dataset does not exist")));
  assert.ok(validateDatasetMapping([path], (p) => p !== "app/ballot/page.tsx").some((p) => p.includes("reader surface ballot does not exist")));
  assert.ok(validateDatasetMapping(["data/states/az/unregistered/new.json"], () => true).some((p) => p.includes("no declared reader-surface mapping")));
});

test("an exact authority cutover preserves the frozen law-title evidence but removes the dead Git path from current holdings", (t) => {
  const root = fixture(t);
  installLawTitlesCutover(root);
  const context = loadManifestContext(root);
  assert.equal(canonicalDatasetPaths(root).includes(LAW_TITLES_PATH), false);
  assert.equal(context.datasets.some((dataset) => dataset.path === LAW_TITLES_PATH), false);
  assert.equal(context.authorityCutovers.length, 1);
  assert.equal(context.authorityCutovers[0].contract.id, "federal-key-votes");
  const az = expectedManifests(context).get("docs/states/az.md")!;
  assert.match(az, /Tracked authorities retired to the production data plane/);
  assert.match(az, /RETIRED_TO_PRODUCTION_DATA_PLANE/);
  assert.match(az, /NON_SERVING_ACQUISITION_SURPLUS/);
  assert.match(az, /FEDERAL_KEY_VOTE \/ US:reviewed-key-vote-selection:v1/);
  assert.match(az, /civic_data_candidates\+civic_data_candidate_events\+civic_data_promotions/);
  assert.match(az, /readFederalKeyVotesProjection/);
  assert.doesNotMatch(az, /\[data\/votes\/law-titles-cache\.json\]\(\.\.\/\.\.\/data\/votes\/law-titles-cache\.json\)/);
});

test("an authority-cutover label cannot hide a present file or drift from its frozen hash and production contract", (t) => {
  const wrongHashRoot = fixture(t);
  installLawTitlesCutover(wrongHashRoot, { frozenSha256: "0".repeat(64) });
  assert.throws(() => loadManifestContext(wrongHashRoot), /does not bind the exact frozen manifest input/);

  const wrongContractRoot = fixture(t);
  installLawTitlesCutover(wrongContractRoot, { scope: "US:wrong-scope" });
  assert.throws(() => loadManifestContext(wrongContractRoot), /permanent production contract does not match/);

  const presentRoot = fixture(t);
  installLawTitlesCutover(presentRoot);
  mkdirSync(dirname(join(presentRoot, LAW_TITLES_PATH)), { recursive: true });
  writeFileSync(join(presentRoot, LAW_TITLES_PATH), "{}\n");
  assert.throws(() => loadManifestContext(presentRoot), /retired tracked authority still exists/);
});

const ZIP_INDEX_PATH = "data/derived/zip-division-ids.json";
const ZIP_INDEX_BASELINE = "tests/fixtures/zip-division-ids-three-state.json";
const ZIP_INDEX_BYTES = '{"zips":{"07866":["ocd-division/country:us/state:nj/county:morris"]}}\n';
const ZIP_INDEX_SHA256 = createHash("sha256").update(ZIP_INDEX_BYTES).digest("hex");

/** The three-state ZIP index superseded by the national shards (2026-09-23), in miniature. */
function installSupersededZipIndex(root: string, overrides: Record<string, unknown> = {}, baselineBytes = ZIP_INDEX_BYTES): void {
  const input = JSON.parse(readFileSync(join(root, INPUT_PATH), "utf8"));
  input.files.push({ path: ZIP_INDEX_PATH, basePath: ZIP_INDEX_PATH, sha256: ZIP_INDEX_SHA256, source: "SESSION_BASE" });
  input.supersededHoldings = [{
    formerPath: ZIP_INDEX_PATH,
    frozenSha256: ZIP_INDEX_SHA256,
    disposition: "SUPERSEDED_BY_SUCCESSOR_HOLDING",
    successorDirectory: "data/derived/zip-divisions",
    baselinePath: ZIP_INDEX_BASELINE,
    reason: "The same fact for every ZIP code, one shard per ZIP prefix.",
    ...overrides,
  }];
  writeFileSync(join(root, INPUT_PATH), JSON.stringify(input));
  const plan = JSON.parse(readFileSync(join(root, PLAN_PATH), "utf8"));
  plan.exemptions.push({ oldPath: ZIP_INDEX_PATH, newPath: ZIP_INDEX_PATH, disposition: "EXEMPT", sha256: ZIP_INDEX_SHA256, referenceCount: 0, references: [] });
  writeFileSync(join(root, PLAN_PATH), JSON.stringify(plan));
  mkdirSync(dirname(join(root, ZIP_INDEX_BASELINE)), { recursive: true });
  writeFileSync(join(root, ZIP_INDEX_BASELINE), baselineBytes);
  const shard = "data/derived/zip-divisions/07.json";
  fixtureConsumers(root, shard);
  mkdirSync(dirname(join(root, shard)), { recursive: true });
  writeFileSync(join(root, shard), JSON.stringify({ formatVersion: 1, divisions: ["ocd-division/country:us/state:nj/county:morris"], zips: { "07866": [0] }, partial: {}, zipSamples: { "07866": 1 } }));
}

test("a superseded holding leaves current holdings while its frozen bytes stay at a named test baseline", (t) => {
  const root = fixture(t);
  installSupersededZipIndex(root);
  const context = loadManifestContext(root);
  assert.equal(canonicalDatasetPaths(root).includes(ZIP_INDEX_PATH), false);
  assert.ok(canonicalDatasetPaths(root).includes("data/derived/zip-divisions/07.json"), "the successor is a current holding");
  assert.equal(context.supersededHoldings.length, 1);
  const az = expectedManifests(context).get("docs/states/az.md")!;
  assert.match(az, /Tracked holdings superseded by a successor holding/);
  assert.match(az, /SUPERSEDED_BY_SUCCESSOR_HOLDING/);
  assert.ok(az.includes(`[${ZIP_INDEX_BASELINE}](../../${ZIP_INDEX_BASELINE})`));
  assert.ok(!az.includes(`[${ZIP_INDEX_PATH}](../../${ZIP_INDEX_PATH})`), "the former path is never linked as a current holding");
});

test("a superseded label cannot hide a present file, drift from its frozen hash, or lose its baseline or successor", (t) => {
  const wrongHash = fixture(t);
  installSupersededZipIndex(wrongHash, { frozenSha256: "0".repeat(64) });
  assert.throws(() => loadManifestContext(wrongHash), /does not bind the exact frozen manifest input/);

  const present = fixture(t);
  installSupersededZipIndex(present);
  mkdirSync(dirname(join(present, ZIP_INDEX_PATH)), { recursive: true });
  writeFileSync(join(present, ZIP_INDEX_PATH), ZIP_INDEX_BYTES);
  assert.throws(() => loadManifestContext(present), /superseded tracked holding still exists/);

  const driftedBaseline = fixture(t);
  installSupersededZipIndex(driftedBaseline, {}, '{"zips":{}}\n');
  assert.throws(() => loadManifestContext(driftedBaseline), /exact frozen bytes are not kept at a test baseline/);

  const baselineAsHolding = fixture(t);
  installSupersededZipIndex(baselineAsHolding, { baselinePath: "data/derived/zip-index-baseline.json" });
  assert.throws(() => loadManifestContext(baselineAsHolding), /exact frozen bytes are not kept at a test baseline/);

  const noSuccessor = fixture(t);
  installSupersededZipIndex(noSuccessor, { successorDirectory: "data/derived/nowhere" });
  assert.throws(() => loadManifestContext(noSuccessor), /holds no dataset/);
});

test("every migrated contract bootstrap fixture rendered by a state manifest is labeled evidence, never live Reader authority", () => {
  const currentDatasets = new Set(canonicalDatasetPaths(resolve(".")));
  const manifestLines = readdirSync("docs/states")
    .filter((name) => name.endsWith(".md"))
    .flatMap((name) => readFileSync(join("docs/states", name), "utf8").split(/\r?\n/));
  let renderedFixturePaths = 0;
  for (const contract of MANUAL_PRODUCTION_SOURCE_CONTRACTS) for (const path of contract.bootstrapFixturePaths) {
    if (!currentDatasets.has(path)) continue;
    renderedFixturePaths++;
    const rows = manifestLines.filter((line) => line.startsWith(`| [${path}](../../${path}) |`));
    assert.ok(rows.length > 0, `${path}: migrated first-seed evidence disappeared from the generated inventory`);
    assert.ok(rows.every((line) => line.includes(TRACKED_FIRST_SEED_AUTHORITY_BOUNDARY)), `${path}: a generated row still describes migrated tracked bytes as current Reader authority`);
  }
  assert.ok(renderedFixturePaths > 0, "the migrated bootstrap-fixture guard ran over an empty denominator");
});

test("a new state's first acquisition creates a required manifest without a state list edit", (t) => {
  const root = fixture(t);
  const first = expectedManifests(loadManifestContext(root));
  assert.deepEqual([...first.keys()], ["docs/states/az.md"]);
  writeManifests(root, first);
  mkdirSync(join(root, "data/states/ct/ballot"), { recursive: true });
  writeFileSync(join(root, "data/states/ct/ballot/new.json"), JSON.stringify({ election: { state: "CT" }, candidacies: [{ id: "ct:person" }], contests: [] }));
  const next = expectedManifests(loadManifestContext(root));
  assert.ok(next.has("docs/states/ct.md"));
  assert.match(next.get("docs/states/ct.md")!, /NEW AFTER SNAPSHOT/);
  assert.ok(checkManifests(root, next).includes("MISSING docs/states/ct.md"));
  assert.deepEqual(JSON.parse(readFileSync(join(root, INPUT_PATH), "utf8")).discoveredStates, ["az"]);
});

test("seeded stale manifest makes standalone --check red and touches no input or output bytes", (t) => {
  const root = fixture(t);
  writeManifests(root, expectedManifests(loadManifestContext(root)));
  writeFileSync(join(root, "docs/states/az.md"), "SEEDED STALE MANIFEST\n");
  const before = fileBytes(root);
  const run = spawnSync(process.execPath, ["--experimental-strip-types", SCRIPT, "--root", root, "--check"], { encoding: "utf8", env: { ...process.env, WTP_CONTROL_PLANE_DATABASE_URL: "must-never-be-contacted", WTP_ASSET_STORE: "must-never-be-read" } });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /STALE docs\/states\/az\.md/);
  assert.deepEqual(fileBytes(root), before);
});

test("a readback update makes a byte-current manifest stale while preserving its observed_at", (t) => {
  const root = fixture(t);
  const initial = expectedManifests(loadManifestContext(root));
  writeManifests(root, initial);
  const cp = JSON.parse(readFileSync(join(root, CONTROL_PATH), "utf8"));
  cp.obligations.push({ id: "freshness:meetings:az:body", subjectId: "az:body", recordClass: "meetings", active: true, routeId: null, nextDueAt: "2026-09-05T00:00:00.000Z" });
  writeFileSync(join(root, CONTROL_PATH), JSON.stringify(cp));
  const after = expectedManifests(loadManifestContext(root));
  assert.ok(checkManifests(root, after).includes("STALE docs/states/az.md"));
  const text = after.get("docs/states/az.md")!;
  assert.match(text, /2026-09-01T00:00:00.000Z/);
  assert.match(text, /2026-09-05T00:00:00.000Z/);
  assert.match(text, /1 of 1 state-tagged standing obligations/);
});

test("vault-only state joins through durable work-item identity and acquires a manifest obligation", (t) => {
  const root = fixture(t);
  const cp = JSON.parse(readFileSync(join(root, CONTROL_PATH), "utf8"));
  cp.workItems.push({ id: "wi-fixture", subject: "ocd-division/country:us/state:wy", state: "OPEN" });
  writeFileSync(join(root, CONTROL_PATH), JSON.stringify(cp));
  const v = JSON.parse(readFileSync(join(root, VAULT_PATH), "utf8"));
  v.objects.push({ key: "project/fixture/wy.txt", meta: { byteLength: 4, contentHash: "fixture", custom: { workItemId: "wi-fixture", retrievedAt: "2026-08-30T00:00:00.000Z", sourceId: "fixture-source", canonicalUrl: "https://example.invalid/record" } } });
  writeFileSync(join(root, VAULT_PATH), JSON.stringify(v));
  const manifests = expectedManifests(loadManifestContext(root));
  assert.match(manifests.get("docs/states/wy.md")!, /project\/fixture\/wy.txt/);
  assert.match(manifests.get("docs/states/wy.md")!, /2026-08-30T00:00:00.000Z/);
});

test("every advertised table row count equals the rendered row count", (t) => {
  const root = fixture(t);
  const text = expectedManifests(loadManifestContext(root)).get("docs/states/az.md")!;
  for (const section of text.split(/^### /m).slice(1)) {
    const count = /\n\n(\d+) of \1 /.exec(section);
    if (!count) continue;
    const rows = section.split("\n").filter((line) => line.startsWith("| ")).length - 2;
    assert.equal(rows, Number(count[1]), section.split("\n")[0]);
  }
});

test("ignored local source bytes are never external manifest inputs", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, ".gitignore"), "/data/states/az/ballot/private-source.json\n");
  writeFileSync(join(root, "data/states/az/ballot/private-source.json"), "private bytes are not a committed readback");
  assert.equal(loadManifestContext(root).datasets.length, 1);
});

test("content-addressed asset aliases preserve the union of authoritative state joins", (t) => {
  const root = fixture(t);
  const vault = JSON.parse(readFileSync(join(root, VAULT_PATH), "utf8"));
  vault.assetInventory = [
    { originalPath: "public/candidates/nh-person.jpg", key: "fixture-shared-key", verified: true, storedAt: "2026-08-31" },
    { originalPath: "public/officials/untagged-alias.jpg", key: "fixture-shared-key", verified: true },
  ];
  writeFileSync(join(root, VAULT_PATH), JSON.stringify(vault));
  const context = loadManifestContext(root);
  assert.deepEqual(context.vaultStates.get("fixture-shared-key"), ["nh"]);
  assert.match(expectedManifests(context).get("docs/states/nh.md")!, /2 of 2 vault inventory objects/);
  assert.match(expectedManifests(context).get("docs/states/nh.md")!, /stored_at 2026-08-31; source retrieval date not recorded/);
});

test("state funding citations never borrow the first other-state candidate's provenance", (t) => {
  const root = fixture(t);
  mkdirSync(join(root, "data/fec"), { recursive: true });
  fixtureConsumers(root, "data/fec/fec-test.json");
  writeFileSync(join(root, "data/fec/fec-test.json"), JSON.stringify({ candidates: [
    { id: "nh:person", state: "NH", provenance: { sourceUrl: "https://example.invalid/nh-filing" } },
    { id: "az:person", state: "AZ", provenance: { sourceUrl: "https://example.invalid/az-filing" } },
  ] }));
  const az = expectedManifests(loadManifestContext(root)).get("docs/states/az.md")!;
  assert.match(az, /https:\/\/example.invalid\/az-filing/);
  assert.doesNotMatch(az, /https:\/\/example.invalid\/nh-filing/);
});

test("unpartitioned canonical holdings and non-state control rows remain explicitly visible", (t) => {
  const root = fixture(t);
  mkdirSync(join(root, "data/ballot"), { recursive: true });
  writeFileSync(join(root, "data/ballot/candidate-cards-unpartitioned.json"), JSON.stringify({ cards: {} }));
  const cp = JSON.parse(readFileSync(join(root, CONTROL_PATH), "utf8"));
  cp.obligations.push({ id: "proof-fixture", subjectId: "ocd-division/proof:fixture", recordClass: "meetings", active: true, nextDueAt: null });
  writeFileSync(join(root, CONTROL_PATH), JSON.stringify(cp));
  const az = expectedManifests(loadManifestContext(root)).get("docs/states/az.md")!;
  assert.match(az, /1 of 1 canonical shared inputs without a state partition/);
  assert.match(az, /candidate-cards-unpartitioned\.json/);
  assert.match(az, /1 of 1 unattributed standing rows/);
  assert.match(az, /proof-fixture/);
});

test("every exempt canonical TypeScript holding has an explicit export and dependency contract", () => {
  const plan = JSON.parse(readFileSync(PLAN_PATH, "utf8"));
  const paths = plan.exemptions.filter((entry: { oldPath: string }) => entry.oldPath.endsWith(".ts")).map((entry: { oldPath: string }) => entry.oldPath).sort();
  assert.deepEqual(MODULE_DATASETS.map((entry) => entry.path).sort(), paths);
  assert.deepEqual(validateDatasetMapping(paths, (path) => { try { readFileSync(path); return true; } catch { return false; } }), []);
  const roster = readModuleDataset(resolve("."), "lib/registry/body-rosters.ts");
  assert.ok(roster.records.length > 1);
  assert.ok(roster.records.every((row) => Array.isArray(row.members) && row.members.length > 0));
  assert.ok(moduleDatasetInputPaths(["lib/registry/body-rosters.ts"]).includes("data/states/az/officials/cawcd-rosters.json"));
});

test("unknown canonical TypeScript and a different context root fail closed", (t) => {
  const root = fixture(t);
  assert.throws(() => readModuleDataset(root, "data/states/az/officials/unreviewed.ts"), /no reviewed export adapter/);
  assert.throws(() => readModuleDataset(root, "lib/registry/body-rosters.ts"), /context root differs/);
});

test("imported module values cannot pass freshness after a supporting source changes", (t) => {
  const root = fixture(t);
  // Copy the real transitive import closure: production Reader projections may
  // wrap a static first seed without making their runtime modules authoritative
  // manifest inputs. The explicit adapter dependency below is still hash-bound.
  const files = sourceClosure(resolve("."), resolve("lib/holdings/module-datasets.ts"));
  for (const path of files) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), readFileSync(path)); }
  symlinkSync(resolve("node_modules"), join(root, "node_modules"), "junction");
  const script = `import { readFileSync, writeFileSync } from 'node:fs';
    const m = await import(${JSON.stringify(pathToFileURL(join(root, "lib/holdings/module-datasets.ts")).href)});
    const path = ${JSON.stringify(join(root, "lib/officials/body-form.ts"))};
    writeFileSync(path, readFileSync(path, 'utf8') + '\\n// seeded dependency change\\n');
    m.readModuleDataset(${JSON.stringify(root)}, 'lib/officials/body-definitions.ts');`;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source hash differs from imported bytes: lib\/officials\/body-form\.ts/);
});

test("extracted canonical envelopes count roster records and render every member", (t) => {
  const root = fixture(t);
  const path = "data/states/az/officials/cawcd-rosters.json";
  fixtureConsumers(root, path);
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), JSON.stringify({ schemaVersion: 1, state: "AZ", source: { baseSha: BASE }, commentary: [], records: { AZ_CAWCD_ROSTERS: [{ bodyId: "ocd-division/country:us/state:az#fixture", sourceUrl: "https://example.invalid/roster", collectedAt: "2026-08-27", members: [{ id: "fixture:one", name: "One", officeTitle: "Director" }, { id: "fixture:two", name: "Two", officeTitle: "Director" }] }] } }));
  const context = loadManifestContext(root);
  const dataset = context.datasets.find((d) => d.path === path)!;
  assert.equal(dataset.totalRows, 1);
  assert.equal(dataset.rowsByState.get("az"), 1);
  const text = expectedManifests(context).get("docs/states/az.md")!;
  assert.match(text, /2 of 2 held roster member records/);
  assert.match(text, /fixture:one/); assert.match(text, /fixture:two/);
  assert.match(text, /2026-08-27/);
});

test("a transitive generator code change invalidates manifests independently of held data", (t) => {
  const root = fixture(t);
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts/state-manifest.mts"), "import { value } from './fixture-engine-helper.ts';\n");
  writeFileSync(join(root, "scripts/fixture-engine-helper.ts"), "export const value = 1;\n");
  const initial = loadManifestContext(root);
  assert.ok(initial.inputs.some((input) => input.path === "scripts/fixture-engine-helper.ts"));
  writeManifests(root, expectedManifests(initial));
  writeFileSync(join(root, "scripts/fixture-engine-helper.ts"), "export const value = 2;\n");
  const changed = loadManifestContext(root);
  assert.notEqual(changed.inputDigest, initial.inputDigest);
  assert.ok(checkManifests(root, expectedManifests(changed)).includes("STALE docs/states/az.md"));
});
