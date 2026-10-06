import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
/**
 * CAMPAIGN MONEY FOR STATE, COUNTY AND LOCAL CANDIDATES.
 *
 * The reader-facing display of state and local filings (2026-08-24). The
 * filings are never sold; reactions to them are (Sean, 2026-10-01). Until this
 * shipped, every one of these cards rendered a placeholder explaining that the
 * FEC does not cover their race — true, and useless to a reader who wants to
 * know who is paying for the campaign on their ballot.
 *
 * ## THE FOUR THINGS THIS MUST NEVER DO
 *
 * 0. **Never say a registry holds nothing when the record in hand names a
 *    committee.** Added 2026-08-31 after this file did exactly that to six
 *    named New Hampshire candidates on production: it had a committee id, a
 *    registered name, a filed office and an election cycle, and it rendered
 *    *"No reports on file with the New Hampshire Secretary of State."*
 *    `RegisteredNoActivityRecord` below carries the distinction — a committee
 *    that has reported no money is a fact about a COMMITTEE, and a registry
 *    holding nothing is a fact about a REGISTRY.
 * 1. **Never render `$0` for a candidate who has filed nothing.** Small-race
 *    candidates file short forms or sit under a reporting threshold entirely.
 *    `$0` is a claim about their campaign; *no reports on file* is a claim
 *    about the agency's records, which is the one we can actually source. The
 *    two are different sentences and the data keeps them apart with
 *    `NO_REPORTS_ON_FILE`.
 * 2. **Never render a LEAD.** Filtered upstream in `stateMoneyForTarget`, so
 *    this component cannot make that mistake even by accident.
 * 3. **Never characterise.** The committee renders under its registered name,
 *    the agency under its own name, and the reader clicks through to the
 *    filings. No adjective about anybody's money.
 *
 * ## Register
 *
 * A CLAIM surface, so the voice is level throughout — real money and a real
 * person's name. Plain language: no `STATE_COMMITTEE`, no `NO_REPORTS_ON_FILE`,
 * no agency acronym without its full name at least once.
 */

import { WorkingOnIt } from "@/components/demand/working-on-it";
import type { StateMoneyRecord } from "@/lib/funding/state-money";
import { stateMoneyRecordsForDisplay } from "@/lib/funding/state-money-reader";
import { ReactionControl } from "@/components/reactions/reaction-control";
import type { ReactionViewContext } from "@/lib/reactions/client";
import { formatDateLong } from "@/lib/text/format-date";

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
 * Pull the filing date out of the stored period string, which the collector
 * writes as `<forms> through YYYY-MM-DD`.
 *
 * Reading it here rather than storing a second field keeps ONE source of the
 * fact (RULING 103) — and returning `null` when there is no date means the
 * clause simply does not render, which is the render-default rule: an absent
 * date may not be filled in with a plausible one.
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
  return (
    <div className="mt-3 first:mt-0">
      <p className="t-body font-medium">{record.registeredName}</p>
      <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 t-body">
        {/*
          A null renders as its NAMED GAP, never as zero. `cashOnHand` is null
          for every New Jersey record because ELEC does not publish it on either
          endpoint we read — that is a fact about the agency, and a `$0` there
          would be a fact about the candidate.
        */}
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
      {/*
        PLAIN LANGUAGE, and this line is where it nearly went wrong.
        The first version printed the agency's own form codes and a raw ISO
        date: "14 reports on file · 72/24 HR, D-1, R-1, RQ-2024, RQ-2025
        through 2026-06-22". `72/24 HR` is an internal filing-form identifier
        and `2026-06-22` is a machine date — neither passes the 15-year-old
        test, and identifiers never render outside a technical disclosure.
        The form list stays in the data for anyone auditing the figure; what a
        reader needs is how many reports and how recent.
      */}
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
 * **REGISTERED, AND THE AGENCY PUBLISHES NOTHING RAISED AND NOTHING SPENT.**
 *
 * Added 2026-08-31 (Session C) because this card was rendering `AbsentRecord`
 * for these people, which says the New Hampshire Secretary of State holds no
 * reports for them — while the record in hand named their committee, its id,
 * its registered name, the office they filed for and the cycle they filed in.
 *
 * Six named candidates on the 03255 ballot were reading that sentence on
 * production, and the collector had already written the TRUE one into
 * `coveringPeriod`: *registered for the 2026 Election Cycle, with no receipts
 * or expenditures reported as of ...*. The data was right and this file threw
 * it away.
 *
 * The distinction, in the reader's terms: *this committee exists and has
 * reported no money* is a fact about a committee. *Nothing is on file* is a
 * fact about a registry. A reader who is told the second when the first is
 * true has been told a different thing about a different subject.
 *
 * Still never `$0`. The agency publishes no report count on this endpoint, so
 * what is said is what is published — activity reported, as of a date, by a
 * named authority — and nothing about how much money exists.
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
      {/*
        THE SENTENCE THIS WHOLE SECTION EXISTS FOR.
        It is a statement about the AGENCY'S RECORDS on a stated date — not
        about how much this person raised, and not about our research. The
        reader can tell whose gap it is, which is the render-default rule's
        actual requirement.
      */}
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

/**
 * **THE GAP THAT SAYS WHOSE IT IS.** (RULING 224, 2026-08-31.)
 *
 * Before this existed, a candidate we had actively investigated — whose
 * committee we had found, read and could not safely attribute — rendered the
 * card's generic empty line: *"We don't hold a campaign finance filing for this
 * person."* Undated, unsourced, and word-for-word identical to what a candidate
 * nobody had ever looked for renders. The reader could not tell the two apart,
 * and one of them is a fact about us while the other is very nearly a fact
 * about the candidate.
 *
 * **No money appears here and none may ever be added.** Not a total, not a
 * partial, not a committee name — those are exactly what the matching bar
 * withheld, and rendering them under a hedge would be the failure the bar
 * exists to prevent, wearing a disclaimer. What renders is one sentence about
 * what we have not settled, the date the agency's own next filing deadline
 * falls, and the reader's route to look for themselves.
 */
function OurGapRecord({ record }: { record: StateMoneyRecord }) {
  const gap = record.ourGap;
  return (
    <div className="mt-3 first:mt-0">
      <AgencyLine record={record} />
      <WorkingOnIt />
      <p className="mt-1 t-detail text-muted-foreground">
        {gap?.whatIsMissing ??
          "The agency holds a record we could not confirm belongs to this candidacy."}{" "}
       
        {/*
          A LITERAL ENTITY IN A TEMPLATE STRING RENDERS AS ITS OWN SOURCE.
          This clause was written as `${agency}&rsquo;s` inside a JS template
          literal rather than in JSX, and React escaped it: readers saw the six
          characters `&rsquo;` on the card. The character itself goes in.
        */}
        {gap?.nextDue
          ? ` We check again after the agency’s next filing deadline, ${readableDate(gap.nextDue)}.`
          : ""}{" "}
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
   * A candidate with a real filing does not also show the absence note: the
   * absence was written for a location pass that another committee answered,
   * and rendering both would contradict itself on one card.
   *
   * The middle state slots in by the same reasoning — the STRONGER statement
   * the agency actually made wins. A committee it names, reporting nothing,
   * outranks the registry holding nothing; money outranks both.
   *
   * AN OURS GAP RANKS LAST OF ALL, and that ordering is the point of it: it is
   * what renders when the agency has made no statement we can carry, and never
   * alongside one we can. It replaces silence, never a fact.
   */
  const shown = stateMoneyRecordsForDisplay(records);
  const agency = shown[0]?.agency ?? "";
  // The same five-point question the federal money cards ask, on the state or
  // local committee's own candidacy key. Only where there is money to feel
  // something about: a filed record, or a registered committee with no activity.
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
