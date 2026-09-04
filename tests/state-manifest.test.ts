import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { READER_SURFACES, datasetFamily, validateDatasetMapping } from "../lib/holdings/datasets.ts";
import { MODULE_DATASETS, moduleDatasetInputPaths, readModuleDataset } from "../lib/holdings/module-datasets.ts";
import { CONTROL_PATH, INPUT_PATH, PLAN_PATH, VAULT_PATH, checkManifests, expectedManifests, loadManifestContext, statesFromIdentity, writeManifests } from "../lib/holdings/manifest.ts";
import { classify, scanText } from "../scripts/doc-dates.mjs";

const SCRIPT = resolve("scripts/state-manifest.mts");
const BASE = "3f9a138fd39f6160659329e17c496d2dd99cee00";
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
  const files = [...moduleDatasetInputPaths(MODULE_DATASETS.map((entry) => entry.path)), "lib/holdings/module-datasets.ts"];
  for (const path of files) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), readFileSync(path)); }
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
