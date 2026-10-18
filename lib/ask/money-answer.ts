import { normalizeName } from "../routing/exact-name.ts";
import { formatDateLong, spellOutDates } from "../text/format-date.ts";
import type { EvidenceGap, EvidenceRecord } from "./evidence.ts";
import { overLengthBudget } from "./length-contract.ts";
import { filedOrganizations, stateSmallDonorSentence } from "../funding/state-money-funding.ts";

/**
 * A campaign-money answer composed from held FINANCE_SUMMARY records only:
 *
 * - **HOW_MUCH**: each held committee filing's own figures in dollars as the
 *   record carries them, its period as the agency states it, the agency and
 *   the read date. Two committees are stated separately and never added.
 * - **WHO_GAVE**: our records hold campaign totals, not donor identities, so
 *   the answer says so, names what we hold and counts it ("money records we
 *   hold for this candidate that name a donor: 0 of 1"). It never says the
 *   state withholds donors.
 * - **COMPARE**: each person's own figure, with a verdict only when both are
 *   one filing for the same period and agency. No filing is stated as the
 *   record states it, never as $0.
 *
 * A person is named as few times as possible: the length contract counts the
 * "R. " in a middle initial as a sentence end.
 *
 * Returns null (the model writes) whenever the pack holds anything this cannot
 * state plainly: no state money record for a named person, a federal or county
 * record, more than two committees, an unresolved finance identity, or an
 * answer over the length contract. The caller applies the same validator a
 * model answer faces.
 */

export type MoneyMeasure = "RAISED" | "SPENT" | "CASH";
export type MoneyAsk =
  | { kind: "HOW_MUCH"; measures: readonly MoneyMeasure[] }
  | { kind: "WHO_GAVE" }
  | { kind: "COMPARE"; measure: MoneyMeasure };

/** A money question's shape and the words in its name slot(s). A pure reading of the words. */
export interface MoneyQuestion {
  ask: MoneyAsk;
  /** The words naming the (first) person. */
  slot: string;
  /** COMPARE only: the words naming the second person. */
  otherSlot?: string;
  /** "for her state senate race": words naming the race, which must be the person's own office. */
  raceWords?: string;
}

/* Written against `normalizeName` (lowercase, punctuation -> space, one leading
   "the" dropped): "X's campaign" reads "x s campaign". */
const OF_CAMPAIGN = "(?: s (?:campaign committee|campaign|committee|reelection campaign|re election campaign))?";
const GENERIC_TAIL = "so far|in total|this (?:year|cycle|election(?: cycle)?)|for (?:his|her|their) (?:campaign|race|bid|run|reelection|re election)(?: campaign)?";
/* A race the reader names ("for her state senate race") is admitted, and checked against the person's office. */
const TAIL = `(?: (?:${GENERIC_TAIL})| for (?:his|her|their) (?<race>(?:[a-z0-9]+ ){1,4})(?:race|campaign|bid|seat|run))?`;
const RAISE = "raised|raise";
const SPEND = "spent|spend";
const DONORS = "(?:biggest |largest |top |main |major |big )?(?:donors?|contributors?|funders?|backers?)";

interface MoneyPattern { readonly pattern: RegExp; readonly read: (groups: Record<string, string | undefined>) => MoneyAsk }
const measureOf = (verb: string | undefined): MoneyMeasure => /^(?:out ?)?(?:spen|spend)/.test(verb ?? "") ? "SPENT" : "RAISED";

const MONEY_PATTERNS: readonly MoneyPattern[] = [
  /* HOW_MUCH */
  {
    pattern: new RegExp(`^how much (?:campaign )?(?:money |cash )?(?:has|have|did) (?<name>.+?)${OF_CAMPAIGN} (?<m1>${RAISE}|${SPEND})(?: and (?<m2>${RAISE}|${SPEND}))?${TAIL}$`),
    read: (g) => ({ kind: "HOW_MUCH", measures: [...new Set([measureOf(g.m1), ...(g.m2 ? [measureOf(g.m2)] : [])])] }),
  },
  {
    pattern: new RegExp(`^how much (?:campaign )?(?:money|cash) (?:does|do) (?<name>.+?)${OF_CAMPAIGN} have(?: on hand| left| in the bank)?${TAIL}$`),
    read: () => ({ kind: "HOW_MUCH", measures: ["CASH"] }),
  },
  {
    pattern: new RegExp("^what (?:is|s|are) (?<name>.+?) s (?:campaign )?(?<what>cash on hand|fundraising totals?|fundraising|finances)$"),
    read: (g) => ({ kind: "HOW_MUCH", measures: g.what === "cash on hand" ? ["CASH"] : ["RAISED", "SPENT"] }),
  },
  /* WHO_GAVE */
  {
    pattern: new RegExp(`^who (?:gave|gives|has given|donated|donates|has donated|contributed|contributes|has contributed) (?:money )?to (?<name>.+?)${OF_CAMPAIGN}$`),
    read: () => ({ kind: "WHO_GAVE" }),
  },
  {
    pattern: new RegExp("^who (?:funded|funds|is funding|has funded|financed|is financing|has financed|bankrolled|is bankrolling|is paying for|paid for) (?<name>.+?) s (?:campaign committee|campaign|race|bid|reelection campaign)$"),
    read: () => ({ kind: "WHO_GAVE" }),
  },
  /* "Who is funding <person>?": the slot must bind a held person, so a body or measure is not this. */
  {
    pattern: new RegExp(`^who (?:is |has |are )?(?:funding|funded|funds|financing|financed|finances|bankrolling|bankrolled|bankrolls|backing|backed|backs|paying for|paid for|pays for) (?!(?:the|this|that|these|those|our|my|your|a|an|all|every|any|some) )(?<name>.+?)${OF_CAMPAIGN}$`),
    read: () => ({ kind: "WHO_GAVE" }),
  },
  {
    pattern: new RegExp(`^who (?:are|is|were|was) (?<name>.+?) s (?:campaign )?${DONORS}$`),
    read: () => ({ kind: "WHO_GAVE" }),
  },
  {
    pattern: new RegExp(`^who (?:are|is|were|was) the ${DONORS} (?:to|of|for|behind) (?<name>.+?)${OF_CAMPAIGN}$`),
    read: () => ({ kind: "WHO_GAVE" }),
  },
  /* COMPARE — two named people. */
  {
    pattern: new RegExp(`^(?:has|have|did) (?<name>.+?)${OF_CAMPAIGN} (?<m>${RAISE}|${SPEND}) more(?: money)? than (?<other>.+?)(?: has| did| have)?$`),
    read: (g) => ({ kind: "COMPARE", measure: measureOf(g.m) }),
  },
  {
    pattern: new RegExp("^(?:has|did) (?<name>.+?) (?<m>out ?raised|out ?spent) (?<other>.+?)$"),
    read: (g) => ({ kind: "COMPARE", measure: measureOf(g.m) }),
  },
  {
    pattern: new RegExp("^who (?:has |have )?(?<m>raised|spent) (?:more|the most)(?: money)?(?: so far)?(?: between)? (?<name>.+?) (?:or|and) (?<other>.+?)$"),
    read: (g) => ({ kind: "COMPARE", measure: measureOf(g.m) }),
  },
];

/** The money question this is, with its name slot(s), or null. Nothing is bound here. */
export function moneyQuestionShape(question: string): MoneyQuestion | null {
  const normalized = normalizeName(question);
  if (!normalized || normalized.length > 160 || /\d{4}/.test(normalized)) return null;
  // A question naming a race, not a person, belongs to the race reader.
  if (groupMoneyQuestionShape(question)) return null;
  for (const { pattern, read } of MONEY_PATTERNS) {
    const groups = pattern.exec(normalized)?.groups;
    const slot = groups?.name?.trim();
    if (!groups || !slot) continue;
    const otherSlot = groups.other?.trim();
    const raceWords = groups.race?.trim();
    return { ask: read(groups), slot, ...(otherSlot ? { otherSlot } : {}), ...(raceWords ? { raceWords } : {}) };
  }
  return null;
}

const RACE_FILLER: ReadonlySet<string> = new Set(["the", "his", "her", "their", "for", "race", "campaign", "bid", "seat", "run", "reelection", "re", "election"]);

/**
 * Do the reader's race words name this person's own office (a shared stem,
 * e.g. "state senate" and "State Senator, District 7")? An unknown office fits
 * nothing.
 */
export function raceWordsFitOffice(raceWords: string, office: string | null | undefined): boolean {
  if (!office) return false;
  const words = normalizeName(raceWords).split(" ").filter((word) => word && !RACE_FILLER.has(word));
  const own = normalizeName(office).split(" ").filter(Boolean);
  return words.length > 0 && words.every((word) => own.some((token) => token === word ||
    (word.length >= 5 && token.length >= 5 && word.slice(0, 5) === token.slice(0, 5))));
}

/* ── the composition ─────────────────────────────────────────────────────── */

export interface MoneyPerson {
  id: string;
  name: string;
}

export interface MoneyAnswerInput {
  ask: MoneyAsk;
  subject: MoneyPerson;
  /** COMPARE: the second person the reader named. */
  other?: MoneyPerson | null;
  /** The gated pack records — the same ones the validator checks. */
  records: readonly EvidenceRecord[];
  gaps: readonly EvidenceGap[];
  /**
   * A required first sentence: a person held as two records whose authorities
   * disagree is named with both, never merged. Not used for a comparison.
   */
  lead?: string;
}

type Finance = NonNullable<EvidenceRecord["finance"]>;
interface Held { record: EvidenceRecord; finance: Finance & { registeredName: string; agency: string; electionYear: number; checkedAt: string } }

const dollars = (amount: number) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const possessive = (name: string) => `${name}'s`;
const quoted = (text: string) => `"${text.replace(/"/g, "'").trim()}"`;

/** The state money records the route held for one person, or null when anything else is there too. */
function heldFor(records: readonly EvidenceRecord[], personId: string): Held[] | null {
  const mine = records.filter((record) => record.kind === "FINANCE_SUMMARY" && record.subjectId === personId);
  const held: Held[] = [];
  for (const record of mine) {
    const finance = record.finance;
    if (!record.id.startsWith("state-money:") || !finance || !finance.agency ||
      typeof finance.electionYear !== "number" || !finance.checkedAt) return null;
    // A filing or a registered committee is stated by its registered name; an agency's "no reports" has none.
    if (finance.filingState !== "NO_REPORTS_ON_FILE" && !finance.registeredName) return null;
    held.push({ record, finance: { ...finance, registeredName: finance.registeredName ?? "" } as Held["finance"] });
  }
  return held;
}

/**
 * A federal candidate's money: the one FEC summary record held, in the
 * record's own sentences, with the FEC and the read date. Null when anything
 * else is held or more than one record.
 */
function federalHeld(records: readonly EvidenceRecord[], personId: string): EvidenceRecord | null {
  const mine = records.filter((record) => record.kind === "FINANCE_SUMMARY" && record.subjectId === personId);
  return mine.length === 1 && mine[0]!.id.startsWith("fec:") && mine[0]!.sourceUrl && mine[0]!.text.trim() ? mine[0]! : null;
}

function composeFederalMoney(input: MoneyAnswerInput, record: EvidenceRecord): { answer: string; citedUrls: string[]; missingAnswer?: boolean } | null {
  const person = input.subject;
  if (input.ask.kind === "WHO_GAVE") return { answer: `We don't have ${person.name}'s campaign funding sources yet.`, citedUrls: [], missingAnswer: true };
  const totals = record.fecTotals;
  if (!totals || input.ask.kind !== "HOW_MUCH") return null;
  const parts = input.ask.measures.flatMap(measure => {
    const amount = measure === "RAISED" ? totals.receipts : measure === "SPENT" ? totals.disbursements : totals.cashOnHand;
    if (amount === null) return [];
    return [measure === "RAISED" ? `raised ${dollars(amount)}`
      : measure === "SPENT" ? `spent ${dollars(amount)}` : `had ${dollars(amount)} cash on hand`];
  });
  if (parts.length !== input.ask.measures.length) return null;
  const body = `${possessive(person.name)} campaign ${parts.join(" and ")} in the ${totals.cycle} cycle${totals.through ? ` through ${formatDateLong(totals.through) ?? totals.through}` : ""}`;
  const answer = assemble([...(input.lead ? [input.lead] : []), body], []);
  return answer ? { answer, citedUrls: [record.sourceUrl!] } : null;
}

/**
 * The period as the agency states it, spelled for a reader, with the report
 * count where the agency gives one. Agency report codes are not read out.
 */
export function periodPhrase(finance: Pick<Held["finance"], "totals" | "electionYear">): string {
  const period = finance.totals.coveringPeriod?.trim();
  const count = finance.totals.reportCount;
  const reports = count ? `${count} report${count === 1 ? "" : "s"}` : null;
  const through = period ? /^(.*?)\s*through (\d{4}-\d{2}-\d{2})$/.exec(period) : null;
  if (through && /^[A-Z0-9/ ,-]*$/.test(through[1])) return `in ${reports ?? "reports"} filed through ${formatDateLong(through[2]) ?? through[2]}`;
  const stated = period ? `for the ${spellOutDates(period)}` : `for the ${finance.electionYear} election cycle`;
  return reports ? `${stated}, across ${reports}` : stated;
}

const MEASURE_WORDS: Record<MoneyMeasure, { key: "receipts" | "expenditures" | "cashOnHand"; gerund: string; noun: string; more: string }> = {
  RAISED: { key: "receipts", gerund: "raising", noun: "money raised", more: "raising more" },
  SPENT: { key: "expenditures", gerund: "spending", noun: "spending", more: "spending more" },
  CASH: { key: "cashOnHand", gerund: "holding", noun: "cash on hand", more: "more cash on hand" },
};

/** "raising $X and spending $Y" — every figure the filing states, in the record's order. */
function facts(finance: Held["finance"], only?: MoneyMeasure): string | null {
  const parts: string[] = [];
  for (const measure of (only ? [only] : ["RAISED", "SPENT", "CASH"]) as MoneyMeasure[]) {
    const amount = finance.totals[MEASURE_WORDS[measure].key];
    if (amount === null) continue;
    parts.push(measure === "CASH" ? `${dollars(amount)} cash on hand` : `${MEASURE_WORDS[measure].gerund} ${dollars(amount)}`);
  }
  return parts.length ? parts.join(" and ") : null;
}

/**
 * One held record as one clause, opening with `committee` ("The campaign
 * committee", "One", "the other") so the person is named as few times as
 * possible. Null for a state this cannot state.
 */
function heldClause(person: MoneyPerson, held: Held, committee: string, only?: MoneyMeasure): string | null {
  const { finance } = held;
  const read = formatDateLong(finance.checkedAt) ?? finance.checkedAt;
  if (finance.filingState === "FILED") {
    const stated = facts(finance, only);
    if (!stated) return null;
    return `${committee}, registered as ${quoted(finance.registeredName)}, reported ${stated} ${periodPhrase(finance)}`;
  }
  if (finance.filingState === "REGISTERED_NO_ACTIVITY_REPORTED") {
    return `${committee}, registered as ${quoted(finance.registeredName)}, has reported no money raised or spent to the ${finance.agency} as of ${read}; registration does not establish that no money was raised`;
  }
  if (finance.filingState === "NO_REPORTS_ON_FILE") {
    return `the ${finance.agency} had no reports on file for ${person.name} as of ${read}`;
  }
  return null;
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function assemble(required: readonly string[], optional: readonly string[]): string | null {
  const sentences = required.map((sentence) => sentence.replace(/[.\s]+$/, ""));
  const text = (list: readonly string[]) => `${list.join(". ")}.`;
  if (overLengthBudget(text(sentences)) !== null) return null;
  for (const extra of optional) {
    const next = [...sentences, extra.replace(/[.\s]+$/, "")];
    if (overLengthBudget(text(next)) === null) sentences.push(extra.replace(/[.\s]+$/, ""));
  }
  return text(sentences);
}

/**
 * Compose the money answer, or null when a model should write it. See the
 * module note for exactly when each applies.
 */
export function composeMoneyAnswer(input: MoneyAnswerInput): { answer: string; citedUrls: string[]; missingAnswer?: boolean } | null {
  // Anything the pack holds beyond state committee totals is for a writer to read.
  if (input.records.some((record) => record.kind === "FINANCE_COMMITTEE" || record.kind === "FINANCE_TRANSACTION")) return null;
  if (input.ask.kind !== "COMPARE") {
    const federal = federalHeld(input.records, input.subject.id);
    if (federal) return composeFederalMoney(input, federal);
  }
  const people = [input.subject, ...(input.ask.kind === "COMPARE" && input.other ? [input.other] : [])];
  if (input.ask.kind === "COMPARE" && (people.length !== 2 || input.lead)) return null;
  const first = input.lead ? [input.lead] : [];
  const heldBy = people.map((person) => heldFor(input.records, person.id));
  if (heldBy.some((held) => held === null || held.length === 0)) return null;
  const all = heldBy.flat() as Held[];
  if (heldBy.some((held) => held!.filter((entry) => entry.finance.filingState === "FILED").length > 2)) return null;
  const cited = [...new Set(all.flatMap((entry) => entry.record.sourceUrl ? [entry.record.sourceUrl] : []))];

  if (input.ask.kind === "COMPARE") {
    const measure = input.ask.measure;
    const [mine, theirs] = heldBy as Held[][];
    // Each person in one clause, both clauses in one sentence: the people are named once each.
    const chosen: Held[] = [];
    for (const held of [mine, theirs]) {
      const filed = held.filter((entry) => entry.finance.filingState === "FILED");
      if (filed.length > 1) return null;
      chosen.push(filed[0] ?? held[0]);
    }
    const [a, b] = chosen.map((held, index) => [mine, theirs][index].length === 1 && held.finance.filingState === "FILED" ? held : null);
    const amountOf = (held: Held) => held.finance.totals[MEASURE_WORDS[measure].key];
    const figures = Boolean(a && b && amountOf(a) !== null && amountOf(b) !== null);
    const samePeriod = Boolean(a && b && a.finance.agency === b.finance.agency && a.finance.electionYear === b.finance.electionYear &&
      (a.finance.totals.coveringPeriod ?? "") === (b.finance.totals.coveringPeriod ?? "") && (a.finance.totals.reportCount ?? null) === (b.finance.totals.reportCount ?? null));
    let pair: string;
    if (figures && samePeriod) {
      // One period, stated once: "..., both for the 2026 Election Cycle".
      pair = `${possessive(people[0].name)} campaign committee, registered as ${quoted(a!.finance.registeredName)}, reported ${facts(a!.finance, measure)}, and ` +
        `${possessive(people[1].name)} campaign committee, registered as ${quoted(b!.finance.registeredName)}, reported ${facts(b!.finance, measure)}, both ${periodPhrase(a!.finance)}`;
    } else {
      const clauses = chosen.map((held, index) => heldClause(people[index], held, `${possessive(people[index].name)} campaign committee`, measure));
      if (clauses.some((clause) => clause === null)) return null;
      pair = clauses.map((clause, index) => index === 0 ? capitalized(clause!) : clause!).join("; ");
    }
    const sentences = [pair];
    if (figures) {
      if (!samePeriod) {
        sentences.push("The two filings cover different reporting periods, so the figures are stated side by side and not compared");
      } else {
        const [x, y] = [amountOf(a!)!, amountOf(b!)!];
        // The winner is named by its committee's registered name, the filer's own words, already tied to its candidate above.
        sentences.push(x === y
          ? `By these filings, the two committees reported the same ${MEASURE_WORDS[measure].noun}`
          : `By these filings, ${quoted((x > y ? a! : b!).finance.registeredName)} reported ${MEASURE_WORDS[measure].more}`);
      }
    }
    const answer = assemble(sentences, []);
    return answer ? { answer, citedUrls: cited } : null;
  }

  const held = heldBy[0]!;
  const person = input.subject;
  const filed = held.filter((entry) => entry.finance.filingState === "FILED");
  const shown = filed.length ? filed : held.slice(0, 1);
  if (input.ask.kind === "HOW_MUCH" && shown.length === 1 && filed.length === 1) {
    const { finance } = shown[0];
    const parts = input.ask.measures.flatMap(measure => {
      const amount = finance.totals[MEASURE_WORDS[measure].key];
      if (amount === null) return [];
      return [measure === "CASH" ? `had ${dollars(amount)} cash on hand`
        : `${measure === "RAISED" ? "raised" : "spent"} ${dollars(amount)}`];
    });
    if (parts.length === input.ask.measures.length) {
      const answer = `${quoted(finance.registeredName)} ${parts.join(" and ")} ${periodPhrase(finance)}.`;
      return overLengthBudget(answer) === null ? { answer, citedUrls: [shown[0].record.sourceUrl!] } : null;
    }
  }
  /* The WHO_GAVE lead names the person, so the filing is "The campaign
     committee"; two filings are "One" and "the other", in one sentence. */
  const statement = (named: boolean): string | null => {
    if (shown.length === 2) {
      const clauses = [heldClause(person, shown[0], "One"), heldClause(person, shown[1], "the other")];
      return clauses.every(Boolean) ? clauses.join("; ") : null;
    }
    const clause = heldClause(person, shown[0], named ? `${possessive(person.name)} campaign committee` : "The campaign committee");
    return clause ? capitalized(clause) : null;
  };

  if (input.ask.kind === "WHO_GAVE") {
    const organizationRows = shown.flatMap(entry => filedOrganizations(entry.finance.funding).map(org => ({ org, entry })));
    if (organizationRows.length) {
      const amounts = organizationRows.map(({ org, entry }) => `${org.filedName}${org.filedType ? ` (${org.filedType})` : ""}, ${dollars(org.amount)} ${periodPhrase(entry.finance)}`);
      const individuals = shown.flatMap(entry => {
        const funding = entry.finance.funding;
        const total = funding?.individualTotal;
        return [typeof total === "number" ? `Individual giving was ${dollars(total)} ${periodPhrase(entry.finance)}` : null,
          stateSmallDonorSentence(funding)].filter((text): text is string => Boolean(text));
      });
      const answer = assemble([...(input.lead ? [input.lead] : []), `${person.name}'s filings report these organization amounts: ${amounts.join("; ")}`,
        ...individuals], []);
      return answer ? { answer, citedUrls: cited } : null;
    }
    return { answer: `We don't have ${person.name}'s campaign funding sources yet.`, citedUrls: [], missingAnswer: true };
  }

  // HOW_MUCH: a figure the reader asked for that the filing does not carry is said to be missing from OUR record.
  const two = shown.length === 2 ? `We hold 2 committee filings for ${person.name}, each stated on its own and not added together` : null;
  const body = statement(!two);
  if (!body) return null;
  const missing = filed.length
    ? input.ask.measures.filter((measure) => filed.every((entry) => entry.finance.totals[MEASURE_WORDS[measure].key] === null))
    : [];
  const absent = missing.map((measure) => `Our record of ${filed.length === 1 ? "this filing" : "these filings"} does not include ${MEASURE_WORDS[measure].noun}`);
  const answer = assemble([...first, body, ...absent], []);
  return answer ? { answer, citedUrls: cited } : null;
}

/* ── a race's candidates, together ──────────────────────────────────────── */

/**
 * The candidates in one race the route resolved, from the same held filings.
 *
 * - **A contest on the reader's held ballot** (bound by name, or the one
 *   contest for a bound body's own seats): every listed candidate with their
 *   own state committee filing, two committees stated apart, and every
 *   candidate with no money record named as such, with the count ("candidates
 *   with a state money record we hold: 2 of 3"). "Who is raising the most" gets
 *   a verdict only when every candidate has one filing with the same agency and
 *   period.
 * - **A governing body whose race the authority says is not on the ballot**:
 *   that statement in the authority's words, then the committees the county
 *   register links to the office, as the register states them; never attached
 *   to a person.
 *
 * "Who gave" is answered as for one person. Anything else returns null and the
 * model writes.
 */
export type GroupMoneyAsk =
  | { kind: "HOW_MUCH"; measures: readonly MoneyMeasure[] }
  | { kind: "WHO_GAVE" }
  | { kind: "MOST"; measure: MoneyMeasure };

export interface GroupMoneyQuestion {
  ask: GroupMoneyAsk;
  /** The words naming the race ("<place> school board", "governor", "state senator district 7"). */
  group: string;
}

const FUNDED = "(?:funded|funds|is funding|has funded|financed|is financing|has financed|bankrolled|is bankrolling|is paying for|paid for|(?:gave|gives|given|donated|donates|contributed|contributes) (?:money )?to)";
const GROUP_TAIL = "(?: (?:so far|in total|this (?:year|cycle|election(?: cycle)?)))?";
/* "the <place> school board candidates", "the candidates for governor", "the candidates in the state senate district 7 race". */
const CANDIDATES_OF: readonly string[] = [
  "(?:the )?(?<group>.+?) (?:candidates|candidates campaigns|candidates committees)",
  "(?:the )?candidates (?:for|in|running for) (?:the )?(?<group>.+?)(?: (?:race|contest|election))?",
];
const RACE = "(?:the )?(?<group>.+?)(?: (?:race|contest|election))?";
const mostMeasure = (verb: string | undefined): MoneyMeasure => /^spen/.test(verb ?? "") ? "SPENT" : "RAISED";

const GROUP_PATTERNS: readonly { pattern: RegExp; read: (groups: Record<string, string | undefined>) => GroupMoneyAsk }[] = [
  /* WHO_GAVE */
  ...CANDIDATES_OF.map((of) => ({ pattern: new RegExp(`^who (?:has |have )?${FUNDED} ${of}$`), read: (): GroupMoneyAsk => ({ kind: "WHO_GAVE" }) })),
  ...CANDIDATES_OF.map((of) => ({ pattern: new RegExp(`^who (?:are|were|is) the ${DONORS} (?:to|of|for|behind) ${of}$`), read: (): GroupMoneyAsk => ({ kind: "WHO_GAVE" }) })),
  { pattern: new RegExp(`^who (?:are|were|is) the ${DONORS} (?:in|for) ${RACE}$`), read: () => ({ kind: "WHO_GAVE" }) },
  /* HOW_MUCH */
  ...CANDIDATES_OF.map((of) => ({
    pattern: new RegExp(`^how much (?:campaign )?(?:money )?(?:have|has|did) ${of} (?<m1>${RAISE}|${SPEND})(?: and (?<m2>${RAISE}|${SPEND}))?${GROUP_TAIL}$`),
    read: (g: Record<string, string | undefined>): GroupMoneyAsk => ({ kind: "HOW_MUCH", measures: [...new Set([measureOf(g.m1), ...(g.m2 ? [measureOf(g.m2)] : [])])] }),
  })),
  { pattern: new RegExp(`^how much (?:campaign )?money (?:has been|was|is being) (?<m1>raised|spent) (?:in|for) ${RACE}${GROUP_TAIL}$`), read: (g) => ({ kind: "HOW_MUCH", measures: [measureOf(g.m1)] }) },
  /* MOST */
  { pattern: new RegExp(`^(?:who|which candidate) (?:is|s|has been|has|have) (?<m>raising|spending|raised|spent) the most(?: money)? (?:in|for|among) ${RACE}${GROUP_TAIL}$`), read: (g) => ({ kind: "MOST", measure: mostMeasure(g.m) }) },
  { pattern: new RegExp(`^(?:who|which candidate) (?<m>raised|spent) the most(?: money)? (?:in|for|among) ${RACE}${GROUP_TAIL}$`), read: (g) => ({ kind: "MOST", measure: mostMeasure(g.m) }) },
  ...CANDIDATES_OF.map((of) => ({
    pattern: new RegExp(`^which of ${of} (?:has |is )?(?<m>raising|spending|raised|spent) the most(?: money)?${GROUP_TAIL}$`),
    read: (g: Record<string, string | undefined>): GroupMoneyAsk => ({ kind: "MOST", measure: mostMeasure(g.m) }),
  })),
];

const GROUP_PRONOUNS = /\b(?:he|she|his|her|their|they|them|this|that|these|those|my|our|your|i|me|we|you)\b/;

/** The race money question this is, with the words naming the race, or null. Nothing is bound here. */
export function groupMoneyQuestionShape(question: string): GroupMoneyQuestion | null {
  const normalized = normalizeName(question);
  if (!normalized || normalized.length > 160 || /\d{4}/.test(normalized)) return null;
  for (const { pattern, read } of GROUP_PATTERNS) {
    const groups = pattern.exec(normalized)?.groups;
    // "the governor s race": the possessive is not part of the race's name.
    const group = groups?.group?.trim().replace(/^the /, "").replace(/ s$/, "").trim();
    if (!groups || !group || GROUP_PRONOUNS.test(group)) continue;
    return { ask: read(groups), group };
  }
  return null;
}

/**
 * Is this contest the bound body's own seats? Every word of the contest's
 * title (past "member of the") must be a word of the body's name.
 */
export function contestFitsBody(contestTitle: string, bodyName: string): boolean {
  const office = normalizeName(contestTitle).replace(/\b(?:members?|of|at large|unexpired|full|short|term|seats?)\b/g, " ").trim();
  return raceWordsFitOffice(office, bodyName);
}

/** A candidate the ballot lists; `matched` is false when their ballot listing is not yet joined to a filing identity. */
export interface GroupCandidate extends MoneyPerson {
  matched: boolean;
}

export interface GroupMoneyContestInput {
  ask: GroupMoneyAsk;
  contest: { id: string; title: string };
  /** Every candidate the held ballot lists for the contest, in ballot order. */
  candidates: readonly GroupCandidate[];
  records: readonly EvidenceRecord[];
  gaps: readonly EvidenceGap[];
}

const MEASURE_VERB: Record<MoneyMeasure, string> = { RAISED: "raised", SPENT: "spent", CASH: "cash on hand" };

/** What one committee filing reported, compactly: "raised $X, spent $Y", and any asked figure it does not carry. */
function filedFacts(finance: Held["finance"], measures: readonly MoneyMeasure[]): string {
  const parts = measures.flatMap((measure) => {
    const amount = finance.totals[MEASURE_WORDS[measure].key];
    if (amount === null) return [];
    return [measure === "CASH" ? `${dollars(amount)} cash on hand` : `${MEASURE_VERB[measure]} ${dollars(amount)}`];
  });
  const missing = measures.filter((measure) => finance.totals[MEASURE_WORDS[measure].key] === null).map((measure) => MEASURE_WORDS[measure].noun);
  return [...parts, ...(missing.length ? [`no ${missing.join(" or ")} in our record of the filing`] : [])].join(", ");
}

/**
 * One candidate, compactly: `Name ("Committee"): raised $X`. Two committees
 * are stated apart. No filing is our gap ("no state committee filing in our
 * records", or "not yet matched to a state filing in our records" when the
 * listing is not joined to a filing identity). Candidates sharing a gap are
 * named together.
 */
function candidateClause(person: GroupCandidate, held: readonly Held[], measures: readonly MoneyMeasure[], withPeriod: boolean): { name: string; text: string; gap?: string } | null {
  const period = (finance: Held["finance"]) => withPeriod ? ` ${periodPhrase(finance)}` : "";
  if (held.length === 0) {
    return { name: person.name, text: "", gap: "we don't have a campaign filing yet" };
  }
  if (held.length === 2) {
    if (!held.every((entry) => entry.finance.filingState === "FILED")) return null;
    const apart = held.map((entry) => `${quoted(entry.finance.registeredName)} ${filedFacts(entry.finance, measures)}${period(entry.finance)}`).join("; ");
    return { name: person.name, text: `${person.name}, two committees stated apart (${apart})` };
  }
  const { finance } = held[0];
  const read = formatDateLong(finance.checkedAt) ?? finance.checkedAt;
  if (finance.filingState === "FILED") {
    return { name: person.name, text: `${person.name} (${quoted(finance.registeredName)}): ${filedFacts(finance, measures)}${period(finance)}` };
  }
  if (finance.filingState === "REGISTERED_NO_ACTIVITY_REPORTED") {
    return { name: person.name, text: `${person.name} (${quoted(finance.registeredName)}): registered, no money raised or spent reported to the ${finance.agency} as of ${read}` };
  }
  if (finance.filingState === "NO_REPORTS_ON_FILE") {
    return { name: person.name, text: "", gap: `no reports on file with the ${finance.agency} as of ${read}` };
  }
  return null;
}

/** The clauses in ballot order, candidates who share a gap named together where the first of them stands. */
function joinedClauses(clauses: readonly { name: string; text: string; gap?: string }[]): string {
  const out: string[] = [];
  const placed = new Set<string>();
  for (const clause of clauses) {
    if (!clause.gap) { out.push(clause.text); continue; }
    if (placed.has(clause.gap)) continue;
    placed.add(clause.gap);
    const names = clauses.filter((other) => other.gap === clause.gap).map((other) => other.name);
    const named = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    out.push(`${named}: ${clause.gap}`);
  }
  return out.join("; ");
}

/** Compose a contest's candidates' money from their held state filings, or null when a model should write it. */
export function composeGroupMoneyAnswer(input: GroupMoneyContestInput): { answer: string; citedUrls: string[]; missingAnswer?: boolean } | null {
  if (input.candidates.length === 0) return null;
  if (input.records.some((record) => record.kind === "FINANCE_COMMITTEE" || record.kind === "FINANCE_TRANSACTION")) return null;
  const ids = new Set(input.candidates.map((person) => person.id));
  // Every money summary in the pack belongs to a candidate the ballot lists for this race.
  if (input.records.some((record) => record.kind === "FINANCE_SUMMARY" && !ids.has(record.subjectId ?? ""))) return null;
  const heldBy = input.candidates.map((person) => heldFor(input.records, person.id));
  if (heldBy.some((held) => held === null || held.length > 2)) return null;
  const chosen = heldBy as Held[][];
  const all = chosen.flat();
  // A race where we hold no state filing at all (a federal race, say) is for the records and a writer, not a list of "none".
  if (all.length === 0) return null;
  const measures: readonly MoneyMeasure[] = input.ask.kind === "HOW_MUCH" ? input.ask.measures
    : input.ask.kind === "MOST" ? [input.ask.measure] : ["RAISED"];
  const filed = all.filter((held) => held.finance.filingState === "FILED");
  // One period, stated once, when every filing states the same one.
  const periods = new Set(filed.map((held) => periodPhrase(held.finance)));
  const shared = filed.length > 1 && periods.size === 1 ? [...periods][0] : null;
  const clauses = input.candidates.map((person, index) => candidateClause(person, chosen[index], measures, !shared));
  if (clauses.some((clause) => clause === null)) return null;
  const list = joinedClauses(clauses as { name: string; text: string; gap?: string }[]);
  const race = `the ${input.contest.title} race`;
  const sentences: string[] = [];
  if (input.ask.kind === "WHO_GAVE") {
    if (all.some(entry => filedOrganizations(entry.finance.funding).length > 0)) return null;
    return { answer: `We don't have the campaign funding sources for ${race} yet.`, citedUrls: [], missingAnswer: true };
  }
  sentences.push(`${list}${shared ? `, ${shared}` : ""}`);
  if (input.ask.kind === "MOST") {
    const key = MEASURE_WORDS[input.ask.measure].key;
    // Like for like only: one filing each, every candidate, the same agency and period, the asked figure present.
    const comparable = chosen.every((held) => held.length === 1 && held[0].finance.filingState === "FILED") && filed.length > 1 &&
      periods.size === 1 && new Set(filed.map((held) => held.finance.agency)).size === 1 && filed.every((held) => held.finance.totals[key] !== null);
    if (comparable) {
      const top = Math.max(...filed.map((held) => held.finance.totals[key]!));
      const leaders = filed.filter((held) => held.finance.totals[key] === top);
      sentences.push(leaders.length === 1
        ? `By these filings, ${quoted(leaders[0].finance.registeredName)} reported ${MEASURE_WORDS[input.ask.measure].more}`
        : `By these filings, ${leaders.length} committees reported the same, highest ${MEASURE_WORDS[input.ask.measure].noun}`);
    } else {
      sentences.push("Not every candidate has one like filing for the same period, so none is ranked");
    }
  }
  const answer = assemble(sentences, []);
  const cited = [...new Set(all.flatMap((entry) => entry.record.sourceUrl ? [entry.record.sourceUrl] : []))];
  return answer ? { answer, citedUrls: cited } : null;
}

export interface GroupMoneyNoRaceInput {
  ask: GroupMoneyAsk;
  body: { id: string; name: string };
  /** The authority's own statement that this body's race is not on the ballot. */
  absence: EvidenceRecord;
  records: readonly EvidenceRecord[];
}

export function composeNoRaceMoneyAnswer(input: GroupMoneyNoRaceInput): { answer: string; citedUrls: string[]; missingAnswer?: boolean } | null {
  if (input.absence.kind !== "BALLOT_ABSENCE" || !input.absence.text.trim()) return null;
  if (input.records.some((record) => record.kind === "FINANCE_SUMMARY")) return null;
  const mine = (record: EvidenceRecord) => record.bodyId === input.body.id;
  const money = input.records.filter((record) => (record.kind === "FINANCE_COMMITTEE" || record.kind === "FINANCE_TRANSACTION") && mine(record));
  if (money.some(record => record.kind === "FINANCE_TRANSACTION" && /\bcontribution\b.*\bfrom\b/.test(record.text))) return null;
  return { answer: `We don't have ${input.body.name}'s campaign ${input.ask.kind === "WHO_GAVE" ? "funding sources" : "totals"} yet.`,
    citedUrls: [], missingAnswer: true };
}
