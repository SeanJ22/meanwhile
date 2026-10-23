import { HUNT_STATES, scopeControlKey } from "../hunt-orders.ts";
import { parseV6PlaceKey } from "../admin-view/v6-hunts-read.ts";
import { findScheduledChild } from "./receipts.ts";
import { ownerDispatchWorkOf, type DispatchWorkReading, type OwnerDispatchWork } from "../expansion/dispatch-work.ts";
import { confirmHuntScores, type PlaceScoreReader } from "./hunt-score.ts";

import type { ControlPlaneRepositories } from "../repository/types.ts";
import { RESEARCH_INTENT_LOG_KEY, RESEARCH_STATE_ID, type ResearchIntent } from "../scheduler/research-policy.ts";
import { RUNNER_ID } from "../admin-data.ts";
import type { ActionReceipt } from "./contract.ts";
import type { RunnerHeartbeat } from "../owner-surface.ts";
import { formatEastern } from "../eastern-time.ts";
import { isLeadOrder, leadCounts, leadCountsWords, leadItems, LEADS_ACTION, rowOpen, type LeadOrder } from "../leads/order.ts";
import { OFFICIALS_CHECK_ACTION } from "./officials-action.ts";
import { officialsReceiptFeeds } from "../admin-view/officials-results.ts";
import { officialsLeadStatus } from "../officials-leads.ts";

export type ConfirmationState =
  | "applied"
  | "in-progress"

  | "waiting"
  | "not-needed"
  | "unread"

  | "not-picked-up"

  | "working";

export interface OrderPlan {
  readonly who: string;
  readonly change: string;

  readonly creates: number | null;
  readonly affects: string;

  readonly resultsBy: string | null;
}

export interface OrderProgress {
  readonly done: number | null;
  readonly of: number | null;
}

export interface OrderItem {
  readonly name: string;
  readonly status: "done" | "failed" | "queued" | "running";
  readonly label: string;
  readonly note: string;
}

export interface Confirmation {
  readonly state: ConfirmationState;
  readonly plan?: OrderPlan;
  readonly progress?: OrderProgress;
  readonly change?: ActionReceipt["change"];

  readonly items?: readonly OrderItem[];
  readonly at: string | null;
  readonly words: string;
}

export const INTENT_ACTIONS: ReadonlySet<string> = new Set([
  "runner.pause",
  "runner.resume",
  "runner.runCycleNow",
  "research.pause",
  "research.resume",
  "fleet.deployHere",
  "fleet.cancelDispatch",
]);

const ROUND_ACTIONS: ReadonlySet<string> = new Set([
  "config.setFleetSpendCeiling",
  "config.setPlaceTarget",
  "config.setDiscoverySearch",
  "expansion.scope.set",
  "expansion.scope.setMany",
  "expansion.scope.budget",
  "expansion.scope.remove",
  "expansion.scope.stopAll",
]);

const APPLIED_WORDS: Readonly<Record<string, string>> = {
  "runner.pause": "Paused.",
  "runner.resume": "Resumed.",
  "runner.runCycleNow": "Started.",
  "research.pause": "Paid research paused.",
  "research.resume": "Paid research resumed.",
  "fleet.deployHere": "Sent.",
  "fleet.cancelDispatch": "Taken back.",
  "expansion.scope.set": "Runner has it.",
  "expansion.scope.setMany": "Runner has the list.",
  "expansion.scope.budget": "Budget in use.",
  "expansion.scope.remove": "Stopped.",
  "expansion.scope.stopAll": "Stopped.",
  "config.setFleetSpendCeiling": "Ceiling in use.",
  "config.setPlaceTarget": "Target in use.",
  "config.setDiscoverySearch": "Search setting in use.",
};

const WAITING_WORDS: Readonly<Record<string, string>> = {
  "runner.pause": "Saved. Waiting for the runner.",
  "runner.resume": "Saved. Waiting for the runner.",
  "runner.runCycleNow": "Saved. Waiting for the runner.",
  "research.pause": "Saved. Waiting for the next round.",
  "research.resume": "Saved. Waiting for the next round.",
  "fleet.deployHere": "Saved. Waiting for the runner.",
  "fleet.cancelDispatch": "Saved. Waiting for the runner to take it back.",
  "expansion.scope.set": "Saved. Waiting for the runner.",
  "expansion.scope.setMany": "Saved. Waiting for the runner.",
  "expansion.scope.budget": "Saved. Waiting for the next round.",
  "expansion.scope.remove": "Saved. Waiting for the runner.",
  "expansion.scope.stopAll": "Saved. Waiting for the runner.",
  "config.setFleetSpendCeiling": "Saved. Waiting for the next round.",
  "config.setPlaceTarget": "Saved. Waiting for the next round.",
  "config.setDiscoverySearch": "Saved. Waiting for the next round.",
};

function later(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) && x > y;
}

interface AssignmentReading {
  readonly assignments?: { readonly assignments?: readonly { readonly ref?: unknown }[] };
}

/** Shared only for one history read; a later request always reads the store again. */
export function confirmationReadSession(repos: ControlPlaneRepositories): ControlPlaneRepositories {
  const reads = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, read: () => Promise<T>): Promise<T> => {
    if (!reads.has(key)) reads.set(key, read());
    return reads.get(key) as Promise<T>;
  };
  return {
    ...repos,
    runnerHeartbeat: { ...repos.runnerHeartbeat, read: id => once(`heartbeat:${id}`, () => repos.runnerHeartbeat.read(id)) },
    researchState: { ...repos.researchState, readNarrowed: (id, projection) =>
      once(`research:${id}:${JSON.stringify(projection)}`, () => repos.researchState.readNarrowed(id, projection)) },
  };
}

export async function confirmReceipt(repos: ControlPlaneRepositories, receipt: ActionReceipt, nowMs: number = Date.now(), readPlaceScore?: PlaceScoreReader): Promise<Confirmation> {
  if (receipt.type === LEADS_ACTION && receipt.outcome !== "REFUSED") return confirmLeads(repos, receipt, nowMs);
  if (receipt.type === OFFICIALS_CHECK_ACTION && receipt.outcome !== "REFUSED") return confirmOfficials(repos, receipt, nowMs);
  let core = await confirmCore(repos, receipt, nowMs, readPlaceScore);

  if (receipt.outcome === "REFUSED") return core;
  core = await confirmHuntScores(repos, receipt, core, readPlaceScore);
  let nextRound: string | null = null;
  try {
    const beat = (await repos.runnerHeartbeat.read(RUNNER_ID))?.value ?? null;
    nextRound = beat?.nextCycleDueAt ?? null;
    if (core.state === "waiting" && !(receipt.type === "orders.schedule" && core.words.startsWith("Scheduled."))) core = notPickedUp(core, beat, receipt, nowMs);
  } catch {  }
  const result = { ...core, plan: core.plan ?? orderPlan(receipt, nextRound), progress: core.progress ?? orderProgress(receipt, core) };
  return confirmDispatch(repos, receipt, result);
}

async function confirmLeads(repos: ControlPlaneRepositories, receipt: ActionReceipt, nowMs: number): Promise<Confirmation> {
  let beat: RunnerHeartbeat | null = null;
  let order: LeadOrder | null = null;
  try {
    beat = (await repos.runnerHeartbeat.read(RUNNER_ID))?.value ?? null;
    const row = await repos.leadOrders.read(receipt.receiptId);
    order = row !== null && isLeadOrder(row.value) ? row.value : null;
  } catch { }
  if (order === null) return { state: "unread", at: null, words: "Saved. Runner status —", plan: leadsPlan(receipt, null, beat) };
  const counts = leadCounts(order);
  const base = { plan: leadsPlan(receipt, counts.queued, beat), progress: { done: order.rows.filter((r) => !rowOpen(r)).length, of: counts.total }, items: leadItems(order) };
  if (!order.open) return { ...base, state: "applied", at: order.updatedAt, words: `Done: ${leadCountsWords(counts)}` };
  if (counts.tested > 0) return { ...base, state: "working", at: null, words: `Testing links: ${leadCountsWords(counts)}` };
  const waiting: Confirmation = { state: "waiting", at: null, words: `Saved. Waiting for the runner to test ${counts.queued.toLocaleString("en-US")} link${counts.queued === 1 ? "" : "s"}.` };
  return { ...base, ...notPickedUp(waiting, beat, receipt, nowMs) };
}

function leadsPlan(receipt: Pick<ActionReceipt, "label" | "requestedSubject" | "subject">, toTest: number | null, beat: Pick<RunnerHeartbeat, "nextCycleDueAt"> | null): OrderPlan {
  return { who: "Runner", affects: receipt.requestedSubject ?? receipt.subject ?? "the selected place", change: receipt.label, creates: toTest !== null && toTest > 0 ? toTest : null, resultsBy: beat?.nextCycleDueAt ?? null };
}

export const RUNNER_SILENT_MS = 15 * 60 * 1000;

/** An officials check, from each people source's own runner outcome since the check and the Scout's verification of any lead. */
async function confirmOfficials(repos: ControlPlaneRepositories, receipt: ActionReceipt, nowMs: number): Promise<Confirmation> {
  try {
    const [feeds, beat] = await Promise.all([officialsReceiptFeeds(repos, receipt), repos.runnerHeartbeat.read(RUNNER_ID)]);
    const leadRef = receipt.openedWork.find(work => work.kind === "officials-lead");
    const lead = leadRef ? await officialsLeadStatus(repos, leadRef.id) : null;
    const total = feeds.length + (lead === null ? 0 : 1);
    const done = feeds.filter(feed => feed.state !== "waiting").length + (lead?.state === "checked" ? 1 : 0);
    const failed = feeds.filter(feed => feed.state === "failed" || feed.state === "paused").length;
    const base = { plan: { who: "Runner", change: "Check officials now", creates: null, affects: receipt.subject, resultsBy: beat?.value.nextCycleDueAt ?? null },
      progress: { done, of: total }, items: [...feeds.map(feed => ({ name: feed.name,
        status: feed.state === "waiting" ? "queued" as const : feed.state === "failed" || feed.state === "paused" ? "failed" as const : "done" as const,
        label: feed.state === "changed" ? "Changes found" : feed.state === "checked" ? "Checked" : feed.state === "paused" ? "Paused or closed" : feed.state === "failed" ? "Could not read source" : "Waiting for the runner",
        note: feed.sourceUrl ?? "" })), ...(lead ? [{ name: "What I heard", status: lead.state === "checked" ? "done" as const : lead.state === "working" ? "running" as const : "queued" as const,
          label: lead.state === "checked" ? "Verified against official sources" : lead.state === "working" ? "Scout is checking" : "Waiting for a Scout", note: "Within the current paid-work controls" }] : [])] };
    if (done === total) return { ...base, state: "applied", at: [...feeds.map(feed => feed.checkedAt), lead?.checkedAt].filter((at): at is string => !!at).sort().at(-1) ?? receipt.completedAt,
      words: failed ? `Finished with ${failed} source${failed === 1 ? " needing" : "s needing"} attention.` : `Checked ${done} people source${done === 1 ? "" : "s"}.` };
    if (done > 0 || lead?.state === "working") return { ...base, state: "working", at: null, words: lead && feeds.every(feed => feed.state !== "waiting") ? "Sources checked. The reported change is still with a Scout." : `Finished ${done} of ${total} checks.` };
    return { ...base, ...notPickedUp({ state: "waiting", at: null, words: "Saved. Waiting for the runner to check officials." }, beat?.value ?? null, receipt, nowMs) };
  } catch { return { state: "unread", at: null, words: "Saved. Officials check results —" }; }
}

export function notPickedUp(
  waiting: Confirmation,
  beat: Pick<RunnerHeartbeat, "beatAt" | "nextCycleDueAt"> | null,
  receipt: Pick<ActionReceipt, "completedAt" | "startedAt">,
  nowMs: number,
): Confirmation {
  const savedAt = Date.parse(receipt.completedAt ?? receipt.startedAt);
  const beatAt = beat ? Date.parse(beat.beatAt) : NaN;
  const silent = Number.isFinite(beatAt) ? nowMs - beatAt > RUNNER_SILENT_MS : nowMs - savedAt > RUNNER_SILENT_MS;
  const due = beat?.nextCycleDueAt ? Date.parse(beat.nextCycleDueAt) : NaN;
  const roundPassed = Number.isFinite(due) && due > savedAt && due < nowMs;
  if (!silent && !roundPassed) return waiting;
  const since = Number.isFinite(beatAt) && beat ? formatEastern(beat.beatAt) : null;
  return { state: "not-picked-up", at: null, words: since ? `The runner hasn't checked in since ${since}.` : "The runner hasn't checked in yet." };
}

const SETTING_ACTIONS: ReadonlySet<string> = new Set(["config.setSetting", "config.setFleetSpendCeiling", "config.setPlaceTarget", "config.setDiscoverySearch", "config.setDataSwitch"]);

export function orderPlan(receipt: Pick<ActionReceipt, "type" | "openedWork" | "label">, nextRoundAt: string | null): OrderPlan {
  const runner = INTENT_ACTIONS.has(receipt.type) || ROUND_ACTIONS.has(receipt.type) || receipt.type.startsWith("orders.");
  const created = receipt.openedWork.length;
  return {
    who: runner ? "Runner" : "Admin",
    change: receipt.label,
    affects: receipt.label,
    creates: created > 0 ? created : null,
    resultsBy: runner ? nextRoundAt : null,
  };
}

export function orderProgress(receipt: Pick<ActionReceipt, "type" | "openedWork">, confirmation: Pick<Confirmation, "state">): OrderProgress {
  const finished = confirmation.state === "applied" || confirmation.state === "not-needed";
  if (SETTING_ACTIONS.has(receipt.type)) return { done: finished ? 1 : 0, of: 1 };
  if (receipt.type === "fleet.deployHere") return { done: finished ? receipt.openedWork.length : 0, of: receipt.openedWork.length || null };
  return { done: null, of: null };
}

async function confirmCore(repos: ControlPlaneRepositories, receipt: ActionReceipt, nowMs: number = Date.now(), readPlaceScore?: PlaceScoreReader): Promise<Confirmation> {
  if (receipt.outcome === "REFUSED") return { state: "not-needed", at: null, words: receipt.says };
  const type = receipt.type;
  if (type === "orders.schedule") {
    try {
      const child=await findScheduledChild(repos,receipt.subject);
      if(child)return confirmReceipt(repos,child,nowMs,readPlaceScore);
      const config=(await repos.adminConfig.read("current"))?.value;
      const scheduled=config?.scheduledOrders?.find(o=>o.id===receipt.subject);
      if(scheduled && !scheduled.after && nowMs - Date.parse(scheduled.startAt ?? scheduled.decidedAt) > RUNNER_SILENT_MS) return {state:"not-picked-up",at:null,words:"The scheduled time passed, and the timer has not sent this order."};
      return scheduled?{state:"waiting",at:null,words:"Scheduled. Waiting for its time or the first order to finish.",plan:orderPlan(receipt,scheduled.startAt)}:{state:"not-needed",at:null,words:"Unscheduled; it will not be sent."};
    }catch{return {state:"unread",at:null,words:"The scheduled order could not be read just now."};}
  }
  if (type === "queue.add") {
    try {
      const item = (await repos.adminConfig.read("current", { fixList: { ids: [receipt.subject] } }))?.value.fixList?.find(i=>i.id === receipt.subject);
      if (item?.dispatch) return confirmReceipt(repos, { ...receipt, type: "fleet.deployHere", subject: item.dispatch.intentId },nowMs,readPlaceScore);
    } catch { return { state: "unread", at: null, words: "Saved. Runner status —" }; }
  }
  const inIntent = INTENT_ACTIONS.has(type);
  const inRound = ROUND_ACTIONS.has(type);
  if (!inIntent && !inRound) return { state: "not-needed", at: receipt.completedAt, words: receipt.says };
  const applied = (at: string | null, detail?: string): Confirmation => ({
    state: "applied",
    at,
    words: `${APPLIED_WORDS[type]}${detail ? ` ${detail}` : ""}`,
  });
  const waiting: Confirmation = { state: "waiting", at: null, words: WAITING_WORDS[type] };
  try {
    if(type==="expansion.scope.remove" || type==="expansion.scope.stopAll") {
      // These receipts record the completed synchronous removal used before runner stop orders.
      if (type === "expansion.scope.remove" && receipt.outcome === "DONE" && receipt.completedAt &&
        /^(?:Removed:|That geography was not on your expansion list, so nothing changed\.)/.test(receipt.says)) {
        return applied(receipt.completedAt);
      }
      const orders=await repos.huntOrders.listWhere(["receiptId"],receipt.receiptId);
      if (!orders.length) return { state: "unread", at: null, words: "The stop request is saved, but its runner order could not be found." };
      const done = orders.filter(row => row.value.confirmedAt !== null);
      const expected = type === "expansion.scope.stopAll" && receipt.subject === "us" ? HUNT_STATES.length : 1;
      if (new Set(orders.map(row => row.value.state)).size < expected) {
        return { state: "unread", at: null, words: "The stop request is saved, but some of its runner orders could not be found." };
      }
      if (done.length === orders.length) return { ...applied(done.map(row => row.value.confirmedAt!).sort().at(-1)!), progress: { done: done.length, of: orders.length } };
      return done.length ? { state: "in-progress", at: done.map(row => row.value.confirmedAt!).sort()[0],
        words: `Stopped in ${done.length} of ${orders.length} states.`, progress: { done: done.length, of: orders.length } } : waiting;
    }
    if (inIntent) {
      const rows: readonly ResearchIntent[] = await repos.researchIntents.readWhere(RESEARCH_INTENT_LOG_KEY, ["honors"], receipt.subject);
      const honored = rows.find((r) => r.kind === "HONORED");
      return honored && honored.kind === "HONORED" ? applied(honored.honoredAt) : waiting;
    }
    if(type==="expansion.scope.budget") {
      const policy=await repos.adminConfig.read("current",{expansionScopes:{ids:[receipt.subject]}});
      const scope=policy?.value.expansionScopes?.find(scope=>scope.key===receipt.subject);
      if(!scope) {
        const stops = await repos.huntOrders.listWhere(["scopeKey"], receipt.subject);
        const place = parseV6PlaceKey(receipt.requestedSubject ?? "");
        const allStopped = place && place.kind !== "country" ? await repos.huntOrders.latestStop(place.state) : null;
        const stopped = [...stops, ...(allStopped ? [allStopped] : [])].map(row => row.value)
          .filter(order => order.confirmedAt && later(order.requestedAt, receipt.completedAt ?? receipt.startedAt))
          .sort((a, b) => a.confirmedAt!.localeCompare(b.confirmedAt!)).at(-1);
        return stopped ? { state: "applied", at: stopped.confirmedAt, words: "The hunt was stopped; this budget order is closed." }
          : { state: "unread", at: null, words: "The budget change is saved, but its hunt could not be found." };
      }
      if (scope.latestDecisionReceiptId && scope.latestDecisionReceiptId !== receipt.receiptId && later(scope.decidedAt, receipt.completedAt ?? receipt.startedAt)) {
        return { state: "applied", at: scope.decidedAt, words: "A later hunt change replaced this budget order." };
      }
      const state=await repos.researchState.readNarrowed(`${RESEARCH_STATE_ID}:${scope.geography.stateAbbr.toLowerCase()}`,
        {scopeControls:[scopeControlKey(scope.key)],cycleFinishedAt:true});
      const reading=state?.value as {scopeControls?:Record<string,string>;cycleFinishedAt?:string|null}|undefined;
      if (reading?.cycleFinishedAt && reading.scopeControls?.[scopeControlKey(scope.key)]===receipt.receiptId) return applied(reading.cycleFinishedAt);
      if (state) return waiting;
      // Older rounds recorded the applied policy in the shared research state.
      const legacy = await repos.researchState.readNarrowed(RESEARCH_STATE_ID, { cycleStartedAt: true, cycleFinishedAt: true });
      const round = legacy?.value as { cycleStartedAt?: string; cycleFinishedAt?: string | null } | undefined;
      return later(round?.cycleStartedAt, receipt.completedAt ?? receipt.startedAt) && round?.cycleFinishedAt ? applied(round.cycleFinishedAt) : waiting;
    }
    const heartbeat = (await repos.runnerHeartbeat.read(RUNNER_ID))?.value ?? null;
    if (type === "config.setDiscoverySearch" && heartbeat?.discoverySearch?.receiptId === receipt.receiptId) {
      return applied(heartbeat.discoverySearch.appliedAt ?? null);
    }
    if (type === "expansion.scope.set" || type === "expansion.scope.setMany") {
      const states=new Set(receipt.huntScores?.flatMap(score=>{
        const place=parseV6PlaceKey(score.placeKey);return place && place.kind!=="country"?[place.state]:[];
      })??[]);
      if(states.size===0) {
        const held=await repos.adminConfig.read("current",{expansionScopes:{ids:[receipt.subject]}});
        for(const scope of held?.value.expansionScopes??[])states.add(scope.geography.stateAbbr.toLowerCase());
      }
      let at:string|null=null;
      let pickedUp = states.size > 0;
      const readings = await Promise.all([...states].map(code =>
        repos.researchState.readNarrowed(`${RESEARCH_STATE_ID}:${code}`, { assignments: true, beatAt: true })));
      for(const state of readings) {
        const refs=(state?.value as AssignmentReading|undefined)?.assignments?.assignments??[];
        if(!refs.some(a=>a.ref===receipt.receiptId))pickedUp = false;
        at=(state?.value as {beatAt?:string}|undefined)?.beatAt??at;
      }
      if (pickedUp) return applied(at);
      const legacy = await repos.researchState.readNarrowed(RESEARCH_STATE_ID, { assignments: true, beatAt: true });
      const legacyRefs = (legacy?.value as AssignmentReading | undefined)?.assignments?.assignments ?? [];
      return legacyRefs.some(a => a.ref === receipt.receiptId) ? applied((legacy?.value as { beatAt?: string }).beatAt ?? null) : waiting;
    }
    if (later(heartbeat?.lastCycleStartedAt, receipt.completedAt ?? receipt.startedAt)) return applied(heartbeat?.lastCycleStartedAt ?? null);
    return waiting;
  } catch {
    return { state: "unread", at: null, words: "Saved. Runner status —" };
  }
}

async function confirmDispatch(repos: ControlPlaneRepositories, receipt: ActionReceipt, core: Confirmation): Promise<Confirmation> {
  if (receipt.type !== "fleet.deployHere" || receipt.outcome === "REFUSED") return core;
  try {
    let work:OwnerDispatchWork|null=null;
    const states = await Promise.all(HUNT_STATES.map(code =>
      repos.researchState.readNarrowed(`${RESEARCH_STATE_ID}:${code}`, { ownerDispatch: true, dispatchWork: true })));
    for(const held of states) {
      const state=held?.value as {ownerDispatch?:{intentId:string;work?:OwnerDispatchWork|null};dispatchWork?:DispatchWorkReading|null}|undefined;
      const scoped=ownerDispatchWorkOf(state?.dispatchWork??null,receipt.subject)
        ??(state?.ownerDispatch?.intentId===receipt.subject?state.ownerDispatch.work??null:null);
      if(!scoped)continue;
      const prior=work as OwnerDispatchWork|null;
      work=prior?{...prior,created:prior.created+scoped.created,deferred:prior.deferred+scoped.deferred}:scoped;
    }
    if (!work) {
      const held = await repos.researchState.readNarrowed(RESEARCH_STATE_ID, { ownerDispatch: true, dispatchWork: true });
      const state = held?.value as { ownerDispatch?: { intentId: string; work?: OwnerDispatchWork | null }; dispatchWork?: DispatchWorkReading | null } | undefined;
      work = ownerDispatchWorkOf(state?.dispatchWork ?? null, receipt.subject)
        ?? (state?.ownerDispatch?.intentId === receipt.subject ? state.ownerDispatch.work ?? null : null);
    }
    if (!work || work.key !== `dispatch:${receipt.subject}`) return core;
    const of = work.created + work.deferred;
    return { ...core, progress: { done: work.created, of: of || null },
      plan: core.plan ? { ...core.plan, creates: of } : undefined,
      state: core.state === "applied" && work.deferred > 0 ? "in-progress" : core.state,
      words: core.state === "applied" && work.deferred > 0 ? `${work.created} created; ${work.deferred} waiting for the next round.` : core.words };
  } catch { return { ...core, progress: { done: null, of: null } }; }
}
