import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";

test("before-body startup uses its exact held native AZ publications, preserves legacy component startup, and refuses changed scope or versions before work", async () => {
  const root = await mkdtemp(join(tmpdir(), "rh01-before-body-bootstrap-"));
  const put = async (path: string, value: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, value); };
  try {
    await put(join(root, "package.json"), '{"type":"module"}');
    await put(join(root, "data/campaign-finance/sources.json"), '{}');
    const entry = join(root, "lib/control-plane/workers/lease-worker.ts"), store = join(root, "component");
    await mkdir(store);
    await put(entry, `type LeaseWorkerConfig={postgres:boolean;fileStoreRoot:string};
      globalThis.calls=[];
      async function work(config: LeaseWorkerConfig): Promise<void> { globalThis.calls.push('work'); }
      await work({postgres:false,fileStoreRoot:process.env.WTP_RH01_BASELINE_COMPONENT_STORE});
      console.log('BOOTSTRAP_CALLS '+JSON.stringify(globalThis.calls));`);
    await put(join(root, "lib/control-plane/repository/file-store.ts"), `export async function createFileRepositories(){return{doors:{}};}`);
    await put(join(root, "lib/doors/install.ts"), `export async function refreshDoorsForPass(){globalThis.calls.push('doors');return{reason:null,rows:1,partitions:{refreshed:true,partitions:1},doors:[{ocdId:'ocd-division/country:us/state:az/county:pima'}]};}`);
    await put(join(root, "lib/civic-data/operational-references.ts"), `export async function preloadAzOperationalReferenceBundle(options){if(options.bypassCache!==true||!options.store)throw Error('NO_NATIVE_PROOF');globalThis.calls.push('op');return{metadata:{versionId:'held-op'}};}`);
    await put(join(root, "lib/civic-data/store.ts"), `export class PostgresRoutineDataStore{constructor(){globalThis.calls.push('routine-store');}}`);
    await put(join(root, "lib/registry/runtime-read-model.ts"), `export async function readRegistryRuntimeProjection(states,options){if(JSON.stringify(states)!=='["az"]'||!options.store||options.bypassCache!==true)throw Error('NO_NATIVE_REGISTRY_PROOF');globalThis.calls.push('registry');return{kind:'PROMOTED',metadata:{versionId:'held-registry'}};}`);
    const descriptor = join(root, "broker.json"); await writeFile(descriptor, JSON.stringify({ url: "http://127.0.0.1:9" }));
    const context = { state: "AZ", subjectId: "ocd-division/country:us/state:az/county:pima#governing", operationalVersionId: "held-op", registryVersionId: "held-registry" };
    for (const [name, bodyContext, expected] of [
      ["legacy", undefined, ["doors", "work"]],
      ["held body", context, ["routine-store", "op", "routine-store", "registry", "doors", "work"]],
      ["foreign subject", { ...context, subjectId: "ocd-division/country:us/state:tx/county:travis#governing" }, null],
      ["moved publication", { ...context, registryVersionId: "not-the-held-version" }, null],
    ] as const) {
      await writeFile(join(store, "rh01-model-replay.json"), JSON.stringify({ inputs: { beforeBodyContext: bodyContext } }));
      const child = spawn(process.execPath, ["--max-old-space-size=128", "--experimental-strip-types", "--import", join(process.cwd(), "scripts/rh01-model-preload.mjs"), entry], {
        cwd: root, env: { NODE_ENV: "test", PATH: process.env.PATH, NODE_USE_ENV_PROXY: "1", WTP_RH01_CODE_ROOT: root, WTP_RH01_HARNESS_ROOT: process.cwd(),
          WTP_RH01_MODEL_PHASE: "before", WTP_RH01_BASELINE_COMPONENT_STORE: store, WTP_RH01_MODEL_BROKER: descriptor }, stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "", stderr = "";
      child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
      const [code] = await once(child, "close");
      if (expected) {
        assert.equal(code, 0, name + ": " + stderr);
        assert.deepEqual(JSON.parse(stdout.split("\n").find(line => line.startsWith("BOOTSTRAP_CALLS "))!.slice("BOOTSTRAP_CALLS ".length)), expected);
      } else {
        assert.notEqual(code, 0, name); assert.doesNotMatch(stdout, /BOOTSTRAP_CALLS/);
        assert.match(stderr, name === "foreign subject" ? /RH01_BASELINE_BODY_CONTEXT_SCOPE_MISMATCH/ : /RH01_BASELINE_BODY_CONTEXT_PUBLICATION_CHANGED/);
      }
    }
    const driver = await readFile(new URL("../scripts/rh01-model-replay.mts", import.meta.url), "utf8");
    assert.match(driver, /phase === "before" && manifest\.inputs\.beforeBodyContext/);
    assert.match(driver, /process\.env\.WTP_RH01_DIRECTORY = root; process\.env\.WTP_RH01_SHARED_STATE_DIRECTORY = root/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
