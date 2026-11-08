/**
 * A long read that walks a table page by page says so as it goes. The round turns each page into a counted "round
 * progress" line, which renews the runner's no-progress limit; a read that is stuck completes no page and says nothing.
 * Only scans that end with the table (the planner's open-work read) report here, never a loop that could poll forever.
 */
export type ScanProgressObserver = (label: string) => void;

let observer: ScanProgressObserver | null = null;

/** One process-wide observer, told of every page a reporting scan completes. Returns its own remover. */
export function observeScanProgress(next: ScanProgressObserver): () => void {
  observer = next;
  return () => { if (observer === next) observer = null; };
}

/** One page of a scan finished under `label`. An observer that throws never changes the read. */
export function noteScanProgress(label: string): void {
  try { observer?.(label); } catch { /* progress reporting never fails a read */ }
}
