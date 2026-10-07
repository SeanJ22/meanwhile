/**
 * Admin is reviewed by running the owner's tasks (`data/health/admin-tasks.json`).
 * A run reports, per task, the words on screen, the taps, the time to the
 * first decision and each view's first-open time; this turns those readings
 * into red and green flags. Pure: the runner passes the readings in.
 */
import { SPEED_BUDGET_MS } from "./worst-case-speed.ts";
import { VIEW_IDS, type View } from "../../app/(admin)/_mw/admin-v6/view-param.ts";

export interface AdminTask {
  readonly id: string;
  readonly title: string;
  readonly start: View;
  readonly success: string;
  readonly tapBudget: number;
  readonly wordBudget: number;
  readonly decisionBudgetMs: number;
}

export interface AdminTaskFile {
  readonly tasks: readonly AdminTask[];
}

/** What one run of one task measured. A reading that was not taken is null. */
export interface AdminTaskReading {
  readonly taskId: string;
  readonly taps: number;
  readonly words: number | null;
  /** From opening the start view to the first screen that lets the owner decide. */
  readonly decisionMs: number | null;
  /** First open of the start view, from navigation to usable. */
  readonly firstOpenMs: number | null;
  /** Whether the task's success condition was reached by the scripted taps. */
  readonly reached: boolean;
  readonly screenshot: string | null;
}

export interface AdminTaskFlag {
  readonly taskId: string;
  readonly title: string;
  readonly verdict: "red" | "green";
  /** Plain words, one per thing that was over; empty when green. */
  readonly reasons: readonly string[];
  readonly screenshot: string | null;
}

/** Words as a reader counts them: runs of non-space characters. */
export function countWords(text: string): number {
  return (text.match(/\S+/g) ?? []).length;
}

/** Problems with the task file; empty means it is usable. */
export function validateAdminTasks(file: AdminTaskFile): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const t of file.tasks) {
    if (seen.has(t.id)) problems.push(`duplicate task ${t.id}`);
    seen.add(t.id);
    if (!(VIEW_IDS as readonly string[]).includes(t.start)) problems.push(`${t.id}: start view ${t.start} is not an Admin view`);
    for (const f of ["tapBudget", "wordBudget", "decisionBudgetMs"] as const) {
      if (!(t[f] > 0)) problems.push(`${t.id}: ${f} must be above zero`);
    }
  }
  return problems;
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} seconds`;

/** One run as a flag. Red when the goal was missed or any budget was passed; a missing reading is never green on its own. */
export function judgeAdminTask(task: AdminTask, r: AdminTaskReading): AdminTaskFlag {
  const reasons: string[] = [];
  if (!r.reached) reasons.push("The task could not be finished from this screen.");
  if (r.taps > task.tapBudget) reasons.push(`It took ${r.taps} taps; ${task.tapBudget} is the most allowed.`);
  if (r.words === null) reasons.push("The words on screen could not be counted.");
  else if (r.words > task.wordBudget) reasons.push(`The screen has ${r.words} words; ${task.wordBudget} is the most allowed.`);
  if (r.decisionMs === null) reasons.push("The time to the first decision could not be measured.");
  else if (r.decisionMs > task.decisionBudgetMs) reasons.push(`The first decision took ${secs(r.decisionMs)}; ${secs(task.decisionBudgetMs)} is the most allowed.`);
  if (r.firstOpenMs === null) reasons.push("The first-open time could not be measured.");
  else if (r.firstOpenMs > SPEED_BUDGET_MS) reasons.push(`The view took ${secs(r.firstOpenMs)} to open; ${secs(SPEED_BUDGET_MS)} is the most allowed.`);
  return { taskId: task.id, title: task.title, verdict: reasons.length ? "red" : "green", reasons, screenshot: r.screenshot };
}

/** Every task judged. A task with no reading is red, so a run that skipped it cannot look clean. */
export function judgeAdminRun(file: AdminTaskFile, readings: readonly AdminTaskReading[]): { flags: AdminTaskFlag[]; red: number; green: number } {
  const byTask = new Map(readings.map((r) => [r.taskId, r]));
  const flags = file.tasks.map((t): AdminTaskFlag => {
    const r = byTask.get(t.id);
    return r ? judgeAdminTask(t, r) : { taskId: t.id, title: t.title, verdict: "red", reasons: ["This task was not run."], screenshot: null };
  });
  const red = flags.filter((f) => f.verdict === "red").length;
  return { flags, red, green: flags.length - red };
}
