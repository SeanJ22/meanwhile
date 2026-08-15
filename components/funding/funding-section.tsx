import type {
  FundingAbsenceData,
  FundingDisplayData,
} from "@/lib/funding/display";
import {
  contributorTypeLabel,
  plainContributorLabel,
} from "@/lib/funding/labels";
import type { ReactionViewContext } from "@/lib/reactions/client";
import { ReactionControl } from "@/components/reactions/reaction-control";
import { formatDateMDY } from "@/lib/map/format";

/**
 * The Funding section (D34) — campaign money in the plain register, on
 * candidate cards and the official large popup. FUNDING is its own evidence
 * tier (CLAUDE.md): visually distinct from statements and votes, and the
 * data never blends with either.
 *
 * What renders is exactly what the FEC publishes: committee totals in
 * sentences, and — while ripcord.fecContributorDisplay is live — the
 * largest contributions listed as filed, cited, never characterized. The
 * reaction controls are the standard reusable control, tagged
 * FUNDING_TOTAL_REACTION / CONTRIBUTOR_REACTION and keyed by FEC candidate
 * id so the same committee gets the same answer everywhere.
 *
 * No directive on this file: rendered by the server ballot page and by the
 * client modal alike.
 */

const SECTION_LABEL_CLASS =
  "font-mono text-[0.5625rem] uppercase tracking-[0.15em] text-muted";

export function FundingDisplay({
  data,
  context,
}: {
  data: FundingDisplayData;
  context: ReactionViewContext | null;
}) {
  return (
    <div className="mt-2">
      <p className={SECTION_LABEL_CLASS}>Campaign money · FEC</p>
      {data.sentences.map((sentence) => (
        <p key={sentence} className="mt-1 text-[0.75rem] leading-relaxed text-paper-dim">
          {sentence}
        </p>
      ))}
      <ReactionControl
        targetType="FUNDING_TOTAL_REACTION"
        targetId={data.fecCandidateId}
        prompt="Would you vote for someone whose campaign is funded this way?"
        context={context}
      />

      {data.contributorsShown && (
        <div className="mt-2">
          <p className={SECTION_LABEL_CLASS}>Largest reported contributions</p>
          <p className="mt-0.5 text-[0.6875rem] text-muted">
            The biggest single contributions this campaign&apos;s main
            committee has reported, listed exactly as filed.
          </p>
          <ul className="mt-1 space-y-1">
            {data.contributors.map((row, index) => {
              // 2a: the suffix comes from the FEC's entity typing — a
              // candidate's own money says so, plainly.
              const entityLabel = plainContributorLabel(row);
              // Item 6 (2026-08-14): where the contributing committee filed
              // its own typing, the label carries an explainer. `typeLabel`
              // is null for individuals and for rows the FEC never typed —
              // those keep the plain suffix with nothing to tap, because
              // there is nothing more we honestly know.
              const typeLabel = contributorTypeLabel(row);
              return (
              <li
                key={`${row.contributorName}-${row.amount}-${index}`}
                className="text-[0.75rem]"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-paper-dim">
                    {row.contributorName}
                    {row.city && row.state && (
                      <span className="text-muted"> · {row.city}, {row.state}</span>
                    )}
                    {entityLabel && !typeLabel && (
                      <span className="text-muted"> · {entityLabel}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-[0.6875rem]">
                    ${Math.round(row.amount).toLocaleString("en-US")}
                  </span>
                </div>
                {typeLabel && (
                  // Expansion, never a new tab (CLAUDE.md's reader gesture).
                  // `<details>` so this stays a server-renderable component
                  // and costs no client JavaScript.
                  <details className="funding-type">
                    <summary>{typeLabel.label}</summary>
                    <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-muted">
                      {typeLabel.explainer}{" "}
                      <a
                        href={typeLabel.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-dotted"
                      >
                        the FEC&apos;s own definition
                      </a>
                    </p>
                  </details>
                )}
              </li>
              );
            })}
          </ul>
          <ReactionControl
            targetType="CONTRIBUTOR_REACTION"
            targetId={data.fecCandidateId}
            prompt="Would you vote for someone with these contributors?"
            context={context}
          />
        </div>
      )}

      <p className="mt-1.5 text-[0.625rem] text-muted">
        {data.sourceUrl ? (
          <a
            href={data.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted"
          >
            {data.sourceOrg}
          </a>
        ) : (
          data.sourceOrg
        )}
        {data.reportedThrough && (
          <> · reported through {formatDateMDY(data.reportedThrough)}</>
        )}{" "}
        · read {formatDateMDY(data.collectedAt)}
      </p>
    </div>
  );
}

export function FundingAbsence({ data }: { data: FundingAbsenceData }) {
  return (
    <div className="mt-2">
      <p className={SECTION_LABEL_CLASS}>Campaign money · FEC</p>
      <p className="mt-1 text-[0.75rem] leading-relaxed text-muted">
        {data.statement}{" "}
        {data.searchUrl && (
          <a
            href={data.searchUrl}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted"
          >
            FEC records
          </a>
        )}{" "}
        <span>(checked {formatDateMDY(data.checkedAt)})</span>
      </p>
    </div>
  );
}

/** The honest line for state and local races — a stated gap, never silence. */
export function StateFundingNote({ note }: { note: string }) {
  return (
    <p className="mt-2 text-[0.6875rem] leading-relaxed text-muted">{note}</p>
  );
}
