import {
  THIN_CANDIDATE_LINE,
  isThinCandidateCard,
  type CandidateCardData,
} from "@/lib/ballot/candidate-cards";
import type { CandidateLinks } from "@/lib/ballot/candidate-sites";

/**
 * The Kelly-standard candidate card (2b): not a hyperlink — a card. Photo
 * (labeled with its source), the candidate's own site's words for a bio
 * (attributed, never ours), published contact, official site first and
 * campaign site labeled, party as filed.
 *
 * Server component — everything here is curated data; the reaction control
 * rides separately in the page so this stays renderable anywhere.
 *
 * Honesty rules: a missing photo renders initials, never a broken image or a
 * stock face; a missing bio renders nothing (the hunt is recorded in the
 * data file); nothing here ranks, scores, or recommends.
 */

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function CandidateCard({
  name,
  partyLine,
  card,
  links,
  filedSiteUrl,
}: {
  name: string;
  /** Party label (and slogan where filed), already formatted by the caller. */
  partyLine: React.ReactNode;
  card: CandidateCardData | null;
  links: CandidateLinks | null;
  /** The URL the candidate stated in the filing, if any — a different claim
   *  from a hunted link, rendered only when no hunted link exists. */
  filedSiteUrl?: string | null;
}) {
  const hasLinks = Boolean(links?.official || links?.campaign || filedSiteUrl);
  // Item 5, the tester's finding: silent absence becomes named absence. The
  // line lives here rather than in a page, so it travels to every surface
  // the thin card renders on.
  const thin = isThinCandidateCard(card ?? null, hasLinks);
  return (
    <div className="flex gap-3">
      {card?.photoUrl ? (
        // External campaign-site photo; next/image would require
        // allowlisting every campaign's host.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={card.photoUrl}
          alt={`${name} — ${card.photoSource ?? "photo"}`}
          title={card.photoSource ?? undefined}
          className="h-16 w-16 shrink-0 rounded-lg border border-[var(--panel-border)] object-cover object-top"
          loading="lazy"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-[var(--panel-border)] bg-[var(--surface,rgba(255,255,255,0.06))] font-mono text-[1rem] text-muted"
        >
          {initials(name)}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="text-[0.9375rem] font-semibold tracking-tight">
            {name}
          </span>
          <span className="text-right text-[0.75rem] text-muted">
            {partyLine}
          </span>
        </div>

        {card?.bio && (
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-paper-dim">
            &ldquo;{card.bio}&rdquo;{" "}
            {card.bioSourceUrl && (
              <a
                href={card.bioSourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-muted underline decoration-dotted underline-offset-2 hover:text-link"
              >
                {card.bioSourceLabel ?? "source"}
              </a>
            )}
          </p>
        )}

        {(hasLinks || card?.email || card?.phone) && (
          // Links register (design pass): tappable things carry the link
          // color and the dotted underline, everywhere.
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.75rem]">
            {links?.official && (
              <a
                href={links.official.url}
                target="_blank"
                rel="noreferrer"
                className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
              >
                official site
              </a>
            )}
            {links?.campaign && (
              <a
                href={links.campaign.url}
                target="_blank"
                rel="noreferrer"
                className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
              >
                campaign site
              </a>
            )}
            {!links?.official && !links?.campaign && filedSiteUrl && (
              <a
                href={filedSiteUrl}
                target="_blank"
                rel="noreferrer"
                className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
              >
                site (as filed)
              </a>
            )}
            {card?.email && (
              <a
                href={`mailto:${card.email}`}
                className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
              >
                {card.email}
              </a>
            )}
            {card?.phone && (
              <a
                href={`tel:${card.phone.replace(/[^\d+]/g, "")}`}
                className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
              >
                {card.phone}
              </a>
            )}
          </p>
        )}

        {thin && (
          // The absence, named. Not muted into a footnote: a reader
          // skipping this candidate should see that the gap is ours.
          // Voice register — it describes our research, never them.
          <p className="mt-1 text-[0.75rem] leading-relaxed text-voice">
            {THIN_CANDIDATE_LINE}
          </p>
        )}
      </div>
    </div>
  );
}
