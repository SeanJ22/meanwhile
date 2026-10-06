import { currentBodyRosters } from "../registry/body-rosters.ts";
import { normalizeName } from "../routing/exact-name.ts";
import { formatDateLong } from "../text/format-date.ts";
import {
  azPimaContributionsFor,
  azPimaExpendituresFor,
  azPimaHeld,
  azPimaOtherDisbursementsFor,
  azPimaOtherReceiptsFor,
  azPimaTransactions,
  type AzPimaCommitteeRow,
} from "../control-plane/campaign-finance/held-records.ts";

import type { EvidenceGap, EvidenceRecord, EvidenceSubject } from "./evidence.ts";

/**
 * **CAMPAIGN MONEY FOR A LOCAL BODY, FROM THE FILINGS WE ACTUALLY HOLD.**
 * (2026-08-30.)
 *
 * ## The defect this closes
 *
 * The repository holds 900 contribution rows and 584 distribution rows read
 * from the Pima County filing officer's own portal, a slice of the county's
 * committee register, and the state's own reporting calendar — acquired
 * 2026-08-29 (`data/campaign-finance/`) and reachable through the sanctioned
 * readers in `lib/control-plane/campaign-finance/held-records.ts`. The
 * grounded Ask engine could reach none of it. A reader asking who funded a
 * Vail school board campaign was told campaign-finance records were not held,
 * over a store that holds the committee's register row and its itemized
 * transactions. "We don't have any campaign finance records" had become a
 * false statement about us.
 *
 * ## The linkage rule, and why it is a crosswalk rather than a match
 *
 * The chain is `BODY ← OFFICE ← COMMITTEE`, and each leg is somebody's own
 * record:
 *
 * 1. **COMMITTEE → OFFICE is the filing officer's.** The county register row
 *    carries `officeName` — the office the committee registered for, in the
 *    filing officer's own words ("School Governing Board - Vail"). We read it;
 *    we never infer it.
 * 2. **OFFICE → BODY is a hand-audited crosswalk, committed with its basis.**
 *    {@link REGISTER_OFFICE_TO_BODY_ID} maps the register's office designation
 *    to the canonical body id, one entry at a time, each entry carrying the
 *    evidence it was audited against. It is a data decision recorded in code —
 *    the same posture as `lib/registry/body-rosters.ts` — never a runtime
 *    string similarity.
 *
 * A committee that cannot be linked by that chain DOES NOT APPEAR for the
 * body. The live case is deliberate and worth naming: **"Citizens of Vail for
 * Education"** holds transactions in the store (a $5,000.00 contribution from
 * Concord General Contracting among them) and its register row's office
 * designation is "PAC" — a filer type, not an office. Nothing we hold links
 * that committee to the Vail governing board, its races or its members; the
 * word "Vail" in its name is a name, and this project's own bar refuses to
 * treat a name match as agreement. It therefore appears for NO body until a
 * record links it — its Statement of Organization is the record that would.
 * The same refusal keeps "ANDRES FOR SUPERVISOR"'s transaction rows away from
 * the county Board of Supervisors: those committees have no register row in
 * the held slice at all, so no held record states their office.
 *
 * ## What it never does
 *
 * No totals — a sum across filed rows would be our arithmetic wearing a
 * filing's provenance, and the store's own limits note that summing across
 * `ItemizedListType` values invents a figure no filer reported. No ranking of
 * donors or committees — rows are ordered by date, newest first, uniformly.
 * No support/opposition — an independent-expenditure report is the record
 * class that states outside spending for or against a candidate, none is
 * held, and every evidence set this module returns names that gap. And no
 * committee-to-person attachment: the register links a committee to an
 * OFFICE, so a question about a person on a covered body is answered with the
 * body's own finance evidence and a gap saying exactly that.
 */

/* -------------------------------------------------------------------------- */
/* THE QUESTION                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Wording that asks about CAMPAIGN MONEY. Conservative on the same reasoning
 * as `outcome-question.ts`: a missed finance question keeps the pre-existing
 * behaviour, while a false positive attaches finance records or a finance gap
 * to a question that was not about money — noise, not a false claim about a
 * government — so the phrases lean specific. Bare "funding" is deliberately
 * absent: "who is funding the school district" is a budget question.
 */
const FINANCE_PHRASES: readonly RegExp[] = [
  /\bcampaign (?:finance|finances|money|cash|funds?|fundraising|spending|contributions?|donations?|donors?|expenditures?|war chest)\b/,
  /\bdonors?\b/,
  /\bdonations?\b/,
  /\bcontribut(?:ions?|ors?|ed)\b/,
  /*
   * The fund/finance verbs demand campaign context in the same breath: "who
   * is funding the school district?" is a question about a budget, and
   * answering it with committee filings would be the product not listening.
   */
  /\bwho (?:funded|funds|is funding|has funded|financed|finances|is financing|bankrolled|bankrolls|is bankrolling|paid for|pays for|is paying for) (?:\w+ ){0,6}(?:campaign|race|candidac\w*|candidate|election|bid)/,
  /\bwho (?:gave|donated|is giving) money\b/,
  /\bwho (?:has |have )?donated\b/,
  /\bhow much (?:money )?(?:has|have|did|was|were) (?:\w+ ){0,8}(?:raised|spent)\b/,
  /\braised? money\b/,
  /*
   * **A COMPARISON IS A MONEY QUESTION TOO.** (2026-09-25, the Ask model
   * comparison.) *"Has Cinde Warmington raised more money than Kelly Ayotte?"*
   * matched none of these ("raised MORE money"), so no money record was
   * retrieved and every writer said we hold no fundraising for either of them
   * — over a New Hampshire file that holds both committees. The verb and a
   * comparing word, in the same breath: "raised more", "spent the most",
   * "outraised".
   */
  /\b(?:raised?|raising|spent|spend|spending) (?:more|less|the most|the least|as much)\b/,
  /\bout ?(?:raised|raising|spent|spending)\b/,
  /\bcash on hand\b/,
  /\bfundrais(?:ing|ed|er|ers)\b/,
  /\bwho (?:gave|gives|has given) (?:money )?to\b/,
  /\bwar chest\b/,
  /\bindependent expenditures?\b/,
  /\boutside spending\b/,
  /\bpac (?:money|contributions?|spending)\b/,
  /\b(?:list|all|every|itemized|itemised)\b.*\b(?:pacs?|donors?|contributors?|filings?)\b/,
];

/** Did the reader ask about campaign money? False never means "not finance". */
export function financeQuestionAsked(question: string): boolean {
  const normalized = normalizeName(question);
  return FINANCE_PHRASES.some((p) => p.test(normalized));
}

/** "Who is funding Andy Biggs?": a funding verb aimed at a NAMED PERSON. For a school district the same words are a budget question. */
const PERSON_FUNDING = new RegExp(`\\bwho (?:is |has |are )?(?:funding|funded|funds|financing|financed|finances|bankrolling|bankrolled|bankrolls|backing|backed|backs|paying for|paid for|pays for)\\b`);

/**
 * Did the reader ask about campaign money, given what the question resolved to?
 * A funding verb needs campaign words after it to be a money question ("who is
 * funding the school district?" is a budget question) — unless the subject is a
 * person, whose funding is their campaign's (2026-09-29: "Who is funding Andy
 * Biggs?" retrieved no money and the writer said we hold none, over three filings).
 */
export function financeQuestionAskedFor(question: string, subjectKind: string | null): boolean {
  return financeQuestionAsked(question) || (subjectKind === "PERSON" && PERSON_FUNDING.test(normalizeName(question)));
}

/**
 * Did the reader ask about a person's campaign money and nothing they did in
 * office? Then their votes, key votes, statements and recorded actions are not
 * what was asked: they only make the pack (and the writer's bill, and the
 * reader's wait) larger. A question that also asks how they voted, what they
 * said or what they signed keeps all of it.
 */
export function asksOnlyMoney(question: string, subjectKind: string | null = null): boolean {
  return financeQuestionAskedFor(question, subjectKind) &&
    !/\b(?:vot(?:e|es|ed|ing)|bills?|legislation|positions?|stances?|executive orders?|vetoe[sd]?|signed|sponsor\w*|said|says|statements?|record|done|actions?)\b/i.test(question);
}

/* -------------------------------------------------------------------------- */
/* THE CROSSWALK                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The filing officer's office designation → the canonical body id.
 *
 * **Hand-audited, one entry at a time, and each entry states its basis.**
 * An entry asserts that the office the register names is the office whose
 * seat-holders sit as the named body — an identity question a human answered
 * against the records below, not a string a matcher scored.
 *
 * - `"School Governing Board - Vail"` is the Pima County filing officer's own
 *   designation on four candidate-committee register rows
 *   (`data/states/az/campaign-finance/az-pima-2026-held.json`,
 *   `committeeRegisterCountyPortal`, read from the county's own portal API
 *   2026-08-29). The body is the Vail Unified School District Governing Board:
 *   the registry's LIVE Vail body (`lib/registry/registry.json`), whose roster
 *   is read from the district's own governing-board page
 *   (`lib/registry/body-rosters.ts`), and Pima County has exactly one school
 *   district named Vail — the state's own committee register places every
 *   Vail committee in Vail, AZ 85641, inside the district. One of the four
 *   committees is "Ed Buster for VUSD Board", and Ed Buster sits on that board
 *   per the district's own roster — corroboration, though the OFFICE
 *   designation is the linkage, never the name.
 *
 * A register office with no entry here links to nothing, which fails closed:
 * the committee simply does not appear for any body, and the body's answer
 * carries the honest OURS gap instead.
 */
const REGISTER_OFFICE_TO_BODY_ID: Readonly<Record<string, string>> = {
  "School Governing Board - Vail":
    "ocd-division/country:us/state:az/school_district:vail_unified_district#board",
};

/* -------------------------------------------------------------------------- */
/* THE RECORDS                                                                 */
/* -------------------------------------------------------------------------- */

export interface LocalFinanceEvidence {
  records: EvidenceRecord[];
  gaps: EvidenceGap[];
  denominators: Record<string, number>;
}

/** `$5,000.00` — an amount as filed, spelled the way a reader reads money. */
function usd(amount: number): string {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The filed date, spelled out where it parses, the filer's own string where it
 * does not. Years 0006 and 2926 exist in this store and are preserved as
 * filed — a repaired date would be our claim rather than the filer's record.
 */
function filedDate(raw: string | null): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return formatDateLong(raw) ?? raw;
  return raw;
}

/** ISO only where it is genuinely ISO — `occurredAt` never carries a guess. */
function filedIso(raw: string | null): string | null {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function committeeTypeInPlainWords(row: AzPimaCommitteeRow): string {
  if (row.filerType === "Candidate") return "candidate committee";
  if (row.filerType.startsWith("PAC")) return "political action committee";
  if (row.filerType === "Party") return "party committee";
  return "committee";
}

interface TransactionLine {
  id: string;
  text: string;
  isoDate: string | null;
}

/** One committee's held money rows, each as the filer's own line. */
function transactionLines(committeeNameAsFiled: string, filedWith: string): TransactionLine[] {
  const lines: TransactionLine[] = [];

  for (const [index, row] of azPimaContributionsFor(committeeNameAsFiled).entries()) {
    const date = filedDate(row.receivedOn);
    lines.push({
      id: `cf:${row.filingId}:contribution:${index}`,
      text: `${committeeNameAsFiled} reported receiving a ${usd(row.amountReceived)} contribution${
        date
          ? `, ${filedIso(row.receivedOn) ? "on" : "dated"} ${date}`
          : ", on a date the filed row does not carry"
      }, in a campaign-finance report filed with ${filedWith}.`,
      isoDate: filedIso(row.receivedOn),
    });
  }

  for (const [index, row] of azPimaExpendituresFor(committeeNameAsFiled).entries()) {
    const date = filedDate(row.spentOn);
    const payee = row.payeeNameAsFiled
      ? `, paid to ${row.payeeNameAsFiled},`
      : ", to a payee the public copy of the filing does not name,";
    lines.push({
      id: `cf:${row.filingId}:spending:${index}`,
      text: `${committeeNameAsFiled} reported spending ${usd(row.amountSpent)}${payee}${
        date ? ` ${filedIso(row.spentOn) ? "on" : "dated"} ${date}` : " on a date the filed row does not carry"
      }, in a campaign-finance report filed with ${filedWith}.`,
      isoDate: filedIso(row.spentOn),
    });
  }

  return lines;
}

/* -------------------------------------------------------------------------- */
/* THE EVIDENCE                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Everything the pack should carry about campaign money for one BODY.
 *
 * Every path produces something: a body with linked committees gets their
 * register rows and their filed money rows; a body with none gets the honest
 * OURS gap — never silence, which reads as "no committee exists", a claim
 * about a government made out of our own collection state.
 */
function bodyFinanceEvidence(bodyId: string, bodyName: string): LocalFinanceEvidence {
  const records: EvidenceRecord[] = [];
  const gaps: EvidenceGap[] = [];
  const denominators: Record<string, number> = {};

  const held = azPimaHeld();
  const registerRows = held.committeeRegisterCountyPortal;
  const filedWith = held.filingAuthorityIdentification.officeNameAsPublished;
  const linked = registerRows.filter(
    (row) => row.officeName !== null && REGISTER_OFFICE_TO_BODY_ID[row.officeName] === bodyId,
  );

  denominators.financeRegisterRowsHeld = registerRows.length;
  denominators.financeCommitteesLinkedToThisBody = linked.length;

  if (linked.length === 0) {
    /*
     * THE HONEST EMPTY. Our register slice is 5 of the 138 filers the county's
     * own portal lists, and the committees whose transaction rows we DO hold
     * without a register row (an "ANDRES FOR SUPERVISOR", say) state no office
     * in any held record — so nothing we hold links any committee to this
     * body. That is a fact about our records. It is never "no committee
     * exists" and never "no money was raised", and the sentence says so.
     */
    gaps.push({
      whose: "OURS",
      statement:
        `We have not linked any campaign-finance committee to ${bodyName} in the records we hold. ` +
        `Our copy of the campaign-finance register covers a small part of what filing officers ` +
        `publish, so this is a gap in our records — it says nothing about whether such a committee ` +
        `exists or what any campaign here raised or spent.`,
    });
    return { records, gaps, denominators };
  }

  /* ── The register rows — the linkage itself, as sourced records. ── */
  for (const row of linked) {
    const filings = `${row.filingCount} campaign-finance filing${row.filingCount === 1 ? "" : "s"}`;
    records.push({
      kind: "FINANCE_COMMITTEE",
      id: `easyvote:pima:${row.portalFilerId}`,
      bodyId,
      text:
        `"${row.registeredName}" is ${row.status === "Active" ? "an active" : "an inactive"} ` +
        `${committeeTypeInPlainWords(row)} in the ${filedWith} campaign-finance register, ` +
        `registered for the office the register names "${row.officeName}", with ${filings} on record.`,
      sourceUrl: row.source,
      sourceOrg: filedWith,
      retrievedAt: held.recordedOn,
    });
  }

  /* ── The money rows, dated by the filer, ordered by date and nothing else. ── */
  const tx = azPimaTransactions();
  const acquisition = tx.acquisition as {
    contributionsUrl?: string;
    distributionsUrl?: string;
    retrievedOn?: string;
  };

  let contributionRows = 0;
  let expenditureRows = 0;
  let otherMoneyRows = 0;
  let committeesWithRows = 0;
  const committeesWithoutRows: string[] = [];
  const lines: TransactionLine[] = [];

  for (const row of linked) {
    const forCommittee = transactionLines(row.registeredName, filedWith);
    contributionRows += azPimaContributionsFor(row.registeredName).length;
    expenditureRows += azPimaExpendituresFor(row.registeredName).length;
    otherMoneyRows +=
      azPimaOtherReceiptsFor(row.registeredName).length +
      azPimaOtherDisbursementsFor(row.registeredName).length;
    if (forCommittee.length > 0) committeesWithRows += 1;
    else committeesWithoutRows.push(row.registeredName);
    lines.push(...forCommittee);
  }

  /* Date is the one neutral order, applied uniformly to both directions of
     money and every committee alike. Never by amount — an amount-ordered list
     is a leaderboard. Undated rows sort last rather than being dropped. */
  lines.sort((a, b) => {
    if (a.isoDate === b.isoDate) return a.id < b.id ? -1 : 1;
    if (a.isoDate === null) return 1;
    if (b.isoDate === null) return -1;
    return a.isoDate < b.isoDate ? 1 : -1;
  });

  for (const line of lines) {
    records.push({
      kind: "FINANCE_TRANSACTION",
      id: line.id,
      bodyId,
      text: line.text,
      occurredAt: line.isoDate,
      sourceUrl: line.id.includes(":spending:")
        ? acquisition.distributionsUrl ?? null
        : acquisition.contributionsUrl ?? null,
      sourceOrg: filedWith,
      retrievedAt: acquisition.retrievedOn ?? tx.recordedOn,
    });
  }

  denominators.financeContributionRowsHeldForThisBody = contributionRows;
  denominators.financeSpendingRowsHeldForThisBody = expenditureRows;
  denominators.financeOtherMoneyRowsHeldForThisBody = otherMoneyRows;
  denominators.financeTransactionRecordsShown = lines.length;
  denominators.financeCommitteesWithMoneyRowsHeld = committeesWithRows;
  /* The document-class denominator: candidate/committee campaign-finance
     reports are the ONLY class these rows come from, and the class that
     states outside spending is affirmatively not acquired. */
  denominators.independentExpenditureReportsHeld = 0;

  if (committeesWithoutRows.length > 0) {
    /*
     * A committee the register links and the transaction search returns
     * nothing for. The county's own search partitions cleanly (the store's
     * reconciliation block), so "no rows from this route" is real — but the
     * committee's filed reports are indexed and their DOCUMENTS are unread
     * behind the 401 route, so what they raised or spent is OUR open question,
     * never "they raised nothing".
     */
    const names = committeesWithoutRows.map((n) => `"${n}"`).join(", ");
    gaps.push({
      whose: "OURS",
      statement:
        `The register also links ${names} to this office. The county's public transaction search ` +
        `returns no itemized money rows for ${committeesWithoutRows.length === 1 ? "that committee" : "those committees"}, ` +
        `and we have not yet been able to read the report documents they filed — so we cannot say ` +
        `what they raised or spent.`,
    });
  }

  if (otherMoneyRows > 0) {
    /* Loans, interest, refunds, reimbursements and the rest: neither
       contributions nor campaign spending, never folded into either, and
       never silently dropped. */
    gaps.push({
      whose: "OURS",
      statement:
        `These committees' filings also carry ${otherMoneyRows} other money row${otherMoneyRows === 1 ? "" : "s"} — ` +
        `loans, interest, refunds and similar — which are neither contributions nor campaign ` +
        `spending and are not shown as either.`,
    });
  }

  /*
   * THE DOCUMENT-CLASS GAP, ALWAYS. Contribution ≠ expenditure ≠ independent
   * expenditure. Every row above is off a candidate/committee campaign-finance
   * report; the record class that states outside spending for or against a
   * candidate is a different document type, none is acquired, and an answer
   * that showed filed money without saying so would read as the whole money
   * picture. Its absence is OURS — the state's reporting surface publishes IE
   * reports and we have not acquired them — never a finding about anyone.
   */
  gaps.push({
    whose: "OURS",
    statement:
      `Every dollar figure here comes from campaign-finance reports these committees filed with ` +
      `the county. Independent-expenditure reports — money spent by outside groups for or against ` +
      `a candidate, which is not money a campaign received — are a different kind of filing, and ` +
      `we have not yet acquired any for Pima County. That is a gap in our records, not a finding ` +
      `that no outside spending happened.`,
  });

  return { records, gaps, denominators };
}

/**
 * Campaign-finance evidence for a resolved Ask subject, or null where this
 * module has nothing honest to add.
 *
 * - **BODY** — always answers: linked committees' records, or the named gap.
 * - **PERSON** — only a person whose canonical official ID resolves to
 *   exactly ONE body the committed crosswalk covers; they get that
 *   body's evidence with the no-committee-attachment gap stated first. Anyone
 *   else — a statewide executive, a federal candidate — returns null: their
 *   finance records live in other stores (the FEC snapshot renders on the
 *   ballot surface), and "we have not recorded campaign finance for X" would
 *   be a false statement about us for a candidate whose FEC totals we hold.
 * - **MEASURE** — the linkage gap: no held source states which committees
 *   support or oppose a measure, and a committee's name is never evidence of
 *   its position.
 * - **CONTEST / OFFICE** — null. A contest's money is its candidacies', and
 *   no held record links a committee to a candidacy (see held-records.ts on
 *   why `authorizedByCandidacyId` stays null).
 */
export function localFinanceEvidenceFor(subject: EvidenceSubject, canonicalOfficialIds: readonly string[] = [subject.id]): LocalFinanceEvidence | null {
  if (subject.kind === "BODY") {
    return bodyFinanceEvidence(subject.id, subject.name);
  }

  if (subject.kind === "MEASURE") {
    return {
      records: [],
      gaps: [
        {
          whose: "OURS",
          statement:
            `We have not recorded which campaign-finance committees, if any, are raising or ` +
            `spending money around ${subject.name}. None of the filing records we hold states ` +
            `which committees support or oppose a ballot measure, and we never infer that from a ` +
            `committee's name.`,
        },
      ],
      denominators: { financeCommitteesLinkedToThisMeasure: 0 },
    };
  }

  if (subject.kind === "PERSON") {
    const coveredBodyIds = new Set(Object.values(REGISTER_OFFICE_TO_BODY_ID));
    const officialIds = new Set(canonicalOfficialIds);
    const seats = new Map<string, { bodyId: string; bodyName: string }>();
    for (const roster of currentBodyRosters()) {
      if (!coveredBodyIds.has(roster.bodyId)) continue;
      for (const member of roster.members) {
        if (officialIds.has(member.id)) {
          seats.set(roster.bodyId, { bodyId: roster.bodyId, bodyName: roster.bodyName });
        }
      }
    }
    /* Exactly one, or nothing — the same fail-closed identity rule as
       lib/ask/votes.ts. Zero seats is a person this module holds nothing
       for; two would be an ambiguity nothing here can resolve. */
    if (seats.size !== 1) return null;

    const seat = [...seats.values()][0];
    const evidence = bodyFinanceEvidence(seat.bodyId, seat.bodyName);
    evidence.gaps.unshift({
      whose: "OURS",
      statement:
        `The campaign-finance register we hold links each committee to the office it filed for, ` +
        `not to a person, so we have not attached any committee to ${subject.name} specifically. ` +
        `What follows is what we hold for ${seat.bodyName} campaigns as a whole.`,
    });
    return evidence;
  }

  return null;
}

/* ═════════════ OWN-Q5: EVERY REGIME, NAMED, ON EVERY MONEY ANSWER ════════ */

/**
 * **A CAMPAIGN-FINANCE ANSWER SAYS WHICH REGIMES IT LOOKED IN.**
 * (The owner's amendment on Q5, worked 2026-08-31.)
 *
 * The owner's words: *not just FEC filings, but state and local finances must
 * be checked* — and its operative half, *an FEC absence never stands in for
 * "no records exist"*.
 *
 * ## What was actually wrong, measured rather than assumed
 *
 * The county store is reachable and has been since 2026-08-30. What is missing
 * is the DENOMINATOR SENTENCE. `localFinanceEvidenceFor` returns **null** for
 * a statewide executive, a federal candidate, a contest and an office, and a
 * null pushes nothing — so the answer fell through to whatever generic
 * finance-gap sentence the pack produced, and one regime's silence became a
 * claim about all money everywhere.
 *
 * That is the same class as `NO_SOURCE_FOUND → COMPLETE`: one route's failure
 * standing in for the record universe. The acquisition doctrine names it —
 * **ONE ROUTE SUCCESS != SOURCE UNIVERSE COMPLETE**, and its mirror is that one
 * route's absence is not the universe's.
 *
 * ## So every money answer carries every regime, always
 *
 * Three, and each says what it is and what we hold:
 *
 * ```
 *   FEDERAL   the FEC, through the funding snapshot, which renders on the
 *             ballot surface rather than through this pipeline
 *   STATE     Arizona's own filing officer, whose reporting calendar we hold
 *             and whose itemized filings we do not
 *   COUNTY    the Pima County filing officer's portal — 900 contribution and
 *             584 distribution rows, itemized, and the store this module reads
 * ```
 *
 * These are gaps in the `EvidenceGap` sense — *statements about scope*, every
 * one labelled `OURS`, because each says what THIS PRODUCT has and has not
 * searched. None of them is a claim about whether a government holds a filing:
 * that would be an absence asserted, and the registry's own note says it
 * plainly — *absence from this file is a fact about this file.*
 *
 * **The regime list is data, not prose.** It is derived from
 * `data/campaign-finance/filing-regimes.json`, which records that this project
 * knows two jurisdictions out of fifty states plus tens of thousands of local
 * filing jurisdictions. The sentence says that, so a reader is never told the
 * search was wider than it was.
 */
export interface FinanceRegimeNote {
  readonly regime: "FEDERAL" | "STATE" | "COUNTY";
  readonly gap: EvidenceGap;
}

/**
 * The regime statements for one subject. Never empty when a money question was
 * asked, which is the whole point: silence is what let one regime answer for
 * all of them.
 */
export function financeRegimeNotesFor(subject: EvidenceSubject, retrieved: { state: boolean; federal: boolean; county?: boolean } = { state: false, federal: false }): FinanceRegimeNote[] {
  const about = subject.name;
  const notes: FinanceRegimeNote[] = [];

  notes.push({
    regime: "COUNTY",
    gap: {
      whose: "OURS",
      statement: retrieved.county
        ? `County filings: this answer includes the Pima County filing officer's committee and itemized records for the resolved body's campaigns. The filing register links committees to an office, not to an individual person.`
        : `County filings: no applicable county filing was resolved for this answer about ${about}. That does not establish that none exists.`,
    },
  });

  notes.push({
    regime: "STATE",
    gap: {
      whose: "OURS",
      statement:
        retrieved.state
          ? `State filings: this answer uses the same state campaign-money records as the card. These records describe the campaigns' own filings; they do not establish outside spending for or against ${about}.`
          : `State filings: we have not linked a verified state filing to this answer about ${about}. That does not establish that none exists.`,
    },
  });

  notes.push({
    regime: "FEDERAL",
    gap: {
      whose: "OURS",
      statement:
        retrieved.federal
          ? `Federal filings: this answer uses the same FEC snapshot as the campaign-money card, with its recorded reporting period and source.`
          : `Federal filings: no applicable FEC record was resolved for this answer. This does not establish an absence of state or county filings.`,
    },
  });

  return notes;
}

/**
 * The one sentence that must never be said, said correctly instead.
 *
 * A reader asking about money for a subject this module returns null for was
 * previously answered from whatever generic gap the pack produced. This is
 * what they get instead: the subject class, why this pipeline holds nothing
 * for it, and — for a federal candidate — where the record actually is.
 */
export function financeScopeGapFor(subject: EvidenceSubject): EvidenceGap {
  if (subject.kind === "CONTEST" || subject.kind === "OFFICE") {
    return {
      whose: "OURS",
      statement:
        `Money in a race belongs to the campaigns in it, so this answer does not combine their ` +
        `filings into a total for ${subject.name} ` +
        `as a whole. Ask about one of the candidates or about the body the office sits on.`,
    };
  }
  return {
    whose: "OURS",
    statement:
      `No applicable verified campaign-finance record was resolved for this answer about ` +
      `${subject.name}. That is a gap in this answer, not a finding that no filings exist.`,
  };
}
