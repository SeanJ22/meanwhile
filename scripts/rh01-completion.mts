/** A successful exit alone cannot prove that the requested workload ran. */
export interface MeasuredCompletion { readonly complete: boolean; readonly reason: string; readonly successful?: boolean; readonly units?: number }
interface Receipt { acquisitionSucceeded?: boolean; decision?: string; state?: string }
const jsonLine = (output: string, prefix: string): Record<string, unknown> | null => {
  const line = output.split(/\r?\n/).findLast(value => value.startsWith(prefix));
  if (!line) return null;
  try { return JSON.parse(line.slice(prefix.length)); } catch { return null; }
};
export function measuredCompletion(input: { readonly script: string; readonly stdout: string; readonly stderr: string;
  readonly code: number | null; readonly timedOut: boolean; readonly receipt?: Receipt | null }): MeasuredCompletion {
  const { stdout, stderr } = input;
  const script = input.script.split(/[\\/]/).at(-1);
  const no = (reason: string): MeasuredCompletion => ({ complete: false, reason });
  const yes = (reason: string, units?: number): MeasuredCompletion => ({ complete: true, reason, ...(units === undefined ? {} : { units }) });
  if (input.timedOut) return no("The measurement deadline ended the job before completion");
  if (/RH01_(?:UNSUPPORTED|REMOTE_.*_BLOCKED)|WRITE_HANDLE_REFUSED|RuntimeAuthorityRefused/.test(stderr + stdout)) return no("A required operation was refused by the measurement boundary");
  if (script === "promote-registry-runtime.mts") {
    const actual = jsonLine(stdout, "RH01_NATIONAL_RESULT ");
    if (actual?.completed !== true) return no("The national child did not report a completed place workload; an existing pointer receipt cannot substitute");
  }
  if (input.receipt) {
    const held = ["IDENTITY_UNRESOLVED", "TEMPORAL_INVALID", "SEMANTIC_INVALID", "HORIZON_UNRESOLVED", "DEPENDENT_CONSUMER_INVALID", "CANNOT_TELL"];
    if (input.receipt.acquisitionSucceeded === true && input.receipt.decision === "GOOD" && input.code === 0)
      return { ...yes("Acquisition, validation, and local publication completed"), successful: true };
    if (input.receipt.acquisitionSucceeded === true && held.includes(input.receipt.state ?? "") && [0, 1, 2].includes(input.code ?? -1))
      return { ...yes(`Acquisition and processing completed; the source was held as ${input.receipt.state}`), successful: false };
    return no(`Source workload did not complete: ${input.receipt.state ?? input.receipt.decision}`);
  }
  if (input.code !== 0) return no(`The executable exited ${input.code}`);
  if (script === "rh01-route-replay.mts") {
    const replay = jsonLine(stdout, "RH01_ROUTE_REPLAY ");
    return replay?.complete === true ? yes("The actual pending production route acquired and processed fresh source bytes with local lifecycle writes", 1)
      : no("The route did not finish fresh source acquisition and its canonical local Attempt");
  }
  if (script === "rh01-model-replay.mts") {
    const replay = jsonLine(stdout, "RH01_REPLAY ");
    const reports = replay?.reports as { claimed?: boolean; outcome?: string; attemptId?: unknown }[] | undefined;
    return replay?.complete === true && ["SCOUT", "ADVERSARIAL_AUDITOR"].includes(String(replay.role)) &&
      typeof replay.taskId === "string" && reports?.length === 1 && reports[0]?.claimed === true &&
      reports[0].outcome === "WORKED" && typeof reports[0].attemptId === "string"
      ? yes("The native model role committed its completed Attempt and role result over authentic held inputs", 1)
      : no("The model role did not commit its completed Attempt and role result");
  }
  if (script === "rh01-control-replay.mts" || script === "rh01-held-worker-replay.mts") {
    const replay = jsonLine(stdout, "RH01_REPLAY ");
    const reports = replay?.reports as { claimed?: boolean; outcome?: string }[] | undefined;
    return replay?.complete === true && typeof replay.committedResultId === "string" && reports?.length && reports.every(row => row.claimed && row.outcome === "WORKED")
      ? yes("The real worker body committed a fresh diagnostic completion", reports.length) : no("The worker did not commit a completed execution");
  }
  if (script === "freshness-shadow.mts") {
    const run = jsonLine(stdout, "RH01_FRESHNESS_RESULT ");
    return run?.state === "SUCCEEDED" && run.durable === true && run.simulated === false && run.filtered === false &&
      Number(run.registeredUnits) > 0 && run.workedUnits === run.registeredUnits && typeof run.cycleId === "string"
      ? yes("The entire actual parent scheduling/publication lifecycle completed; paid worker bodies remain separate measurements", Number(run.workedUnits))
      : no("The parent did not finish its full registered scheduling and canonical publication lifecycle");
  }
  if (script === "hunter-lane.mts") {
    const ended = /^hunter lane: ended after (\d+) wave\(s\), (\d+) task result\(s\): (its life ended; the runner starts a fresh lane|a release asked it to drain)\r?$/m.exec(stdout);
    const failed = /refresh failed|open request hold could not be released|hunter lane: stuck worker ended alone:|hunter lane: task done: [^\r\n]*; (?:FAILED|NOT_CLAIMED|NOT_RUN)\b|hunter lane: hunt done: [^\r\n]*; REFUSED;|hunter lane: lease worker process ended: pid \d+; (?!exit 0\r?$)[^\r\n]+/m.test(stdout + "\n" + stderr);
    return ended && Number(ended[1]) > 0 && Number(ended[2]) > 0 && /^hunter lane: armed;/m.test(stdout) && !failed
      ? yes(`The standing parent's native work and ${ended[3] === "a release asked it to drain" ? "graceful release-drain" : "normal rollover"} lifecycle completed; typed worker bodies remain separate measurements`, Number(ended[2]))
      : no("The standing parent did not complete native work and a successful rollover or release-drain lifecycle");
  }
  if (script === "pilot-runner.mts") {
    const cycle = jsonLine(stdout, "RH01_PILOT_CYCLE ");
    return /pilot-runner · 1 cycle\(s\) complete\./.test(stdout) && cycle?.ok === true && cycle.recorded === true &&
      Number(cycle.registeredUnits) > 0 && cycle.workedUnits === cycle.registeredUnits
      ? yes("The controlled staging parent completed one successful full registered cycle and drained its child lanes", 1)
      : no("The standing pilot did not complete and drain a successful full registered cycle");
  }
  if (["routine-civic-data-runner.mts", "publish-now-runner.mts"].includes(script ?? "")) {
    const operational = jsonLine(stdout, "RCD_OPERATIONAL_OUTCOME="), run = jsonLine(stdout, "RCD_RUN=");
    return operational?.state === "SUCCEEDED" && operational.durable === true && Number(run?.denominator) > 0 &&
      run?.attempted === run?.denominator && run?.failed === 0 && run?.skipped === 0
      ? yes("The full selected supervisor pass and durable outcome completed", Number(run.denominator))
      : no("The supervisor did not finish every owed job and readback");
  }
  if (script === "intake-tripwire.mts") {
    const receipt = jsonLine(stdout, "INTAKE_RUNTIME_RECEIPT=");
    return receipt && receipt.outcome !== "UNREADABLE" && Array.isArray(receipt.reactionDays) && receipt.limiterRowsRemaining !== null
      ? yes("The complete intake observation and local limiter operation ran") : no("The intake stores or local limiter operation were unreadable");
  }
  if (script === "publish-owner-snapshot.mts") return /owner-snapshot · published: snapshot;/.test(stdout) &&
      !/incomplete control-plane inputs|NOT BUILT|--dry-run:/.test(stdout)
    ? yes("The complete snapshot fold was published to the local control store") : no("The snapshot fold or publication remained incomplete");
  if (script === "db-apply.mts") return /target: .*role=readonly/.test(stdout) && /DRY RUN — nothing applied|No pending .* migrations within this plan/.test(stdout)
    ? yes("The production migration journal and complete selected plan were inspected read-only") : no("The full production migration plan was not inspected");
  if (script === "loss-study-pass.mts") {
    const match = /loss study: (\d+) lessons from (\d+) losses/.exec(stdout);
    return match && !/not read:|nothing was measured|nothing was studied/.test(stdout) ? yes("The full production loss history was processed", Number(match[2])) : no("The loss history was not fully processed");
  }
  if (script === "break-pattern-pass.mts") {
    const match = /break patterns: (\d+) found, (\d+) lessons written/.exec(stdout);
    return match ? yes("The production break-history pass completed", Number(match[1])) : no("The break-history pass did not complete");
  }
  if (script === "claim-audit-pass.mts") {
    const match = /claim audit: (\d+) claims checked.*; (\d+) confirmed, (\d+) wrong, 0 could not be checked/.exec(stdout);
    return match && Number(match[1]) > 0 && !/lessons not saved:|could not be done:/.test(stdout)
      ? yes("Production claims were actually recomputed", Number(match[1])) : no("Claims were skipped, unreadable, or not recomputed");
  }
  if (script === "look-pass.mts") {
    const look = jsonLine(stdout, "RH01_LOOK_RESULT ");
    if (look?.durable !== true || look.exactTargets !== true || typeof look.runId !== "string" ||
        !Number.isInteger(look.expectedScreens) || Number(look.expectedScreens) <= 0 ||
        look.screens !== look.expectedScreens || look.shots !== look.expectedScreens || !["REVIEWED", "NOT_RUN"].includes(String(look.reviewer)))
      return no("The native look pass did not retain every requested screenshot and its local pass");
    return { ...yes(`Every native browser target and the local look pass completed; reviewer ${look.reviewer === "REVIEWED" ? "ran" : `NOT_RUN (${String(look.reviewerSays)})`}`, Number(look.expectedScreens)),
      successful: look.reviewer === "REVIEWED" && look.notReviewed === 0 && look.red === 0 };
  }
  if (script === "live-audit-pass.mts") {
    const match = /live audit: (\d+) sampled in (\d+) areas;/.exec(stdout);
    return match && Number(match[1]) > 0 && !/not read:|lessons not kept:/.test(stdout)
      ? yes("Production facts were sampled and audited against their sources", Number(match[1])) : no("The live audit did not cover its readable production families");
  }
  if (script === "resident-tasks.mts" || script === "worst-case-speed-pass.mts") {
    const observed = jsonLine(stdout, "RH01_BROWSER_RESULT "), tasks = script === "resident-tasks.mts";
    const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    if (!observed || observed.kind !== (tasks ? "TASKS" : "SPEED") || observed.durable !== true || observed.exactTargets !== true || observed.exhausted !== true ||
        !count(observed.places) || observed.places === 0 || !count(observed.expected) || observed.expected === 0 || observed.observed !== observed.expected ||
        !count(observed.expectedChecks) || observed.expectedChecks === 0 || observed.checks !== observed.expectedChecks ||
        !count(observed.expectedAsks) || observed.expectedAsks === 0 || observed.asks !== observed.expectedAsks || !count(observed.passed) || !count(observed.failed) ||
        Number(observed.passed) + Number(observed.failed) !== (tasks ? observed.observed : observed.checks) ||
        typeof observed.expectedDigest !== "string" || !/^[a-f0-9]{64}$/.test(observed.expectedDigest) || observed.actualDigest !== observed.expectedDigest ||
        tasks && (!count(observed.shots) || Number(observed.shots) < Number(observed.observed)))
      return no("A native browser target, interaction, retained pass, screenshot or full place-scoped Ask response was missing");
    return { ...yes("Every native browser workload and place-scoped Ask response completed and its actual pass was retained", Number(observed.observed)),
      successful: observed.failed === 0 };
  }
  return no("No full-workload completion evidence was recorded for this executable");
}
