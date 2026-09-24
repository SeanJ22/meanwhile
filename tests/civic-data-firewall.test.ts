import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { observableRoutineContracts } from "../lib/civic-data/meeting-partitions.ts";
import {
  MANUAL_PRODUCTION_SOURCE_CONTRACTS,
  type ManualProductionSourceContract,
} from "../lib/civic-data/manual-contracts.ts";
import { civicDataFirewall } from "../lib/civic-data/firewall.ts";

const inventory = {
  census: { datasetFamiliesRepresented: 42, datasetFamiliesTotal: 42 },
  classificationVocabulary: ["RUNTIME_CIVIC_DATA"],
  rows: [{ source_id: "meetings", classification: "RUNTIME_CIVIC_DATA" }],
};
const ROUTINE_SOURCE_CONTRACTS = observableRoutineContracts();

function minimalFiles(): Record<string, string> {
  const files = Object.fromEntries([
    ["package.json", JSON.stringify({ scripts: {
      "votes:fetch": "node scripts/installed-runtime-command.mjs manual-promote --contract=congress-rollcalls",
      "key-votes:positions": "node scripts/installed-runtime-command.mjs manual-promote --contract=federal-key-votes",
      "voting-sites:fetch": "node scripts/installed-runtime-command.mjs manual-promote --contract=voting-sites",
      "prl:fetch": "node scripts/installed-runtime-command.mjs manual-promote --contract=prl",
      "congress:fetch": "node scripts/installed-runtime-command.mjs manual-promote --contract=congress-bulk-roster",
      "registry:promote": "node scripts/installed-runtime-command.mjs manual-promote --contract=registry-runtime-bindings",
      "official-actions:promote": "node scripts/installed-runtime-command.mjs manual-promote --contract=az-official-actions",
      "outcomes:ingest": "node scripts/installed-runtime-command.mjs manual-promote --contract=pima-legistar-outcomes",
      "jurisdictions:promote": "node scripts/installed-runtime-command.mjs manual-promote --contract=jurisdiction-operational-reference",
      "money:az": "node scripts/installed-runtime-command.mjs manual-promote --contract=az-sos-campaign-finance",
      "money:nh": "node scripts/installed-runtime-command.mjs manual-promote --contract=nh-sos-campaign-finance",
      "money:nj": "node scripts/installed-runtime-command.mjs manual-promote --contract=nj-elec-campaign-finance",
      "money:az:pima": "node scripts/installed-runtime-command.mjs manual-promote --contract=az-pima-local-finance",
      "civic-data:promote-manual": "node scripts/installed-runtime-command.mjs manual-promote",
      "window:run": "node scripts/installed-runtime-command.mjs window",
      "agent-bridge:job": "node scripts/installed-runtime-command.mjs agent-bridge-job",
      "agent-bridge:review": "node scripts/installed-runtime-command.mjs agent-bridge-review",
    } })],
    ["scripts/nightly-window.mts", "export const window = true;"],
    ...ROUTINE_SOURCE_CONTRACTS.map((contract) => [contract.acquisitionAdapter.command[0], "export const acquisition = true;"] as const),
    ...MANUAL_PRODUCTION_SOURCE_CONTRACTS.map((contract) => [contract.command[0], "prepareProductionCivicDataWrite(); export const acquisition = true;"] as const),
  ]);
  const federalManualAdapter = 'if (!process.argv.includes("--promote")) throw new Error("promote required"); prepareProductionCivicDataWrite(); processRegisteredManualCandidate();';
  files["scripts/fetch-votes.mts"] = federalManualAdapter;
  files["scripts/fetch-key-vote-positions.mts"] = federalManualAdapter;
  files["scripts/fetch-voting-sites.mts"] = federalManualAdapter;
  files["scripts/fetch-prl.mts"] = federalManualAdapter;
  files["scripts/fetch-congress-legislators.mts"] = federalManualAdapter;
  files["scripts/promote-registry-runtime.mts"] = federalManualAdapter;
  files["scripts/promote-manual-civic-projection.mts"] = "MANUAL_PROMOTION_PACKAGE_MUST_BE_OUTSIDE_REPOSITORY; prepareProductionCivicDataWrite(); processRegisteredManualCandidate();";
  files["scripts/ingest.ts"] = 'input.sourceName === "composite" || input.sourceName === "legistar"; refreshVenueResolutionsFromPromoted(); source.lastPartitionRows; readPreviousMeetingPartition(); readMeetingPartitionProjection(); processRegisteredMeetingPartitionCandidate(); console.log("RCD_MEETING_PARTITION_RECEIPT="); MEETING_PARTITION_EXACTLY_ONE_REQUIRED; MEETING_PARTITION_BATCH_ARGUMENT_RETIRED;';
  files["lib/sources/legistar/client-registry.ts"] = 'function legistarClientsFromWiring(rows = wiringForMeetingSource("legistar")) { return reviewedVenueEntries("legistar", ocdId); }';
  files["lib/sources/legistar-insite/tenant-registry.ts"] = 'function inSiteTenantsFromWiring(rows = wiringForMeetingSource("legistar-insite")) { return reviewedVenueEntries("legistar-insite", ocdId); }';
  files["lib/registry/source-wiring.ts"] = "const TUCSON_CLERKSBOARDS_ROUTES = []; export function meetingSourceNamesForWiring() {} export function wiringForMeetingSource() {}";
  files["lib/civic-data/meeting-partitions.ts"] = "SOURCE_WIRING; meetingSourceNamesForWiring(); export const MEETING_PARTITION_CONTRACTS = [];";
  files["lib/sources/composite/wiring.ts"] = "wiringForMeetingSource(); capability.make(rows);";
  files["lib/meetings/snapshot.ts"] = "MEETING_PARTITION_CONTRACTS; partition.scope; collapseDuplicateSittings(); PRODUCTION_MEETING_SOURCE_MUST_BE_CANONICAL;";
  files["lib/meetings/registry.ts"] = 'if (process.env.NODE_ENV === "production") throw new Error("PRODUCTION_MEETING_SOURCE_MUST_BE_CANONICAL");';
  files["lib/registry/fixtures/official-person-candidacy-links-v1.json"] = JSON.stringify({
    classification: "EXPLICIT_VERSIONED_IDENTITY_INPUT",
    productionAuthority: false,
    rows: [],
  });
  files["lib/corpus/fixtures/statement-identity-first-seed-v1.json"] = JSON.stringify({
    classification: "IMMUTABLE_STATEMENT_IDENTITY_TRANSFER_EVIDENCE",
    productionAuthority: false,
    frozenSource: { path: "lib/funding/official-candidacies.json" },
    rows: [{ holder: { id: "plural:retired" }, candidacy: { candidacyId: "ballot:permanent" } }],
  });
  return files;
}

const audit = (files: Record<string, string>, extra: Partial<Parameters<typeof civicDataFirewall>[0]> = {}) =>
  civicDataFirewall({
    files,
    contracts: ROUTINE_SOURCE_CONTRACTS,
    manualContracts: MANUAL_PRODUCTION_SOURCE_CONTRACTS,
    inventory,
    ...extra,
  });

test("civic-data firewall accepts one release-free adapter and clock per contract", () => {
  assert.deepEqual(audit(minimalFiles()), []);
});

test("package aliases must preserve the exact installed-dispatcher contract mapping", () => {
  const files = minimalFiles();
  const parsed = JSON.parse(files["package.json"]!) as { scripts: Record<string, string> };
  parsed.scripts["votes:fetch"] =
    "node scripts/installed-runtime-command.mjs manual-promote --contract=federal-key-votes";
  parsed.scripts["money:nh"] = "tsx scripts/state-money-nh.mts --promote";
  parsed.scripts["window:run"] =
    "node --env-file=.env.local --experimental-strip-types scripts/nightly-window.mts --shadow";
  parsed.scripts["routine:civic-data"] =
    "node --env-file=.env.local --experimental-strip-types scripts/routine-civic-data-runner.mts";
  files["package.json"] = JSON.stringify(parsed);

  const codes = audit(files).map(({ code }) => code);
  assert.ok(codes.includes("FEDERAL_VOTE_COMMAND_NOT_PROMOTING"));
  assert.ok(codes.includes("MANUAL_PACKAGE_AUTHORITY_BYPASS"));
  assert.ok(codes.includes("RUNTIME_PACKAGE_AUTHORITY_BYPASS"));
  assert.ok(codes.includes("DIRECT_PRODUCTION_CHILD_COMMAND"));
});

test("production executables cannot bypass source-scoped evidence through the generic transition driver", () => {
  const files = minimalFiles();
  files["scripts/renamed-generic-promoter.mts"] = [
    'import { processRoutineCandidate as promoteAnything } from "../lib/civic-data/promotion.ts";',
    "await promoteAnything(store, candidate);",
  ].join("\n");
  assert.deepEqual(
    audit(files)
      .filter(({ code }) => code === "UNREGISTERED_PRODUCTION_PROMOTION_DOOR")
      .map(({ path }) => path),
    ["scripts/renamed-generic-promoter.mts"],
  );
});

test("civic-data firewall refuses the exact scheduled bot-commit architecture", () => {
  const files = minimalFiles();
  files[".github/workflows/refresh-daily.yml"] = "on:\n  schedule:\n    - cron: '11 9 * * *'\npermissions:\n  contents: write\nsteps:\n  - run: pnpm refresh:daily\n";
  const codes = audit(files).map((finding) => finding.code);
  assert.ok(codes.includes("SCHEDULED_ROUTINE_DATA_WORKFLOW"));
  assert.ok(codes.includes("ROUTINE_DATA_CONTENTS_WRITE"));
  assert.ok(codes.includes("LEGACY_EXECUTABLE_PRESENT"));
});

test("a retired data executable cannot survive behind a renamed package command", () => {
  const files = minimalFiles();
  files["package.json"] = JSON.stringify({ scripts: {
    "votes:fetch": "tsx scripts/fetch-votes.mts --promote",
    "key-votes:positions": "tsx scripts/fetch-key-vote-positions.mts --promote",
    "official-actions:promote": "tsx scripts/promote-az-official-actions.mts",
    "outcomes:ingest": "tsx scripts/legistar-outcomes-ingest.mts --promote --slug pima",
    "frozen-meetings-health": "tsx scripts/source-headroom.mts",
    "innocent-looking-name": "tsx scripts/wire-campaign-sites-0823.mts",
  } });
  const findings = audit(files).filter(({ code }) => code === "LEGACY_EXECUTABLE_COMMAND");
  assert.deepEqual(findings.map(({ path, detail }) => ({ path, detail })), [
    {
      path: "package.json",
      detail: "A package command still names retired executable scripts/source-headroom.mts.",
    },
    {
      path: "package.json",
      detail: "A package command still names retired executable scripts/wire-campaign-sites-0823.mts.",
    },
  ]);
});

test("arbitrary-checkout control-plane bootstrap/proof writers cannot return as executable or package doors", () => {
  const files = minimalFiles();
  files["scripts/control-plane-bootstrap.mts"] = "await createPgRepositories(productionUrl);";
  files["scripts/control-plane-proof.mts"] = "await sql.query('TRUNCATE TABLE cp_attempts');";
  files["scripts/control-plane-proof-worker.mts"] = "await repos.attempts.put('proof', attempt, now);";
  files["package.json"] = JSON.stringify({ scripts: {
    "harmless-proof-name": "node --experimental-strip-types scripts/control-plane-proof.mts",
    "harmless-schema-name": "node --experimental-strip-types scripts/control-plane-bootstrap.mts",
  } });

  const findings = audit(files);
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "LEGACY_EXECUTABLE_PRESENT")
      .map(({ path }) => path)
      .sort(),
    [
      "scripts/control-plane-bootstrap.mts",
      "scripts/control-plane-proof-worker.mts",
      "scripts/control-plane-proof.mts",
    ],
  );
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "LEGACY_EXECUTABLE_COMMAND")
      .map(({ path }) => path),
    ["package.json", "package.json"],
  );
});

test("the repaired Git-shipping transition model cannot survive as a callable backup", () => {
  const files = minimalFiles();
  files["lib/control-plane/freshness/authority.ts"] =
    'export const authoritative = "GITHUB_SCHEDULED_WORKFLOW";';
  const findings = audit(files).filter(
    ({ code }) => code === "TRANSITION_ARCHITECTURE_PRESENT",
  );
  assert.deepEqual(findings.map(({ path }) => path), [
    "lib/control-plane/freshness/authority.ts",
  ]);
});

test("deleted schedule-audit and Git-refresh bridge/revert implementations cannot return or hide behind a rename", () => {
  const files = minimalFiles();
  for (const path of [
    "lib/ops/schedule-audit.ts",
    "scripts/schedule-audit.mts",
    "scripts/lib/refresh-revert.ts",
    "lib/control-plane/promotion/promoter.ts",
  ]) {
    files[path] = "export const retiredImplementation = true;";
  }
  files["lib/control-plane/promotion/legacy-refresh.ts"] = "export const retiredBridge = true;";
  files["lib/ops/renamed-schedule-reader.ts"] =
    "export function cronsInWorkflowYaml() {} export function parseDailyCron() {}";
  files["scripts/lib/renamed-refresh-restore.ts"] =
    "export function restoreRefusedChange() {}";

  const findings = audit(files);
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "LEGACY_EXECUTABLE_PRESENT")
      .map(({ path }) => path)
      .sort(),
    [
      "lib/control-plane/promotion/promoter.ts",
      "lib/ops/schedule-audit.ts",
      "scripts/lib/refresh-revert.ts",
      "scripts/schedule-audit.mts",
    ],
  );
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "TRANSITION_ARCHITECTURE_PRESENT")
      .map(({ path }) => path),
    ["lib/control-plane/promotion/legacy-refresh.ts"],
  );
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "RETIRED_SCHEDULE_AUDIT_IMPLEMENTATION")
      .map(({ path }) => path),
    ["lib/ops/renamed-schedule-reader.ts"],
  );
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "RETIRED_REFRESH_BRIDGE_HELPER")
      .map(({ path }) => path),
    ["scripts/lib/renamed-refresh-restore.ts"],
  );
});

test("retired Arizona filing and ACS adapters cannot regain callable tracked-file writers", () => {
  const files = minimalFiles();
  files["lib/sources/az-sos-candidate-filings/index.ts"] =
    'export const CORPUS_PATH = "data/states/az/candidates/az-2026-sos-candidate-filings.json"; export async function upsertCorpus() { const { writeFileSync } = await import("node:fs"); writeFileSync(CORPUS_PATH, "{}"); }';
  files["lib/sources/census-acs-population/index.ts"] =
    'import { writeFileSync } from "node:fs"; export function upsert(rows, scope, path) { writeFileSync(path, "csv"); }';

  assert.deepEqual(
    audit(files)
      .filter(({ code }) => code === "RETIRED_TRACKED_ACQUISITION_WRITER")
      .map(({ path }) => path),
    [
      "lib/sources/az-sos-candidate-filings/index.ts",
      "lib/sources/census-acs-population/index.ts",
    ],
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
    "SCHEDULED_ROUTINE_DATA_WORKFLOW",
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
    "SCHEDULED_ROUTINE_DATA_WORKFLOW",
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

test("reported four-path operational commits stay FULL and their routine writer is forbidden", () => {
  const reportedIncidentPaths = [
    "data/health/job-watch.json",
    "data/ops/refresh-run-log.json",
    "data/ops/workflow-run-index.json",
    "docs/status-ledger.md",
  ];
  // In the superseded classifier, only the generated status view was OPS_ONLY.
  // The three mutable runtime records were proof-bearing, which is why this
  // reported four-path shape classified FULL. PDC removes the writer instead
  // of granting those records a CHEAP exception.
  const historicalOpsOnly = new Set(["docs/status-ledger.md"]);
  assert.deepEqual(reportedIncidentPaths.filter((path) => !historicalOpsOnly.has(path)), reportedIncidentPaths.slice(0, 3));
  assert.equal(
    reportedIncidentPaths.some((path) => !historicalOpsOnly.has(path)),
    true,
    "the superseded allowlist would have classified this incident shape FULL",
  );

  const files = minimalFiles();
  files["scripts/runtime-status-writer.mts"] = [
    "const paths = [",
    "  join(ROOT, 'data', 'health', 'job-watch.json'),",
    "  join(ROOT, 'data', 'ops', 'refresh-run-log.json'),",
    "  join(ROOT, 'data', 'ops', 'workflow-run-index.json'),",
    "  join(ROOT, 'docs', 'status-ledger.md'),",
    "];",
    "for (const path of paths) writeFileSync(path, runtimeState);",
  ].join("\n");
  assert.deepEqual(
    audit(files)
      .filter(({ code }) => code === "TRACKED_RUNTIME_STATE_WRITER")
      .map(({ path }) => path),
    ["scripts/runtime-status-writer.mts"],
  );
});

test("actual 673f1dd job-watch tracker commit shape is blocked at the deleted workflow/writer boundary", () => {
  const actualChangedPaths = [
    "docs/log.md",
    "docs/tracker-opened.json",
    "docs/tracker-working.csv",
    "docs/tracker.md",
    "docs/tracker.xlsx",
  ];
  assert.deepEqual(
    actualChangedPaths.filter((path) => !new Set(["docs/status-ledger.md"]).has(path)),
    actualChangedPaths,
    "the verified 673f1dd paths were 0/5 historical OPS_ONLY and therefore FULL",
  );
  const files = minimalFiles();
  files[".github/workflows/job-watch.yml"] = [
    "name: Job watch",
    "on:",
    "  schedule:",
    "    - cron: '40 15 * * *'",
    "permissions:",
    "  contents: write",
    "steps:",
    `  - run: git add ${actualChangedPaths.join(" ")} && git commit -m job-watch && git push`,
  ].join("\n");
  const codes = audit(files)
    .filter(({ path }) => path === ".github/workflows/job-watch.yml")
    .map(({ code }) => code);
  assert.ok(codes.includes("LEGACY_EXECUTABLE_PRESENT"));
  assert.ok(codes.includes("SCHEDULED_ROUTINE_OPS_WORKFLOW"));
  assert.ok(codes.includes("ROUTINE_OPS_CONTENTS_WRITE"));
  assert.ok(codes.includes("ROUTINE_OPS_GIT_WRITE"));
});

test("freshness/nightly tracked run stores are rejected while historical docs and fixtures remain evidence", () => {
  const files = minimalFiles();
  files["scripts/reopened-freshness-run-writer.mts"] =
    "const RUNS_DIR = join(ROOT, 'data', 'health', 'freshness-shadow-runs'); writeFileSync(join(RUNS_DIR, 'run.json'), value);";
  files["scripts/reopened-nightly-run-writer.mts"] =
    "const RUNS_DIR = join(ROOT, 'data', 'health', 'nightly-window-runs'); appendFileSync(join(RUNS_DIR, 'run.json'), value);";
  files["lib/control-plane/reopened-staging-writer.ts"] =
    "const ROOT = join(repo, 'data', 'control-plane', 'staging'); writeFileSync(join(ROOT, 'manifest.json'), value);";
  files["scripts/reopened-freshness-run-reader.mts"] = [
    'import { readFile as load } from "node:fs/promises";',
    "await load(join(ROOT, 'data', 'health', 'freshness-shadow-runs', 'latest.json'), 'utf8');",
  ].join("\n");
  files["lib/reopened-nightly-run-reader.ts"] = [
    'import * as filesystem from "node:fs";',
    "const openStream = filesystem.createReadStream;",
    "openStream(join(ROOT, 'data', 'health', 'nightly-window-runs', 'latest.json'));",
  ].join("\n");
  files["scripts/reopened-job-watch-reader.cjs"] = [
    'const { readFileSync: load } = re' + 'quire("node:fs");',
    "load('data/health/job-watch.json', 'utf8');",
  ].join("\n");
  files["lib/reopened-freshness-shadow-reader.ts"] = [
    'const filesystem = await import("node:fs/promises");',
    "await filesystem.readFile('data/control-plane/freshness-shadow/latest.json');",
  ].join("\n");
  files["scripts/reopened-staging-reader.mts"] = [
    'const filesystem = await import("node:fs/promises");',
    "const { readFile: load } = filesystem;",
    "await load('data/control-plane/staging/manifest.json');",
  ].join("\n");
  files["app/reopened-method-candidate-reader.ts"] =
    'import candidates from "../data/method/candidates.json" with { type: "json" }; export default candidates;';
  files["lib/reopened-refresh-debt-reader.ts"] =
    'export const debt = import("../data/ops/refresh-debt.json", { with: { type: "json" } });';
  files["scripts/reopened-refresh-log-reader.mts"] = [
    'import filesystem from "node:fs";',
    "filesystem.createReadStream(`${ROOT}/data/ops/refresh-run-log.json`);",
  ].join("\n");
  files["lib/reopened-workflow-index-reader.cjs"] = [
    'const { readFileSync: load } = re' + 'quire("fs");',
    "load(resolve(ROOT, 'data', 'ops', 'workflow-run-index.json'));",
  ].join("\n");
  files["scripts/reopened-maptiler-usage-writer.mts"] =
    "writeFileSync(join(ROOT, 'data', 'ops', 'maptiler-usage.json'), JSON.stringify(liveUsage));";
  files["scripts/reopened-maptiler-usage-reader.mts"] =
    "readFileSync(join(ROOT, 'data', 'ops', 'maptiler-usage.json'), 'utf8');";
  files["scripts/reopened-relaunch-proof-reader.mts"] = [
    'import filesystem from "node:fs";',
    "const promisedFilesystem = filesystem.promises;",
    "const loadBase = promisedFilesystem.readFile;",
    "const load = loadBase;",
    "const dormantCycleA = dormantCycleB; const dormantCycleB = dormantCycleA;",
    "await load(join(ROOT, 'data', 'ops', 'runner-relaunch-proof.json'), 'utf8');",
  ].join("\n");
  files["docs/history/retired-runtime.md"] =
    "Historical example: readFileSync('data/ops/refresh-debt.json') and writeFileSync('data/health/nightly-window-runs/run.json', value).";
  files["tests/fixtures/retired-runtime-writer.ts"] =
    "readFileSync('data/ops/workflow-run-index.json'); writeFileSync('data/health/freshness-shadow-runs/run.json', value);";
  files["lib/read-only-untracked-fixture.ts"] = [
    'import { readFile as load } from "node:fs/promises";',
    "await load('data/civic/current.json');",
    "const note = \"readFileSync('data/ops/refresh-debt.json')\";",
    "const domainRecord = { read() { return note; } }; domainRecord.read();",
  ].join("\n");

  const findings = audit(files).filter(({ code }) => code === "TRACKED_RUNTIME_STATE_WRITER");
  assert.deepEqual(findings.map(({ path }) => path), [
    "lib/control-plane/reopened-staging-writer.ts",
    "scripts/reopened-freshness-run-writer.mts",
    "scripts/reopened-maptiler-usage-writer.mts",
    "scripts/reopened-nightly-run-writer.mts",
  ]);
  assert.deepEqual(
    audit(files)
      .filter(({ code }) => code === "TRACKED_RUNTIME_STATE_READER")
      .map(({ path }) => path)
      .sort(),
    [
      "app/reopened-method-candidate-reader.ts",
      "lib/reopened-freshness-shadow-reader.ts",
      "lib/reopened-nightly-run-reader.ts",
      "lib/reopened-refresh-debt-reader.ts",
      "lib/reopened-workflow-index-reader.cjs",
      "scripts/reopened-freshness-run-reader.mts",
      "scripts/reopened-job-watch-reader.cjs",
      "scripts/reopened-maptiler-usage-reader.mts",
      "scripts/reopened-refresh-log-reader.mts",
      "scripts/reopened-relaunch-proof-reader.mts",
      "scripts/reopened-staging-reader.mts",
    ],
  );
});

test("the immutable standing runtime cannot invoke a tracked tracker or method-candidate writer", () => {
  const files = minimalFiles();
  files["scripts/pilot-runner.mts"] =
    'const children = ["scripts/apply-owner-decisions.mts", "scripts/scout-candidates-rederive.mts"];';
  files["scripts/reopened-method-candidate-writer.mts"] =
    "const path = join(ROOT, 'data', 'method', 'candidates.json'); writeFileSync(path, body);";

  const findings = audit(files);
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "IMMUTABLE_RUNTIME_INVOKES_TRACKED_WRITER")
      .map(({ detail }) => detail),
    [
      "The standing production runtime invokes scripts/apply-owner-decisions.mts, which can dirty its detached checkout and block exact-SHA handoff.",
      "The standing production runtime invokes scripts/scout-candidates-rederive.mts, which can dirty its detached checkout and block exact-SHA handoff.",
    ],
  );
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "TRACKED_RUNTIME_STATE_WRITER")
      .map(({ path }) => path),
    ["scripts/reopened-method-candidate-writer.mts"],
  );
});

test("the standing owner snapshot cannot turn tracked run or sweep outputs into live health", () => {
  const files = minimalFiles();
  files["scripts/publish-owner-snapshot.mts"] = [
    "loadJsonArray(join(ROOT, 'data', 'health', 'reader-questions.json'));",
    "loadJsonArray(join(ROOT, 'data', 'health', 'control-facts.json'));",
    "readFileSync(join(ROOT, 'docs', 'tracker-reconciliation.json'), 'utf8');",
  ].join("\n");
  assert.equal(
    audit(files).some(({ code }) => code === "OWNER_SNAPSHOT_TRACKED_LIVE_INPUT"),
    false,
    "release-pinned acceptance and software-governance inputs are not runtime observations",
  );

  const forbidden = [
    "latestReaderRun(ROOT);",
    "latestControlRun(ROOT);",
    "readFileSync(join(ROOT, 'data', 'health', 'reader-suite-runs', latest), 'utf8');",
    "readFileSync(join(ROOT, 'data', 'health', 'control-set-runs', latest), 'utf8');",
    "readFileSync(join(ROOT, 'data', 'feedback', 'sweeps', latest), 'utf8');",
  ];
  for (const source of forbidden) {
    files["scripts/publish-owner-snapshot.mts"] = source;
    assert.deepEqual(
      audit(files)
        .filter(({ code }) => code === "OWNER_SNAPSHOT_TRACKED_LIVE_INPUT")
        .map(({ path }) => path),
      ["scripts/publish-owner-snapshot.mts"],
      source,
    );
  }
});

test("standing Scout ordering and health cannot consume tracked Reader certification state", () => {
  const files = minimalFiles();
  files["scripts/freshness-shadow.mts"] = [
    "const currentImpact = obligation.readerImpactAt;",
    "const orderingInputs = { pilotZips: PILOT_ZIPS };",
  ].join("\n");
  assert.equal(
    audit(files).some(({ code }) => code === "STANDING_RUNTIME_TRACKED_SOFTWARE_HEALTH_INPUT"),
    false,
    "canonical obligation impact and release-pinned pilot configuration are valid standing inputs",
  );

  const forbidden = [
    "latestReaderRun(ROOT);",
    "openRedReaderQuestions();",
    "readFileSync(join(ROOT, 'data', 'health', 'reader-suite-runs', latest), 'utf8');",
    "readFileSync(join(ROOT, 'data', 'health', 'reader-questions.json'), 'utf8');",
    "const orderingInputs = { openRedQuestionZips, openRedQuestions, readerSuiteRun };",
  ];
  for (const source of forbidden) {
    files["scripts/freshness-shadow.mts"] = source;
    assert.deepEqual(
      audit(files)
        .filter(({ code }) => code === "STANDING_RUNTIME_TRACKED_SOFTWARE_HEALTH_INPUT")
        .map(({ path }) => path),
      ["scripts/freshness-shadow.mts"],
      source,
    );
  }
});

test("civic-data firewall refuses release calls, repository writers, duplicate authority, and unclassified rows", () => {
  const files = minimalFiles();
  const command = ROUTINE_SOURCE_CONTRACTS[0]!.acquisitionAdapter.command[0];
  files[command] = "writeFileSync('data/civic.json', '{}'); spawnSync('git', ['push']);";
  const duplicate = { ...ROUTINE_SOURCE_CONTRACTS[0]!, id: "duplicate" };
  const badInventory = { ...inventory, rows: [{ source_id: "x", classification: "UNKNOWN" }] };
  const codes = audit(files, { contracts: [...ROUTINE_SOURCE_CONTRACTS, duplicate], inventory: badInventory }).map((finding) => finding.code);
  assert.ok(codes.includes("ROUTINE_PATH_INVOKES_RELEASE"));
  assert.ok(codes.includes("ROUTINE_PATH_WRITES_REPOSITORY"));
  assert.ok(codes.includes("MULTIPLE_AUTHORITATIVE_WRITERS"));
  assert.ok(codes.includes("MULTIPLE_ROUTINE_MEMBERSHIPS"));
  assert.ok(codes.includes("UNCLASSIFIED_EXTERNAL_DATA"));
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
    'import "./lib/promotion-writer.ts"; prepareProductionCivicDataWrite(); processRegisteredManualCandidate();';
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
    ].sort((a, b) => a.path.localeCompare(b.path)),
  );
  assert.equal(
    findings.some(({ path }) =>
      path === "tests/fixtures/permitted-writer.ts" || path === "scripts/lib/read-only-filesystem.ts"),
    false,
    "an unimported test fixture and an imported read-only helper are not production repository writers",
  );
});

test("civic-data firewall refuses every retired Plural/OpenStates production door", () => {
  const files = minimalFiles();
  files["package.json"] = JSON.stringify({ scripts: { "b14:links": "tsx scripts/b14-official-links.mts" } });
  files["scripts/build-officeholders.ts"] = 'import { fetchAll } from "../lib/sources/plural/index.ts";';
  files["scripts/enrich-federal-officeholders.mts"] = 'writeFileSync(rosterPath(`officeholders-${fips}.json`), value);';
  files["scripts/reader-finance-identity.mts"] = 'globSync("data/states/*/officials/officeholders-??.json")';
  files["data/ballot/candidate-links-2026.json"] = JSON.stringify({
    links: { x: { official: { verification: "Joined from Plural Open States" }, campaign: null } },
    hunts: [{ note: "MISS — B14 official-page rung" }],
  });
  files["lib/funding/official-person-candidacy-links.json"] = JSON.stringify({ rows: [{ officialId: "plural:retired" }] });
  files["lib/funding/official-candidacies.json"] = JSON.stringify({
    rows: [{ holder: { id: "plural:retired", sourcePath: "data/states/az/officials/officeholders-04.json" } }],
  });
  files["lib/photos/person.ts"] = "for (const row of generated.photos) best.set(row.name, row);";
  files["lib/registry/server.ts"] = "for (const photo of manifest.photos) photos.set(photo.officeholderId, photo.url);";
  files["lib/officials/campaign-sites.ts"] = "export const campaignSiteFor = (officeholderId) => CAMPAIGN_SITES[officeholderId];";
  files["lib/corpus/unified.ts"] = "const fromStatements = statements().snapshots;";

  const findings = audit(files);
  assert.ok(findings.some(({ code }) => code === "LEGACY_INTERMEDIARY_COMMAND"));
  assert.equal(findings.filter(({ code }) => code === "RETIRED_INTERMEDIARY_WRITER").length, 3);
  assert.equal(findings.filter(({ code }) => code === "RETIRED_INTERMEDIARY_READER_ARTIFACT").length, 2);
  assert.ok(findings.some(({ code, path }) => code === "TRACKED_OFFICIAL_CANDIDACY_AUTHORITY" && path === "lib/funding/official-person-candidacy-links.json"));
  assert.equal(findings.filter(({ code }) => code === "RETIRED_INTERMEDIARY_READER").length, 4);
});

test("civic-data firewall refuses every retired federal-vote Git writer or Reader door", () => {
  const files = minimalFiles();
  files["package.json"] = JSON.stringify({ scripts: {
    "votes:fetch": "tsx scripts/fetch-votes.mts --promote",
    "key-votes:positions": "tsx scripts/fetch-key-vote-positions.mts --promote",
    "law-votes:fetch": "tsx scripts/fetch-law-votes.mts",
  } });
  files["scripts/fetch-law-votes.mts"] = "writeFileSync('data/votes/key-votes-snapshot.json', payload);";
  files["lib/ask/returned-tracked-votes.ts"] = "readFileSync('data/votes/votes-snapshot.json', 'utf8');";
  files["lib/votes/snapshot.ts"] = "readFileSync('data/votes/votes-snapshot.json', 'utf8');";
  files["lib/votes/key-votes-projection.ts"] = "readFileSync('data/votes/key-votes-snapshot.json', 'utf8');";
  const codes = audit(files).map((finding) => finding.code);
  assert.ok(codes.includes("LEGACY_EXECUTABLE_PRESENT"));
  assert.ok(codes.includes("LEGACY_FEDERAL_VOTE_WRITER_COMMAND"));
  assert.ok(codes.includes("FEDERAL_VOTE_TRACKED_RUNTIME_READER"));
  assert.equal(codes.filter((code) => code === "FEDERAL_VOTE_FIRST_SEED_GATE_MISSING").length, 2);
});

test("civic-data firewall requires both surviving federal-vote commands to promote", () => {
  const files = minimalFiles();
  const parsed = JSON.parse(files["package.json"]!) as { scripts: Record<string, string> };
  parsed.scripts["votes:fetch"] = "tsx scripts/fetch-votes.mts";
  files["package.json"] = JSON.stringify(parsed);
  const findings = audit(files).filter(({ code }) => code === "FEDERAL_VOTE_COMMAND_NOT_PROMOTING");
  assert.deepEqual(findings.map(({ detail }) => detail), ["votes:fetch must enter exact installed-runtime contract congress-rollcalls."]);
});

test("voting-sites and PRL tracked seeds cannot become production Readers", () => {
  const files = minimalFiles();
  files["lib/ask/reopened-voting-sites.ts"] = "readFileSync('data/voting-sites.json', 'utf8');";
  files["lib/ask/reopened-prl.ts"] = "readFileSync('data/prl/prl-profiles.json', 'utf8');";
  files["lib/ballot/voting-sites-server.ts"] = "readFileSync('data/voting-sites.json', 'utf8');";
  files["lib/sources/prl/snapshot.ts"] = "readFileSync('data/prl/prl-profiles.json', 'utf8');";

  const findings = audit(files);
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "VOTING_PRL_TRACKED_RUNTIME_READER")
      .map(({ path }) => path),
    ["lib/ask/reopened-prl.ts", "lib/ask/reopened-voting-sites.ts"],
  );
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "VOTING_PRL_PRODUCTION_GATE_MISSING")
      .map(({ path }) => path),
    ["lib/ballot/voting-sites-server.ts", "lib/sources/prl/snapshot.ts"],
  );
});

test("voting-sites and PRL commands and adapters remain promotion-only", () => {
  const files = minimalFiles();
  const parsed = JSON.parse(files["package.json"]!) as { scripts: Record<string, string> };
  parsed.scripts["voting-sites:fetch"] = "tsx scripts/fetch-voting-sites.mts";
  files["package.json"] = JSON.stringify(parsed);
  files["scripts/fetch-voting-sites.mts"] = "downloadAndWriteTrackedFile();";
  files["scripts/fetch-prl.mts"] = "downloadAndWriteTrackedFile();";

  const findings = audit(files);
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "VOTING_PRL_COMMAND_NOT_PROMOTING")
      .map(({ detail }) => detail),
    ["voting-sites:fetch must enter exact installed-runtime contract voting-sites."],
  );
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "VOTING_PRL_MANUAL_PROMOTION_GATE_MISSING")
      .map(({ path }) => path),
    ["scripts/fetch-prl.mts", "scripts/fetch-voting-sites.mts"],
  );
});

test("official actions and meeting outcomes cannot reopen tracked runtime authority", () => {
  const files = minimalFiles();
  files["package.json"] = JSON.stringify({ scripts: {
    "votes:fetch": "tsx scripts/fetch-votes.mts --promote",
    "key-votes:positions": "tsx scripts/fetch-key-vote-positions.mts --promote",
    "official-actions:promote": "tsx scripts/promote-az-official-actions.mts",
    "outcomes:ingest": "tsx scripts/legistar-outcomes-ingest.mts --promote --slug pima",
    "hunt:azleg-store": "tsx scripts/hunt-azleg-build-store.mts",
  } });
  files["scripts/hunt-azleg-build-store.mts"] = "writeFileSync('data/states/az/officials/az-governor-actions.json', value);";
  files["lib/ask/reopened-action-file.ts"] = "readFileSync('data/states/az/officials/az-governor-actions.json', 'utf8');";
  files["lib/ask/reopened-outcome-file.ts"] = "readFileSync('data/states/az/outcomes/legistar-outcomes.json', 'utf8');";
  const codes = audit(files).map((finding) => finding.code);
  assert.ok(codes.includes("LEGACY_EXECUTABLE_PRESENT"));
  assert.ok(codes.includes("LEGACY_OFFICIAL_ACTION_WRITER_COMMAND"));
  assert.deepEqual(
    audit(files)
      .filter(({ code }) => code === "ACTION_OUTCOME_TRACKED_RUNTIME_READER")
      .map(({ path }) => path),
    [
      "lib/ask/reopened-action-file.ts",
      "lib/ask/reopened-outcome-file.ts",
      "scripts/hunt-azleg-build-store.mts",
    ],
  );
});

test("candidate research holdings and statement history cannot regain production authority", () => {
  const files = minimalFiles();
  files["package.json"] = JSON.stringify({ scripts: {
    "votes:fetch": "tsx scripts/fetch-votes.mts --promote",
    "key-votes:positions": "tsx scripts/fetch-key-vote-positions.mts --promote",
    "official-actions:promote": "tsx scripts/promote-az-official-actions.mts",
    "outcomes:ingest": "tsx scripts/legistar-outcomes-ingest.mts --promote --slug pima",
    "candidates:universe": "tsx scripts/candidate-universe.mts",
    "corpus:fetch": "tsx scripts/fetch-corpus.mts",
  } });
  files["scripts/candidate-universe.mts"] = "writeFileSync('data/states/az/hunt/az-candidate-universe-2026.json', value);";
  files["scripts/fetch-corpus.mts"] = "writeFileSync('data/corpus/statements.json', value);";
  files["lib/control-plane/scheduler/providers/candidate-enrichment.ts"] = "readAzBallotProjection(); readFileSync('data/states/az/hunt/az-candidate-universe-2026.json');";
  files["lib/corpus/unified.ts"] = "currentOfficeholderStatements(); readFileSync('data/corpus/statements.json');";
  files["lib/ask/reopened-statement-identity.ts"] = "readFileSync('lib/corpus/fixtures/statement-identity-first-seed-v1.json');";
  files["lib/corpus/fixtures/statement-identity-first-seed-v1.json"] = JSON.stringify({
    classification: "IMMUTABLE_STATEMENT_IDENTITY_TRANSFER_EVIDENCE",
    productionAuthority: true,
    frozenSource: { path: "lib/funding/official-candidacies.json" },
    rows: [{ candidacy: { candidacyId: "plural:retired" } }],
  });
  files["lib/corpus/data-plane.ts"] = "readPromotedOrBootstrap({ bootstrap });";

  const codes = audit(files).map(({ code }) => code);
  assert.ok(codes.includes("LEGACY_MANUAL_PROJECTION_WRITER_COMMAND"));
  assert.equal(codes.filter((code) => code === "LEGACY_EXECUTABLE_PRESENT").length, 2);
  assert.ok(codes.includes("TRACKED_CANDIDATE_UNIVERSE_AUTHORITY"));
  assert.ok(codes.includes("PROMOTED_CANDIDATE_DENOMINATOR_GATE_MISSING"));
  assert.ok(codes.includes("OFFICEHOLDER_STATEMENT_TRACKED_RUNTIME_READER"));
  assert.ok(codes.includes("OFFICEHOLDER_STATEMENT_PRODUCTION_GATE_MISSING"));
  assert.ok(codes.includes("STATEMENT_IDENTITY_FIRST_SEED_AUTHORITY_INVALID"));
});

test("federal directory and registry runtime truth cannot return to tracked readers or writers", () => {
  const files = minimalFiles();
  files["lib/ask/reopened-registry.ts"] = "readFileSync('lib/registry/registry.json', 'utf8');";
  files["lib/ask/reopened-federal-roster.ts"] = "readFileSync('lib/registry/officeholders-us.json', 'utf8');";
  files["lib/funding/official-candidacies.json"] = '{"rows":[]}';
  files["lib/funding/official-person-candidacy-links.json"] = '{"rows":[]}';
  files["lib/registry/fixtures/official-person-candidacy-links-v1.json"] = '{"productionAuthority":true,"rows":[]}';
  files["lib/funding/campaign-money.ts"] = "import bridge from './official-candidacies.json';";
  files["lib/officials/federal-directory-read-model.ts"] = "export const read = () => readFileSync('directory.json');";
  files["lib/registry/runtime-read-model.ts"] = "export const read = () => readFileSync('registry.json');";
  files["scripts/fetch-congress-legislators.mts"] = "writeFileSync('lib/registry/officeholders-us.json', value);";
  files["scripts/promote-registry-runtime.mts"] = "writeFileSync('lib/registry/registry.json', value);";
  files["package.json"] = JSON.stringify({ scripts: {
    "congress:fetch": "tsx scripts/fetch-congress-legislators.mts",
    "registry:promote": "tsx scripts/promote-registry-runtime.mts",
  } });

  const codes = audit(files).map(({ code }) => code);
  assert.equal(codes.filter((code) => code === "REGISTRY_RUNTIME_TRACKED_READER").length, 2);
  assert.equal(codes.filter((code) => code === "REGISTRY_RUNTIME_FIRST_SEED_GATE_MISSING").length, 2);
  assert.equal(codes.filter((code) => code === "REGISTRY_RUNTIME_COMMAND_NOT_PROMOTING").length, 2);
  assert.equal(codes.filter((code) => code === "REGISTRY_RUNTIME_MANUAL_PROMOTION_GATE_MISSING").length, 2);
  assert.ok(codes.includes("TRACKED_OFFICIAL_CANDIDACY_AUTHORITY"));
  assert.ok(codes.includes("REGISTRY_IDENTITY_FIXTURE_AUTHORITY_INVALID"));
  assert.ok(codes.includes("REGISTRY_RUNTIME_FINANCE_BRIDGE_GATE_MISSING"));
});

test("registry seed recognition requires an actual import or filesystem read", () => {
  const files = minimalFiles();
  const proofPath = "lib/holdings/registry-seed-proof.ts";
  files[proofPath] = readFileSync(new URL(`../${proofPath}`, import.meta.url), "utf8");
  files["lib/ask/documented-seed.ts"] = 'import { createHash } from "node:crypto"; const path = "lib/registry/registry.json"; export const digest = createHash("sha256");';
  files["lib/ask/unrelated-seed.ts"] = 'readFileSync("lib/registry/unrelated-registry.json", "utf8");';
  files["lib/ask/unrelated-import.ts"] = 'const path = "lib/registry/registry.json"; const crypto = await import("node:crypto"); const note = "import(path)";';
  for (const path of ["lib/ask/server-sources.ts", "lib/tracker/registry.mjs"]) {
    files[path] = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  }
  assert.deepEqual(audit(files).filter(({ code }) => code === "REGISTRY_RUNTIME_TRACKED_READER"), []);

  // Keep forbidden loader calls in fixture data without making this ESM test
  // itself contain the raw CommonJS call token scanned by R46.
  const commonJsLoader = "require";
  const readers = [
    'import held from "../registry/registry.json" with { type: "json" };',
    'import held from "../registry/registry.json?raw";',
    'export { default } from "../registry/registry.json#held";',
    'export { default } from "../registry/registry.json";',
    'import "../registry/registry.json";',
    'const held = await import("../registry/registry.json");',
    'const held = await import(`../registry/registry.json`);',
    'const held = await import("../registry/registry.json?raw#held");',
    'const path = "../registry/registry.json"; const alias = path; const held = await import(alias);',
    `const held = ${commonJsLoader}("../registry/registry.json");`,
    `const held = ${commonJsLoader}(\`../registry/registry.json\`);`,
    `const path = "../registry/registry.json"; const held = ${commonJsLoader}(path);`,
    'readFileSync("lib/registry/registry.json", "utf8");',
    'import { readFile as load } from "node:fs/promises"; const path = "lib/registry/registry.json"; await load(path, "utf8");',
    'import * as fs from "node:fs"; const path = "lib/registry/registry.json"; fs.readFileSync(path);',
    `const { readFileSync: load } = ${commonJsLoader}("node:fs"); load("lib/registry/registry.json");`,
    'const path = "lib/registry/registry.json"; const alias = path; readFileSync(alias);',
    'readFileSync(join(ROOT, "lib", "registry", "registry.json"));',
  ];
  for (const source of readers) {
    files["lib/ask/reopened-registry.ts"] = source;
    assert.deepEqual(audit(files).filter(({ code }) => code === "REGISTRY_RUNTIME_TRACKED_READER").map(({ path }) => path), ["lib/ask/reopened-registry.ts"], source);
  }
});

test("comment access gate accepts mapped canonical records and rejects seed fallbacks", () => {
  const files = minimalFiles();
  const path = "lib/registry/comment-access.ts";
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  files[path] = source;
  const findings = () => audit(files).filter((finding) => finding.path === path && finding.code === "CURATED_READER_PRODUCTION_GATE_MISSING");
  assert.deepEqual(findings(), []);
  for (const replacement of [
    source.replace('currentCuratedReaderRecords("comment-access", seed)', "seed"),
    source.replace('currentCuratedReaderRecords("comment-access", seed)', "COMMENT_ACCESS"),
    source.replace("const seed = COMMENT_ACCESS.map", "const seed = UNRELATED.map"),
    source.replace("records = [];", "records = COMMENT_ACCESS;"),
  ]) {
    assert.notEqual(replacement, source);
    files[path] = replacement;
    assert.equal(findings().length, 1);
  }
});

test("mutable curated Reader facts cannot reopen tracked fallbacks or Git writers", () => {
  const files = minimalFiles();
  files["lib/ask/reopened-comment-access.ts"] = "return COMMENT_ACCESS;";
  files["components/reopened-ballot-navigation.tsx"] = "return [...POLLING_PLACE_LINKS, ...REGISTRATION_LINKS];";
  files["lib/officials/reopened-campaign-sites.ts"] = "return CAMPAIGN_SITES[id];";
  files["scripts/rewrite-curated-reader.mts"] = "writeFileSync('lib/registry/comment-access.ts', source);";
  files["lib/civic-data/curated-reader-read-model.ts"] = "return trackedSeed;";
  files["lib/registry/comment-access.ts"] = "export const COMMENT_ACCESS = [];";
  files["scripts/promote-manual-civic-projection.mts"] = "writeFileSync('lib/officials/campaign-sites.ts', payload);";

  const findings = audit(files);
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "CURATED_READER_TRACKED_RUNTIME_READER")
      .map(({ path }) => path),
    [
      "components/reopened-ballot-navigation.tsx",
      "lib/ask/reopened-comment-access.ts",
      "lib/officials/reopened-campaign-sites.ts",
    ],
  );
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "CURATED_READER_TRACKED_WRITER")
      .map(({ path }) => path),
    ["scripts/promote-manual-civic-projection.mts", "scripts/rewrite-curated-reader.mts"],
  );
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "CURATED_READER_PRODUCTION_GATE_MISSING")
      .map(({ path }) => path),
    ["lib/civic-data/curated-reader-read-model.ts", "lib/registry/comment-access.ts"],
  );
  assert.equal(
    findings.filter(({ code }) => code === "CURATED_READER_PROMOTION_GATE_MISSING").length,
    1,
  );
});

test("Legistar adapters cannot reopen frozen tracked venue registries", () => {
  const files = minimalFiles();
  files["lib/sources/legistar/client-registry.ts"] =
    'import held from "../../../data/states/az/meetings/legistar-venues.json" with { type: "json" }; export const clients = held.records;';
  files["lib/sources/legistar-insite/tenant-registry.ts"] =
    'import held from "../../../data/states/az/meetings/insite-venues.json" with { type: "json" }; export const tenants = held.records;';
  files["scripts/ingest.ts"] = 'if (name === "composite") refreshVenueResolutionsFromPromoted();';

  const findings = audit(files);
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "CURATED_READER_TRACKED_VENUE_AUTHORITY")
      .map(({ path }) => path),
    [
      "lib/sources/legistar-insite/tenant-registry.ts",
      "lib/sources/legistar/client-registry.ts",
    ],
  );
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "CURATED_READER_PRODUCTION_GATE_MISSING")
      .map(({ path }) => path),
    [
      "lib/sources/legistar-insite/tenant-registry.ts",
      "lib/sources/legistar/client-registry.ts",
      "scripts/ingest.ts",
    ],
  );
});

test("meetings cannot regain an aggregate pointer, receipt, or hidden membership denominator", () => {
  const files = minimalFiles();
  files["scripts/ingest.ts"] = [
    'name === "composite" || name === "legistar";',
    "refreshVenueResolutionsFromPromoted();",
    'const scope = "supported-bodies";',
    'console.log("RCD_RECEIPT=");',
    "const exit = EXIT_WRITTEN_WITH_JOB_FAILURES;",
  ].join("\n");
  files["lib/sources/legistar/client-registry.ts"] =
    'const LEGISTAR_CLIENTS = [{ slug: "pima" }]; reviewedVenueEntries("legistar", ocdId);';
  files["lib/registry/source-wiring.ts"] =
    'import { TUCSON_CLERKSBOARDS } from "./curated-bodies.ts"; function meetingSourceNamesForWiring() {} function wiringForMeetingSource() {} const TUCSON_CLERKSBOARDS_ROUTES = [];';

  const findings = audit(files);
  assert.equal(
    findings.filter(({ code }) => code === "LEGACY_MEETING_AGGREGATE_AUTHORITY").length,
    1,
  );
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "MEETING_PARTITION_AUTHORITY_GATE_MISSING")
      .map(({ path }) => path),
    ["lib/sources/legistar/client-registry.ts", "scripts/ingest.ts"],
  );
  assert.equal(
    findings.filter(({ code }) => code === "MEETING_HIDDEN_MEMBERSHIP_REGISTRY").length,
    1,
  );
});

test("terminal PDC guard refuses every exact one-time trusted-LKG path and package door", () => {
  const files = minimalFiles();
  for (const path of [
    "scripts/pdc-v2-trusted-lkg-import.mts",
    "lib/civic-data/trusted-lkg-import-plan.ts",
    "tests/pdc-v2-trusted-lkg-importer.test.ts",
    "tests/trusted-lkg-reattestation.test.ts",
    "scripts/routine-civic-data-live-acceptance.mts",
    "scripts/routine-civic-data-live-canary-child.mts",
    "scripts/routine-civic-data-live-supervisor-proof.mts",
    "lib/civic-data/live-acceptance.ts",
    "tests/routine-civic-data-live-acceptance.test.ts",
  ]) files[path] = "export const cutoverOnly = true;";
  const packageJson = JSON.parse(files["package.json"]!) as { scripts: Record<string, string> };
  packageJson.scripts["renamed-one-time-seed"] =
    "node --experimental-strip-types scripts/pdc-v2-trusted-lkg-import.mts --promote";
  packageJson.scripts["renamed-live-canary"] =
    "node --experimental-strip-types scripts/routine-civic-data-live-acceptance.mts";
  files["package.json"] = JSON.stringify(packageJson);

  const findings = audit(files);
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "TEMPORARY_TRUSTED_LKG_PATH_PRESENT")
      .map(({ path }) => path)
      .sort(),
    [
      "lib/civic-data/live-acceptance.ts",
      "lib/civic-data/trusted-lkg-import-plan.ts",
      "scripts/pdc-v2-trusted-lkg-import.mts",
      "scripts/routine-civic-data-live-acceptance.mts",
      "scripts/routine-civic-data-live-canary-child.mts",
      "scripts/routine-civic-data-live-supervisor-proof.mts",
      "tests/pdc-v2-trusted-lkg-importer.test.ts",
      "tests/routine-civic-data-live-acceptance.test.ts",
      "tests/trusted-lkg-reattestation.test.ts",
    ],
  );
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "TRUSTED_LKG_BOOTSTRAP_PACKAGE_COMMAND")
      .map(({ path }) => path),
    ["package.json"],
  );
  assert.deepEqual(
    findings
      .filter(({ code }) => code === "TEMPORARY_PDC_PACKAGE_COMMAND")
      .map(({ path }) => path),
    ["package.json", "package.json"],
  );
});

test("terminal PDC guard follows renamed bootstrap capability, mint, bypass, store, promotion, plan, and test admissions", () => {
  const files = minimalFiles();
  files["lib/runtime/renamed-capability.ts"] =
    'export const RUNTIME_AUTHORITY_CAPABILITIES = ["ROUTINE_CONTRACT", "TRUSTED_LKG_IMPORT"] as const;';
  files["scripts/renamed-mint.mts"] =
    'export const env = { [RUNTIME_AUTHORITY_ENV.capability]: "TRUSTED_LKG_IMPORT" };';
  files["lib/runtime/renamed-bypass.ts"] =
    'export function admit(envelope) { if (envelope.capability === "TRUSTED_LKG_IMPORT") return; refuse(); }';
  files["lib/store/renamed-import-admission.ts"] =
    'export const admitted = authority.capability === "TRUSTED_LKG_IMPORT" ? isTrustedLkgImportCandidate(candidate) : false;';
  files["lib/promotion/renamed-import-door.ts"] =
    'const TRUSTED_LKG_REGISTERED_DOOR = Symbol("renamed"); export { TRUSTED_LKG_REGISTERED_DOOR };';
  files["scripts/renamed-transfer-plan.mts"] =
    "await executePdcV2PermanentCutoverImportPlan(store, plan);";
  files["tests/renamed-bootstrap-admission.test.ts"] = [
    "await processRegisteredManualCandidate(store, contractId, candidate);",
    'const evidence = { kind: "TRUSTED_LKG_IMPORT" };',
  ].join("\n");

  const findings = audit(files);
  const paths = (code: string) => findings.filter((finding) => finding.code === code).map(({ path }) => path);
  assert.deepEqual(paths("TRUSTED_LKG_RUNTIME_CAPABILITY_PRESENT"), ["lib/runtime/renamed-capability.ts"]);
  assert.deepEqual(paths("TRUSTED_LKG_CAPABILITY_MINT_PRESENT"), ["scripts/renamed-mint.mts"]);
  assert.deepEqual(paths("TRUSTED_LKG_AUTHORITY_BYPASS_PRESENT"), ["lib/runtime/renamed-bypass.ts"]);
  assert.deepEqual(paths("TRUSTED_LKG_STORE_ADMISSION_PRESENT"), ["lib/store/renamed-import-admission.ts"]);
  assert.deepEqual(paths("TRUSTED_LKG_PROMOTION_ADMISSION_PRESENT"), ["lib/promotion/renamed-import-door.ts"]);
  assert.deepEqual(paths("TRUSTED_LKG_BOOTSTRAP_PLAN_CALLABLE"), ["scripts/renamed-transfer-plan.mts"]);
  assert.deepEqual(paths("TRUSTED_LKG_BOOTSTRAP_TEST_ADMISSION"), ["tests/renamed-bootstrap-admission.test.ts"]);
});

test("terminal PDC guard preserves historical trusted-LKG receipt validation and Admin interpretation", () => {
  const files = minimalFiles();
  files["lib/civic-data/types.ts"] =
    'export interface HistoricalEvidence { readonly kind: "TRUSTED_LKG_IMPORT"; readonly importerCodeSha: string; }';
  files["lib/civic-data/observability.ts"] =
    'export const authorityOrigin = (candidate) => candidate.bootstrapImport?.kind === "TRUSTED_LKG_IMPORT" ? "TRUSTED_LKG_IMPORT" : "LIVE_SOURCE_ACQUISITION";';
  files["lib/civic-data/historical-import-proof.ts"] =
    'export const validateHistoricalReceipt = (row) => row.bootstrapImport?.kind === "TRUSTED_LKG_IMPORT" && row.bootstrapImport.importerCodeSha.length === 40;';
  files["tests/historical-trusted-lkg-receipt.test.ts"] =
    'assert.equal(authorityOrigin({ bootstrapImport: { kind: "TRUSTED_LKG_IMPORT" } }), "TRUSTED_LKG_IMPORT");';

  assert.deepEqual(
    audit(files).filter(({ code }) =>
      code === "TEMPORARY_TRUSTED_LKG_PATH_PRESENT" ||
      code.startsWith("TRUSTED_LKG_BOOTSTRAP_") ||
      code.startsWith("TRUSTED_LKG_RUNTIME_") ||
      code.startsWith("TRUSTED_LKG_CAPABILITY_") ||
      code.startsWith("TRUSTED_LKG_AUTHORITY_") ||
      code.startsWith("TRUSTED_LKG_STORE_") ||
      code.startsWith("TRUSTED_LKG_PROMOTION_")),
    [],
  );
});
