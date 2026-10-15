import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { candidateOwnKind, hostOf } from "@/lib/officials/verification";
import { VisibleCard } from "@/components/ballot/visible-card";
import { personInitials } from "@/lib/officials/person-name";
import { type CandidateCardData } from "@/lib/ballot/candidate-cards";
import type { CandidateLinks } from "@/lib/ballot/candidate-sites";

import type { SeatHolder } from "@/lib/officials/lookup";
import type { Provenance } from "@/lib/sources/types";

export function CandidatePortraitSources({ card }: { card: CandidateCardData | null }) {
  if (!card?.photoUrl || !card.photoSource) return null;
  const sources = card.photoVerification?.sources.map(source => ({ what: "Candidate portrait",
    provenance: { sourceUrl: source.url, sourceOrg: card.photoSource!, collectedAt: source.retrievedAt, verifiedAt: null } }))
    ?? [{ what: "Candidate portrait", provenance: { sourceUrl: card.photoUrl, sourceOrg: card.photoSource, collectedAt: "", verifiedAt: null } }];
  return <CardSourcesContribution id={`candidate-portrait:${card.photoUrl}`} sources={sources} />;
}

export function CandidateCard({
  name,
  partyLine,
  card,
  holder = null,
  links,
  filedSiteUrl,
  filingProvenance,
  nameSlot,
  battlecardSlot,
  derivedBlurb,
}: {

  derivedBlurb?: {
    text: string;
    sourceUrl: string;
    sourceLabel: string;
  } | null;
  name: string;

  nameSlot?: React.ReactNode;

  battlecardSlot?: React.ReactNode;

  partyLine: React.ReactNode;
  card: CandidateCardData | null;
  holder?: SeatHolder | null;
  links: CandidateLinks | null;

  filedSiteUrl?: string | null;
  filingProvenance?: Provenance;
}) {
  const photoUrl = card?.photoUrl ?? holder?.photoUrl ?? null;
  const hasLinks = Boolean(links?.official || links?.campaign || filedSiteUrl);
  return (

    <VisibleCard className="candidate-row" cardId={`CANDIDATE:${name}`} cardKind="CANDIDATE">
      {filingProvenance && <CardSourcesContribution id="candidate-filing" sources={[{ what: "Candidate name and party as filed", provenance: filingProvenance }]} />}
      <span className="candidate-avatar" aria-hidden={photoUrl ? undefined : true}>
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt={name}

            loading="lazy"
          />
        ) : (
          <span className="candidate-initials">{personInitials(name)}</span>
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

        <CandidatePortraitSources card={card} />
        {photoUrl && holder && !card?.photoUrl && (holder.fieldSources?.photoUrl ?? holder.provenance) &&
          <CardSourcesContribution id={`candidate-portrait:${holder.id}`} sources={[{ what: "Official portrait",
            provenance: (holder.fieldSources?.photoUrl ?? holder.provenance)! }]} />}
        {card?.bio && (
          <> <p className="mt-1 t-body leading-relaxed text-paper-dim">
            &ldquo;{card.bio}&rdquo;{" "}

          </p>
          <CardSourcesContribution id="candidate-bio" sources={[{ what: "Biography in the candidate's own words", provenance: { kind: candidateOwnKind(card.bioSourceUrl ?? null), sourceUrl: card.bioSourceUrl ?? "", sourceOrg: card.bioSourceLabel ?? (card.bioSourceUrl ? hostOf(card.bioSourceUrl) ?? "" : ""), collectedAt: "", verifiedAt: null } }]} /></>
        )}

        {!card?.bio && derivedBlurb && (
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

            {!links?.official && !links?.campaign && filedSiteUrl && (
              <a
                href={filedSiteUrl}
                target="_blank"
                rel="noreferrer"
                className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
              >
                {hostOf(filedSiteUrl)} (as filed)
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

        {card?.phone && card?.phoneLabel && (
          <p className="mt-1 t-detail text-muted">{card.phoneLabel}</p>
        )}

        {battlecardSlot}
      </div>
    </VisibleCard>
  );
}
