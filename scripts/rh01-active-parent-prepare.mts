/** Disposable native Admin commands for the RH-01 active parent measurement. No production writes or model calls. */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";
import { readIntents, RESEARCH_INTENT_LOG_KEY } from "../lib/control-plane/scheduler/research-policy.ts";

const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const phase = option("phase");
if (phase !== "before" && phase !== "after") throw Error("RH01 active parent preparation requires --phase=before|after");
const store = resolve(option("store") ?? `.scratch/rh01/active-model-${phase}`);
const scratch = resolve(".scratch/rh01") + "/";
if (!store.startsWith(scratch)) throw Error("RH01 local control preparation must remain in its disposable scratch directory");
const manifest = JSON.parse(await readFile(join(store, "rh01-model-replay.json"), "utf8"));
if (manifest.phase !== phase || resolve(manifest.root) !== store) throw Error("RH01 native replay preparation identity differs");
const codeRoot = resolve(option("code-root") ?? (phase === "before" ? "/tmp/rh01-before" : "/workspace/rh01-after"));
const repos = await createFileRepositories(store);
const at = new Date().toISOString();
const deps = { repos, now: () => at, currentStateVersion: null, codeSha: null };
const receipts = [];
for (const [type, input] of [
  ["research.resume", { note: "RH-01 isolated memory diagnostic; production pause remains unchanged" }],
  ["fleet.deployHere", { note: "Send agents to Pima County Arizona", budgetUsd: 2.49 }],
] as const) {
  const result = await submit({ type, subject: "fleet", input, stateVersion: null,
    idempotencyKey: `rh01-active-${phase}-${type}`, caller: "OPERATOR_CHAT", actorRef: "rh01-local-diagnostic" }, deps);
  if (!result.ok) throw Error(`RH01 local diagnostic command refused: ${result.receipt.says}`);
  receipts.push(result.receipt);
}
const controls = readIntents(await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY));
if (controls.paused || controls.pendingDispatch.length !== 1) throw Error("RH01 local native Resume/Send did not read back");
const obligation = "hunt:packet:ocd-division/country:us/state:az/county:pima";
const prepared = {
  phase, store, codeRoot, preparedAt: at, productionQueries: 0, productionWrites: 0, paidCalls: 0,
  receipts, obligation, capture: manifest.inputs.heldCapture,
  nativeStorePath: join(codeRoot, ".runtime/control-plane/freshness-shadow"),
  armingPath: join(store, "hunter-arming.sqlite"),
  commands: [
    ["scripts/freshness-shadow.mts", `--ids=${obligation}`],
    ["scripts/hunter-lane.mts"],
  ],
  requiredEnvironment: { WTP_CONTINUOUS_HUNTERS: "1", WTP_HUNTER_LANE_ARMING: join(store, "hunter-arming.sqlite"),
    WTP_RH01_MODEL_PHASE: phase, WTP_RH01_MODEL_CAPTURE: manifest.inputs.heldCapture,
    WTP_RH01_HELD_VAULT_DIRECTORY: join(store, "vault"), WTP_RH01_CODE_ROOT: codeRoot },
  note: "The native store path must point to this disposable store in an isolated code archive. The normal freshness planner writes queue and arming; the normal hunter consumes them. An explicitly authorized shared local broker is required for paid sends. The replayed held capture excludes baseline country assembly from its measured component.",
};
await writeFile(join(store, "rh01-active-parent.json"), JSON.stringify(prepared, null, 2) + "\n");
console.log(`RH01_ACTIVE_PARENT_PREPARED ${JSON.stringify({ phase, store, codeRoot, manifest: join(store, "rh01-active-parent.json"), commands: prepared.commands, productionQueries: 0, productionWrites: 0, paidCalls: 0 })}`);
