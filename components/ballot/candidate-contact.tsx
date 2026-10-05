/** Public campaign links and email, with the filing link retained in Sources. */
import type { CandidateCardData } from "@/lib/ballot/candidate-cards";
import type { CandidateLinks } from "@/lib/ballot/candidate-sites";
import type { CandidateContact as FilingContact } from "@/lib/ballot/candidate-contacts";
import { formatDateMDY } from "@/lib/map/format";

/**
 * What the Sources section says about the line a reader saw on the ballot.
 *
 * LEVEL register — a claim surface, about where a real person's words came
 * from. It attributes without characterising: it says the campaign published
 * it, and it does not say whether it is true.
 */
export const TAGLINE_SOURCE_NOTE =
  "The line beside this candidate's name on the ballot page is quoted from the campaign's own website, and is labelled there with the site it came from and the date we read it.";

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

  if (!campaign && !email && !filing) return null;

  return (
    <div data-candidate-contact className="mt-1 space-y-1.5">
      {filing && (
        <div data-filed-contact={filing.candidacyId} className="space-y-1 text-[0.75rem]">
          {filing.email && <p><a href={`mailto:${filing.email}`} className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid">{filing.email}</a></p>}
          <p className="text-[0.6875rem] text-muted">Published filing contact — <a href={filing.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-link underline decoration-dotted underline-offset-2">{filing.sourceOrg}</a>; read {formatDateMDY(filing.collectedAt)}.</p>
        </div>
      )}
      {(campaign || email) && (
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[0.75rem]">
          {campaign && (
            <a
              href={campaign.url}
              target="_blank"
              rel="noreferrer"
              className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
            >
              {campaign.label ?? "campaign site"}
            </a>
          )}
          {email && (
            <a
              href={`mailto:${email}`}
              className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
            >
              {email}
            </a>
          )}
        </p>
      )}

    </div>
  );
}
