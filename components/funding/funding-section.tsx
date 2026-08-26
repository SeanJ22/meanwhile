import type {
  FundingAbsenceData,
  FundingDisplayData,
} from "@/lib/funding/display";
import { groupContributions, type ContributorGroup } from "@/lib/funding/grouping";
import {
  contributorTypeLabel,
  plainContributorLabel,
} from "@/lib/funding/labels";
import { pillClassFor } from "@/lib/funding/pill-colors";
import type { SecondHopCommittee } from "@/lib/funding/types";
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

const SECTION_LABEL_CLASS = "t-eyebrow text-muted";

export function FundingDisplay({
  data,
  context,
  bare = false,
}: {
  data: FundingDisplayData;
  context: ReactionViewContext | null;
  /**
   * Inside a CardSection whose header already says "Campaign money" (6b4):
   * the block drops its own frame and eyebrow rather than nesting two frames
   * and saying the same two words twice, one line apart.
   */
  bare?: boolean;
}) {
  // The flagship treatment (design pass, item 2b): the money surface is
  // the product's most distinctive content and renders like it — the
  // section carries its own frame, contributor rows read as designed
  // records, type labels render as pills. Rendering only: the data, the
  // labels, the mapping table and the organizations-as-filed rule are
  // untouched.
  return (
    <div
      data-funding-section
      className={
        bare
          ? ""
          : "mt-3 rounded-md border border-[var(--panel-border)] bg-[var(--surface,rgba(255,255,255,0.04))]/60 p-3"
      }
    >
      {!bare && <p className={SECTION_LABEL_CLASS}>Campaign money · FEC</p>}
      {data.sentences.map((sentence) => (
        <p key={sentence} className="mt-1.5 text-[0.8125rem] leading-relaxed text-paper-dim">
          {sentence}
        </p>
      ))}
      {/* The author's question, 2026-08-15. The old wording — "Would you
          vote for someone whose campaign is funded this way?" — asked the
          reader to convert a feeling about money into a voting intention,
          which is two questions in one button row. This asks the one the
          display is actually about, on the five-point scale the server
          accepts for funding targets and nothing else. */}
      <ReactionControl
        targetType="FUNDING_TOTAL_REACTION"
        targetId={data.fecCandidateId}
        prompt="How do you feel about how this campaign is funded?"
        context={context}
      />

      {data.contributorsShown && (
        <div className="mt-3">
          <p className={SECTION_LABEL_CLASS}>Largest reported contributions</p>
          <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-voice">
            The biggest contributions this campaign&apos;s main committee has
            reported, listed exactly as filed — biggest first, in two groups.
          </p>
          {/* Item 2 (2026-08-15): two compact columns, each sorted by amount
              descending. The reader's question is "who has spent the most to
              get this person elected?", and a single list led by individuals
              does not answer it. Stacked on a phone, side by side from 640px;
              the sort and the grouping are identical either way, and both
              come from lib/funding/grouping.ts so the two funding surfaces
              cannot drift apart. */}
          <div className="mt-2 grid gap-x-5 gap-y-3 sm:grid-cols-2">
            <ContributorColumn
              title="Committees & organizations"
              groups={data.contributorGroups.organizations}
              secondHop={data.secondHop}
            />
            <ContributorColumn
              title="Individual donors"
              groups={data.contributorGroups.individuals}
              secondHop={{}}
            />
          </div>
          {/*
            ITEM 5 (2026-08-16, the author): ONE ASK PER OBJECT.
            This prompt was word-for-word the first one, so a reader who had
            just answered "How do you feel about how this campaign is funded?"
            after the totals met the identical sentence again under the
            contributions table. It read as a nag, and an annoyed second
            answer is worse data than no second answer.

            Two different civic objects deserve two different questions. The
            totals are how much money and where it came from in aggregate;
            this table is WHO GAVE IT, by name, as filed. The sensors were
            already distinct — CONTRIBUTOR_REACTION and
            FUNDING_TOTAL_REACTION are separate target types, so they write
            separate rows under the unique index and aggregate under separate
            keys — and only the wording was pooling them in the reader's head.
          */}
          <ReactionControl
            targetType="CONTRIBUTOR_REACTION"
            targetId={data.fecCandidateId}
            prompt="How do you feel about these contributions?"
            context={context}
          />
        </div>
      )}

      {data.contributorsShown && data.concentrationSentences.length > 0 && (
        <div className="mt-3">
          <p className={SECTION_LABEL_CLASS}>Where that money came from</p>
          {/*
            D06 (2026-08-18). Placed AFTER the contributions table on
            purpose: these are figures ABOUT the rows above, and a summary
            that appears before the thing it summarises reads as an
            independent claim.

            LEVEL register throughout — a claim surface about a real
            person's money. It states shares; it never says whether a share
            is high, unusual, or a problem, and it never sorts a donor into
            an industry or a cause.

            Every sentence carries its denominator, built in
            lib/funding/concentration.ts: these are computed over the
            LARGEST reported contributions and not the campaign's whole
            book, and a percentage without that base is a false claim.
          */}
          <ul className="mt-1 space-y-1.5">
            {data.concentrationSentences.map((sentence) => (
              <li
                key={sentence}
                className="text-[0.75rem] leading-relaxed text-paper-dim"
              >
                {sentence}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.contributorsShown && data.typeConcentrationSentences.length > 0 && (
        <div className="mt-3">
          <p className={SECTION_LABEL_CLASS}>What kind of money it was</p>
          {/*
            D06's third feature (2026-08-19, g20), on the author's ruling
            "Accept": concentration on the FEC's OWN axis, because an
            industry axis would need a taxonomy no government body
            publishes — see lib/funding/type-concentration.ts.

            LEVEL register. Every band is a category the contributing
            committee filed for itself; the app never decides what kind of
            thing an organization is, and never says whether a category is
            good, bad or unusual.

            Committee money only, and the first sentence says so: the
            committee and individual lists were sampled separately, so a
            band spanning both would be a share of a base we chose.
          */}
          <ul className="mt-1 space-y-1.5">
            {data.typeConcentrationSentences.map((sentence) => (
              <li
                key={sentence}
                className="text-[0.75rem] leading-relaxed text-paper-dim"
              >
                {sentence}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-2 text-[0.625rem] text-muted">
        {data.sourceUrl ? (
          <a
            href={data.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:text-link"
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

/**
 * One of the two money columns. Renders nothing when its group is empty:
 * the snapshot holds the FEC's top receipts, so an empty committees column
 * means no committee appears among them — and a "none" line there would
 * read as a claim about the whole book rather than about this list.
 */
function ContributorColumn({
  title,
  groups,
  secondHop,
}: {
  title: string;
  groups: ContributorGroup[];
  secondHop: Record<string, SecondHopCommittee>;
}) {
  if (groups.length === 0) return null;
  return (
    <div>
      <p className="text-[0.625rem] font-semibold uppercase trailing-space-trimmed-8 tracking-[0.08em] text-muted">
        {title}
      </p>
      <ul className="mt-1" data-contributor-group={title}>
        {groups.map((group) => (
          <ContributorRow
            key={group.key}
            group={group}
            hop={
              group.contributorCommitteeId
                ? (secondHop[group.contributorCommitteeId] ?? null)
                : null
            }
          />
        ))}
      </ul>
    </div>
  );
}

function ContributorRow({
  group,
  hop,
}: {
  group: ContributorGroup;
  hop: SecondHopCommittee | null;
}) {
  // 2a: the suffix comes from the FEC's entity typing — a candidate's own
  // money says so, plainly.
  const entityLabel = plainContributorLabel(group);
  // Item 6 (2026-08-14): where the contributing committee filed its own
  // typing, the label carries an explainer. `typeLabel` is null for
  // individuals and for rows the FEC never typed — those keep the plain
  // suffix with nothing to tap, because there is nothing more we honestly
  // know.
  const typeLabel = contributorTypeLabel(group);
  return (
    <li
      className="border-b border-[var(--panel-border)] py-1.5 text-[0.75rem] last:border-0"
      data-contributor-amount={Math.round(group.amount)}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 font-medium text-paper">
          {group.contributorName}
          {group.city && group.state && (
            <span className="font-normal text-muted"> · {group.city}, {group.state}</span>
          )}
          {entityLabel && !typeLabel && (
            <span className="font-normal text-muted"> · {entityLabel}</span>
          )}
        </span>
        <span className="shrink-0 font-mono text-[0.75rem] font-medium tabular-nums">
          ${Math.round(group.amount).toLocaleString("en-US")}
        </span>
      </div>
      {typeLabel && (
        // Expansion, never a new tab (CLAUDE.md's reader gesture).
        // `<details>` so this stays a server-renderable component and costs
        // no client JavaScript. The pill is the tap target (item 2b); its
        // family comes from lib/funding/pill-colors.ts and never the party
        // palette.
        <details className="funding-type mt-0.5">
          <summary>
            <span className={pillClassFor(typeLabel)}>{typeLabel.label}</span>
          </summary>
          <p className="mt-1 text-[0.6875rem] leading-relaxed text-voice">
            {typeLabel.explainer}{" "}
            <a
              href={typeLabel.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
            >
              the FEC&apos;s own definition
            </a>
          </p>
        </details>
      )}

      {group.count > 1 && (
        // Item 2: repeated filings from one contributor fold into a single
        // row so the money's order is readable, and the filings are one tap
        // away, exactly as filed. The summed amount is repeated here on
        // purpose — the summary states what the expander contains, and its
        // total is the reader's own check that the parts equal the whole.
        <details className="funding-type mt-0.5" data-collapsed-filings={group.count}>
          <summary>
            <span className="text-[0.6875rem] text-muted">
              {group.count} {group.countNoun} ·{" "}
              <span className="font-mono tabular-nums">
                ${Math.round(group.amount).toLocaleString("en-US")}
              </span>
            </span>
          </summary>
          <ul className="mt-1 space-y-0.5">
            {group.filings.map((filing, i) => (
              <li
                key={`${filing.receiptDate}-${filing.amount}-${i}`}
                className="flex items-baseline justify-between gap-3 text-[0.6875rem] text-voice"
              >
                <span>
                  {filing.receiptDate
                    ? formatDateMDY(filing.receiptDate)
                    : "date not filed"}
                </span>
                <span className="font-mono tabular-nums">
                  ${Math.round(filing.amount).toLocaleString("en-US")}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {hop && <SecondHopPanel hop={hop} />}
    </li>
  );
}

/**
 * The second hop (item 3, 2026-08-15, the author's design).
 *
 * The BUTTON is playful — it is an interaction surface, and "Give me the
 * tea" is the author's exact label. Everything inside it is a CLAIM
 * surface and reads level: a committee's own filed receipts, its own name
 * over them, the allocation caveat where the filing says it applies, and
 * the committee's FEC page. The fund's donors are never relabelled as this
 * candidate's donors — the heading names the fund, and the note says what a
 * joint fundraiser actually does with the money.
 */
function SecondHopPanel({ hop }: { hop: SecondHopCommittee }) {
  const isJointFundraiser = hop.designation === "J";
  // The same fold as the outer list, for the same reason: ActBlue's books
  // carry one donor twice at $500,000 and WinRed's carry one three times.
  // Two identical lines read as two donors.
  const folded = groupContributions(hop.topContributions);
  const rows = [...folded.organizations, ...folded.individuals].sort(
    (a, b) => b.amount - a.amount,
  );
  return (
    <details className="funding-type mt-1" data-second-hop={hop.committeeId}>
      <summary>
        <span className="rounded-full border border-[var(--signal)]/40 bg-[var(--signal)]/10 px-2 py-0.5 text-[0.625rem] font-semibold text-signal">
          Give me the tea
        </span>
      </summary>
      <div className="mt-1.5 rounded-md border border-[var(--panel-border)] p-2">
        <p className="text-[0.6875rem] font-semibold text-paper">
          Who gives to {hop.name}
        </p>
        <p className="mt-0.5 text-[0.625rem] leading-relaxed text-voice">
          {isJointFundraiser
            ? "Joint fundraisers split what they raise among the campaigns and committees they raise for, following a formula they file with the FEC. These are that fund's own biggest reported donors — not this campaign's."
            : "These are that committee's own biggest reported donors — not this campaign's."}
        </p>
        <ul className="mt-1.5">
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex items-baseline justify-between gap-3 border-b border-[var(--panel-border)] py-1 text-[0.6875rem] last:border-0"
            >
              <span className="min-w-0 text-paper">
                {row.contributorName}
                {row.city && row.state && (
                  <span className="text-muted"> · {row.city}, {row.state}</span>
                )}
                {row.count > 1 && (
                  <span className="text-muted">
                    {" "}
                    · {row.count} {row.countNoun}
                  </span>
                )}
              </span>
              <span className="shrink-0 font-mono tabular-nums">
                ${Math.round(row.amount).toLocaleString("en-US")}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-[0.5625rem] text-muted">
          <a
            href={hop.provenance.sourceUrl ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:text-link"
          >
            {hop.name} at the FEC
          </a>{" "}
          · read {formatDateMDY(hop.provenance.collectedAt)}
        </p>
      </div>
    </details>
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
