/**
 * Triage tab (BUILD.md §C, WIRING.md §1, §2). Server component.
 *
 * Leads with the sentence that keeps someone from debugging a healthy runner —
 * both red findings are reporting defects, not outages — then the two defects
 * as red cards whose verdicts carry the real numbers and whose actions, none of
 * which exist yet, render disabled with their proposed ids. Then the ledger:
 * the measured readings that answered, and the three with no producer held
 * apart under a dashed rim so an empty panel stops reading as a late one.
 */

import type { ResearchProgressHealth } from "@/lib/control-plane/research-progress-health";
import type { RedFinding } from "@/lib/admin/fleet-triage";
import { ResearchProgress } from "@/components/admin/research-progress.tsx";

interface MeasuredReading {
  readonly title: string;
  readonly answered: boolean;
  readonly caveat: string;
  readonly href?: string;
}

function RedCard({ finding }: { readonly finding: RedFinding }) {
  return (
    <div className="ft-finding ft-finding-red">
      <div className="ft-finding-main">
        <div className="ft-badge-row">
          <span className="ft-kind-badge">{finding.kind}</span>
          <span className="note">{finding.affected}</span>
        </div>
        <h3 className="ft-verdict">{finding.verdict}</h3>
        <p className="note ft-explain">{finding.explanation}</p>
        <details className="ft-arith">
          <summary>The arithmetic</summary>
          <dl>
            {finding.rows.map((r) => (
              <div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>
            ))}
            <div className="ft-arith-inference"><dt>Therefore</dt><dd>{finding.inference}</dd></div>
          </dl>
        </details>
      </div>
      <div className="ft-action-stack">
        <button type="button" className="ft-action-disabled" disabled aria-disabled="true">
          Fix the accounting
        </button>
        <span className="ft-action-caption">no such read yet · blind spot {finding.n}</span>
      </div>
    </div>
  );
}

export function FleetTriageTab({
  progress,
  findings,
  measured,
}: {
  readonly progress: ResearchProgressHealth;
  readonly findings: readonly RedFinding[];
  readonly measured: { readonly receipts: boolean; readonly spend: boolean; readonly coverage: boolean };
}) {
  const measuredReadings: readonly MeasuredReading[] = [
    { title: "Lanes", answered: true, caveat: "Derived per work item from its own task states. A live lease means activity, not proven progress.", href: "/admin/fleet?tab=work" },
    { title: "Promotion receipts", answered: measured.receipts, caveat: "LOADED means a valid file was read and bound to its summary. It does not mean promotion passed." },
    { title: "Model spend", answered: measured.spend, caveat: "A known subtotal of zero and an unknown total are different statements." },
    { title: "Coverage gaps", answered: measured.coverage, caveat: "Held-corpus reuse is reuse, not coverage — this is not the completion denominator." },
  ];
  const noProducer = [
    { title: "Served publication", says: "publication.status is the literal UNKNOWN; served-reader proof has no producer." },
    { title: "Throughput over time", says: "No persisted series exists to read. A backend dependency, not a rendering task." },
    { title: "Reader demand", says: "No producer. An empty panel with this sentence is the honest render." },
  ];

  return (
    <section className="fleet-tab" aria-label="Triage">
      <ResearchProgress reading={progress} />

      {findings.length > 0 && (
        <>
          <p className="ft-lede">
            {findings.length === 2 ? "Both of these are reporting defects, not outages." : "This is a reporting defect, not an outage."}{" "}
            The fleet may be fine. The report cannot currently tell you that.
          </p>
          <div className="ft-red-cards">
            {findings.map((f) => <RedCard key={f.n} finding={f} />)}
          </div>
        </>
      )}

      <h3 className="ft-ledger-head">Everything else, by what you can do about it</h3>

      <div className="ft-group-header" id="measured">
        <span className="ft-chip" aria-hidden="true" />
        <span className="ft-group-label">Measured · {measuredReadings.length}</span>
        <span className="ft-rule" aria-hidden="true" />
      </div>
      <div className="ft-ledger-grid">
        {measuredReadings.map((m) => (
          <div key={m.title} className="ft-panel-card">
            <div className="ft-panel-head">
              <strong>{m.title}</strong>
              <span className={`ft-status ${m.answered ? "ft-status-wired" : "ft-status-partial"}`}>{m.answered ? "Answered" : "Unread here"}</span>
            </div>
            <p className="note">{m.caveat}</p>
            {m.href && <a className="ft-inline-link" href={m.href}>Counted on the Work tab →</a>}
          </div>
        ))}
      </div>

      <div className="ft-group-header ft-group-header-dashed" id="no-producer">
        <span className="ft-chip ft-chip-dashed" aria-hidden="true" />
        <span className="ft-group-label">No producer · {noProducer.length}</span>
        <span className="ft-rule" aria-hidden="true" />
      </div>
      <p className="note ft-no-producer-lede">
        These are a separate group, not amber. Amber means a reading that will arrive; these have no
        producer anywhere in the codebase, so there is nothing to be late and refreshing changes nothing.
      </p>
      <div className="ft-ledger-grid">
        {noProducer.map((p) => (
          <div key={p.title} className="ft-panel-card ft-panel-card-dashed">
            <div className="ft-panel-head"><strong>{p.title}</strong></div>
            <p className="note">{p.says}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
