import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPLAY_WRAPPER_PARENT_PEAK_MIB } from "../scripts/rh01-workload.mts";

const root = fileURLToPath(new URL("..", import.meta.url));

for (const script of ["rh01-held-worker-replay.mts", "rh01-model-replay.mts"]) for (const phase of ["after", "before"]) {
  test(`${script} admits its child through the ${phase} archive's shared memory host`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "rh01-replay-admission-"));
    const archive = join(directory, "archive"), store = join(directory, "store"), temporary = join(directory, "temporary");
    const model = script === "rh01-model-replay.mts", role = model ? "ADVERSARIAL_AUDITOR" : "PARSER";
    const write = async (path: string, source: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, source); };
    const source = (path: string, body: string) => write(join(archive, path), body);
    const leaseMiB = phase === "after" ? 544 : 342;
    try {
      await Promise.all([
        mkdir(temporary, { recursive: true }),
        source("data/campaign-finance/sources.json", "[]"),
        write(join(store, "rh01-held-replay.json"), JSON.stringify({ parserTaskId: "task", source: "fixture" })),
        write(join(store, "rh01-model-replay.json"), JSON.stringify({ phase, tasks: { ADVERSARIAL_AUDITOR: "task" }, inputs: { heldCapture: "unused" } })),
        source("lib/control-plane/repository/file-store.ts", "export async function createFileRepositories(){return {attempts:{read:async()=>({value:{outcome:'COMPLETED'}})}};}"),
        source("lib/control-plane/repository/worker-completion.ts", `export async function readCompletedWorkerResult(){return {record:{routeTaskId:'task',modelReview:{},completion:{closedAttempt:{outcome:'COMPLETED'}},result:{role:${JSON.stringify(role)},verdict:'EXTRACTED'}}};}`),
        source("lib/control-plane/repository/types.ts", "export const canonicalJson=JSON.stringify;"),
        source("lib/control-plane/workers/runtime.ts", "export function enqueueWorkerTask(){throw Error('not called');}"),
        source("lib/method/runtime-manual.ts", "export {};"),
        source("lib/method/manual-bridge.ts", "export {};"),
        source("lib/doors/install.ts", "export function refreshDoorsForPass(){throw Error('not called');}"),
        source("lib/doors/seed-meetings.ts", "export function seedMeetingDoors(){throw Error('not called');}"),
        source("lib/control-plane/workers/standing.ts", "export function standingFleetRuntime(){throw Error('not called');} export function advanceHeldWorkerFleet(){throw Error('not called');}"),
        // A deliberately different before floor proves the wrapper uses its archive's API and policy.
        source("lib/control-plane/workers/worker-slots.ts", `import assert from 'node:assert/strict';
          import {workerProcessSlots as nativeSlots} from ${JSON.stringify(new URL("../lib/control-plane/workers/worker-slots.ts", import.meta.url).href)};
          export function workerProcessSlots(capacity,options){
            assert.equal(capacity(),Number.MAX_SAFE_INTEGER);
            assert.deepEqual(options,${phase === "before" ? "{}" : `{parentPeakBytes:${REPLAY_WRAPPER_PARENT_PEAK_MIB}*1024*1024}`});
            return nativeSlots(capacity,{...options,peakBytes:()=>${leaseMiB}*1024*1024});
          }`),
        source("lib/control-plane/workers/process-pool.ts", `import assert from 'node:assert/strict';
          import {spawn} from 'node:child_process'; import {once} from 'node:events';
          import {readFileSync} from 'node:fs'; import {join} from 'node:path'; import {tmpdir} from 'node:os';
          export async function runLeaseWorkerProcesses(input){
            assert.equal(input.config.postgres,false); assert.deepEqual(input.config.taskIds,['task']);
            assert.equal(input.config.ceilingUsd,${model ? "0.01" : "0"});
            assert.equal(input.entry,'lib/control-plane/workers/lease-worker.ts'); assert.ok(input.slots);
            const release=await input.slots.acquire(input.entry,Date.now()+5000);
            const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{env:{...process.env,NODE_OPTIONS:''},stdio:'ignore'});
            await once(child,'spawn'); release.observe(child.pid);
            try {
              let reservation;
              for(let i=0;i<100;i++){
                const state=JSON.parse(readFileSync(join(tmpdir(),'meanwhile-worker-memory.json'),'utf8'));
                reservation=state.reservations.find(row=>row.pid===child.pid);
                if(reservation){
                  assert.equal(reservation.entry,input.entry); assert.equal(reservation.peak,${leaseMiB}*1024*1024);
                  ${phase === "after" ? `assert.equal(state.parents.find(row=>row.pid===process.pid).peak,${REPLAY_WRAPPER_PARENT_PEAK_MIB}*1024*1024);` : ""}
                  break;
                }
                await new Promise(done=>setTimeout(done,20));
              }
              assert.ok(reservation,'the separately bound lease reservation must exist in the shared host');
              console.log('RH01_REPLAY_CHILD_ADMITTED '+reservation.peak);
            } finally {const closed=once(child,'close'); child.kill(); await closed; release();}
            await input.onDispatched({claimed:true,outcome:'WORKED',attemptId:'attempt',routeTaskId:'task'});
          }`),
      ]);
      const environment = { ...process.env, NODE_OPTIONS: "", TMPDIR: temporary, TMP: temporary, TEMP: temporary,
        WTP_RH01_PHASE: phase, WTP_RH01_CODE_ROOT: archive, WTP_RH01_HARNESS_ROOT: root,
        WTP_RH01_MODEL_BROKER: join(directory, "unused-broker"), WTP_WORKER_MEMORY_RELEASE: `fixture-${phase}` };
      for (const key of ["DATABASE_URL", "WTP_CONTROL_PLANE_DATABASE_URL", "WTP_PRODUCTION_DATABASE_URL_READONLY"]) delete environment[key as keyof typeof environment];
      const child = spawn(process.execPath, ["--experimental-strip-types", "--import", join(root, "scripts/register-test-loader.mjs"),
        join(root, "scripts", script), `--store=${store}`, `--phase=${phase}`, `--role=${role}`],
      { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"], timeout: 15000 });
      let stdout = "", stderr = "";
      child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
      const [status] = await once(child, "close");
      assert.equal(status, 0, stderr + stdout);
      assert.match(stdout, new RegExp(`RH01_REPLAY_CHILD_ADMITTED ${leaseMiB * 1024 * 1024}`));
      assert.match(stdout, /RH01_REPLAY \{"complete":true/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}
