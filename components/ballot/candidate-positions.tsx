import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import type { IssuePosition } from "@/lib/candidates/positions";
import { sourceKindLabel } from "@/lib/corpus/source-kinds";

/**
 * What held campaign and official pages say, as verbatim short quotes with
 * page and read date; no summary, characterisation or count of ours. A phrase
 * match alone does not prove a personal stance. Issues stay in curated order,
 * never sorted by match count.
 */
export function CandidatePositions({
  headline,
  positions,
}: {
  /** The provenance line above the quotes, or `null` when there is nothing to show. Never a count. */
  headline: string | null;
  positions: IssuePosition[];
}) {
  const matched = positions.filter((p) => p.answer.kind === "MATCHED");
  const nothingCollected = positions.every(
    (p) => p.answer.kind === "NOTHING_COLLECTED",
  );

  if (nothingCollected || matched.length === 0 || !headline) return null;

  return (
    <div className="mt-3" data-candidate-positions>
      <CardSourcesContribution id="candidate-positions" sources={matched.flatMap(position => position.answer.kind === "MATCHED" ? position.answer.passages.map(passage => ({ what: [position.issue.label, sourceKindLabel(passage.sourceClass), passage.revisionStatus === "HISTORICAL" ? "earlier captured version" : passage.revisionStatus === "CURRENT" ? "latest captured version" : "", passage.publicationDate ? `source-stated publication date ${passage.publicationDate.date}` : ""].filter(Boolean).join(" · "), provenance: { sourceUrl: passage.documentUrl, sourceOrg: "", collectedAt: passage.retrievedAt, verifiedAt: null } })) : [])} />
      <ul className="mt-2 space-y-3">
        {matched.map((position) => (
          <li key={position.issue.id}>
            <p className="t-detail font-medium text-paper">
              {position.issue.label}
            </p>
            {position.answer.kind === "MATCHED" &&
              position.answer.passages.map((passage) => (
                <div
                  key={`${passage.documentUrl}-${passage.sourceRevisionId ?? "legacy"}-${passage.quote.slice(0, 40)}`}
                  className="mt-1 border-l-2 border-[var(--panel-border)] pl-3"
                >
                  {/* Source words, never rewritten; trimmed only for length, with the corpus's ellipses. */}
                  <p className="t-record t-detail leading-relaxed text-paper-dim">
                    &ldquo;{passage.quote}&rdquo;
                  </p>

                </div>
              ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
