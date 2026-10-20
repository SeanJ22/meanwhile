/** A successful exit alone cannot prove that the requested workload ran. */
export interface MeasuredCompletion { readonly complete: boolean; readonly reason: string; readonly successful?: boolean; readonly units?: number }
interface Receipt { acquisitionSucceeded?: boolean; decision?: string; state?: string }
const jsonLine = (output: string, prefix: string): Record<string, unknown> | null => {
  const line = output.split(/\r?\n/).findLast(value => value.startsWith(prefix));
  if (!line) return null;
  try { return JSON.parse(line.slice(prefix.length)); } catch { return null; }
};
const jsonLines = (output: string, prefix: string): Record<string, unknown>[] | null => {
  try {
    const rows: unknown[] = output.split(/\r?\n/).filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
    return rows.every(row => row !== null && typeof row === "object" && !Array.isArray(row)) ? rows as Record<string, unknown>[] : null;
  } catch { return null; }
};
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
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
  if (script === "platform-census-runner.mts") {
    const terminal = jsonLine(stdout, "RH01_PLATFORM_CENSUS_RESULT ");
    const states = terminal?.states;
    if (terminal?.exhausted !== true || terminal.stopped !== false || !Array.isArray(states) || !states.length ||
        !states.every(state => typeof state === "string" && /^[a-z]{2}$/.test(state)) || new Set(states).size !== states.length)
      return no("The native Census state loops and resource release did not finish");
    const logs = stdout.split(/\r?\n/);
    let failureCount = 0;
    const observedFailures = (report: Record<string, unknown>) => {
      if (!Array.isArray(report.failures) || report.failureCount !== undefined && (!count(report.failureCount) || report.failureCount < report.failures.length)) return false;
      failureCount += report.failureCount === undefined ? report.failures.length : Number(report.failureCount);
      return true;
    };
    const stage = (prefix: string, counter: string) => {
      const rows = logs.filter(line => line.startsWith(prefix));
      return rows.length === states.length && rows.every((line, index) => {
        const expected = `${prefix}${states[index]}: `;
        if (!line.startsWith(expected)) return false;
        try {
          const report = JSON.parse(line.slice(expected.length));
          return count(report[counter]) && observedFailures(report);
        } catch { return false; }
      });
    };
    const discoveries = logs.filter(line => line.startsWith("CENSUS_STATE "));
    let dueChecks = 0;
    if (!stage("CENSUS_SHUT ", "checked") || !stage("CENSUS_PAGES ", "read") || discoveries.length !== states.length ||
        !discoveries.every((line, index) => {
          if (line === `CENSUS_STATE ${states[index]}: discoveries are not due`) { dueChecks++; return true; }
          try {
            const report = JSON.parse(line.slice("CENSUS_STATE ".length));
            return report.state === states[index] && [report.checked, report.walked, report.unchanged, report.notDue].every(count) && observedFailures(report);
          } catch { return false; }
        })) return no("A native Census state check, discovery result, or durable end of the full state pass was missing");
    return { ...yes(`The native Census state pass and release completed: ${states.length - dueChecks} discovery passes, ${dueChecks} explicit not-due checks; not-due checks do not prove source acquisition`, states.length),
      successful: failureCount === 0 && !/^CENSUS_(?:SOURCE|METRICS) /m.test(stderr + "\n" + stdout) };
  }
  if (script === "split-federal-people.mts") {
    const terminal = jsonLine(stdout, "RH01_FEDERAL_SPLIT_RESULT "), counts = jsonLines(stdout, "FEDERAL_PEOPLE_COUNT "), outcomes = jsonLines(stdout, "FEDERAL_PEOPLE_SPLIT ");
    const clean = (value: unknown) => {
      if (!value || typeof value !== "object") return false;
      const row = value as Record<string, unknown>;
      return count(row.old) && row.old === row.new && ["missing", "duplicated", "added"].every(key => {
        const values = row[key];
        return Array.isArray(values) && values.length === 0 && (row[key + "Count"] === undefined || row[key + "Count"] === 0);
      });
    };
    if (terminal?.exhausted !== true || !count(terminal.requested) || !terminal.requested || terminal.settled !== terminal.requested ||
        counts?.length !== 1 || !clean(counts[0].members) || !clean(counts[0].positions) || !outcomes || outcomes.length !== terminal.requested ||
        new Set(outcomes.map(row => row.scope)).size !== outcomes.length || !outcomes.every(row => typeof row.scope === "string" && row.scope.length > 0 &&
          typeof row.from === "string" && row.from.length > 0 && (typeof row.to === "string" && row.to.length > 0 || row.to === null && typeof row.refusal === "string" && row.refusal.length > 0)))
      return no("The native federal split did not exhaust its publication loop with preserved member/position counts and an outcome for every actual publication");
    const refused = outcomes.filter(row => row.to === null).length;
    return { ...yes(`The native held federal split exhausted all ${outcomes.length} publication bodies with preserved source counts; ${refused} refused`, outcomes.length), successful: refused === 0 };
  }
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
