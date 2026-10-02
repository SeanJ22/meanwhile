/**
 * **BAL-15 (2026-08-25) — what the ballot row handed to the battlecard.**
 *
 * The information matters; the placement was what was wrong. The ballot
 * points; the battlecard holds — the battlecard is where a reader meets the
 * campaign in its own words, and a leaner ballot page leads them there.
 *
 * Three things moved off the ballot row and land here: the **campaign site**,
 * the **email address** and the **filed mailing address**. Each keeps the
 * rendering rule it already had, because those rules were never about where the
 * fact sat:
 *
 * - The campaign site is LABELLED as the campaign's, never dressed as an
 *   official page (the campaign-site rule, and RULING 122's host label).
 * - The email is a `mailto:` — an invitation to act now, which it genuinely is.
 * - The address is **NOT a link** and carries its source (RULING 54). A
 *   `mailto:` or a `tel:` invites action; a mailing address is a fact, and
 *   dressing it as a tappable affordance would overstate what it is.
 *
 * **A null renders NOTHING** — no row, no label, no dash, no greyed line
 * (RULING 28). Cards in a contest may be different lengths and that is correct.
 *
 * ## The Sources annotation, which is the third part of the item
 *
 * The battlecard's Sources section also says where the ballot-card tagline
 * came from. `TAGLINE_SOURCE_NOTE` is that sentence. It is
 * exported rather than inlined so the Sources section and this block cannot
 * drift into saying two different things about one fact.
 */
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
  const address = card?.filedAddress !== filing?.filedAddress ? card?.filedAddress ?? null : null;

  if (!campaign && !email && !address && !filing?.email && !filing?.filedAddress) return null;

  return (
    <div data-candidate-contact className="mt-1 space-y-1.5">
      {filing && (filing.email || filing.filedAddress) && (
        <div data-filed-contact={filing.candidacyId} className="space-y-1 text-[0.75rem]">
          {filing.email && <p><a href={`mailto:${filing.email}`} className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid">{filing.email}</a></p>}
          {filing.filedAddress && <p className="text-muted-foreground">{filing.filedAddress}</p>}
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

      {address && (
        <p className="text-[0.75rem] text-muted-foreground">
          <span>{address}</span>
          {card?.filedAddressSource && (
            <span className="opacity-80"> — {card.filedAddressSource}</span>
          )}
        </p>
      )}
    </div>
  );
}
