import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
/**
 * Campaign money for state, county and local candidates. Never says a registry
 * holds nothing when the record names a committee; never renders `$0` for a
 * candidate who filed nothing (`NO_REPORTS_ON_FILE`); never renders a lead
 * (filtered in `stateMoneyForTarget`); never characterises.
 */

import { CardGapContribution } from "@/components/ui/card-gap-context";
import type { StateMoneyRecord } from "@/lib/funding/state-money";
import { stateMoneyRecordsForDisplay } from "@/lib/funding/state-money-reader";
import { ReactionControl } from "@/components/reactions/reaction-control";
import type { ReactionViewContext } from "@/lib/reactions/client";
import { formatDateLong } from "@/lib/text/format-date";
import { filedOrganizations, stateSmallDonorSentence, stateMoneyFundingIssue } from "@/lib/funding/state-money-funding";

const SECTION_LABEL_CLASS = "t-detail font-medium uppercase tracking-wide text-muted-foreground";

/** Money as a reader reads it. Whole dollars — cents are noise at this scale. */
function dollars(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** Dates use the same canonical formatter as other reader surfaces. */
function readableDate(iso: string): string {
  return formatDateLong(iso) ?? "";
}

/**
 * The filing date from the stored period string, which the collector writes
 * as `<forms> through YYYY-MM-DD`. Null when absent, and the clause is omitted.
 */
function lastFilingDate(coveringPeriod: string | null): string | null {
  if (!coveringPeriod) return null;
  const m = /(\d{4}-\d{2}-\d{2})\s*$/.exec(coveringPeriod);
  return m ? m[1] : null;
}

function AgencyLine({ record }: { record: StateMoneyRecord }) {
  return <CardSourcesContribution id={`state-money:${record.targetKeys.join("|")}:${record.registeredName}`} sources={[{ what: "Candidate campaign filings", provenance: { sourceUrl: record.filingsUrl ?? "", sourceOrg: record.agency, collectedAt: record.checkedAt, verifiedAt: null } }]} />;
}

function FiledRecord({ record }: { record: StateMoneyRecord }) {
  const { totals } = record;
  const funding = totals.coveringPeriod?.trim() && record.funding && !stateMoneyFundingIssue(record.funding) ? record.funding : undefined;
  const organizations = filedOrganizations(funding);
  const smallDonors = stateSmallDonorSentence(funding);
  return (
    <div className="mt-3 first:mt-0">
      <p className="t-body font-medium">{record.registeredName}</p>
      <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 t-body">
        {/* A null renders as its named gap, never as zero. */}
        {totals.receipts !== null && (
          <>
            <dt className="text-muted-foreground">Raised</dt>
            <dd className="text-right tabular-nums">{dollars(totals.receipts)}</dd>
          </>
        )}
        {totals.expenditures !== null && (
          <>
            <dt className="text-muted-foreground">Spent</dt>
            <dd className="text-right tabular-nums">{dollars(totals.expenditures)}</dd>
          </>
        )}
        {totals.cashOnHand !== null && (
          <>
            <dt className="text-muted-foreground">Cash on hand</dt>
            <dd className="text-right tabular-nums">{dollars(totals.cashOnHand)}</dd>
          </>
        )}
      </dl>
      {organizations.length > 0 && <section className="mt-2" aria-label="PACs, committees and organizations">
        <p className="text-sm font-medium">PACs, committees and organizations</p>
        <dl className="mt-1 text-sm">{organizations.map((org, index) => <div key={`${org.filedName}:${index}`} className="flex justify-between gap-4">
          <dt>{org.filedName}{org.filedType ? <span className="ml-1 text-muted-foreground">({org.filedType})</span> : null}</dt>
          <dd className="tabular-nums">{dollars(org.amount)}</dd>
        </div>)}</dl>
      </section>}
      {funding && <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {([ ["Individual giving", funding.individualTotal], ["Itemized individual giving", funding.individualItemized],
          ["Unitemized individual giving", funding.individualUnitemized] ] as const).filter(([, value]) => value !== null).map(([label, value]) =>
          <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="text-right tabular-nums">{dollars(value!)}</dd></div>)}
      </dl>}
      {smallDonors && <p className="mt-1 text-sm">{smallDonors}</p>}
      {/* Report count and recency only; the form codes stay in the data. */}
      {totals.reportCount !== null && (
        <p className="mt-1 t-detail text-muted-foreground">
          {totals.reportCount === 1 ? "1 report" : `${totals.reportCount} reports`} on file
          {lastFilingDate(totals.coveringPeriod)
            ? `, most recently ${readableDate(lastFilingDate(totals.coveringPeriod)!)}`
            : ""}
        </p>
      )}
      <AgencyLine record={record} />
    </div>
  );
}

/**
 * A registered committee the agency reports no receipts or expenditures for.
 * A fact about the committee, distinct from a registry holding nothing. Never
 * `$0`; the agency publishes no report count on this endpoint.
 */
function RegisteredNoActivityRecord({ record }: { record: StateMoneyRecord }) {
  return (
    <div className="mt-3 first:mt-0">
      <p className="t-body font-medium">{record.registeredName}</p>
      <p className="mt-1 t-body">
        Registered committee. No money raised and none spent has been reported to the{" "}
        {record.agency} as of {readableDate(record.checkedAt)}.
      </p>
      <AgencyLine record={record} />
    </div>
  );
}

function AbsentRecord({ record }: { record: StateMoneyRecord }) {
  return (
    <div className="mt-3 first:mt-0">
      <AgencyLine record={record} />
      <p className="t-body">
        No reports on file with the {record.agency} as of{" "}
        {readableDate(record.checkedAt)}.
      </p>
      {record.filingsUrl ? (
        <p className="mt-2 t-detail text-muted-foreground">
          <a
            href={record.filingsUrl}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Search the {record.agency}&rsquo;s public filings
          </a>
        </p>
      ) : null}
    </div>
  );
}

/** Unresolved attribution contributes to the card's single gap line. */
function OurGapRecord({ record }: { record: StateMoneyRecord }) {
  return <>
    <AgencyLine record={record} />
    <CardGapContribution id={`state-money:${record.targetKeys.join("|")}`} label="campaign money" />
  </>;
}

export function StateMoneySection({
  records,
  bare = false,
  context = null,
}: {
  records: readonly StateMoneyRecord[];
  bare?: boolean;
  /** The reaction's location context, as the federal money cards take it. */
  context?: ReactionViewContext | null;
}) {
  if (records.length === 0) return null;

  /*
   * The strongest statement the agency made wins: money, then a named
   * committee reporting nothing, then the registry holding nothing. Our own
   * gap ranks last and never renders beside an agency statement.
   */
  const shown = stateMoneyRecordsForDisplay(records);
  const agency = shown[0]?.agency ?? "";
  // Only where there is a filed record or a registered committee with no activity.
  const reactionTarget = shown.find(
    (r) => r.filingState === "FILED" || r.filingState === "REGISTERED_NO_ACTIVITY_REPORTED",
  )?.targetKeys[0];

  return (
    <div data-state-money-targets={[...new Set(shown.flatMap(r => r.targetKeys))].join(" ")} data-state-money-record-count={shown.length}>
      {!bare && (
        <p className={SECTION_LABEL_CLASS}>
          Campaign money{agency ? ` · ${agency}` : ""}
        </p>
      )}
      {shown.map((record, i) => {
        const heading = (
          <p className="mt-3 t-detail text-muted-foreground">
            {record.match.officeOnBallot ?? record.officeSought ?? "Campaign"} · {record.electionYear} election
          </p>
        );
        if (record.filingState === "FILED") {
          return <div key={record.committeeId ?? i}>{heading}<FiledRecord record={record} /></div>;
        }
        if (record.filingState === "REGISTERED_NO_ACTIVITY_REPORTED") {
          return <div key={record.committeeId ?? i}>{heading}<RegisteredNoActivityRecord record={record} /></div>;
        }
        if (record.filingState === "OURS_GAP") {
          return <OurGapRecord key={record.committeeId ?? i} record={record} />;
        }
        return <AbsentRecord key={record.committeeId ?? i} record={record} />;
      })}
      {reactionTarget && (
        <ReactionControl
          targetType="FUNDING_TOTAL_REACTION"
          targetId={reactionTarget}
          prompt="How do you feel about how this campaign is funded?"
          context={context}
        />
      )}
      {shown.length > 1 && (
        <p className="mt-2 t-detail text-muted-foreground">
          This candidate has more than one committee registered. Every one the
          agency holds is shown.
        </p>
      )}
    </div>
  );
}
