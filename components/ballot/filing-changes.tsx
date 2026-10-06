import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import type { CandidacyRemoval } from "@/lib/ballot/types";

/** A sourced filing change is retained without listing a removed candidacy as current. */
export function FilingChanges({ removals }: { removals: readonly CandidacyRemoval[] }) {
  if (!removals.length) return null;
  return (
    <details className="mt-3 t-detail leading-relaxed text-paper-dim" data-filing-change-count={removals.length}>
      <summary className="cursor-pointer text-link">Filing changes ({removals.length})</summary>
      <ul className="mt-2 space-y-2">
        {removals.map((record) => (
          <li key={record.id} data-filing-change-id={record.id}>
            <p>{record.statement}</p>
            <CardSourcesContribution id={`filing-change:${record.id}`} sources={[{ what: "Earlier filing", provenance: record.lastListed }, { what: "Revised filing", provenance: record.absentFrom }]} />
          </li>
        ))}
      </ul>
    </details>
  );
}
