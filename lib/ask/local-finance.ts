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
 * Campaign money for a local body, from the filings we hold (read through
 * `lib/control-plane/campaign-finance/held-records.ts`).
 *
 * The chain is `BODY ← OFFICE ← COMMITTEE`, each leg someone's own record:
 * committee → office is the filing officer's register row (`officeName`), read,
 * never inferred; office → body is the hand-audited
 * {@link REGISTER_OFFICE_TO_BODY_ID} crosswalk, never a string similarity. A
 * committee the chain cannot link appears for no body, whatever its name says.
 *
 * Never: totals (a sum across filed rows is our arithmetic), ranking of donors
 * or committees (rows are dated, newest first), support/opposition (no
 * independent-expenditure report is held, and every evidence set names that
 * gap), or committee-to-person attachment (the register links a committee to
 * an office).
 */

/* -------------------------------------------------------------------------- */
/* THE QUESTION                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Wording that asks about campaign money. Conservative: a false positive
 * attaches finance records to a non-money question. Bare "funding" is absent
 * ("who is funding the school district" is a budget question).
 */
const FINANCE_PHRASES: readonly RegExp[] = [
  /\bcampaign (?:finance|finances|money|cash|funds?|fundraising|spending|contributions?|donations?|donors?|expenditures?|war chest)\b/,
  /\bdonors?\b/,
  /\bdonations?\b/,
  /\bcontribut(?:ions?|ors?|ed)\b/,
  /* Fund/finance verbs need campaign context in the same breath. */
  /\bwho (?:funded|funds|is funding|has funded|financed|finances|is financing|bankrolled|bankrolls|is bankrolling|paid for|pays for|is paying for) (?:\w+ ){0,6}(?:campaign|race|candidac\w*|candidate|election|bid)/,
  /\bwho (?:gave|donated|is giving) money\b/,
  /\bwho (?:has |have )?donated\b/,
  /\bhow much (?:money )?(?:has|have|did|was|were) (?:\w+ ){0,8}(?:raised|spent)\b/,
  /\braised? money\b/,
  /* A comparison is a money question too: "raised more", "spent the most", "outraised". */
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

/** A funding verb aimed at a named person. For a school district the same words are a budget question. */
const PERSON_FUNDING = new RegExp(`\\bwho (?:is |has |are )?(?:funding|funded|funds|financing|financed|finances|bankrolling|bankrolled|bankrolls|backing|backed|backs|paying for|paid for|pays for)\\b`);

/**
 * Did the reader ask about campaign money, given what the question resolved
 * to? A funding verb needs campaign words after it, unless the subject is a
 * person, whose funding is their campaign's.
 */
export function financeQuestionAskedFor(question: string, subjectKind: string | null): boolean {
  return financeQuestionAsked(question) || (subjectKind === "PERSON" && PERSON_FUNDING.test(normalizeName(question)));
}

/**
 * A question about a person's campaign money and nothing they did in office:
 * votes, statements and actions are left out of the pack.
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
 * Hand-audited, one entry at a time: each asserts that the office the register
 * names is the office whose seat-holders sit as the named body, checked against
 * the county register, the registry's live body and its roster page. The
 * office designation is the linkage, never a committee's name. An office with
 * no entry links to nothing, and the body carries the OURS gap.
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

/** An amount as filed, spelled as money. */
function usd(amount: number): string {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The filed date, spelled out where it parses, the filer's own string where it
 * does not; implausible years are preserved as filed, never repaired.
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
 * Everything the pack carries about campaign money for one body: linked
 * committees' register and money rows, or the OURS gap, never silence.
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
    /* Nothing we hold links a committee to this body: a fact about our records, never "no committee exists". */
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

  /* Ordered by date only, uniformly; never by amount. Undated rows sort last. */
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
  /* Only candidate/committee reports are held; the class stating outside spending is not. */
  denominators.independentExpenditureReportsHeld = 0;

  if (committeesWithoutRows.length > 0) {
    /*
     * A linked committee with no transaction rows from this route: its filed
     * documents are unread, so what it raised or spent is our open question,
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
    /* Loans, interest, refunds and the rest: never folded into contributions or spending, never dropped. */
    gaps.push({
      whose: "OURS",
      statement:
        `These committees' filings also carry ${otherMoneyRows} other money row${otherMoneyRows === 1 ? "" : "s"} — ` +
        `loans, interest, refunds and similar — which are neither contributions nor campaign ` +
        `spending and are not shown as either.`,
    });
  }

  /*
   * Always: every row is off a candidate/committee report; independent
   * expenditures are a different document type we have not acquired. A gap of
   * ours, never a finding about anyone.
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
 * module has nothing to add.
 *
 * - **BODY**: linked committees' records, or the named gap.
 * - **PERSON**: only one whose canonical official ID resolves to exactly one
 *   body the crosswalk covers, with the no-committee-attachment gap first.
 *   Others return null; their records live in other stores (FEC).
 * - **MEASURE**: the linkage gap; a committee's name is never its position.
 * - **CONTEST / OFFICE**: null; no held record links a committee to a
 *   candidacy.
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
    /* Exactly one seat, or nothing. */
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

/**
 * Every money answer names every filing regime it looked in (federal via the
 * FEC snapshot, the state filing officer, the county portal), each an OURS
 * statement of scope, so one regime's absence never stands for all money.
 * The regime list is derived from `data/campaign-finance/filing-regimes.json`.
 */
export interface FinanceRegimeNote {
  readonly regime: "FEDERAL" | "STATE" | "COUNTY";
  readonly gap: EvidenceGap;
}

/** The regime statements for one subject; never empty when a money question was asked. */
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
 * The scope gap for a money question about a subject this module returns null
 * for: the subject class, why this pipeline holds nothing, and for a federal
 * candidate where the record is.
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
