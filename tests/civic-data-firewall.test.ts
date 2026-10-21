import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { observableRoutineContracts } from "../lib/civic-data/meeting-partitions.ts";
import {
  MANUAL_PRODUCTION_SOURCE_CONTRACTS,
  type ManualProductionSourceContract,
} from "../lib/civic-data/manual-contracts.ts";
import { civicDataFirewall } from "../lib/civic-data/firewall.ts";
import { temporaryPath } from "../lib/civic-data/temporary-path.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";

const ROUTINE_SOURCE_CONTRACTS = observableRoutineContracts();

function minimalFiles(): Record<string, string> {
  return Object.fromEntries([
    ["package.json", JSON.stringify({ scripts: {} })],
    ...ROUTINE_SOURCE_CONTRACTS.map((contract) => [contract.acquisitionAdapter.command[0], "export const acquisition = true;"] as const),
    ...MANUAL_PRODUCTION_SOURCE_CONTRACTS.map((contract) => [contract.command[0], "prepareProductionCivicDataWrite(); export const acquisition = true;"] as const),
  ]);
}

const audit = (files: Record<string, string>, extra: Partial<Parameters<typeof civicDataFirewall>[0]> = {}) =>
  civicDataFirewall({
    files,
    contracts: ROUTINE_SOURCE_CONTRACTS,
    manualContracts: MANUAL_PRODUCTION_SOURCE_CONTRACTS,
    ...extra,
  });

test("civic-data firewall accepts one release-free adapter and clock per contract", () => {
  assert.deepEqual(audit(minimalFiles()), []);
});

test("filesystem writers prove runtime temporary confinement across module boundaries", () => {
  const files = minimalFiles();
  const command = ROUTINE_SOURCE_CONTRACTS[0]!.acquisitionAdapter.command[0]!;
  files["lib/unrelated-path-name.ts"] = readFileSync(new URL("../lib/civic-data/temporary-path.ts", import.meta.url), "utf8");
  files[command] = [
    'import { temporaryPath as confined } from "../lib/unrelated-path-name.ts";',
    'import { mkdir, open, rename, writeFile } from "node:fs/promises";',
    'export async function acquire(destination: string, bytes: Uint8Array) {',
    '  await mkdir(confined(destination), { recursive: true });',
    '  const file = await open(confined(`${destination}/body`), "w");',
    '  await file.write(bytes); await file.close();',
    '  await writeFile(confined(`${destination}/state`), "complete");',
    '  await rename(confined(`${destination}/body`), confined(`${destination}/ready`));',
    '}',
  ].join("\n");
  assert.deepEqual(audit(files), []);
  const original = files["lib/unrelated-path-name.ts"]!;
  for (const change of [
    (value: string) => value.replace("!target.startsWith(temporary + sep)", "false"),
    (value: string) => value.replace("parent.startsWith(root + sep)", "true"),
    (value: string) => value.replace("target.startsWith(repository + sep)", "false"),
    (value: string) => value.replace("return target;", "return value;"),
    (value: string) => value.replace('from "node:fs"', 'from "./pretend-fs.ts"'),
    (value: string) => `${value}\nprocess.chdir("/");`,
  ]) {
    files["lib/unrelated-path-name.ts"] = change(original);
    assert.ok(audit(files).some(({ code, path }) => code === "ROUTINE_PATH_WRITES_REPOSITORY" && path === command));
  }
  files["lib/unrelated-path-name.ts"] = original;
  for (const writer of [
    'function acquire(confined) { writeFile(confined(destination), bytes); }',
    'class Acquisition { acquire(confined) { writeFile(confined(destination), bytes); } }',
    'function acquire() { const confined = value => value; writeFile(confined(destination), bytes); }',
    'function acquire() { writeFile(confined(destination) + "/../../repo/data.json", bytes); }',
  ]) {
    files[command] = `import { temporaryPath as confined } from "../lib/unrelated-path-name.ts"; import { writeFile } from "node:fs/promises"; ${writer}`;
    assert.ok(audit(files).some(({ code }) => code === "ROUTINE_PATH_WRITES_REPOSITORY"));
  }
});

test("temporary destinations reject repository paths, traversal and symlink escapes", async () => {
  const root = mkdtempSync(join(tmpdir(), "firewall-confinement-"));
  const previous = process.env.TMPDIR;
  try {
    assert.equal(temporaryPath(join(root, "pending", "body.csv")), join(root, "pending", "body.csv"));
    assert.throws(() => temporaryPath(join(process.cwd(), "data", "live.json")), /temporary|repository/);
    assert.throws(() => temporaryPath(join(root, "..", "..", "etc", "unsafe")), /temporary/);
    symlinkSync(process.cwd(), join(root, "escaped"), "dir");
    assert.throws(() => temporaryPath(join(root, "escaped", "data", "not-created.json")), /temporary|repository/);
    const store = new LocalFileArtifactStore(root);
    await assert.rejects(store.writeJsonPointer("../escaped.json", {}, null), /escaped/);
    assert.equal((await store.writeJsonPointer("reader/safe.json", {}, null)).modified, true);
    symlinkSync(root, join(root, "temporary-alias"), "dir");
    process.env.TMPDIR = join(root, "temporary-alias");
    assert.equal(temporaryPath(join(tmpdir(), "body.csv")), join(tmpdir(), "body.csv"));
    process.env.TMPDIR = process.cwd();
    assert.throws(() => temporaryPath(join(process.cwd(), "data", "live.json")), /repository/);
  } finally {
    if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("a package alias cannot restore a direct production child command", () => {
  const files = minimalFiles();
  const parsed = JSON.parse(files["package.json"]!) as { scripts: Record<string, string> };
  parsed.scripts["routine:civic-data"] =
    "node --env-file=.env.local --experimental-strip-types scripts/routine-civic-data-runner.mts";
  files["package.json"] = JSON.stringify(parsed);

  const codes = audit(files).map(({ code }) => code);
  assert.ok(codes.includes("DIRECT_PRODUCTION_CHILD_COMMAND"));
});

test("a standing-clock contract cannot regain an owner manual-promotion door under any package name or adapter", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS[0]!;
  assert.ok(!MANUAL_PRODUCTION_SOURCE_CONTRACTS.some(({ id }) => id === contract.id));
  const withScript = (name: string, command: string) => {
    const files = minimalFiles();
    const parsed = JSON.parse(files["package.json"]!) as { scripts: Record<string, string> };
    parsed.scripts[name] = command;
    files["package.json"] = JSON.stringify(parsed);
    return audit(files);
  };

  assert.deepEqual(
    withScript("outcomes:ingest", "node --experimental-strip-types scripts/legistar-outcomes-ingest.mts --promote")
      .filter(({ code }) => code === "DIRECT_PRODUCTION_CHILD_COMMAND")
      .map(({ detail }) => detail),
    ["outcomes:ingest restores a direct production child outside the installed authority graph."],
  );

  const files = minimalFiles();
  const adapter = contract.acquisitionAdapter.command[0]!;
  files[adapter] = `await processRegisteredManualCandidate(store, "${contract.id}", candidate, now);`;
  assert.deepEqual(
    audit(files)
      .filter(({ code }) => code === "ROUTINE_ADAPTER_REACHES_MANUAL_DOOR")
      .map(({ path }) => path),
    [adapter],
  );
  files[adapter] = `// processRegisteredManualCandidate is not called here.\nawait processRegisteredRoutineCandidate(store, "${contract.id}", candidate, now);`;
  assert.deepEqual(audit(files).filter(({ code }) => code === "ROUTINE_ADAPTER_REACHES_MANUAL_DOOR"), []);
});

test("production executables cannot bypass source-scoped evidence through the generic transition driver", () => {
  const files = minimalFiles();
  files["scripts/renamed-generic-promoter.mts"] = [
    'import { processRoutineCandidate as promoteAnything } from "../lib/civic-data/candidate-lifecycle.ts";',
    "await promoteAnything(store, candidate);",
  ].join("\n");
  assert.deepEqual(
    audit(files)
      .filter(({ code }) => code === "UNREGISTERED_PRODUCTION_PROMOTION_DOOR")
      .map(({ path }) => path),
    ["scripts/renamed-generic-promoter.mts"],
  );
});

test("routine data and runtime-ops workflows cannot regain a cron, contents write, or Git commit path", () => {
  const files = minimalFiles();
  const routineCommand = ROUTINE_SOURCE_CONTRACTS[0]!.acquisitionAdapter.command[0]!;
  files[".github/workflows/renamed-data-publisher.yml"] = [
    "on:",
    "  schedule:",
    "    - cron: '11 9 * * *'",
    "permissions:",
    "  contents: write",
    "steps:",
    `  - run: node ${routineCommand}`,
    "  - run: git add data && git commit -m runtime && git push",
  ].join("\n");
  files[".github/workflows/renamed-runtime-observer.yml"] = [
    "on:",
    "  schedule:",
    "    - cron: '40 15 * * *'",
    "permissions:",
    "  contents: write",
    "steps:",
    "  - run: pnpm window:run",
    "  - run: node scripts/push-main.mjs --workflow runtime-health",
  ].join("\n");

  const byPath = (path: string) => audit(files).filter((finding) => finding.path === path).map(({ code }) => code).sort();
  assert.deepEqual(byPath(".github/workflows/renamed-data-publisher.yml"), [
    "ROUTINE_DATA_CONTENTS_WRITE",
    "ROUTINE_DATA_GIT_WRITE",
  ]);
  assert.deepEqual(byPath(".github/workflows/renamed-runtime-observer.yml"), [
    "ROUTINE_OPS_CONTENTS_WRITE",
    "ROUTINE_OPS_GIT_WRITE",
    "SCHEDULED_ROUTINE_OPS_WORKFLOW",
  ]);
});

test("workflow classification follows renamed package aliases and cycle-safe local composite actions", () => {
  const files = minimalFiles();
  const routineCommand = ROUTINE_SOURCE_CONTRACTS[0]!.acquisitionAdapter.command[0]!;
  const manualCommand = MANUAL_PRODUCTION_SOURCE_CONTRACTS[0]!.command[0]!;
  const packageJson = JSON.parse(files["package.json"]!) as { scripts: Record<string, string> };
  packageJson.scripts["opaque-runtime-entry"] = "pnpm run opaque-runtime-next";
  packageJson.scripts["opaque-runtime-next"] = `node ${routineCommand}`;
  packageJson.scripts["opaque-manual-entry"] = `tsx ${manualCommand}`;
  files["package.json"] = JSON.stringify(packageJson);

  files[".github/workflows/renamed-alias-publisher.yml"] = [
    "on:",
    "  schedule:",
    "    - cron: '11 9 * * *'",
    "permissions:",
    "  contents: write",
    "steps:",
    "  - run: npm run-script opaque-runtime-entry",
    "  - run: git -C . push origin HEAD:main",
  ].join("\n");
  files[".github/workflows/renamed-composite-publisher.yml"] = [
    "on:",
    "  schedule:",
    "    - cron: '12 9 * * *'",
    "permissions:",
    "  contents: write",
    "steps:",
    "  - uses: ./.github/actions/quiet-entry",
    "  - run: git -C . push origin HEAD:main",
  ].join("\n");
  files[".github/actions/quiet-entry/action.yml"] = [
    "name: Quiet entry",
    "runs:",
    "  using: composite",
    "  steps:",
    "    - uses: ./.github/actions/quiet-next",
  ].join("\n");
  files[".github/actions/quiet-next/action.yaml"] = [
    "name: Quiet next",
    "runs:",
    "  using: composite",
    "  steps:",
    "    - uses: ./.github/actions/quiet-entry",
    "    - shell: bash",
    "      run: pnpm opaque-manual-entry",
  ].join("\n");

  const byPath = (path: string) => audit(files)
    .filter((finding) => finding.path === path)
    .map(({ code }) => code)
    .sort();
  const expected = [
    "ROUTINE_DATA_CONTENTS_WRITE",
    "ROUTINE_DATA_GIT_WRITE",
  ];
  assert.deepEqual(byPath(".github/workflows/renamed-alias-publisher.yml"), expected);
  assert.deepEqual(byPath(".github/workflows/renamed-composite-publisher.yml"), expected);
});

test("workflow executable closure fails closed on unresolved actions and excessive alias depth", () => {
  const files = minimalFiles();
  const packageJson = JSON.parse(files["package.json"]!) as { scripts: Record<string, string> };
  for (let index = 0; index <= 256; index += 1) {
    packageJson.scripts[`opaque-depth-${index}`] = index === 256
      ? "node harmless.mjs"
      : `pnpm opaque-depth-${index + 1}`;
  }
  files["package.json"] = JSON.stringify(packageJson);
  files[".github/workflows/unresolved-local-action.yml"] = [
    "on: push",
    "permissions:",
    "  contents: read",
    "steps:",
    "  - uses: ./.github/actions/does-not-exist",
  ].join("\n");
  files[".github/workflows/excessive-alias-depth.yml"] = [
    "on: push",
    "permissions:",
    "  contents: read",
    "steps:",
    "  - run: pnpm opaque-depth-0",
  ].join("\n");

  const findings = audit(files).filter(
    ({ code }) => code === "WORKFLOW_EXECUTABLE_CLOSURE_UNRESOLVED",
  );
  assert.deepEqual(findings.map(({ path }) => path), [
    ".github/workflows/excessive-alias-depth.yml",
    ".github/workflows/unresolved-local-action.yml",
  ]);
  assert.match(findings[0]!.detail, /exceeded 256 nodes/);
  assert.match(findings[1]!.detail, /local action could not be resolved/);
});

test("civic-data firewall refuses release calls, repository writers, and duplicate authority", () => {
  const files = minimalFiles();
  const command = ROUTINE_SOURCE_CONTRACTS[0]!.acquisitionAdapter.command[0];
  files[command] = "writeFileSync('data/civic.json', '{}'); spawnSync('git', ['push']);";
  const duplicate = { ...ROUTINE_SOURCE_CONTRACTS[0]!, id: "duplicate" };
  const codes = audit(files, { contracts: [...ROUTINE_SOURCE_CONTRACTS, duplicate] }).map((finding) => finding.code);
  assert.ok(codes.includes("ROUTINE_PATH_INVOKES_RELEASE"));
  assert.ok(codes.includes("ROUTINE_PATH_WRITES_REPOSITORY"));
  assert.ok(codes.includes("MULTIPLE_AUTHORITATIVE_WRITERS"));
  assert.ok(codes.includes("MULTIPLE_ROUTINE_MEMBERSHIPS"));
});

test("canonical record-class/scope authority cannot be reclaimed under a different source id", () => {
  const original = ROUTINE_SOURCE_CONTRACTS[0]!;
  const crossSourceCollision = {
    ...original,
    id: "planted-cross-source-canonical-collision",
    sourceId: "cisa-dotgov-registry" as const,
    authorityConstraint: {
      registry: "SOURCE_AUTHORITIES" as const,
      sourceId: "cisa-dotgov-registry" as const,
    },
  };
  const findings = audit(minimalFiles(), {
    contracts: [...ROUTINE_SOURCE_CONTRACTS, crossSourceCollision],
  }).filter(({ code }) => code === "MULTIPLE_AUTHORITATIVE_WRITERS");
  assert.deepEqual(findings.map(({ detail }) => detail), [
    `${original.recordClass}:${original.scope} is claimed by both ${original.id} and ${crossSourceCollision.id}`,
  ]);
});

test("a manual contract cannot reclaim a routine canonical record-class/scope authority", () => {
  const routine = ROUTINE_SOURCE_CONTRACTS[0]!;
  const manual = MANUAL_PRODUCTION_SOURCE_CONTRACTS[0]!;
  assert.notEqual(manual.sourceId, routine.sourceId, "the planted collision must cross source identities");
  const crossRegistryCollision: ManualProductionSourceContract = {
    ...manual,
    id: "planted-manual-reclaims-routine-authority",
    recordClass: routine.recordClass,
    scope: routine.scope,
  };
  const findings = audit(minimalFiles(), {
    manualContracts: [...MANUAL_PRODUCTION_SOURCE_CONTRACTS, crossRegistryCollision],
  }).filter(({ code }) => code === "MULTIPLE_AUTHORITATIVE_WRITERS");
  assert.deepEqual(findings.map(({ detail }) => detail), [
    `${routine.recordClass}:${routine.scope} is claimed by both ${routine.id} and ${crossRegistryCollision.id}`,
  ]);
});

test("every explicit production data command must prepare its own sanctioned write context", () => {
  const files = minimalFiles();
  const command = MANUAL_PRODUCTION_SOURCE_CONTRACTS.find(
    ({ command: registered }) => registered[0] === "scripts/state-money-az.mts",
  )!.command[0]!;
  files[command] = "processRegisteredManualCandidate(new PostgresRoutineDataStore());";
  const findings = audit(files).filter(
    ({ code }) => code === "MANUAL_PRODUCTION_WRITE_CONTEXT_MISSING",
  );
  assert.deepEqual(findings.map(({ path }) => path), [command]);

  files[command] =
    "processRegisteredManualCandidate(new PostgresRoutineDataStore()); prepareProductionCivicDataWrite();";
  assert.deepEqual(
    audit(files)
      .filter(({ code }) => code === "MANUAL_PRODUCTION_WRITE_CONTEXT_MISSING")
      .map(({ path }) => path),
    [command],
    "preparing the handle after a store is constructed must still fail closed",
  );
});

test("run 34232794631 regression: a source path cannot execute unrelated software certification", () => {
  const files = minimalFiles();
  const routineCommand = ROUTINE_SOURCE_CONTRACTS[0]!.acquisitionAdapter.command[0];
  const manualCommand = MANUAL_PRODUCTION_SOURCE_CONTRACTS[0]!.command[0];
  files[routineCommand] = 'spawnSync("pnpm", ["test", "tests/office-opening-spell.test.ts"]);';
  files[manualCommand] = 'spawnSync(process.execPath, ["--test", "tests/office-opening-spell.test.ts"]);';
  const findings = audit(files).filter(({ code }) => code === "DATA_PATH_INVOKES_SOFTWARE_CERTIFICATION");
  assert.deepEqual(findings.map(({ path }) => path).sort(), [manualCommand, routineCommand].sort());
});

test("run 34232794631 regression: indirect helpers cannot smuggle software certification into acquisition or promotion", () => {
  const files = minimalFiles();
  const routineCommand = ROUTINE_SOURCE_CONTRACTS[0]!.acquisitionAdapter.command[0]!;
  const manualCommand = MANUAL_PRODUCTION_SOURCE_CONTRACTS[0]!.command[0]!;
  files[routineCommand] = 'import "./lib/acquisition-certifier.ts"; export const acquisition = true;';
  files[manualCommand] =
    'import "./lib/promotion-certifier.ts"; import "./lib/detached-promotion-certifier.ts"; prepareProductionCivicDataWrite(); processRegisteredManualCandidate();';
  files["scripts/lib/acquisition-certifier.ts"] =
    'execFileSync("pnpm", ["test", "tests/office-opening-spell.test.ts"]);';
  files["scripts/lib/promotion-certifier.ts"] =
    'runCommand("pnpm", ["build", "--with-playwright"]);';
  files["scripts/lib/detached-promotion-certifier.ts"] = [
    'import * as child from "node:child_process";',
    "const runBase = child.spawnSync;",
    "const run = runBase;",
    'run("pnpm", ["test", "tests/office-opening-spell.test.ts"]);',
  ].join("\n");
  files["scripts/lib/historical-certification-note.ts"] =
    '/* execFileSync("pnpm", ["test", "tests/office-opening-spell.test.ts"]); */ export const history = true;';
  files[routineCommand] += '\nimport "./lib/historical-certification-note.ts";';

  const findings = audit(files).filter(({ code }) => code === "DATA_PATH_INVOKES_SOFTWARE_CERTIFICATION");
  assert.deepEqual(findings.map(({ path }) => path), [
    "scripts/lib/acquisition-certifier.ts",
    "scripts/lib/detached-promotion-certifier.ts",
    "scripts/lib/promotion-certifier.ts",
  ]);
});

test("registered data commands cannot hide Git or deploy machinery in imported helpers", () => {
  const files = minimalFiles();
  const routineCommand = ROUTINE_SOURCE_CONTRACTS[0]!.acquisitionAdapter.command[0]!;
  const manualCommand = MANUAL_PRODUCTION_SOURCE_CONTRACTS[0]!.command[0]!;
  files[routineCommand] = [
    'import "./lib/acquisition-pusher.ts";',
    'import "./lib/acquisition-namespace-pusher.ts";',
    'import "./lib/acquisition-detached-pusher.ts";',
    'import "./lib/acquisition-destructured-pusher.ts";',
    "export const acquisition = true;",
  ].join("\n");
  files[manualCommand] =
    'import "./lib/promotion-deployer.cjs"; prepareProductionCivicDataWrite(); processRegisteredManualCandidate();';
  files["scripts/lib/acquisition-pusher.ts"] = [
    'import { spawnSync as runShell } from "node:child_process";',
    'runShell("powershell", ["-NoProfile", "-Command", "git -C . push origin HEAD:main"]);',
  ].join("\n");
  files["scripts/lib/acquisition-namespace-pusher.ts"] = [
    'import * as child from "node:child_process";',
    'child.execFileSync("git", ["push", "origin", "HEAD:main"]);',
  ].join("\n");
  files["scripts/lib/acquisition-detached-pusher.ts"] = [
    'import * as child from "node:child_process";',
    "const launchBase = child.spawnSync;",
    "const launch = launchBase;",
    "const dormantCycleA = dormantCycleB; const dormantCycleB = dormantCycleA;",
    'launch("git", ["push", "origin", "HEAD:main"]);',
  ].join("\n");
  files["scripts/lib/acquisition-destructured-pusher.ts"] = [
    'import * as child from "node:child_process";',
    "const { execFileSync: invoke } = child;",
    'invoke("git", ["push", "origin", "HEAD:main"]);',
  ].join("\n");
  files["scripts/lib/promotion-deployer.cjs"] = [
    'const { execSync: invoke } = re' + 'quire("child_process");',
    'invoke("netlify deploy --prod");',
  ].join("\n");
  files[routineCommand] += '\nimport "./lib/read-only-code-identity.ts";';
  files["scripts/lib/read-only-code-identity.ts"] =
    'execFileSync("git", ["rev-parse", "HEAD"]); execFileSync("git", ["merge-base", "--is-ancestor", base, head]);';

  const findings = audit(files).filter(({ code }) =>
    code === "ROUTINE_PATH_INVOKES_RELEASE" || code === "MANUAL_DATA_PATH_INVOKES_RELEASE");
  assert.deepEqual(
    findings.map(({ code, path }) => ({ code, path })).sort((a, b) => a.path.localeCompare(b.path)),
    [
      { code: "ROUTINE_PATH_INVOKES_RELEASE", path: "scripts/lib/acquisition-detached-pusher.ts" },
      { code: "ROUTINE_PATH_INVOKES_RELEASE", path: "scripts/lib/acquisition-destructured-pusher.ts" },
      { code: "ROUTINE_PATH_INVOKES_RELEASE", path: "scripts/lib/acquisition-namespace-pusher.ts" },
      { code: "ROUTINE_PATH_INVOKES_RELEASE", path: "scripts/lib/acquisition-pusher.ts" },
      { code: "MANUAL_DATA_PATH_INVOKES_RELEASE", path: "scripts/lib/promotion-deployer.cjs" },
    ].sort((a, b) => a.path.localeCompare(b.path)),
  );
  assert.equal(
    findings.some(({ path }) => path === "scripts/lib/read-only-code-identity.ts"),
    false,
    "read-only exact-code identity is not a release or Git mutation path",
  );
});

test("registered data-command closure follows package aliases and literal local child-script edges", () => {
  const files = minimalFiles();
  const routineCommand = ROUTINE_SOURCE_CONTRACTS[0]!.acquisitionAdapter.command[0]!;
  const manualCommand = MANUAL_PRODUCTION_SOURCE_CONTRACTS[0]!.command[0]!;
  const packageJson = JSON.parse(files["package.json"]!) as { scripts: Record<string, string> };
  packageJson.scripts["opaque-runtime-entry"] =
    "pnpm opaque-runtime-cycle && node --experimental-strip-types scripts/lib/renamed-runtime-publisher.mts";
  packageJson.scripts["opaque-runtime-cycle"] = "npm run-script opaque-runtime-entry";
  packageJson.scripts["opaque-manual-entry"] =
    "node --experimental-strip-types scripts/lib/renamed-manual-certifier.mts";
  files["package.json"] = JSON.stringify(packageJson);
  files[routineCommand] = [
    'import { execSync as invoke, spawnSync as launchScript } from "node:child_process";',
    'invoke("cmd.exe /d /s /c pnpm --silent opaque-runtime-entry");',
    "launchScript('powershell.exe', ['-NoProfile', '-File', join(ROOT, 'scripts', 'lib', 'renamed-runtime-publisher.ps1')]);",
  ].join("\n");
  files[manualCommand] = [
    'const child = await import("node:child_process");',
    "const launchBase = child.spawnSync;",
    "const launch = launchBase;",
    'launch("powershell.exe", ["-NoProfile", "-Command", "pnpm -s opaque-manual-entry"]);',
    "prepareProductionCivicDataWrite();",
    "processRegisteredManualCandidate();",
  ].join("\n");
  files["scripts/lib/renamed-runtime-publisher.mts"] = [
    'import { writeFileSync } from "node:fs";',
    'import { spawnSync } from "node:child_process";',
    'writeFileSync("data/civic/renamed-runtime.json", payload);',
    'spawnSync("git", ["push", "origin", "HEAD:main"]);',
  ].join("\n");
  files["scripts/lib/renamed-runtime-publisher.ps1"] = [
    "# Historical words in a comment do not count: pnpm test",
    "Set-Content -LiteralPath data/civic/renamed-runtime-from-shell.json -Value $payload",
    "git -C . push origin HEAD:main",
  ].join("\n");
  files["scripts/lib/renamed-manual-certifier.mts"] = [
    'import * as child from "node:child_process";',
    "const certify = child.execFileSync;",
    'certify("pnpm", ["test", "tests/office-opening-spell.test.ts"]);',
  ].join("\n");

  const findings = audit(files);
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "ROUTINE_PATH_INVOKES_RELEASE")
      .map(({ path }) => path),
    [
      "scripts/lib/renamed-runtime-publisher.mts",
      "scripts/lib/renamed-runtime-publisher.ps1",
    ],
  );
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "ROUTINE_PATH_WRITES_REPOSITORY")
      .map(({ path }) => path),
    [
      "scripts/lib/renamed-runtime-publisher.mts",
      "scripts/lib/renamed-runtime-publisher.ps1",
    ],
  );
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "DATA_PATH_INVOKES_SOFTWARE_CERTIFICATION")
      .map(({ path }) => path),
    ["scripts/lib/renamed-manual-certifier.mts"],
  );
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "MANUAL_DATA_PATH_INVOKES_RELEASE")
      .map(({ path }) => path),
    ["scripts/lib/renamed-manual-certifier.mts"],
  );
});

test("registered data commands cannot hide any Node filesystem mutation in imported helpers", () => {
  const files = minimalFiles();
  const routineCommand = ROUTINE_SOURCE_CONTRACTS[0]!.acquisitionAdapter.command[0]!;
  const manualCommand = MANUAL_PRODUCTION_SOURCE_CONTRACTS[0]!.command[0]!;
  files[routineCommand] = [
    'import "./lib/acquisition-stream.ts";',
    'import "./lib/acquisition-copy.cjs";',
    'import "./lib/acquisition-detached-writer.ts";',
    'import "./lib/read-only-filesystem.ts";',
    "export const acquisition = true;",
  ].join("\n");
  files[manualCommand] =
    'import "./lib/promotion-writer.ts"; import "../lib/extract/ocr.ts"; import "./lib/temp-files.ts"; import "./lib/mixed-writer.ts"; prepareProductionCivicDataWrite(); processRegisteredManualCandidate();';
  files["lib/extract/ocr.ts"] = readFileSync(new URL("../lib/extract/ocr.ts", import.meta.url), "utf8");
  files["scripts/lib/temp-files.ts"] = [
    'import * as filesystem from "node:fs/promises";',
    'import { tmpdir as temporaryRoot } from "node:os";',
    'import * as paths from "node:path";',
    'const create = filesystem.mkdtemp; const save = filesystem.writeFile;',
    'const root = temporaryRoot();',
    'const dir = await create(paths.join(root, "parser-"));',
    'const input = paths.join(dir, "input.pdf");',
    'await save(input, bytes);',
    'await filesystem.copyFile("data/civic/input.pdf", paths.join(dir, "copy.pdf"));',
    'await filesystem.rename(input, paths.resolve(dir, "output.pdf"));',
    'await filesystem.rm(dir, { recursive: true });',
  ].join("\n");
  files["scripts/lib/mixed-writer.ts"] = [
    'import { writeFileSync, renameSync } from "node:fs";',
    'import { tmpdir } from "node:os";',
    'import { join } from "node:path";',
    'const temporary = join(tmpdir(), "scratch.txt");',
    'writeFileSync(temporary, bytes);',
    'renameSync("data/civic/live.json", temporary);',
  ].join("\n");
  files["scripts/lib/acquisition-stream.ts"] = [
    'import * as filesystem from "node:fs";',
    'filesystem.createWriteStream("data/civic/arbitrary-runtime-holding.json");',
  ].join("\n");
  files["scripts/lib/acquisition-copy.cjs"] = [
    'const { copyFile: duplicate, truncate: shorten } = re' + 'quire("node:fs/promises");',
    'await duplicate(candidate, "data/civic/copied-runtime-holding.json");',
    'await shorten("data/ops/arbitrary-source-state.json", 0);',
  ].join("\n");
  files["scripts/lib/acquisition-detached-writer.ts"] = [
    'import * as filesystem from "node:fs";',
    "const saveBase = filesystem.createWriteStream;",
    "const save = saveBase;",
    "const dormantCycleA = dormantCycleB; const dormantCycleB = dormantCycleA;",
    'save("data/civic/arbitrary-runtime-holding.json");',
  ].join("\n");
  files["scripts/lib/promotion-writer.ts"] = [
    'import * as filesystem from "node:fs/promises";',
    "const { rename: installCandidate, rm: erasePrior, unlink: detachLkg } = filesystem;",
    'await installCandidate(candidate, "data/civic/live.json");',
    'await erasePrior("data/civic/prior.json");',
    'await detachLkg("data/civic/lkg.json");',
  ].join("\n");
  files["scripts/lib/read-only-filesystem.ts"] = [
    'import { readFile as load } from "node:fs/promises";',
    'await load("data/civic/input.json", "utf8");',
    'const sourceRecord = { rename() { return "display-name"; } };',
    'sourceRecord.rename();',
    'const note = "createWriteStream(data/civic/not-a-call.json)";',
  ].join("\n");
  files["tests/fixtures/permitted-writer.ts"] =
    'writeFileSync("data/civic/deterministic-test-fixture.json", payload);';

  const findings = audit(files).filter(({ code }) =>
    code === "ROUTINE_PATH_WRITES_REPOSITORY" || code === "MANUAL_DATA_PATH_WRITES_REPOSITORY");
  assert.deepEqual(
    findings.map(({ code, path }) => ({ code, path })).sort((a, b) => a.path.localeCompare(b.path)),
    [
      { code: "ROUTINE_PATH_WRITES_REPOSITORY", path: "scripts/lib/acquisition-copy.cjs" },
      { code: "ROUTINE_PATH_WRITES_REPOSITORY", path: "scripts/lib/acquisition-detached-writer.ts" },
      { code: "ROUTINE_PATH_WRITES_REPOSITORY", path: "scripts/lib/acquisition-stream.ts" },
      { code: "MANUAL_DATA_PATH_WRITES_REPOSITORY", path: "scripts/lib/promotion-writer.ts" },
      { code: "MANUAL_DATA_PATH_WRITES_REPOSITORY", path: "scripts/lib/mixed-writer.ts" },
    ].sort((a, b) => a.path.localeCompare(b.path)),
  );
  assert.equal(
    findings.some(({ path }) =>
      path === "tests/fixtures/permitted-writer.ts" || path === "scripts/lib/read-only-filesystem.ts"
      || path === "lib/extract/ocr.ts" || path === "scripts/lib/temp-files.ts"),
    false,
    "test fixtures, read-only helpers and OS temporary files are not production repository writers",
  );
  for (const destination of ['paths.join(temporaryRoot(), "..", "repository", "data.json")', 'paths.resolve(root, "/repository/data.json")', '"data/civic/live.json"', 'unknownPath']) {
    files["scripts/lib/temp-files.ts"] += `\nawait save(${destination}, bytes);`;
    assert.ok(audit(files).some(({ code, path }) => code === "MANUAL_DATA_PATH_WRITES_REPOSITORY" && path === "scripts/lib/temp-files.ts"));
    files["scripts/lib/temp-files.ts"] = files["scripts/lib/temp-files.ts"]!.slice(0, files["scripts/lib/temp-files.ts"]!.lastIndexOf("\n"));
  }
  files["scripts/lib/temp-files.ts"] += '\nasync function writeElsewhere(dir) { await save(paths.join(dir, "data.json"), bytes); }';
  assert.ok(audit(files).some(({ code, path }) => code === "MANUAL_DATA_PATH_WRITES_REPOSITORY" && path === "scripts/lib/temp-files.ts"));
});

test("publication closure follows runtime imports but not erased TypeScript interfaces", () => {
  for (const [declaration, reachable] of [
    ['import type { CandidateStore } from "../lib/fixture-writer.ts";', false],
    // Node retains an empty named import, which still executes the module.
    ['import { type CandidateStore } from "../lib/fixture-writer.ts";', true],
    ['import { type CandidateStore, write } from "../lib/fixture-writer.ts"; write();', true],
    ['import "../lib/fixture-writer.ts";', true],
    ['await import("../lib/fixture-writer.ts");', true],
  ] as const) {
    const files = minimalFiles();
    files["scripts/promote-registry-runtime.mts"] += declaration;
    files["lib/fixture-writer.ts"] = 'import { writeFileSync } from "node:fs"; export function write() { writeFileSync("data/held.json", "bad"); } export interface CandidateStore { read(): void; }';
    assert.equal(audit(files).some(row => row.code === "MANUAL_DATA_PATH_WRITES_REPOSITORY" && row.path === "lib/fixture-writer.ts"), reachable, declaration);
  }
});

test("executable closure permits its exact bound with duplicate pending imports and rejects the next module", () => {
  const files = minimalFiles();
  const command = ROUTINE_SOURCE_CONTRACTS[0]!.acquisitionAdapter.command[0]!;
  const first = '../lib/closure/0.ts';
  files[command] = `import "${first}"; import "${first}";`;
  for (let i = 0; i < 1023; i++) {
    files[`lib/closure/${i}.ts`] = i === 1022 ? 'export const last = true;' : `import "./${i + 1}.ts"; import "./${i + 1}.ts";`;
  }
  assert.equal(audit(files).some(row => row.code === "DATA_EXECUTABLE_CLOSURE_UNRESOLVED"), false);
  files['lib/closure/350.ts'] += '\nimport {execFileSync} from "node:child_process"; execFileSync("git", ["push", "origin", "HEAD:main"]);';
  assert.ok(audit(files).some(row => row.code === "ROUTINE_PATH_INVOKES_RELEASE" && row.path === "lib/closure/350.ts"));
  files['lib/closure/1022.ts'] = 'import "./1023.ts";';
  files['lib/closure/1023.ts'] = 'export const last = true;';
  assert.ok(audit(files).some(row => row.code === "DATA_EXECUTABLE_CLOSURE_UNRESOLVED"));
});
