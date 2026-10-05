import type { IssuePosition } from "@/lib/candidates/positions";
import { sourceKindLabel } from "@/lib/corpus/source-kinds";

/**
 * **What held campaign and official pages say** — P02's reader surface,
 * and D05's corpus reaching a reader. A phrase match alone does not prove a
 * personal candidate stance or the speaker of an endorsement.
 *
 * ## Quote and link. No sentence of ours sits on top.
 *
 * Every passage below is source text, verbatim and short, with
 * the page it came from and the date we read it. There is no summary line, no
 * characterisation, and no "they support X" anywhere — that is an editorial
 * act attributed to a real person, and it stays forbidden even where it would
 * be accurate.
 *
 * ## RULING 44 and RULING 47 (2026-08-20) — no count, no enumeration, no row
 *
 * This section used to carry three completeness statements: a count on the
 * ballot row (`positionsAnnotation`), a buried enumeration of the issues we
 * found nothing on, and a sentence for a candidate we hold no published words
 * for at all. All three are gone.
 *
 * The reasoning is RULING 42's, applied one layer in. Each of them printed a
 * measurement of OUR coverage next to a named person's name, and the shortest
 * version — the one a reader actually noticed — landed on the least-covered
 * candidate in the race. A digit is the banned statement compressed, and a
 * `<details>` summary reading "Which 9 we found nothing on" is the digit with
 * a door on it.
 *
 * What ships instead is one page-level line, once, at the foot of the ballot:
 * *"What we have found, we are displaying here."* (`app/ballot/page.tsx`,
 * `COLLECTION_NOTE`.) It says the same thing about every card at once.
 *
 * **So a candidate we hold nothing published for renders no section here at
 * all** — RULING 28: a field with no data renders nothing, no row, no label,
 * no placeholder. Cards in a contest are different lengths and that is
 * correct.
 *
 * ## Nothing is ordered by how much was found
 *
 * The issues render in the curated order. Sorting by match count would order
 * them by how loudly a campaign talks and read as a ranking of what the
 * candidate cares about — a claim no word search can support.
 */
export function CandidatePositions({
  headline,
  positions,
}: {
  /**
   * The provenance line above the quotes, or `null` when there is nothing to
   * put a line above. Never a count — see the ruling note above.
   */
  headline: string | null;
  positions: IssuePosition[];
}) {
  const matched = positions.filter((p) => p.answer.kind === "MATCHED");
  const nothingCollected = positions.every(
    (p) => p.answer.kind === "NOTHING_COLLECTED",
  );

  // RULING 28 + RULING 44: nothing held, nothing rendered. Not a placeholder,
  // not a greyed line, not a sentence about our research.
  if (nothingCollected || matched.length === 0 || !headline) return null;

  return (
    <div className="mt-3" data-candidate-positions>
      <p className="trailing-space-trimmed-15 font-mono text-[0.5625rem] uppercase tracking-[0.15em] text-muted">
        From campaign and official pages
      </p>
      {/* Provenance, not arithmetic: where these passages came from. */}
      <p className="mt-1 text-[0.75rem] leading-relaxed text-paper-dim">
        {headline}
      </p>

      <ul className="mt-2 space-y-3">
        {matched.map((position) => (
          <li key={position.issue.id}>
            <p className="text-[0.75rem] font-medium text-paper">
              {position.issue.label}
            </p>
            {position.answer.kind === "MATCHED" &&
              position.answer.passages.map((passage) => (
                <div
                  key={`${passage.documentUrl}-${passage.sourceRevisionId ?? "legacy"}-${passage.quote.slice(0, 40)}`}
                  className="mt-1 border-l-2 border-[var(--panel-border)] pl-3"
                >
                  {/* Source words. Never rewritten, never trimmed of
                      meaning — only of length, and then it says so with
                      the ellipses the corpus put there. */}
                  <p className="t-record text-[0.75rem] leading-relaxed text-paper-dim">
                    &ldquo;{passage.quote}&rdquo;
                  </p>
                  <p className="mt-0.5 text-[0.6875rem] text-muted">
                    {sourceKindLabel(passage.sourceClass)}
                    {" · "}
                    <a
                      href={passage.documentUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline decoration-dotted underline-offset-2 hover:text-link"
                    >
                    {new URL(passage.documentUrl).hostname}
                    </a>
                    {passage.revisionStatus === "HISTORICAL" ? " · earlier captured version" :
                      passage.revisionStatus === "CURRENT" ? " · latest captured version" : ""}
                    {passage.publicationDate && ` · source-stated publication date ${passage.publicationDate.date}`}
                    {" · read "}
                    {passage.retrievedAt.slice(0, 10)}
                  </p>
                </div>
              ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
