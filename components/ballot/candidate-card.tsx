import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { sourceLabelReadDate, splitLabelReadStamp } from "@/lib/ballot/label-read-stamp";
import { hostOf } from "@/lib/officials/verification";
import { VisibleCard } from "@/components/ballot/visible-card";
import { personInitials } from "@/lib/officials/person-name";
import { type CandidateCardData } from "@/lib/ballot/candidate-cards";
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

/*
 * The initials live in `lib/officials/person-name.ts`. This file used to carry
 * its own, which took the first TWO alphabetic tokens — so `Thomas J. Haynes`
 * initialled a middle name and rendered `TJ`. Three surfaces each held a
 * different version of this function; keeping a retired copy here is how the
 * fourth one gets written.
 */
const initials = personInitials;

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
  /**
   * **B14's blurb rung** — the campaign's own one-line self-description,
   * captured on the corpus retrieval. Rendered ONLY where no curated bio
   * exists: a session that hand-read a candidate's site and wrote the bio
   * down beats a meta tag, and this fills the gap underneath, which is
   * exactly where the information asymmetry lives.
   */
  derivedBlurb?: {
    text: string;
    sourceUrl: string;
    sourceLabel: string;
  } | null;
  name: string;
  /**
   * The name rendered as the door to this person's large battlecard (g3 item
   * 7). A ReactNode, never a render function — a function cannot cross the
   * server/client boundary, and doing that is what 500'd `/about-area`.
   *
   * Absent for anyone we hold no record for: their name stays plain text
   * rather than becoming a link onto an empty card.
   */
  nameSlot?: React.ReactNode;
  /**
   * **The battlecard pill** — F01-continued session 2, item 12, 2026-08-19.
   *
   * Rendered directly beneath the links row, full width of the ballot
   * column. A ReactNode for the same reason `nameSlot` is one: the pill is a
   * client component and this card is a server component, and a function
   * cannot cross that boundary.
   *
   * **PEOPLE ONLY**, and the distinction is structural rather than a
   * condition anybody has to remember. This slot exists on the CANDIDATE
   * card, and the candidate card is the component the ballot renders for a
   * person — a nominee or a filed candidacy. A ballot measure never reaches
   * this component at all: it renders through the measure path, with its
   * provisions and its own reaction targets. So a measure cannot grow a
   * "View Battlecard" pill by being forgotten about; it would have to be
   * given one deliberately, by passing it a component built for people.
   * `tests/candidate-battlecard.test.ts` holds that line.
   */
  battlecardSlot?: React.ReactNode;
  /** Party label (and slogan where filed), already formatted by the caller. */
  partyLine: React.ReactNode;
  card: CandidateCardData | null;
  links: CandidateLinks | null;
  /** The URL the candidate stated in the filing, if any — a different claim
   *  from a hunted link, rendered only when no hunted link exists. */
  filedSiteUrl?: string | null;
}) {
  const hasLinks = Boolean(links?.official || links?.campaign || filedSiteUrl);
  /*
   * **RULING 42 (Prompt E item 3, 2026-08-20) — there is no per-card marker.**
   *
   * `THIN_CANDIDATE_LINE` used to render here, on any card holding no photo,
   * no words, no contact and no link. It was added for the right reason —
   * silence reads as absence of the candidate rather than absence of our
   * research — and it was the wrong instrument, because it printed only on the
   * shortest card in the race. A marker that appears exactly on the
   * least-resourced person is the information asymmetry pointed the other way:
   * the reader is told which candidate we know least about, on their card, in
   * their column, next to their name.
   *
   * The disclosure it was carrying is now made ONCE, at the foot of the ballot
   * page, about every card equally — `app/ballot/page.tsx`, `COLLECTION_NOTE`.
   * Nothing is hidden and nothing moved into a tooltip; the same fact is
   * stated where it cannot single anybody out.
   */
  return (
    /*
     * Item 6b3 (2026-08-15) — the author: "photos scattered through a contest
     * read as broken." The fix is GEOMETRY, and it is deliberately not
     * ordering.
     *
     * What was actually wrong, measured rather than assumed: the tile was
     * already 64×64 for both a photo and initials, so the *box* was uniform.
     * What was not uniform was what sat INSIDE it. A campaign portrait
     * published as a circular PNG on transparency (Risa Lombardo's) rendered
     * as a floating disc against the page while its neighbours rendered as
     * full-bleed rectangles, and a portrait with lots of headroom sat at a
     * different optical weight again. Three candidates, three different
     * shapes, in a column that is supposed to read as one rhythm.
     *
     * So the tile is now a real surface: fixed size, its own background, its
     * own border and radius, `object-cover` on top of it. A transparent
     * source lands on the same ground the initials do, and every row in a
     * contest has the same silhouette whatever the source published.
     *
     * ORDER IS UNTOUCHED — as filed. Sorting the photographed candidates to
     * the top would make the layout tidier by handing the visual advantage to
     * exactly the candidates who already have the information advantage,
     * which is the thin-card bias the equal-effort rule exists to catch. If
     * the geometry fix does not satisfy the author's eye, ordering is HIS
     * decision to revisit, not a tidy-up.
     */
    <VisibleCard className="candidate-row" cardId={`CANDIDATE:${name}`} cardKind="CANDIDATE">
      <span className="candidate-avatar" aria-hidden={card?.photoUrl ? undefined : true}>
        {card?.photoUrl ? (
          // External campaign-site photo; next/image would require
          // allowlisting every campaign's host.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.photoUrl}
            /*
             * **NO INVENTED DESCRIPTOR** (2026-08-23, item 3). This read
             * `?? "photo"`, which put a word we did not have into the place
             * the photo's SOURCE belongs. Where the source is recorded it is
             * named; where it is not, the alt text is the person's name and
             * nothing else.
             */
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
          <CardSourcesContribution id="candidate-bio" sources={[{ what: "Biography in the candidate's own words", provenance: { sourceUrl: card.bioSourceUrl ?? "", sourceOrg: sourceLabelReadDate(card.bioSourceLabel).org || (card.bioSourceUrl ? hostOf(card.bioSourceUrl) ?? "" : ""), collectedAt: sourceLabelReadDate(card.bioSourceLabel).readAt, verifiedAt: null } }]} /></>
        )}

        {!card?.bio && derivedBlurb && (
          // B14 (2026-08-19, g20). The same shape and the same label rule as
          // a curated bio, because it is the same kind of claim: the
          // campaign's own words, quoted, with the page and the read date.
          // Rendered only where no curated bio exists — the gap is where the
          // information asymmetry lives, and filling it is the whole row.
          <> <p className="mt-1 t-body leading-relaxed text-paper-dim">
            &ldquo;{derivedBlurb.text}&rdquo;{" "}

          </p>
          <CardSourcesContribution id="candidate-derived-bio" sources={[{ what: "Biography in the candidate's own words", provenance: { sourceUrl: derivedBlurb.sourceUrl, sourceOrg: sourceLabelReadDate(derivedBlurb.sourceLabel).org, collectedAt: sourceLabelReadDate(derivedBlurb.sourceLabel).readAt, verifiedAt: null } }]} /></>
        )}

        {(hasLinks || card?.email || card?.phone) && (
          // Links register (design pass): tappable things carry the link
          // color and the dotted underline, everywhere.
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
            {/*
              **BAL-15 (2026-08-25) — the campaign site, the email and the
              mailing address MOVED INTO THE BATTLECARD.**

              Sean red-boxed exactly this row and the address line under it on
              `17-37-45`, and gave the reason rather than only the change:
              *"we always want people to choose the battlecard, in the
              campaign's own words. Stripping the ballot page drives them
              there."*

              **Nothing is deleted.** The ballot POINTS and the battlecard
              HOLDS: the official site stays here, because it is the one link
              that answers *who is this in office* rather than *what does their
              campaign say*, and the phone stays because a number a reader can
              tap now is not extra text. Everything else renders inside the
              card, under Sources, with the same provenance it always carried.

              Equal-effort neutrality applies and the mechanism is structural,
              not remembered: this treatment lands on `CandidateCard`, which is
              the ONE component every candidate in every contest renders
              through, so it cannot land for one candidate and not another.
            */}
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

        {/*
          RULING 64 (2026-08-21): where the number is an OFFICE line rather than
          the candidate's own, it says so — here, next to it, in the reader's
          own words.

          Two County Attorney candidates carried the same switchboard in two
          formats with nothing marking it, which reads as each person's own
          number. The ruling is that the line is published and LABELLED; the
          label is the whole of what makes publishing it honest. It is a claim
          surface, so the register is level and the string is the office's own
          name — never a hedge, and never hunt vocabulary.
        */}
        {card?.phone && card?.phoneLabel && (() => {
          // FE-14: the label stays here; its inline read date and host move
          // to the card's Sources section.
          const label = splitLabelReadStamp(card.phoneLabel);
          return (
            <>
              <p className="mt-1 t-detail text-muted">{label.text}</p>
              {label.readAt && (
                <CardSourcesContribution
                  id="candidate-phone-label"
                  sources={[{ what: "The office phone line and address", provenance: { sourceUrl: label.host ? `https://${label.host}` : "", sourceOrg: label.host ?? "", collectedAt: label.readAt, verifiedAt: null } }]}
                />
              )}
            </>
          );
        })()}

        {/*
          RULING 54 (2026-08-21): the address the candidate filed with the
          state renders. It is on a public form they submitted for exactly this
          purpose, and for some candidates it is the ONLY way to reach them —
          Kathleen Donnelly and Cynthia Rusis had no contact at all while their
          opponents showed phones and sites.

          NOT a link. A `mailto:` or `tel:` is an invitation to act now; a
          mailing address is a fact, and dressing it as a tappable affordance
          would overstate what it is. It renders in the LEVEL register — this is
          a claim surface, about a real person's real address.

          The source rides with it, per the rule that every fact carries its
          source class. A null renders NOTHING — no row, no label, no dash
          (RULING 28).
        */}
        {/*
          **BAL-15 (2026-08-25): the filed address moved into the battlecard.**

          RULING 54's reasoning is untouched and travels WITH it — the address
          is on a public form the candidate submitted for exactly this purpose,
          for some of them it is the only route to reach them at all, it is
          never a link, and it carries its source. What changed is WHERE a
          reader finds it: one tap into the card rather than as a fourth line
          of small type on a ballot row.
        */}

        {/* Item 12: directly beneath the links row — a candidate we hold
            little about still gets the same door, because the pill is where
            the long sections went and a card without one would simply have
            lost them. (The thin line that used to sit above this went with
            RULING 42; the door did not move.) */}
        {battlecardSlot}
      </div>
    </VisibleCard>
  );
}
