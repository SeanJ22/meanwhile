import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import nodeModule from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { observeNativeBody } from "../scripts/rh01-native-body.mjs";
import { measuredCompletion } from "../scripts/rh01-completion.mts";
import { COMPLETION_EVIDENCE_BYTES, readCompletionLogEvidence } from "../scripts/rh01-completion-evidence.mts";
import { federalPeopleCountClean, federalPeopleCountLine, federalPeopleSplitLine } from "../lib/civic-data/federal-people-split.ts";

const stripTypeScriptTypes = (source: string): string => {
  const strip = Reflect.get(nodeModule, "stripTypeScriptTypes");
  if (typeof strip !== "function") throw Error("The native CLI fixture requires Node's runtime TypeScript stripping API");
  return Reflect.apply(strip, nodeModule, [source]) as string;
};

test("the subprocess boundary preserves native execFile promisification and guards its custom entry point", async () => {
  const moduleUrl = new URL("../scripts/rh01-network.mjs", import.meta.url).href;
  const source = `import assert from 'node:assert/strict';import{promisify}from'node:util';
    import child,{execFile}from'node:child_process';
    import{installMeasurementNetworkBoundary}from${JSON.stringify(moduleUrl)};
    installMeasurementNetworkBoundary();
    const run=promisify(execFile);
    const pending=run(process.execPath,['-e',"process.stdout.write('Málaga');process.stderr.write('warning')"]);
    assert.ok(pending.child instanceof child.ChildProcess);assert.ok(pending.child.pid);
    assert.deepEqual(await pending,{stdout:'Málaga',stderr:'warning'});
    await new Promise((resolve,reject)=>execFile(process.execPath,['-e',"process.stdout.write('callback')"],(error,stdout,stderr)=>{
      if(error)return reject(error);assert.equal(stdout,'callback');assert.equal(stderr,'');resolve();}));
    const failed=run(process.execPath,['-e',"process.stdout.write('partial');process.stderr.write('failure');process.exitCode=7"]);
    assert.ok(failed.child instanceof child.ChildProcess);
    await assert.rejects(failed,error=>error.code===7&&error.stdout==='partial'&&error.stderr==='failure');
    for(const [file,args]of[['git',['push']],['gh',['pr','create']],['curl',['-X','POST','https://example.com']],['bash',['-c','true']]]){
      assert.throws(()=>run(file,args),/RH01_REMOTE_COMMAND_BLOCKED/);
      assert.throws(()=>execFile(file,args,()=>{}),/RH01_REMOTE_COMMAND_BLOCKED/);
    }
    console.log('native-promisify-guarded');`;
  const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
  const [code] = await once(child, "close");
  assert.equal(code, 0, stderr + stdout); assert.match(stdout, /native-promisify-guarded/);
});

async function nativeCli(script: string, bindings: Record<string, unknown>): Promise<void> {
  const url = new URL(`../scripts/${script}`, import.meta.url);
  const observed = observeNativeBody(script, await readFile(url, "utf8"));
  const executable = stripTypeScriptTypes(observed.replace(/^import\s[\s\S]*?;\r?\n/gm, "")
    .replace(/^export (?=async function)/gm, "").replaceAll("import.meta.url", JSON.stringify(url.href)));
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction(...Object.keys(bindings), executable)(...Object.values(bindings));
}

const completion = (script: string, stdout: string, override: { code?: number | null; timedOut?: boolean; stderr?: string } = {}) =>
  measuredCompletion({ script, stdout, stderr: "", code: 0, timedOut: false, ...override });

async function censusFixture(mode: "work" | "not-due" | "paused" | "drain" | "write-failed") {
  const lines: string[] = [], events: string[] = [], env = { onDrain: () => {} };
  const report = (state: string) => ({ state, checked: 1, walked: 1, unchanged: 0, notDue: 0, failures: [] });
  const repos = { researchIntents: { read: async () => ({}) }, doors: { read: async (id: string) => ({ value: { state: id } }) },
    fieldManual: { readNarrowed: async () => null } };
  let failure: unknown;
  try {
    await nativeCli("platform-census-runner.mts", {
      process: { env: {}, cwd: () => "/fixture", on: (_event: string, listener: (value: unknown) => void) => { env.onDrain = () => listener({ kind: "RUNTIME_RELEASE_DRAIN" }); } },
      console: { log: (line: string) => { lines.push(line); events.push(line); }, error: (line: string) => { throw Error(line); } },
      join, controlPlaneUrlFromEnv: () => "fixture", createPgRepositories: async () => repos,
      acquireProcessSingleton: async () => ({ release: async () => { events.push("RELEASED"); } }),
      cycleVault: () => ({ put: async () => {} }), VAULT_DIR: [],
      FleetSafetyController: class {}, websiteSizeFromHoldings: () => () => "LARGE", hostSpacer: () => async () => {},
      REGISTRATION_TARGETS: [{ state: "AZ" }, { state: "TX" }], RESEARCH_INTENT_LOG_KEY: "intent",
      readIntents: () => ({ runnerPause: { paused: mode === "paused" } }),
      neon: () => ({ query: async (_sql: string, params: string[]) => [{ id: params[2].toLowerCase() }] }),
      censusDivisionPrefix: (state: string) => `ocd-division/country:us/state:${state}`,
      recheckShutDoors: async () => ({ checked: 1, reopened: 0, failures: [] }),
      runPageDoorChecks: async (_repos: unknown, _runtime: unknown, doors: { state: string }[]) => {
        events.push(`PAGE:${doors[0].state}`);
        if (mode === "drain") env.onDrain();
        return { read: 1, changed: 0, failures: [] };
      },
      loadRegistrationReference: () => ({ sha256: "native-reference", listings: [] }),
      censusStateNotDue: async (_repos: unknown, state: string) => mode === "not-due" && state === "tx",
      censusStateCoverage: async () => ({}), refreshDotgovCensusLeads: async () => {},
      readPlatformCensusNeeds: async () => ({ needs: [], failures: [] }), readRuntimeAdminConfig: async () => null,
      writeFieldManual: async (_repos: unknown, entries: { kind: string }[]) => {
        if (entries[0]?.kind === "PLATFORM_CENSUS_RUN") {
          events.push("PERSISTED");
          if (mode === "write-failed") return { error: "native write failed" };
        }
        return {};
      },
      newFieldManualEntry: (_namespace: string, _id: string, value: unknown) => value,
      fieldManualEntryId: (_namespace: string, state: string) => state,
      runCensusState: async ({ state }: { state: string }) => report(state),
    });
  } catch (error) { failure = error; }
  return { stdout: lines.join("\n"), events, failure };
}

test("the actual native Census loops complete after state work, durable writes and release, and identify normal not-due decisions", async () => {
  for (const mode of ["work", "not-due"] as const) {
    const run = await censusFixture(mode);
    assert.equal(run.failure, undefined);
    const result = completion("platform-census-runner.mts", run.stdout);
    assert.equal(result.complete, true); assert.equal(result.units, 2); assert.equal(result.successful, true);
    assert.match(result.reason, mode === "work" ? /2 discovery passes, 0 explicit not-due/ : /1 discovery passes, 1 explicit not-due/);
    assert.ok(run.events.indexOf("RELEASED") > run.events.lastIndexOf("PERSISTED"));
    assert.match(run.events.at(-1)!, /^RH01_PLATFORM_CENSUS_RESULT /);
    for (const override of [{ code: 1 }, { code: null }, { timedOut: true }]) assert.equal(completion("platform-census-runner.mts", run.stdout, override).complete, false);
    assert.equal(completion("platform-census-runner.mts", run.stdout.replace(/^CENSUS_PAGES tx:.*\n/m, "")).complete, false);
    assert.equal(completion("platform-census-runner.mts", run.stdout.replace(/^RH01_PLATFORM_CENSUS_RESULT .*$/m, "")).complete, false);
  }
});

test("native Census pause, release drain, missing state phases and failed persistence cannot masquerade as a completed full pass", async () => {
  for (const mode of ["paused", "drain", "write-failed"] as const) {
    const run = await censusFixture(mode);
    assert.equal(completion("platform-census-runner.mts", run.stdout).complete, false, mode);
    assert.ok(run.events.includes("RELEASED"));
    if (mode === "write-failed") { assert.match(String(run.failure), /native write failed/); assert.doesNotMatch(run.stdout, /RH01_PLATFORM_CENSUS_RESULT/); }
  }
});

async function federalFixture(mode: "work" | "refused" | "throw" | "count-mismatch", publications = 2) {
  const lines: string[] = [], calls: unknown[][] = [];
  const tally = { old: 2, new: mode === "count-mismatch" ? 1 : 2, missing: [], duplicated: [], added: [] };
  const candidates = Array.from({ length: publications }, (_, index) => ({ candidate: { scope: index === 0 ? "US-AZ:directory" : `US:member-votes:${index}` },
    contractId: index === 0 ? "directory" : "votes", from: index === 0 ? "held-directory" : "held-rolls" }));
  let failure: unknown;
  try {
    await nativeCli("split-federal-people.mts", {
      process: { argv: ["node", join(process.cwd(), "scripts/split-federal-people.mts")] }, pathToFileURL,
      console: { log: (line: string) => lines.push(line) },
      assertRuntimeAuthority: () => {}, installNeonRequestDeadline: () => {}, prepareProductionCivicDataWrite: () => {},
      PostgresRoutineDataStore: class {}, readerDatabaseQuery: () => async () => [],
      federalPeopleCountClean, federalPeopleCountLine, federalPeopleSplitLine,
      withHeldFederalPeopleSplit: async (_query: unknown, visit: (split: unknown) => Promise<void>) =>
        visit({ count: { members: tally, positions: { ...tally, old: 5, new: 5 } }, candidates: () => candidates }),
      processRegisteredManualCandidate: async (...args: unknown[]) => {
        calls.push(args);
        if (mode === "throw") throw Error("native publication failed");
        return mode === "refused" && calls.length === 2 ? { candidate: { failureCode: "SEMANTIC_INVALID" } } : { promoted: { versionId: `native-version-${calls.length}` } };
      },
    });
  } catch (error) { failure = error; }
  return { stdout: lines.join("\n"), failure, calls, candidates };
}

test("the actual native held federal split records every publication outcome and clean source count at normal CLI return", async () => {
  for (const mode of ["work", "refused"] as const) {
    const run = await federalFixture(mode);
    assert.equal(run.failure, undefined); assert.equal(run.calls.length, 2);
    assert.equal(run.calls[0][2], run.candidates[0].candidate); assert.equal(run.calls[1][2], run.candidates[1].candidate);
    const result = completion("split-federal-people.mts", run.stdout);
    assert.equal(result.complete, true); assert.equal(result.units, 2); assert.equal(result.successful, mode === "work");
    for (const override of [{ code: 1 }, { code: null }, { timedOut: true }]) assert.equal(completion("split-federal-people.mts", run.stdout, override).complete, false);
    for (const changed of [run.stdout.replace(/^FEDERAL_PEOPLE_SPLIT .*\n/m, ""), run.stdout.replace('"settled":2', '"settled":1'),
      run.stdout.replace(/^FEDERAL_PEOPLE_COUNT .*\n/m, ""), run.stdout.replace('"old":2,"new":2', '"old":2,"new":1'),
      run.stdout.replace(/^RH01_FEDERAL_SPLIT_RESULT .*$/m, "")]) assert.equal(completion("split-federal-people.mts", changed).complete, false, changed);
  }
  for (const mode of ["throw", "count-mismatch"] as const) {
    const run = await federalFixture(mode);
    assert.ok(run.failure); assert.doesNotMatch(run.stdout, /RH01_FEDERAL_SPLIT_RESULT/);
    assert.equal(completion("split-federal-people.mts", run.stdout).complete, false);
  }
});

test("native body observers fail closed when their real CLI seams change", () => {
  assert.throws(() => observeNativeBody("platform-census-runner.mts", "await runSomethingElse();"), /did not match/);
  assert.throws(() => observeNativeBody("split-federal-people.mts", "await runSomethingElse();"), /did not match/);
});

async function retainedCompletion(script: string, stdout: string, stderr = "") {
  const directory = await mkdtemp(join(tmpdir(), "rh01-native-completion-"));
  try {
    const paths = { stdoutFile: join(directory, "stdout.log"), stderrFile: join(directory, "stderr.log") };
    const tail = "unrelated native progress after the terminal result\n".repeat(20_000);
    await writeFile(paths.stdoutFile, stdout + "\n" + tail); await writeFile(paths.stderrFile, stderr);
    const evidence = await readCompletionLogEvidence(paths);
    assert.ok(evidence.retainedBytes < COMPLETION_EVIDENCE_BYTES);
    assert.doesNotMatch(evidence.stdout, /unrelated native progress/);
    return { evidence, result: completion(script, evidence.stdout, { stderr: evidence.stderr }) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("actual native observers survive the saved-log collector and noisy tails without losing state phases or publication scopes", async () => {
  const census = await censusFixture("not-due"), federal = await federalFixture("work");
  for (const [script, run] of [["platform-census-runner.mts", census], ["split-federal-people.mts", federal]] as const) {
    const retained = await retainedCompletion(script, run.stdout);
    assert.deepEqual(retained.evidence.failures, []);
    assert.equal(retained.result.complete, true); assert.equal(retained.result.successful, true); assert.equal(retained.result.units, 2);
  }
  const failedSource = await retainedCompletion("platform-census-runner.mts", census.stdout,
    "CENSUS_SOURCE az: " + "private error detail ".repeat(20_000) + "\nCENSUS_SOURCE az: another failed source\nCENSUS_METRICS tx: unreadable\n");
  assert.equal(failedSource.result.complete, true); assert.equal(failedSource.result.successful, false);
  assert.ok(failedSource.evidence.retainedBytes < 2048); assert.doesNotMatch(failedSource.evidence.stderr, /private error detail/);
  const failedReport = await retainedCompletion("platform-census-runner.mts", census.stdout.replace('"failures":[]', '"failures":[' + JSON.stringify("source detail ".repeat(20_000)) + "]"));
  assert.equal(failedReport.result.complete, true); assert.equal(failedReport.result.successful, false);
  assert.ok(failedReport.evidence.retainedBytes < 2048); assert.doesNotMatch(failedReport.evidence.stdout, /source detail/);
  const wholeSplit = await retainedCompletion("split-federal-people.mts", (await federalFixture("work", 600)).stdout);
  assert.equal(wholeSplit.result.complete, true); assert.equal(wholeSplit.result.units, 600);
  assert.equal(wholeSplit.evidence.stdout.split("\n").filter(line => line.startsWith("FEDERAL_PEOPLE_SPLIT ")).length, 600);
  assert.ok(wholeSplit.evidence.retainedBytes < 100_000);
});

test("saved native completion evidence refuses duplicate identities, malformed controls, and nonempty count differences", async () => {
  const census = await censusFixture("work"), federal = await federalFixture("work");
  const censusLine = census.stdout.split("\n").find(line => line.startsWith("CENSUS_STATE "))!;
  const splitLine = federal.stdout.split("\n").find(line => line.startsWith("FEDERAL_PEOPLE_SPLIT "))!;
  const terminal = federal.stdout.split("\n").at(-1)!;
  for (const [script, output] of [
    ["platform-census-runner.mts", census.stdout + "\n" + censusLine],
    ["platform-census-runner.mts", "CENSUS_PAGES zz: malformed\n" + census.stdout],
    ["split-federal-people.mts", federal.stdout + "\n" + splitLine],
    ["split-federal-people.mts", federal.stdout + "\n" + terminal],
    ["split-federal-people.mts", "FEDERAL_PEOPLE_COUNT malformed\n" + federal.stdout],
    ["split-federal-people.mts", federal.stdout.replace('"missing":[]', '"missing":["genuine unmatched source identity"]')],
  ]) {
    const retained = await retainedCompletion(script, output);
    assert.equal(retained.result.complete, false, output);
  }
  const refused = await retainedCompletion("split-federal-people.mts", (await federalFixture("refused")).stdout);
  assert.equal(refused.result.complete, true); assert.equal(refused.result.successful, false);
});
