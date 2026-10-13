/** Public campaign links and email, with the filing link retained in Sources. */
import { CheckedLink } from "@/components/ui/checked-link";
import type { CandidateCardData } from "@/lib/ballot/candidate-cards";
import type { CandidateLinks } from "@/lib/ballot/candidate-sites";
import type { CandidateContact as FilingContact } from "@/lib/ballot/candidate-contacts";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { candidateOwnKind } from "@/lib/officials/verification";

/**
 * What the Sources section says about the line a reader saw on the ballot.
 *
 * LEVEL register — a claim surface, about where a real person's words came
 * from. It attributes without characterising: it says the campaign published
 * it, and it does not say whether it is true.
 */
export const TAGLINE_SOURCE_NOTE =
  "The line beside this candidate's name on the ballot page is quoted from the campaign's own website, with its published source retained under Sources.";

export function CandidateContact({
  card,
  links,
  filing = null,
}: {
  card: CandidateCardData | null;
  links: CandidateLinks | null;
  filing?: FilingContact | null;
}) {
  const campaign = links?.campaign ?? null;
  const email = card?.email !== filing?.email ? card?.email ?? null : null;

  if (!campaign && !email && !filing?.email) return null;

  return (
    <div data-candidate-contact className="contact-pill-row">
      {filing?.email && (
        <div data-filed-contact={filing.candidacyId} className="space-y-1 t-detail">
          {filing.email && <p><CheckedLink href={`mailto:${filing.email}`} className="contact-pill">{filing.email}</CheckedLink></p>}
        </div>
      )}
      {(campaign || email) && (
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 t-detail">
          {campaign && (
            <CheckedLink
              href={campaign.url}
              target="_blank"
              rel="noreferrer"
              className="contact-pill"
            >
              {campaign.label ?? "campaign site"}
            </CheckedLink>
          )}
          {email && (
            <CheckedLink
              href={`mailto:${email}`}
              className="contact-pill"
            >
              {email}
            </CheckedLink>
          )}
        </p>
      )}

    </div>
  );
}

/** Campaign and filing attribution belongs to the person card's Sources section. */
export function CandidateContactSources({ links, filing }: { links: CandidateLinks | null; filing?: FilingContact | null }) {
  const sources = [
    ...(links?.campaign ? [{ what: "Campaign contacts and website", provenance: { kind: candidateOwnKind(links.campaign.url), sourceOrg: links.campaign.label ?? "Campaign", sourceUrl: links.campaign.url, collectedAt: links.campaign.attemptedAt, verifiedAt: links.campaign.attemptedAt } }] : []),
    ...(filing ? [{ what: "Published filing contact", provenance: { sourceOrg: filing.sourceOrg, sourceUrl: filing.sourceUrl, collectedAt: filing.collectedAt, verifiedAt: null } }] : []),
  ];
  return sources.length ? <CardSourcesContribution id={`candidate-contact:${filing?.candidacyId ?? links?.campaign?.url}`} sources={sources} /> : null;
}
