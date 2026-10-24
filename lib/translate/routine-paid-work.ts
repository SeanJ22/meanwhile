import { randomUUID } from "node:crypto";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { readPlanningIntents } from "../control-plane/repository/pg-store.ts";
import { ADMIN_CONFIG_ID, adminConfigForPaidWork, discoverySearchEnabled, fleetSpendCeilingOverrideUsd, type AdminConfigRead } from "../control-plane/gateway/admin-config.ts";
import { recordCost } from "../control-plane/repository/coordinator.ts";
import { durableSearchBudget } from "../control-plane/discovery/search-runtime.ts";
import { makeHuntSearch } from "../hunt/search.ts";
import { huntSearchCost } from "../hunt/runtime.ts";
import type { MeasurePageSearch } from "./routine-sources.ts";
import { FleetSafetyController, FleetSafetyRefusal, FleetPreSendRefusal, resolveRollingCeiling, type ProviderCircuit } from "../control-plane/fleet-safety.ts";
import { readSpendWindow } from "../control-plane/spend-window.ts";
import { loadExpansionPlan, type ExpansionLoad } from "../control-plane/expansion/runner-load.ts";
import { armExpansionBudget, readScopeHistory, type TerritoryIndex } from "../control-plane/expansion/membership.ts";
import { DurableSpendHolds, SendBudgetRefusal, type BudgetLine } from "../control-plane/expansion/spend-holds.ts";
import { paidWorkGuards } from "../control-plane/workers/paid-work-guards.ts";
import { ModelProviderQueue, modelLaneClosure } from "../control-plane/scheduler/model-lane.ts";
import { RESEARCH_STATE_ID, ceilingPermits, readIntents, type ResearchIntent } from "../control-plane/scheduler/research-policy.ts";
import type { ModelTransport } from "../control-plane/scheduler/scout-executor.ts";
import type { backgroundBatchTransport } from "../control-plane/model-batch.ts";
import { US_JURISDICTIONS, jurisdictionFromOcdId } from "../coverage/states.ts";

export interface RoutineTranslationPaidWorkInput {
  readonly repos: ControlPlaneRepositories;
  readonly state: string;
  readonly subjects: readonly { readonly subjectId: string; readonly ocdId: string }[];
  readonly root: string;
  readonly now: () => string;
  readonly messages: ModelTransport;
  readonly batch: ReturnType<typeof backgroundBatchTransport>;
  readonly credentialConfigured: boolean;
  readonly credentialVar: string;
  readonly providerQueue?: ModelProviderQueue;
  readonly batchEnv?: Readonly<Record<string, string | undefined>>;
  readonly onCondition?: (sentence: string) => void;
  readonly loadExpansion?: (input: Parameters<typeof loadExpansionPlan>[0]) => Promise<ExpansionLoad>;
}

const placeOcdId = (state: string) => `ocd-division/country:us/${US_JURISDICTIONS.find(row => row.slug === state)!.prefix}:${state}`;
const emptyTerritory = (): TerritoryIndex => ({ bySubject: new Map(), unplaced: new Map(), statewide: new Set(), unregisteredUnitsByState: new Map() });
const detail = (error: unknown) => error instanceof Error ? error.message : String(error);
/** All routine children reserve the same existing Admin spending allowance. */
export const ROUTINE_TRANSLATION_FLEET_BUDGET_KEY = "area:fleet-model-spend";

/** The routine clock reads the live controls itself. It never needs a research
 * round, that round's heartbeat, or its cached budget-arming file. */
export async function armRoutineTranslationPaidWork(input: RoutineTranslationPaidWorkInput) {
  const state = input.state.toLowerCase();
  if (!/^[a-z]{2}$/.test(state) || !Number.isFinite(Date.parse(input.now())) || input.subjects.some(subject =>
    !subject.subjectId || jurisdictionFromOcdId(subject.ocdId)?.usps.toLowerCase() !== state)) {
    throw new Error("Translation paid work must name one state and its exact measure divisions.");
  }
  const subjects = new Map(input.subjects.map(subject => [subject.subjectId, subject]));
  const queue = input.providerQueue ?? new ModelProviderQueue();
  const holds = new DurableSpendHolds({ budget: input.repos.budget, table: input.repos.spendHolds, now: input.now });
  const say = input.onCondition ?? (() => {});
  let localCircuits: readonly ProviderCircuit[] = [];
  // The work already names its exact divisions. Existing Census-based declared
  // work attribution places it; unrelated government records are not loaded.
  const scopeRepos: ControlPlaneRepositories = { ...input.repos, planningState: undefined,
    adminConfig: { ...input.repos.adminConfig,
      read: (id, sections) => input.repos.adminConfig.read(id, { ...sections,
        expansionScopes: { where: { path: ["geography", "stateAbbr"], value: state.toUpperCase() } } }),
    },
  };

  const mergeCircuits = (...groups: readonly (readonly ProviderCircuit[])[]) => {
    const merged = new Map<string, ProviderCircuit>();
    for (const circuit of groups.flat()) {
      const held = merged.get(circuit.provider);
      if (!held || Date.parse(circuit.eligibleAt) > Date.parse(held.eligibleAt)) merged.set(circuit.provider, circuit);
    }
    return [...merged.values()];
  };
  const providerClosure = (circuits: readonly ProviderCircuit[]) => {
    const held = circuits.find(circuit => circuit.provider === "anthropic" && Date.parse(circuit.eligibleAt) > Date.parse(input.now()));
    return held ? { code: "PROVIDER_CIRCUIT_BROKEN", reason: held.condition } : null;
  };

  const messages: ModelTransport = async request => {
    const closed = providerClosure(localCircuits);
    if (closed) throw new FleetPreSendRefusal(new FleetSafetyRefusal("PROVIDER_CIRCUIT_BROKEN", closed.reason));
    return input.messages(request);
  };

  async function readGate() {
    const now = input.now(), unreadable: string[] = [];
    let log: readonly ResearchIntent[] = [];
    let configRead: AdminConfigRead;
    try { log = await readPlanningIntents(input.repos, state); }
    catch (error) { unreadable.push(`the owner's research intents could not be read (${detail(error)})`); }
    try { configRead = { row: await input.repos.adminConfig.read(ADMIN_CONFIG_ID) }; }
    catch (error) { configRead = { unreadable: detail(error) }; }
    const { config, holdPaidWork } = adminConfigForPaidWork(configRead);
    if (holdPaidWork) unreadable.push(holdPaidWork);
    const intents = readIntents(log), ceiling = resolveRollingCeiling(fleetSpendCeilingOverrideUsd(config));
    let spend: Awaited<ReturnType<typeof readSpendWindow>> | null = null;
    try { spend = await readSpendWindow(input.repos, now); }
    catch (error) { unreadable.push(`the cost ledger could not be read (${detail(error)})`); }
    let circuits: readonly ProviderCircuit[] = [];
    try { circuits = (await input.repos.researchState.read(`${RESEARCH_STATE_ID}:${state}`))?.value.fleetSafety?.providerCircuits ?? []; }
    catch (error) { unreadable.push(`the provider's safety state could not be read (${detail(error)})`); }
    const closed = modelLaneClosure({ dry: false, noModel: false,
      credentialConfigured: input.credentialConfigured, credentialVar: input.credentialVar,
      paused: intents.paused, pauseIntentId: intents.pauseIntentId,
      runnerPaused: intents.runnerPause.paused, runnerPauseIntentId: intents.runnerPause.intent?.intentId ?? null,
      unreadableControls: unreadable,
      spendHold: spend === null ? "the cost ledger could not be read" : ceilingPermits(spend.windowUsd, ceiling.rollingCeilingUsd).permits
        ? null : `the owner's $${ceiling.rollingCeilingUsd.toFixed(2)} model ceiling is reached`,
    });
    if (closed || !spend) return { closed: closed ?? { code: "LANE_DISABLED", reason: "the cost ledger could not be read" }, guards: null, searchOn: false };
    const activeCircuits = mergeCircuits(circuits, localCircuits);
    const providerHeld = providerClosure(activeCircuits);
    if (providerHeld) return { closed: providerHeld, guards: null, searchOn: false };
    let expansion: ExpansionLoad;
    try {
      expansion = await (input.loadExpansion ?? loadExpansionPlan)({ repos: scopeRepos, root: input.root, now,
        obligations: input.subjects.map(subject => ({ id: `translation:${subject.subjectId}`, subjectId: subject.subjectId, scopeDivisions: [subject.ocdId] })),
        loadTerritory: emptyTerritory });
    } catch (error) {
      return { closed: { code: "SCOPE_BUDGET", reason: `the owner's area budgets could not be read (${detail(error)})` }, guards: null, searchOn: false };
    }
    expansion.conditions.forEach(say);
    const areas = expansion.plan === null ? null : armExpansionBudget(expansion.plan, { now,
      history: await readScopeHistory(input.repos.spend, expansion.plan, now).catch(error => {
        say(`the area's spending could not be read (${detail(error)})`); return null;
      }), worstCaseUsd: 0 });
    // FleetSafety also checks this ceiling. Its process-local reservation is
    // shared through the existing holds store so concurrent routine children
    // cannot each spend the same remaining part of Admin's one allowance.
    const fleetLine: BudgetLine = { key: ROUTINE_TRANSLATION_FLEET_BUDGET_KEY, label: "All paid model work",
      budgetUsd: ceiling.rollingCeilingUsd, historicalUsd: spend.windowUsd, historyReadAt: now };
    const expansionBudget = { gate: {
      linesFor(subjectId: string, stateHint?: string | null) {
        const found = areas?.gate.linesFor(subjectId, stateHint) ?? { lines: [] };
        return "refusal" in found ? found : { lines: [fleetLine, ...found.lines] };
      },
    } };
    const fleetSafety = new FleetSafetyController({ now, spend, costLedgerReadable: true,
      circuits: activeCircuits, rollingCeilingUsd: ceiling.rollingCeilingUsd, websitePacing: input.repos.websitePacing,
      clock: () => Date.parse(input.now()) });
    const guards = paidWorkGuards({ repos: input.repos, now: input.now, armedAt: `${now}:${randomUUID()}`,
      fleetSafety, providerQueue: queue, spendHolds: holds, assignmentBudget: { linesFor: () => ({ lines: [] }) }, expansionBudget,
      messages, batch: input.batch, batchEnv: input.batchEnv, modelLaneEnabled: true,
      ceilingUsd: () => ceiling.rollingCeilingUsd, onCondition: say });
    return { closed: null, guards, fleetSafety, searchOn: !holdPaidWork && discoverySearchEnabled(config) };
  }

  let current = await readGate();
  return {
    get closed() { return current.closed ?? providerClosure(mergeCircuits(localCircuits, current.fleetSafety?.snapshot(input.now()).providerCircuits ?? [])); },
    paidWorkerCapacity: (readyWork?: number) => providerClosure(localCircuits) ? 0 : current.guards?.paidWorkerCapacity(readyWork) ?? 0,
    /** The existing paid discovery search, only while Admin has it on and paid work is open. Each request is
     * admitted by the fleet's search guard and recorded in the cost ledger. */
    measurePageSearch(keys: { readonly braveKey?: string | null; readonly exaKey?: string | null }): MeasurePageSearch | null {
      const open = current;
      if (!open.searchOn || !open.fleetSafety) return null;
      const budget = durableSearchBudget({ repos: input.repos, perCycle: Number.MAX_SAFE_INTEGER, perDay: Number.MAX_SAFE_INTEGER, now: input.now,
        admit: () => {
          try { open.fleetSafety!.admitProviderRequest("discovery-search", "paid-search"); return null; }
          catch (error) { return detail(error); }
        } });
      const id = `measure-search:${state}:${randomUUID()}`;
      const search = makeHuntSearch({ ...keys, budget, onCharge: async charge => {
        await recordCost(input.repos, huntSearchCost({ charge, attemptId: id, workItemId: id, routeTaskId: `measure-translations:${state.toUpperCase()}`,
          governmentId: placeOcdId(state), assignmentKeys: [], recordedAt: input.now() }), input.now());
      } });
      return search === null ? null : async (query, domains) =>
        (await search({ query, ...(domains.length ? { includeDomains: domains } : {}) })).hits.map(hit => ({ url: hit.url, title: hit.title }));
    },
    guardedTransportFor: (subject: { readonly subjectId: string; readonly state: string }): ModelTransport => async request => {
      if (!subjects.has(subject.subjectId) || subject.state.toLowerCase() !== state) throw new Error("Translation request is outside its admitted state or measure set.");
      // A pause or lower spending limit applies to the next model call,
      // including the checker of a writer that already finished.
      current = await readGate();
      const admitted = current;
      if (!admitted.guards) throw new SendBudgetRefusal(admitted.closed!.code, admitted.closed!.reason);
      try { return await admitted.guards.autonomousTransportFor(messages)(subject)(request); }
      finally {
        localCircuits = mergeCircuits(localCircuits.filter(circuit => Date.parse(circuit.eligibleAt) > Date.parse(input.now())),
          admitted.fleetSafety?.snapshot(input.now()).providerCircuits ?? []);
        const closed = providerClosure(localCircuits);
        if (closed) say(closed.reason);
      }
    },
  };
}
