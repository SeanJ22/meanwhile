/** Finite observations of native browser work; product verdicts stay the native pass's verdicts. */
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import type { ResidentTask, TaskPass, TaskProfile, TaskRun, TaskScript } from "../lib/health/resident-tasks.ts";
import type { SpeedPass, SpeedRun, SpeedTarget } from "../lib/health/worst-case-speed.ts";
import type { runTaskPlaces } from "../lib/health/resident-task-run.ts";
import type { AskBridgeInput, AskBridgeReply } from "./rh01-ask-bridge.mts";

const native = (file: string) => import(pathToFileURL(join(process.env.WTP_RH01_CODE_ROOT ?? process.cwd(), file)).href);
const finiteTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const taskKey = (row: { taskId: string; zip: string; profile: string }) => JSON.stringify([row.taskId, row.zip, row.profile]);
const speedKey = (row: SpeedTarget) => JSON.stringify([row.surface, row.zip, row.profile, row.question ?? null]);
const digest = (rows: readonly string[]) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
interface Target { readonly zip: string; readonly question?: string; started: number; settled: number; full: number; scopeVisible: boolean; checks: number }
let activeTarget: Target | null = null;
interface Place { readonly zip: string; readonly expected: readonly string[]; readonly actual: string[]; durable: boolean; complete: boolean; checks: number; shots: number; asks: number }
interface ResidentState { place: Place | null; places: number; expectedTasks: number; actualTasks: number; expectedChecks: number; expectedAsks: number; checks: number; shots: number; asks: number; durable: boolean; complete: boolean; exhausted: boolean }
let resident: ResidentState | null = null;
interface SpeedState { targets: readonly SpeedTarget[]; runs: number; actual: string[]; complete: boolean; asks: number }
let speed: SpeedState | null = null;

export function measurementScreenshotExists(key: string): boolean {
  const directory = resolve(process.env.WTP_RH01_SHARED_STATE_DIRECTORY ?? process.env.WTP_RH01_DIRECTORY!, "screenshots"), path = resolve(directory, key);
  if (!key.startsWith("resident-tasks/") || key.split(/[\\/]/).includes("..") || !path.startsWith(directory + sep)) return false;
  try { const held = statSync(path); return held.isFile() && held.size > 0; } catch { return false; }
}

/** A reply counts only after the actual place/question reached the full native grounded engine. */
export function observeAskRequest(input: AskBridgeInput): (reply?: AskBridgeReply) => void {
  const target = activeTarget, url = new URL(input.url);
  if (!target || url.pathname !== "/api/ask/grounded") return () => undefined;
  target.started++;
  return reply => {
    if (!reply) return;
    target.settled++;
    try {
      const body = JSON.parse(input.body ?? "null"), answer = JSON.parse(reply.body);
      if (reply.status === 200 && body?.question === target.question && body.approximateLocation === target.zip &&
          Array.isArray(answer.records) && Array.isArray(answer.gaps) && Array.isArray(answer.contacts) &&
          typeof answer.mode === "string" && answer.mode !== "OFF" && answer.trace?.preloads &&
          typeof answer.trace.preloads === "object" && typeof answer.trace.sourcesLoaded === "string" && finiteTime(answer.trace.totalMs)) target.full++;
    } catch { /* Invalid, validation-only or failed replies stay incomplete. */ }
  };
}
const asksComplete = (target: Target) => !target.question || target.started > 0 && target.started === target.settled && target.full === target.started;

export async function observeResidentScreen(page: { evaluate(read: (scope: string) => boolean, scope: string): Promise<boolean> }, scope: string, checks: readonly unknown[]): Promise<void> {
  if (!activeTarget) return;
  activeTarget.checks = checks.length;
  activeTarget.scopeVisible = await page.evaluate(selector => Array.from(document.querySelectorAll(selector)).some(element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }), scope);
}

function droveTask(task: ResidentTask, script: TaskScript, run: TaskRun, target: Target): boolean {
  if (run.deadEnd !== null || !target.scopeVisible || target.checks !== script.checks.length || !asksComplete(target)) return false;
  if (!run.steps[0]?.says.startsWith("Opened the ") || !run.steps.every(step => finiteTime(step.ms) && step.shot !== null && measurementScreenshotExists(step.shot))) return false;
  let index = 1, taps = 0;
  for (const step of script.steps) {
    const current = run.steps[index];
    if (step.kind === "ask") {
      if (!task.question || current?.says !== `Asked "${task.question}"`) return false;
      index++; taps += 2;
    } else if (current && step.finders.some(finder => current.says === `Tapped ${finder.says}`)) { index++; taps++; }
    else if (!step.optional) return false;
  }
  return index === run.steps.length && run.taps === taps;
}

/** The native iterator is consumed once; only its current place's finite task matrix is retained. */
export async function observeResidentPlaces(input: Parameters<typeof runTaskPlaces>[0], run: typeof runTaskPlaces): ReturnType<typeof runTaskPlaces> {
  const { taskTargets, TASK_SCRIPTS } = await native("lib/health/resident-tasks.ts");
  const state: ResidentState = { place: null, places: 0, expectedTasks: 0, actualTasks: 0, expectedChecks: 0, expectedAsks: 0,
    checks: 0, shots: 0, asks: 0, durable: true, complete: true, exhausted: false };
  const expectedDigest = createHash("sha256"), actualDigest = createHash("sha256");
  resident = state;
  const zips = async function* () {
    let index = 0;
    for await (const zip of input.zips) {
      const targets = taskTargets(input.tasks, [zip], index++ < input.askZips ? 1 : 0) as { task: ResidentTask; zip: string; profile: TaskProfile }[];
      const expected = targets.map(target => taskKey({ taskId: target.task.id, zip: target.zip, profile: target.profile }));
      state.place = { zip, expected, actual: [], durable: false, complete: true, checks: 0, shots: 0, asks: 0 };
      yield zip;
      const place = state.place;
      state.places++; state.expectedTasks += expected.length; state.actualTasks += place.actual.length;
      state.expectedChecks += targets.reduce((count, target) => count + TASK_SCRIPTS[target.task.id].checks.length, 0);
      state.expectedAsks += targets.filter(target => target.task.start === "ask").length;
      state.checks += place.checks; state.shots += place.shots; state.asks += place.asks;
      expectedDigest.update(JSON.stringify(expected)); actualDigest.update(JSON.stringify(place.actual));
      state.durable &&= place.durable;
      state.complete &&= place.complete && digest(expected) === digest(place.actual);
      state.place = null;
    }
    state.exhausted = true;
  };
  try {
    const totals = await run({ ...input, zips: zips(), run: async (task, zip, profile) => {
      const target: Target = { zip, ...(task.start === "ask" ? { question: task.question } : {}), started: 0, settled: 0, full: 0, scopeVisible: false, checks: 0 };
      activeTarget = target;
      try {
        const result = await input.run(task, zip, profile), place = state.place!;
        place.actual.push(taskKey(result)); place.checks += target.checks; place.shots += result.steps.length;
        if (target.question && asksComplete(target)) place.asks++;
        place.complete &&= taskKey(result) === taskKey({ taskId: task.id, zip, profile }) && droveTask(task, TASK_SCRIPTS[task.id], result, target);
        return result;
      } finally { activeTarget = null; }
    } });
    console.log("RH01_BROWSER_RESULT " + JSON.stringify({ kind: "TASKS", durable: state.durable, exactTargets: state.complete,
      exhausted: state.exhausted && totals.places === state.places, places: state.places, expected: state.expectedTasks, observed: state.actualTasks,
      expectedChecks: state.expectedChecks, checks: state.checks, shots: state.shots, expectedAsks: state.expectedAsks, asks: state.asks,
      expectedDigest: expectedDigest.digest("hex"), actualDigest: actualDigest.digest("hex"), passed: totals.passed, failed: totals.failed }));
    return totals;
  } finally { resident = null; activeTarget = null; }
}

export async function observeResidentPass(repos: Pick<ControlPlaneRepositories, "liveAudits">, pass: TaskPass): Promise<void> {
  if (!resident?.place) return;
  const [{ canonicalJson }, { tasksDayKey }] = await Promise.all([native("lib/control-plane/repository/types.ts"), native("lib/control-plane/live-audit-log.ts")]);
  const saved = await repos.liveAudits.readRecord?.(tasksDayKey(pass.at), `tasks@${pass.at}`);
  resident.place.durable = saved?.kind === "TASKS" && canonicalJson(saved.pass) === canonicalJson(pass);
  resident.place.complete &&= pass.zips.length === 1 && pass.zips[0] === resident.place.zip &&
    digest(pass.runs.map(taskKey)) === digest(resident.place.actual);
}

export function prepareSpeedObservation(targets: readonly SpeedTarget[], runs: number): void {
  speed = { targets, runs, actual: [], complete: Number.isInteger(runs) && runs > 0, asks: 0 };
}
export async function observeSpeedTarget(target: SpeedTarget, visit: () => Promise<SpeedRun>): Promise<SpeedRun> {
  const observation: Target = { zip: target.zip, question: target.question, started: 0, settled: 0, full: 0, scopeVisible: false, checks: 0 };
  activeTarget = observation;
  try {
    const result = await visit();
    if (speed) {
      speed.actual.push(speedKey(result)); if (observation.question && asksComplete(observation)) speed.asks++;
      speed.complete &&= speedKey(target) === speedKey(result) && finiteTime(result.ms) && !result.note && asksComplete(observation);
    }
    return result;
  } finally { activeTarget = null; }
}
export async function observeSpeedPass(repos: Pick<ControlPlaneRepositories, "liveAudits">, pass: SpeedPass): Promise<void> {
  if (!speed) return;
  const state = speed;
  const [{ canonicalJson }, { speedDayKey }] = await Promise.all([native("lib/control-plane/repository/types.ts"), native("lib/control-plane/live-audit-log.ts")]);
  const saved = await repos.liveAudits.readRecord?.(speedDayKey(pass.at), `speed@${pass.at}`);
  const expected = state.targets.flatMap(target => Array.from({ length: target.surface === "ask" ? 1 : state.runs }, () => speedKey(target)));
  const rows = pass.rows.flatMap(row => Array.from({ length: row.runs }, () => speedKey(row)));
  const complete = state.complete && digest(expected) === digest(state.actual) && digest(expected) === digest(rows) &&
    pass.rows.every(row => row.unfinished === 0 && finiteTime(row.worstMs));
  console.log("RH01_BROWSER_RESULT " + JSON.stringify({ kind: "SPEED", durable: saved?.kind === "SPEED" && canonicalJson(saved.pass) === canonicalJson(pass),
    exactTargets: complete, exhausted: true, places: pass.zips.length, expected: expected.length, observed: state.actual.length,
    expectedChecks: state.targets.length, checks: pass.rows.length, shots: 0, expectedAsks: state.targets.filter(target => target.surface === "ask").length,
    asks: state.asks, expectedDigest: digest(expected), actualDigest: digest(state.actual), passed: pass.passed, failed: pass.failed }));
  speed = null;
}
