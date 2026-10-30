/** Marks a dated row whose every date is before today, so a resident sees at a glance what is behind them. */
export function PassedMark() {
  return <span data-date-passed className="ml-2 rounded-sm border border-subtle px-1.5 py-0.5 font-sans text-[0.75rem] font-semibold uppercase tracking-wide text-muted">Passed</span>;
}
