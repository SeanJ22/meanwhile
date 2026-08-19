import type { IssuePosition } from "@/lib/candidates/positions";

/**
 * **What this candidate has said, in their own words** — P02's reader
 * surface, and D05's corpus reaching a reader.
 *
 * ## Quote and link. No sentence of ours sits on top.
 *
 * Every passage below is the candidate's own text, verbatim and short, with
 * the page it came from and the date we read it. There is no summary line, no
 * characterisation, and no "they support X" anywhere — that is an editorial
 * act attributed to a real person, and it stays forbidden even where it would
 * be accurate.
 *
 * ## The three answers render as three different sentences
 *
 * "We searched their pages and nothing mentions veterans" and "we haven't
 * collected anything they've published" are different facts about different
 * things — the first about them, the second about us — and a reader who sees
 * one blank cannot tell which they got. Both render, in words, with the
 * pages and dates named.
 *
 * ## Equal effort, visible
 *
 * The header states the denominator before any count: the same issue list is
 * searched for every candidate in the contest. A candidate with three matches
 * beside one with eleven is then a fact about what each has published, which
 * is what the equal-effort rule exists to make legible — a thin card that
 * tracks campaign professionalism is a thumb on the scale no neutrality rule
 * above catches.
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
  headline: string;
  positions: IssuePosition[];
}) {
  const matched = positions.filter((p) => p.answer.kind === "MATCHED");
  const searchedEmpty = positions.filter(
    (p) => p.answer.kind === "SEARCHED_NOTHING_MATCHED",
  );
  const nothingCollected = positions.every(
    (p) => p.answer.kind === "NOTHING_COLLECTED",
  );

  return (
    <div className="mt-3">
      <p className="font-mono text-[0.5625rem] uppercase tracking-[0.15em] text-muted">
        In their own words
      </p>
      {/* The denominator first — every count below is out of the same list. */}
      <p className="mt-1 text-[0.75rem] leading-relaxed text-paper-dim">
        {headline}
      </p>

      {!nothingCollected && matched.length > 0 && (
        <ul className="mt-2 space-y-3">
          {matched.map((position) => (
            <li key={position.issue.id}>
              <p className="text-[0.75rem] font-medium text-paper">
                {position.issue.label}
              </p>
              {position.answer.kind === "MATCHED" &&
                position.answer.passages.map((passage) => (
                  <div
                    key={`${passage.documentUrl}-${passage.quote.slice(0, 40)}`}
                    className="mt-1 border-l-2 border-[var(--panel-border)] pl-3"
                  >
                    {/* Their words. Never rewritten, never trimmed of
                        meaning — only of length, and then it says so with
                        the ellipses the corpus put there. */}
                    <p className="text-[0.75rem] leading-relaxed text-paper-dim">
                      &ldquo;{passage.quote}&rdquo;
                    </p>
                    <p className="mt-0.5 text-[0.6875rem] text-muted">
                      {passage.sourceClass === "CAMPAIGN_SITE"
                        ? "their campaign site"
                        : "their official site"}
                      {" · "}
                      <a
                        href={passage.documentUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="underline decoration-dotted underline-offset-2 hover:text-link"
                      >
                        {new URL(passage.documentUrl).hostname}
                      </a>
                      {" · read "}
                      {passage.retrievedAt.slice(0, 10)}
                    </p>
                  </div>
                ))}
            </li>
          ))}
        </ul>
      )}

      {!nothingCollected && searchedEmpty.length > 0 && (
        // NAMED, not omitted. An issue we searched and found nothing on is a
        // different fact from an issue we never searched, and leaving it out
        // would let a reader read the matched list as the whole list.
        <p className="mt-2 text-[0.6875rem] leading-relaxed text-muted">
          Nothing in the pages we hold from them mentions{" "}
          {searchedEmpty.map((p) => p.issue.label).join(", ")}. That is what
          their own pages say, as we read them — not a statement about what
          they think.
        </p>
      )}
    </div>
  );
}
