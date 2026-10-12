import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { candidateOwnKind, hostOf } from "@/lib/officials/verification";
import { VisibleCard } from "@/components/ballot/visible-card";
import { personInitials } from "@/lib/officials/person-name";
import { type CandidateCardData } from "@/lib/ballot/candidate-cards";
import type { CandidateLinks } from "@/lib/ballot/candidate-sites";

const initials = personInitials;

/**
 * The candidate card. A missing photo renders initials; a missing bio renders
 * nothing; nothing here ranks, scores or recommends. Order is as filed.
 */
export function CandidateCard({
  name,
  partyLine,
  card,
  links,
  filedSiteUrl,
  nameSlot,
  battlecardSlot,
  derivedBlurb,
}: {
  /** The campaign's own one-line self-description, rendered only where no curated bio exists. */
  derivedBlurb?: {
    text: string;
    sourceUrl: string;
    sourceLabel: string;
  } | null;
  name: string;
  /**
   * The name as the door to the battlecard. A ReactNode because a function
   * cannot cross the server/client boundary. Absent where we hold no record.
   */
  nameSlot?: React.ReactNode;
  /** The battlecard pill, beneath the links row. People only: measures never render through this card. */
  battlecardSlot?: React.ReactNode;
  /** Party label (and slogan where filed), already formatted by the caller. */
  partyLine: React.ReactNode;
  card: CandidateCardData | null;
  links: CandidateLinks | null;
  /** The URL stated in the filing; rendered only when no hunted link exists. */
  filedSiteUrl?: string | null;
}) {
  const hasLinks = Boolean(links?.official || links?.campaign || filedSiteUrl);
  return (
    /* Fixed-size tile with its own ground so every row has the same silhouette. */
    <VisibleCard className="candidate-row" cardId={`CANDIDATE:${name}`} cardKind="CANDIDATE">
      <span className="candidate-avatar" aria-hidden={card?.photoUrl ? undefined : true}>
        {card?.photoUrl ? (
          // External campaign-site photo; next/image would need every host allowlisted.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.photoUrl}
            alt={card.photoSource ? `${name} — ${card.photoSource}` : name}
            title={card.photoSource ?? undefined}
            loading="lazy"
          />
        ) : (
          <span className="candidate-initials">{initials(name)}</span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          {nameSlot ?? (
            <span className="t-heading font-semibold tracking-tight">
              {name}
            </span>
          )}
          <span className="text-right t-detail text-muted">
            {partyLine}
          </span>
        </div>

        {card?.bio && (
          <> <p className="mt-1 t-body leading-relaxed text-paper-dim">
            &ldquo;{card.bio}&rdquo;{" "}

          </p>
          <CardSourcesContribution id="candidate-bio" sources={[{ what: "Biography in the candidate's own words", provenance: { kind: candidateOwnKind(card.bioSourceUrl ?? null), sourceUrl: card.bioSourceUrl ?? "", sourceOrg: card.bioSourceLabel ?? (card.bioSourceUrl ? hostOf(card.bioSourceUrl) ?? "" : ""), collectedAt: "", verifiedAt: null } }]} /></>
        )}

        {!card?.bio && derivedBlurb && (
          // The campaign's own words, quoted, with the page and read date.
          <> <p className="mt-1 t-body leading-relaxed text-paper-dim">
            &ldquo;{derivedBlurb.text}&rdquo;{" "}

          </p>
          <CardSourcesContribution id="candidate-derived-bio" sources={[{ what: "Biography in the candidate's own words", provenance: { kind: candidateOwnKind(derivedBlurb.sourceUrl), sourceUrl: derivedBlurb.sourceUrl, sourceOrg: derivedBlurb.sourceLabel, collectedAt: "", verifiedAt: null } }]} /></>
        )}

        {(hasLinks || card?.email || card?.phone) && (
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 t-detail">
            {links?.official && (
              <a
                href={links.official.url}
                target="_blank"
                rel="noreferrer"
                className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
              >
                {links.official.label ?? "official site"}
              </a>
            )}
            {/* Campaign site and email render inside the battlecard. */}
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

        {/* An office line, not the candidate's own, is labelled. */}
        {card?.phone && card?.phoneLabel && (
          <p className="mt-1 t-detail text-muted">{card.phoneLabel}</p>
        )}

        {battlecardSlot}
      </div>
    </VisibleCard>
  );
}
