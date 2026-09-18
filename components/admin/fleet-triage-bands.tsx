/**
 * The four triage bands (BUILD.md §B). Stacked full-width anchors between the
 * header and the tab strip. Every count is DERIVED, never authored — a band
 * that says 2 while the page shows 3 red cards is worse than no band. The
 * fourth band is teal-dashed, never amber: amber means a reading that will
 * arrive, and these three have no producer at all. Each band is an <a>, so it
 * is middle-clickable and shareable.
 */

import type { FleetBandCounts } from "@/lib/admin/fleet-triage";

interface Band {
  readonly key: string;
  readonly color: string;
  readonly dashed?: boolean;
  readonly count: number;
  readonly label: string;
  readonly reason: string;
  readonly href: string;
}

export function FleetTriageBands({ counts }: { readonly counts: FleetBandCounts }) {
  const bands: readonly Band[] = [
    { key: "red", color: "#cc4b4b", count: counts.red, label: "Makes the rest unreliable",
      reason: "Reporting defects the page detects — they make every other number untrustworthy.", href: "/admin/fleet#triage" },
    { key: "amber", color: "#d99a3a", count: counts.amber, label: "Decisions in this queue",
      reason: "The whole project's decision store; most are not fleet work.", href: "/admin/fleet?tab=decisions" },
    { key: "green", color: "#4c9a5a", count: counts.green, label: "Measured and needing nothing",
      reason: "Readings that answered in this read — receipts, spend and coverage.", href: "/admin/fleet#measured" },
    { key: "dashed", color: "#6fa8a5", dashed: true, count: counts.dashed, label: "No producer",
      reason: "Served publication, throughput, reader demand — no read exists to fill them.", href: "/admin/fleet#no-producer" },
  ];
  return (
    <div className="fleet-bands">
      {bands.map((b) => (
        <a key={b.key} className="fleet-band" href={b.href} style={{ ["--band" as string]: b.color }}>
          <span className={`fleet-band-chip${b.dashed ? " fleet-band-chip-dashed" : ""}`} aria-hidden="true" />
          <span className="fleet-band-body">
            <span className="fleet-band-count">{b.count}</span>
            <span className="fleet-band-label">{b.label}</span>
            <span className="fleet-band-reason">{b.reason}</span>
          </span>
          <span className="fleet-band-go" aria-hidden="true">Go →</span>
        </a>
      ))}
    </div>
  );
}
