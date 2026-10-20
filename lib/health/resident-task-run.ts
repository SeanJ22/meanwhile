import { taskPass, taskTargets, type ResidentTask, type TaskRun, type TaskPass, type TaskProfile } from "./resident-tasks.ts";

/** Finish and publish one place before opening the next, even when every published ZIP is new. */
export async function runTaskPlaces(input: {
  readonly zips: Iterable<string> | AsyncIterable<string>; readonly queued: Pick<ReadonlySet<string>, "has">; readonly tasks: readonly ResidentTask[];
  readonly askZips: number; readonly runId: string; readonly now: () => string;
  readonly run: (task: ResidentTask, zip: string, profile: TaskProfile) => Promise<TaskRun>;
  readonly record: (pass: TaskPass) => Promise<void>;
}): Promise<{passed: number; failed: number; places: number}> {
  let passed = 0, failed = 0, places = 0;
  let index = 0;
  for await (const zip of input.zips) {
    const runs: TaskRun[] = [];
    for (const target of taskTargets(input.tasks, [zip], index < input.askZips ? 1 : 0)) runs.push(await input.run(target.task, zip, target.profile));
    const pass = taskPass(runs, input.now(), input.runId, input.queued.has(zip) ? [zip] : []);
    await input.record(pass);
    passed += pass.passed; failed += pass.failed; places++;
    index++;
  }
  return {passed, failed, places};
}
