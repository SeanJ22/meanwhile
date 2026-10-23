import { normalizeName } from "../routing/exact-name.ts";
import type { EvidenceGap, EvidenceSubject } from "./evidence.ts";

const FINANCE_PHRASES: readonly RegExp[] = [
  /\bcampaign (?:finance|finances|money|cash|funds?|fundraising|spending|contributions?|donations?|donors?|expenditures?|war chest)\b/,
  /\bdonors?\b/,
  /\bdonations?\b/,
  /\bcontribut(?:ions?|ors?|ed)\b/,
  /\bwho (?:funded|funds|is funding|has funded|financed|finances|is financing|bankrolled|bankrolls|is bankrolling|paid for|pays for|is paying for) (?:\w+ ){0,6}(?:campaign|race|candidac\w*|candidate|election|bid)/,
  /\bwho (?:gave|donated|is giving) money\b/,
  /\bwho (?:has |have )?donated\b/,
  /\bhow much (?:money )?(?:has|have|did|was|were) (?:\w+ ){0,8}(?:raised|spent)\b/,
  /\braised? money\b/,
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

export function financeQuestionAsked(question: string): boolean {
  const normalized = normalizeName(question);
  return FINANCE_PHRASES.some((p) => p.test(normalized));
}

const PERSON_FUNDING = new RegExp(`\\bwho (?:is |has |are )?(?:funding|funded|funds|financing|financed|finances|bankrolling|bankrolled|bankrolls|backing|backed|backs|paying for|paid for|pays for)\\b`);

export function financeQuestionAskedFor(question: string, subjectKind: string | null): boolean {
  return financeQuestionAsked(question) || (subjectKind === "PERSON" && PERSON_FUNDING.test(normalizeName(question)));
}

export function asksOnlyMoney(question: string, subjectKind: string | null = null): boolean {
  return financeQuestionAskedFor(question, subjectKind) &&
    !/\b(?:vot(?:e|es|ed|ing)|bills?|legislation|positions?|stances?|executive orders?|vetoe[sd]?|signed|sponsor\w*|said|says|statements?|record|done|actions?)\b/i.test(question);
}

export interface FinanceRegimeNote {
  readonly regime: "FEDERAL" | "STATE" | "COUNTY";
  readonly gap: EvidenceGap;
}

export function financeRegimeNotesFor(subject: EvidenceSubject, retrieved: { state: boolean; federal: boolean; county?: boolean } = { state: false, federal: false }): FinanceRegimeNote[] {
  const about = subject.name;
  const notes: FinanceRegimeNote[] = [];

  notes.push({
    regime: "COUNTY",
    gap: {
      whose: "OURS",
      statement: retrieved.county
        ? `County filings: this answer includes verified campaign totals attached to the published person and office.`
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
