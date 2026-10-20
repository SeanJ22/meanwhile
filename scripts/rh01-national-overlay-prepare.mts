/** Native local Sends exercise selected source jobs without changing their production clocks. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { ADMIN_CONFIG_ID } from "../lib/control-plane/gateway/admin-config.ts";
import type { PublishedPlaceMembership } from "../lib/census-geography/area-lookup.ts";
import type { ExpansionScopeDecision, ExpansionScopeGeography } from "../lib/control-plane/expansion/scopes.ts";
import type { NationalPlaceTask } from "../lib/hunt/place-source-task.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import type { ActionReceipt } from "../lib/control-plane/gateway/contract.ts";
import type { ResearchIntent } from "../lib/control-plane/scheduler/research-policy.ts";

interface SelectedCommand { readonly script: string; readonly command: readonly string[] }
const option = (args: readonly string[], name: string) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);

export function selectedNationalPlaces(commands: readonly SelectedCommand[]): NationalPlaceTask[] {
  const selected = new Map<string, NationalPlaceTask>();
  for (const job of commands) {
    if (job.script.split(/[\\/]/).at(-1) !== "promote-registry-runtime.mts" || !option(job.command, "national-zips")) continue;
    const zip = option(job.command, "national-zips")!, state = option(job.command, "state")!, id = option(job.command, "place-task")!;
    if (!job.command.includes("--promote") || !/^\d{5}$/.test(zip) || !/^[A-Z]{2}$/.test(state) ||
        ![`national-place:${zip}`, `national-place:${zip}:${state}`].includes(id)) throw Error("RH01 national preparation requires each exact native ZIP/state command");
    selected.set(`${id}/${state}`, { id, zip, state });
  }
  return [...selected.values()];
}

export function assertNationalOverlayEnvironment(env: Readonly<Record<string, string | undefined>>): void {
  const facts = env.WTP_RH01_FACTS_URL, connection = env.WTP_CONTROL_PLANE_DATABASE_URL;
  if (!facts || new URL(facts).hostname !== "127.0.0.1" || !connection || new URL(connection).hostname !== "127.0.0.1" ||
      decodeURIComponent(new URL(connection).username) !== "wtp_cp_release_readonly" || env.WTP_RUNTIME_MODE !== "staging" || env.WTP_DB_ROLE !== "local" ||
      !env.WTP_RH01_CODE_ROOT || !env.WTP_RH01_SHARED_STATE_DIRECTORY || !env.WTP_RH01_RUN_ID)
    throw Error("RH01 national preparation requires the named loopback role, local staging overlay and unique run identity");
}

function matches(scope: ExpansionScopeDecision, zip: string, rows: readonly PublishedPlaceMembership[]): boolean {
  const g = scope.geography;
  return rows.some(row => row.zip === zip && (g.type === "zcta" ? row.type === "county" && g.geoid === zip && g.version === `zcta:${row.zctaTabulation}` :
    g.type === "state" ? row.type === "county" && row.state === g.stateAbbr && g.version === `state:${row.version.split(":")[1]}` :
      row.type === g.type && row.geoid === g.geoid && row.version === g.version));
}

export interface NationalRefreshSelection {
  readonly geography: ExpansionScopeGeography; readonly priority: number; readonly budgetUsd: number;
  readonly note: string | null; readonly questions?: ExpansionScopeDecision["questions"];
}
export function planNationalRefreshes(places: readonly NationalPlaceTask[], memberships: readonly PublishedPlaceMembership[],
  scopes: readonly ExpansionScopeDecision[], pimaAllowanceUsd: 2.49 | null): NationalRefreshSelection[] {
  const result = new Map<string, NationalRefreshSelection>();
  for (const place of places) {
    const own = memberships.filter(row => row.zip === place.zip && row.state === place.state);
    const counties = own.filter(row => row.type === "county"), tabs = new Set(counties.map(row => row.zctaTabulation));
    if (!counties.length || tabs.size !== 1 || !/^\d{4}$/.test([...tabs][0]!)) throw Error(`RH01 actual published ZIP/state geography is unresolved: ${place.zip}/${place.state}`);
    const version = `zcta:${[...tabs][0]}`, key = `${version}/${place.zip}`;
    const prior = scopes.filter(scope => !scope.budgetStartedAt && matches(scope, place.zip, own))
      .sort((a, b) => Number(b.key === key) - Number(a.key === key) || a.priority - b.priority || a.key.localeCompare(b.key))[0];
    if (prior) {
      result.set(prior.key, { geography: prior.geography, priority: prior.priority, budgetUsd: prior.budgetUsd,
        note: prior.note, ...(prior.questions ? { questions: prior.questions } : {}) });
      continue;
    }
    if (scopes.some(scope => scope.key === key)) throw Error(`RH01 cannot replace an existing lifetime selection: ${key}`);
    const pima = counties.some(row => row.geoid === "04019");
    const budgetUsd = pima && pimaAllowanceUsd !== null ? pimaAllowanceUsd : 0;
    result.set(key, { geography: { type: "zcta", geoid: place.zip, version, label: `ZIP ${place.zip}`, stateAbbr: place.state },
      priority: 999, budgetUsd, note: "RH-01 isolated source refresh; production clocks and budgets remain unchanged." });
  }
  return [...result.values()];
}

interface NativePreparation {
  readonly submit: typeof import("../lib/control-plane/gateway/gateway.ts").submit;
  readonly findReceipt: typeof import("../lib/control-plane/gateway/receipts.ts").findReceipt;
  readonly expansionScopesOf: typeof import("../lib/control-plane/expansion/scopes.ts").expansionScopesOf;
  readonly readRequests: typeof import("../lib/hunt/place-source-task.ts").readNationalPlaceSendRequests;
  readonly dueZips: typeof import("../lib/hunt/place-source-task.ts").dueNationalPlaceZips;
  readonly memberships: (zips: readonly string[]) => Promise<readonly PublishedPlaceMembership[]>;
}

export function verifiedPimaRefreshAllowance(input: { readonly phase: string; readonly modelPhase: string | undefined;
  readonly broker: { readonly authorized?: boolean; readonly url?: string; readonly budgetPath?: string;
    readonly limits?: { readonly totalUsd?: number; readonly perPhase?: { readonly SCOUT?: { readonly usd?: number } } } };
  readonly preparation: { readonly phase?: string; readonly receipts: readonly ActionReceipt[] };
  readonly saved: ActionReceipt | null; readonly intents: readonly ResearchIntent[] }): 2.49 {
  const receipt = input.preparation.receipts.find(row => row.type === "fleet.deployHere");
  if (input.modelPhase !== input.phase || input.broker.authorized !== true || !input.broker.url ||
      new URL(input.broker.url).hostname !== "127.0.0.1" || !input.broker.budgetPath || input.broker.limits?.totalUsd !== 5 ||
      input.broker.limits?.perPhase?.SCOUT?.usd !== 2.49 || input.preparation.phase !== input.phase || !receipt ||
      !isDeepStrictEqual(input.saved, receipt) || !input.intents.some(row => row.kind === "INTENT" && row.intentId === receipt.subject &&
        row.action === "DISPATCH" && row.note === "Send agents to Pima County Arizona" && row.budgetUsd === 2.49 &&
        row.adminSessionRef === "rh01-user-authorized-local-diagnostic"))
    throw Error("RH01 Pima refresh requires the same authorized shared $5 broker and genuine unchanged local $2.49 Send");
  return 2.49;
}

export async function prepareNationalRefreshes(input: { readonly places: readonly NationalPlaceTask[]; readonly repos: ControlPlaneRepositories;
  readonly native: NativePreparation; readonly at: string; readonly runId: string; readonly pimaAllowanceUsd: 2.49 | null }) {
  const before = await input.repos.adminConfig.readNarrowed(ADMIN_CONFIG_ID, { expansionScopes: true });
  const held = input.native.expansionScopesOf(before?.value ?? null);
  if (held.malformed) throw Error("RH01 existing scope decisions are unreadable");
  const memberships: PublishedPlaceMembership[] = [];
  const zips = [...new Set(input.places.map(place => place.zip))];
  for (let start = 0; start < zips.length; start += 128) memberships.push(...await input.native.memberships(zips.slice(start, start + 128)));
  // Resolve every selection before a gateway write, so a protected collision cannot partially change setup.
  const plan = planNationalRefreshes(input.places, memberships, held.scopes, input.pimaAllowanceUsd);
  const receipts: ActionReceipt[] = [];
  for (const selection of plan) {
    const key = `${selection.geography.version}/${selection.geography.geoid}`;
    const idempotencyKey = `rh01-national-${createHash("sha256").update(`${input.runId}/${key}`).digest("hex").slice(0, 40)}`;
    const result = await input.native.submit({ type: "expansion.scope.set", subject: key,
      input: { ...selection, huntBudget: false, newHunt: false }, stateVersion: null, idempotencyKey,
      caller: "OWNER_SESSION", actorRef: "rh01-user-authorized-local-diagnostic" },
    { repos: input.repos, now: () => input.at, currentStateVersion: null, codeSha: null });
    if (!result.ok) throw Error(`RH01 native local national Send refused: ${result.receipt.says}`);
    if (!isDeepStrictEqual(await input.native.findReceipt(input.repos, result.receipt.receiptId), result.receipt))
      throw Error("RH01 native national Send receipt did not persist exactly");
    receipts.push(result.receipt);
  }
  const requests = await input.native.readRequests(input.repos, zips, input.at);
  const requestTimes = new Set(receipts.map(receipt => receipt.startedAt));
  const instructionIds = new Set(receipts.map(receipt => receipt.receiptId));
  for (const place of input.places) {
    const request = requests.get(place.zip);
    if (!request || !requestTimes.has(request.requestedAt) || !request.instructions.some(id => instructionIds.has(id)) ||
        !(await input.native.dueZips(input.repos, [place], input.at, requests)).includes(place.zip))
      throw Error(`RH01 native Send did not make the exact selected place due: ${place.id}/${place.state}`);
  }
  const after = input.native.expansionScopesOf((await input.repos.adminConfig.readNarrowed(ADMIN_CONFIG_ID, { expansionScopes: true }))?.value ?? null);
  for (const old of held.scopes) {
    const next = after.scopes.find(scope => scope.key === old.key);
    if (!next || next.budgetUsd !== old.budgetUsd || next.budgetStartedAt !== old.budgetStartedAt || next.priority !== old.priority ||
        next.note !== old.note || !isDeepStrictEqual(next.questions, old.questions) || !isDeepStrictEqual(next.geography, old.geography) ||
        old.budgetStartedAt && !isDeepStrictEqual(next, old))
      throw Error(`RH01 national setup changed an existing budget or lifetime instruction: ${old.key}`);
  }
  return { at: input.at, places: input.places, due: input.places.map(place => ({ ...place, request: requests.get(place.zip)! })), receipts, productionWrites: 0,
    note: "Native local Sends made only the selected command due checks; original obligations, clocks, source facts and existing budget periods were not rewritten." };
}

async function main(): Promise<void> {
  assertNationalOverlayEnvironment(process.env);
  const phase = option(process.argv, "phase");
  if (phase !== "before" && phase !== "after") throw Error("RH01 national preparation phase is invalid");
  const commandsPath = option(process.argv, "commands");
  if (!commandsPath) throw Error("RH01 selected native national commands are required");
  const places = selectedNationalPlaces(JSON.parse(await readFile(resolve(commandsPath), "utf8")));
  if (!places.length) throw Error("RH01 national preparation has no selected exact national command");
  const codeRoot = process.env.WTP_RH01_CODE_ROOT!, shared = process.env.WTP_RH01_SHARED_STATE_DIRECTORY!;
  const code = (file: string) => import(pathToFileURL(join(codeRoot, file)).href);
  const [{ createPgRepositories }, { submit }, { findReceipt }, { expansionScopesOf }, { readNationalPlaceSendRequests, dueNationalPlaceZips }, { readPublishedPlaceMemberships }] = await Promise.all([
    code("lib/control-plane/repository/pg-store.ts"), code("lib/control-plane/gateway/gateway.ts"), code("lib/control-plane/gateway/receipts.ts"),
    code("lib/control-plane/expansion/scopes.ts"), code("lib/hunt/place-source-task.ts"), import("../lib/census-geography/area-lookup.ts"),
  ]);
  const at = new Date().toISOString(), repos = await createPgRepositories(process.env.WTP_CONTROL_PLANE_DATABASE_URL!, at, { skipBootstrap: true });
  let pimaAllowanceUsd: 2.49 | null = null;
  if (process.argv.includes("--active-pima")) {
    const brokerPath = process.env.WTP_RH01_MODEL_BROKER;
    if (!brokerPath || process.env.WTP_RH01_MODEL_PHASE !== phase) throw Error("RH01 Pima refresh requires the same authorized phase broker");
    const broker = JSON.parse(await readFile(brokerPath, "utf8"));
    const preparation = JSON.parse(await readFile(join(shared, "active-overlay-preparation.json"), "utf8"));
    const receipt = (preparation.receipts as ActionReceipt[]).find(row => row.type === "fleet.deployHere");
    const { RESEARCH_INTENT_LOG_KEY } = await code("lib/control-plane/scheduler/research-policy.ts");
    const saved = receipt ? await findReceipt(repos, receipt.receiptId) : null;
    const intents = receipt ? await repos.researchIntents.readWhere(RESEARCH_INTENT_LOG_KEY, ["intentId"], receipt.subject) : [];
    pimaAllowanceUsd = verifiedPimaRefreshAllowance({ phase, modelPhase: process.env.WTP_RH01_MODEL_PHASE, broker, preparation, saved, intents });
  }
  const result = await prepareNationalRefreshes({ places, repos, at, runId: process.env.WTP_RH01_RUN_ID!, pimaAllowanceUsd,
    native: { submit, findReceipt, expansionScopesOf, readRequests: readNationalPlaceSendRequests, dueZips: dueNationalPlaceZips, memberships: readPublishedPlaceMemberships } });
  await writeFile(join(shared, "national-overlay-preparation.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(`RH01_NATIONAL_OVERLAY_PREPARED ${JSON.stringify(result)}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
