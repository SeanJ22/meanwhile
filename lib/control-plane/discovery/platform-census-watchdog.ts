import { roundProgressReporter } from "../scheduler/round-progress.ts";

/** Completed work reports progress. An absolute wall still ends a hung await before the parent supervisor does. */
export function platformCensusWatchdog(deadlineMs: number, options: {
  write?: (line: string) => void;
  fail?: (detail: string) => void;
} = {}) {
  const write = options.write ?? (line => console.log(line));
  const progress = roundProgressReporter({ write: line => write(`CENSUS_PROGRESS ${line.trim()}`) });
  const timer = setTimeout(() => {
    const detail = "CENSUS_PASS_TIMEOUT: the census deadline ended unfinished work; its inventory positions remain owed";
    if (options.fail) options.fail(detail);
    else { console.error(detail); process.exit(1); }
  }, Math.max(0, deadlineMs - Date.now()));
  return {
    note: progress.note,
    close() { clearTimeout(timer); progress.flush(); },
  };
}
