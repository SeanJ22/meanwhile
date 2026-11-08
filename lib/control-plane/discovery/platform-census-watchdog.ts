import { roundProgressReporter } from "../scheduler/round-progress.ts";

/**
 * Completed work reports progress. An absolute wall still ends a hung await before the parent supervisor does.
 * A pass that reaches the wall having finished work is a partial pass and exits cleanly with what it did; only a pass
 * that finished nothing is a failure.
 */
export function platformCensusWatchdog(deadlineMs: number, options: {
  write?: (line: string) => void;
  fail?: (detail: string) => void;
  partial?: (detail: string) => void;
} = {}) {
  const write = options.write ?? (line => console.log(line));
  const progress = roundProgressReporter({ write: line => write(`CENSUS_PROGRESS ${line.trim()}`) });
  let finished = 0;
  const timer = setTimeout(() => {
    if (finished > 0) {
      progress.flush();
      const detail = `CENSUS_PASS_PARTIAL: the census deadline ended the pass after ${finished} finished reads; its inventory positions remain owed`;
      if (options.partial) options.partial(detail);
      else { write(detail); process.exit(0); }
      return;
    }
    const detail = "CENSUS_PASS_TIMEOUT: the census deadline ended a pass that finished nothing; its inventory positions remain owed";
    if (options.fail) options.fail(detail);
    else { console.error(detail); process.exit(1); }
  }, Math.max(0, deadlineMs - Date.now()));
  return {
    note(label: string) { finished += 1; progress.note(label); },
    close() { clearTimeout(timer); progress.flush(); },
  };
}
