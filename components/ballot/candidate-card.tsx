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
  nameSlot,
  battlecardSlot,
  annotationSlot,
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
  /**
   * **The positions annotation** — item 14, 2026-08-19. The COUNT, never the
   * enumeration.
   *
   * It renders directly above the pill, so the reader meets the number and
   * then the door to the detail behind it, in that order. The full list —
   * and the "as we read them, not a statement about what they think" clause
   * that must travel with it — lives inside the battlecard.
   */
  annotationSlot?: React.ReactNode;
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
    <div className="candidate-row">
      <span className="candidate-avatar" aria-hidden={card?.photoUrl ? undefined : true}>
        {card?.photoUrl ? (
          // External campaign-site photo; next/image would require
          // allowlisting every campaign's host.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.photoUrl}
            alt={`${name} — ${card.photoSource ?? "photo"}`}
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
            <span className="text-[0.9375rem] font-semibold tracking-tight">
              {name}
            </span>
          )}
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

        {!card?.bio && derivedBlurb && (
          // B14 (2026-08-19, g20). The same shape and the same label rule as
          // a curated bio, because it is the same kind of claim: the
          // campaign's own words, quoted, with the page and the read date.
          // Rendered only where no curated bio exists — the gap is where the
          // information asymmetry lives, and filling it is the whole row.
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-paper-dim">
            &ldquo;{derivedBlurb.text}&rdquo;{" "}
            <a
              href={derivedBlurb.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-muted underline decoration-dotted underline-offset-2 hover:text-link"
            >
              {derivedBlurb.sourceLabel}
            </a>
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

        {annotationSlot}

        {/* Item 12: directly beneath the links row, and beneath the thin
            line where there is one — a candidate we hold little about still
            gets the same door, because the pill is where the long sections
            went and a card without one would simply have lost them. */}
        {battlecardSlot}
      </div>
    </div>
  );
}
