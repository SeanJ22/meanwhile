/**
 * CAMPAIGN MONEY FOR STATE, COUNTY AND LOCAL CANDIDATES.
 *
 * The reader-facing half of RULING 126 (2026-08-24, Sean's ruling). Until this
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

import type { StateMoneyRecord } from "@/lib/funding/state-money";

const SECTION_LABEL_CLASS = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

/** Money as a reader reads it. Whole dollars — cents are noise at this scale. */
function dollars(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** `2026-08-24` → `24 August 2026`. Never a raw identifier on a reader surface. */
function readableDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const month = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][m - 1];
  return `${d} ${month} ${y}`;
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
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      Filed with the {record.agency}
      {record.filingsUrl ? (
        <>
          {" — "}
          <a
            href={record.filingsUrl}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            see this candidate&rsquo;s filings
          </a>
        </>
      ) : null}
      . Read {readableDate(record.checkedAt)}.
    </p>
  );
}

function FiledRecord({ record }: { record: StateMoneyRecord }) {
  const { totals } = record;
  return (
    <div className="mt-3 first:mt-0">
      <p className="text-sm font-medium">{record.registeredName}</p>
      <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
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
        <p className="mt-1 text-xs text-muted-foreground">
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
      <p className="text-sm font-medium">{record.registeredName}</p>
      <p className="mt-1 text-sm">
        Registered committee. No money raised and none spent has been reported to the{" "}
        {record.agency} as of {readableDate(record.checkedAt)}.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        A committee registers before it reports. This is what the committee has
        reported so far, not a statement that no money was raised.
      </p>
      <AgencyLine record={record} />
    </div>
  );
}

function AbsentRecord({ record }: { record: StateMoneyRecord }) {
  return (
    <div className="mt-3 first:mt-0">
      {/*
        THE SENTENCE THIS WHOLE SECTION EXISTS FOR.
        It is a statement about the AGENCY'S RECORDS on a stated date — not
        about how much this person raised, and not about our research. The
        reader can tell whose gap it is, which is the render-default rule's
        actual requirement.
      */}
      <p className="text-sm">
        No reports on file with the {record.agency} as of{" "}
        {readableDate(record.checkedAt)}.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Candidates in smaller races often file short forms, or fall under the
        reporting threshold and file nothing at all. This is not a statement
        that no money was raised.
      </p>
      {record.filingsUrl ? (
        <p className="mt-2 text-xs text-muted-foreground">
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
}: {
  records: readonly StateMoneyRecord[];
  bare?: boolean;
}) {
  if (records.length === 0) return null;

  const filed = records.filter((r) => r.filingState === "FILED");
  const registered = records.filter(
    (r) => r.filingState === "REGISTERED_NO_ACTIVITY_REPORTED",
  );
  const absent = records.filter((r) => r.filingState === "NO_REPORTS_ON_FILE");

  /*
   * A candidate with a real filing does not also show the absence note: the
   * absence was written for a location pass that another committee answered,
   * and rendering both would contradict itself on one card.
   *
   * The middle state slots in by the same reasoning — the STRONGER statement
   * the agency actually made wins. A committee it names, reporting nothing,
   * outranks the registry holding nothing; money outranks both.
   */
  const shown =
    filed.length > 0 ? filed : registered.length > 0 ? registered : absent.slice(0, 1);
  const agency = shown[0]?.agency ?? "";

  return (
    <div>
      {!bare && (
        <p className={SECTION_LABEL_CLASS}>
          Campaign money{agency ? ` · ${agency}` : ""}
        </p>
      )}
      {shown.map((record, i) => {
        if (record.filingState === "FILED") {
          return <FiledRecord key={record.committeeId ?? i} record={record} />;
        }
        if (record.filingState === "REGISTERED_NO_ACTIVITY_REPORTED") {
          return <RegisteredNoActivityRecord key={record.committeeId ?? i} record={record} />;
        }
        return <AbsentRecord key={record.committeeId ?? i} record={record} />;
      })}
      {shown.length > 1 && (
        <p className="mt-2 text-xs text-muted-foreground">
          This candidate has more than one committee registered. Every one the
          agency holds is shown.
        </p>
      )}
    </div>
  );
}
