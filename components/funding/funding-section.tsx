import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { WorkingOnIt } from "@/components/demand/working-on-it";
import type {
  FundingAbsenceData,
  FundingDisplayData,
} from "@/lib/funding/display";
import {
  aggregateIndividuals,
  type IndividualAggregate,
} from "@/lib/funding/donor-privacy";
import { groupContributions, type ContributorGroup } from "@/lib/funding/grouping";
import { committeePillLabel } from "@/lib/funding/committee-types";
import {
  contributorTypeLabel,
  plainContributorLabel,
} from "@/lib/funding/labels";
import { pillClassFor } from "@/lib/funding/pill-colors";
import type { SecondHopCommittee } from "@/lib/funding/types";
import type { ReactionViewContext } from "@/lib/reactions/client";
import { ReactionControl } from "@/components/reactions/reaction-control";
import { formatDateMDY } from "@/lib/map/format";
import { plainMoney } from "@/lib/funding/plain-money";

/**
 * Campaign money as the FEC publishes it: committee totals in sentences and,
 * while `ripcord.fecContributorDisplay` is live, the largest contributions as
 * filed. Kept visually distinct from statements and votes. Reaction targets
 * are keyed by FEC candidate id. No directive: rendered by the server ballot
 * page and the client modal alike.
 */

const SECTION_LABEL_CLASS = "t-eyebrow text-muted";

export function FundingDisplay({
  data,
  context,
  bare = false,
}: {
  data: FundingDisplayData;
  context: ReactionViewContext | null;
  /** Inside a CardSection that already names the block: drops its own frame and eyebrow. */
  bare?: boolean;
}) {
  return (
    <div
      data-funding-section
      className={
        bare
          ? ""
          : "mt-3 rounded-md border border-[var(--panel-border)] bg-[var(--surface,rgba(255,255,255,0.04))]/60 p-3"
      }
    >
      {!bare && <p className={SECTION_LABEL_CLASS}>Campaign money</p>}
      <MoneyOverview data={data} />
      {data.sentences.map((sentence) => (
        <p key={sentence} className="mt-1.5 t-body leading-relaxed text-paper-dim">
          {sentence}
        </p>
      ))}
      <ReactionControl
        targetType="FUNDING_TOTAL_REACTION"
        targetId={data.fecCandidateId}
        prompt="How do you feel about how this campaign is funded?"
        context={context}
      />

      {data.contributorsShown && (
        <div className="mt-3">
          <p className={SECTION_LABEL_CLASS}>Largest reported contributions</p>
          <p className="mt-0.5 t-caption leading-relaxed text-voice">
            The biggest contributions this campaign&apos;s main committee has
            reported, listed exactly as filed — biggest first, in two groups.
          </p>
          {/* Two columns sorted by amount, grouped by lib/funding/grouping.ts. */}
          <div className="mt-2 grid gap-x-5 gap-y-3 sm:grid-cols-2">
            <ContributorColumn
              title="Committees & organizations"
              groups={data.contributorGroups.organizations}
              secondHop={data.secondHop}
            />
            {/* Individual donors render as aggregates only, never by name. */}
            <IndividualDonorsPanel
              aggregate={aggregateIndividuals(data.contributorGroups.individuals)}
            />
          </div>
          <ReactionControl
            targetType="CONTRIBUTOR_REACTION"
            targetId={data.fecCandidateId}
            prompt="How do you feel about these contributions?"
            context={context}
          />
        </div>
      )}

      {data.contributorsShown && data.concentrationSentences.length > 0 && (
        <details className="mt-3" data-money-origin>
          <summary className="provisions-summary">
            <span aria-hidden="true" className="provisions-caret">
              ›
            </span>
            Where that money came from
          </summary>
          {/* Shares are computed over the largest reported contributions listed above, not the whole book. */}
          {data.concentration && <OriginBars data={data} />}
          <ul className="mt-1 space-y-1.5">
            {data.concentrationSentences.map((sentence) => (
              <li
                key={sentence}
                className="t-detail leading-relaxed text-paper-dim"
              >
                {sentence}
              </li>
            ))}
          </ul>
        </details>
      )}

      {data.contributorsShown && data.typeConcentrationSentences.length > 0 && (
        <details className="mt-3" data-money-kind>
          <summary className="provisions-summary">
            <span aria-hidden="true" className="provisions-caret">
              ›
            </span>
            What kind of money it was
          </summary>
          {/* Committee money only, by the type each committee filed for itself. */}
          <TypeBars data={data} />
          <ul className="mt-1 space-y-1.5">
            {data.typeConcentrationSentences.map((sentence) => (
              <li
                key={sentence}
                className="t-detail leading-relaxed text-paper-dim"
              >
                {sentence}
              </li>
            ))}
          </ul>
        </details>
      )}

      <CardSourcesContribution id={`funding:${data.fecCandidateId}`} sources={[{ what: "Campaign money", provenance: { sourceUrl: data.sourceUrl ?? "", sourceOrg: data.sourceOrg, collectedAt: data.collectedAt, verifiedAt: null } }]} />
    </div>
  );
}

/**
 * The overview line and, when reported totals are numbers, three figure
 * tiles. Raised, spent and cash on hand are separate reported values (cash is
 * never raised minus spent); each tile shows its own figure or nothing.
 */
type ReportedTotals = {
  receipts: number;
  disbursements: number;
  cashOnHand: number;
  smallDonorShare?: number | null;
};

function reportedTotalsOf(data: FundingDisplayData): ReportedTotals | null {
  const totals = (data as FundingDisplayData & { totals?: ReportedTotals | null }).totals;
  if (!totals) return null;
  const ok = [totals.receipts, totals.disbursements, totals.cashOnHand].every(
    (n) => typeof n === "number" && Number.isFinite(n),
  );
  return ok ? totals : null;
}

function MoneyOverview({ data }: { data: FundingDisplayData }) {
  const totals = reportedTotalsOf(data);
  return (
    <div className="mw-money-overview" data-money-overview>
      <p className="mw-money-meta">
        Cycle {data.cycleLabel}
        {data.reportedThrough && <> · reported through {formatDateMDY(data.reportedThrough)}</>}
      </p>
      {totals && (
        <div className="mw-money-tiles">
          <MoneyTile label="Raised" amount={totals.receipts} />
          <MoneyTile label="Spent" amount={totals.disbursements} />
          <MoneyTile label="Cash on hand" amount={totals.cashOnHand} />
        </div>
      )}
      {!totals && (
        <p className="mw-share-note" data-money-chart="totals-not-held">
          <WorkingOnIt inline />
        </p>
      )}
    </div>
  );
}

function MoneyTile({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="mw-money-tile">
      <span className="mw-money-tile-label">{label}</span>
      <span className="mw-money-tile-value">{plainMoney(amount)}</span>
    </div>
  );
}

/** Dollar amounts on the filing, in a consistent row. */
function AmountRow({ label, amount, detail }: { label: string; amount: number; detail?: string }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="mw-share-label">{label}</span>
    <span className="mw-share-value">${usd(amount)}{detail && <span className="mw-share-detail"> · {detail}</span>}</span></div>;
}

function usd(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * "Where that money came from", drawn from the held concentration numbers.
 * The scope badge states the base — the contributions listed above, not the
 * whole campaign — and the location is the state on the filing, not a district.
 */
function OriginBars({ data }: { data: FundingDisplayData }) {
  const c = data.concentration;
  if (!c) return null;
  if (c.totalAmount <= 0) {
    return (
      <p className="mw-share-note" data-money-chart="origin-not-held">
        <WorkingOnIt inline />
      </p>
    );
  }
  return (
    <div className="mw-share-block">
      <p className="mw-scope-badge">
        Contributions listed above · ${usd(c.totalAmount)}.
      </p>
      {c.hasGeography && (
        <>
          <p className="mw-share-heading">State on the filing</p>
          <AmountRow
            label={`Inside ${c.candidateState}`}
            amount={c.inStateAmount}

          />
          <AmountRow
            label={`Outside ${c.candidateState}`}
            amount={c.outStateAmount}

          />
        </>
      )}
      <p className="mw-share-heading">Who filed it</p>
      <AmountRow
        label="Committees and organizations"
        amount={c.organizationAmount}

      />
      <AmountRow
        label="Individual people"
        amount={c.individualAmount}

      />
      {c.unlocatedAmount > 0 && <AmountRow label="State not stated" amount={c.unlocatedAmount} />}
    </div>
  );
}

/**
 * "What kind of money it was": the committee and organization rows listed
 * above, by the type each filer put on its own FEC filing. Individual donors
 * are excluded — a different base — and the badge says which base this is.
 */
function TypeBars({ data }: { data: FundingDisplayData }) {
  const rows = data.contributorGroups.organizations;
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  if (rows.length === 0 || total <= 0) {
    return (
      <p className="mw-share-note" data-money-chart="type-not-held">
        <WorkingOnIt inline />
      </p>
    );
  }
  const byType = new Map<string, { label: string; amount: number; count: number }>();
  for (const row of rows) {
    const label = contributorTypeLabel(row);
    const name = label ? committeePillLabel(label) : "Type not stated on the filing";
    const entry = byType.get(name) ?? { label: name, amount: 0, count: 0 };
    entry.amount += row.amount;
    entry.count += row.count;
    byType.set(name, entry);
  }
  const count = rows.reduce((sum, row) => sum + row.count, 0);
  const kinds = [...byType.values()].sort((a, b) => b.amount - a.amount);
  return (
    <div className="mw-share-block">
      <p className="mw-scope-badge">
        Covers the {count} committee and organization contributions listed above · {usd(total)}.
      </p>
      {kinds.map((kind) => (
        <AmountRow
          key={kind.label}
          label={kind.label}
          amount={kind.amount}

        />
      ))}
    </div>
  );
}

/**
 * One of the two money columns. Renders nothing when empty: the snapshot holds
 * only the FEC's top receipts, so "none" would misstate the whole book.
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
      <p className="t-caption font-semibold uppercase trailing-space-trimmed-8 tracking-[0.08em] text-muted">
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

/** The bucket for filings that carried no state. */
const STATE_NOT_ON_FILING = "State not stated on the filing";

function IndividualDonorsPanel({ aggregate }: { aggregate: IndividualAggregate }) {
  if (aggregate.donors === 0) return null;
  const fromStrangers = aggregate.amount - aggregate.candidateOwnMoney;
  return (
    <div data-contributor-group="Individual donors">
      <p className="t-caption font-semibold uppercase trailing-space-trimmed-8 tracking-[0.08em] text-muted">
        Individual donors
      </p>
      <ul className="mt-1">
        <li
          className="border-b border-[var(--panel-border)] py-1.5 t-detail last:border-0"
          data-individual-total={Math.round(aggregate.amount)}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 font-medium text-paper">
              {aggregate.donors.toLocaleString("en-US")}{" "}
              {aggregate.donors === 1 ? "person" : "people"}
              <span className="font-normal text-muted">
                {" "}
                · {aggregate.filings.toLocaleString("en-US")}{" "}
                {aggregate.filings === 1 ? "filing" : "filings"}
              </span>
            </span>
            <span className="shrink-0 font-mono t-detail font-medium tabular-nums">
              ${Math.round(aggregate.amount).toLocaleString("en-US")}
            </span>
          </div>
        </li>
        {aggregate.candidateOwnMoney > 0 && (
          <li
            className="border-b border-[var(--panel-border)] py-1.5 t-detail last:border-0"
            data-candidate-own-money={Math.round(aggregate.candidateOwnMoney)}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 font-medium text-paper">
                The candidate&apos;s own money
                <span className="font-normal text-muted">
                  {" "}
                  · ${Math.round(fromStrangers).toLocaleString("en-US")} of the
                  above came from other people
                </span>
              </span>
              <span className="shrink-0 font-mono t-detail font-medium tabular-nums">
                ${Math.round(aggregate.candidateOwnMoney).toLocaleString("en-US")}
              </span>
            </div>
          </li>
        )}
      </ul>
      {aggregate.byState.length > 0 && (
        <ul className="mt-1" data-individual-states={aggregate.byState.length}>
          {aggregate.byState.map((share) => (
            <li
              key={share.state ?? "unstated"}
              className="flex items-baseline justify-between gap-3 border-b border-[var(--panel-border)] py-1 t-caption last:border-0"
            >
              <span className="min-w-0 text-paper">
                {share.state ?? STATE_NOT_ON_FILING}
                <span className="text-muted">
                  {" "}
                  · {share.donors.toLocaleString("en-US")}{" "}
                  {share.donors === 1 ? "person" : "people"}
                </span>
              </span>
              <span className="shrink-0 font-mono tabular-nums">
                ${Math.round(share.amount).toLocaleString("en-US")}
              </span>
            </li>
          ))}
        </ul>
      )}
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
  const entityLabel = plainContributorLabel(group);
  // Null for individuals and rows the FEC never typed; those get no explainer.
  const typeLabel = contributorTypeLabel(group);
  return (
    <li
      className="border-b border-[var(--panel-border)] py-1.5 t-detail last:border-0"
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
        <span className="shrink-0 font-mono t-detail font-medium tabular-nums">
          ${Math.round(group.amount).toLocaleString("en-US")}
        </span>
      </div>
      {typeLabel && (
        // `<details>` keeps this server-renderable; pill colours come from lib/funding/pill-colors.ts, never the party palette.
        <details className="funding-type mt-0.5">
          <summary>
            <span className={pillClassFor(typeLabel)}>{committeePillLabel(typeLabel)}</span>
          </summary>
          <p className="mt-1 t-caption leading-relaxed text-voice">
            {typeLabel.explainer}{" "}

          </p>
          <CardSourcesContribution id={`contributor-type:${typeLabel.sourceUrl}`} sources={[{ what: typeLabel.explainer, provenance: { sourceUrl: typeLabel.sourceUrl, sourceOrg: "Federal Election Commission", collectedAt: "", verifiedAt: null } }]} />
        </details>
      )}

      {group.count > 1 && (
        // Repeated filings from one contributor fold into one row; the summed amount is the reader's check.
        <details className="funding-type mt-0.5" data-collapsed-filings={group.count}>
          <summary>
            <span className="t-caption text-muted">
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
                className="flex items-baseline justify-between gap-3 t-caption text-voice"
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

      {hop && <SecondHopPanel hop={hop} toCampaign={{ amount: group.amount, count: group.count, noun: group.countNoun }} />}
    </li>
  );
}

/**
 * A joint fundraiser's or conduit's own filed receipts. The fund's donors are
 * never relabelled as this candidate's donors.
 */
function SecondHopPanel({
  hop,
  toCampaign,
}: {
  hop: SecondHopCommittee;
  /** What this committee gave this campaign, from the row above it. */
  toCampaign?: { amount: number; count: number; noun: string };
}) {
  const isJointFundraiser = hop.designation === "J";
  // The same fold as the outer list: one donor can appear several times in these books.
  const folded = groupContributions(hop.topContributions);
  // Individual donors are private here too; only organizations are listed.
  const rows = [...folded.organizations].sort((a, b) => b.amount - a.amount);
  const hopIndividuals = aggregateIndividuals(folded.individuals);
  return (
    <details className="funding-type mt-1" data-second-hop={hop.committeeId}>
      <summary>
        <span className="rounded-full border border-[var(--signal)]/40 bg-[var(--signal)]/10 px-2 py-0.5 t-caption font-semibold text-signal">
          Give me the tea
        </span>
      </summary>
      <div className="mt-1.5 rounded-md border border-[var(--panel-border)] p-2">
        {/* Two sets of books, side by side and never added together. */}
        <div className="mw-books" data-books>
          {toCampaign && (
            <div className="mw-books-panel">
              <span className="mw-books-label">The campaign&apos;s books</span>
              <span className="mw-books-value">${Math.round(toCampaign.amount).toLocaleString("en-US")}</span>
              <span className="mw-books-note">
                from {hop.name}, {toCampaign.count} {toCampaign.count === 1 ? toCampaign.noun.replace(/s$/, "") : toCampaign.noun}
              </span>
            </div>
          )}
          {hop.receipts !== null && (
            <div className="mw-books-panel">
              <span className="mw-books-label">This committee&apos;s books</span>
              <span className="mw-books-value">${Math.round(hop.receipts).toLocaleString("en-US")}</span>
              <span className="mw-books-note">
                raised by {hop.name} itself — separate money, not added to the campaign&apos;s totals
              </span>
            </div>
          )}
        </div>
        <p className="t-caption font-semibold text-paper">
          Who gives to {hop.name}
        </p>
        <p className="mt-0.5 t-caption leading-relaxed text-voice">
          {isJointFundraiser
            ? "Joint fundraisers split what they raise among the campaigns and committees they raise for, following a formula they file with the FEC. These are that fund's own biggest reported donors — not this campaign's."
            : "These are that committee's own biggest reported donors — not this campaign's."}
        </p>
        <ul className="mt-1.5">
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex items-baseline justify-between gap-3 border-b border-[var(--panel-border)] py-1 t-caption last:border-0"
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
          {hopIndividuals.donors > 0 && (
            <li
              className="flex items-baseline justify-between gap-3 border-b border-[var(--panel-border)] py-1 t-caption last:border-0"
              data-hop-individual-total={Math.round(hopIndividuals.amount)}
            >
              <span className="min-w-0 text-paper">
                {hopIndividuals.donors.toLocaleString("en-US")}{" "}
                {hopIndividuals.donors === 1 ? "person" : "people"}
                <span className="text-muted">
                  {" "}
                  · {hopIndividuals.filings.toLocaleString("en-US")}{" "}
                  {hopIndividuals.filings === 1 ? "filing" : "filings"}
                </span>
              </span>
              <span className="shrink-0 font-mono tabular-nums">
                ${Math.round(hopIndividuals.amount).toLocaleString("en-US")}
              </span>
            </li>
          )}
        </ul>
        <CardSourcesContribution id={`funding-hop:${hop.provenance.sourceUrl}:${hop.name}`} sources={[{ what: `Contributions reported by ${hop.name}`, provenance: hop.provenance }]} />
      </div>
    </details>
  );
}

export function FundingAbsence({ data }: { data: FundingAbsenceData }) {
  return (
    <div className="mt-2">
      <p className={SECTION_LABEL_CLASS}>Campaign money</p>
      <p className="mt-1 t-detail leading-relaxed text-muted">
        {data.statement}
      </p>
      <CardSourcesContribution id={`funding-absence:${data.searchUrl ?? "unknown"}`} sources={[{ what: "Campaign filing search", provenance: { sourceUrl: data.searchUrl ?? "", sourceOrg: "Federal Election Commission", collectedAt: data.checkedAt, verifiedAt: null } }]} />
    </div>
  );
}

/** The state and local races line: a stated gap, never silence. */
export function StateFundingNote({ note }: { note: string }) {
  return (
    <p className="mt-2 t-caption leading-relaxed text-muted">{note}</p>
  );
}
