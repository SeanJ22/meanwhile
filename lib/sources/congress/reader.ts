import type { PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";
import type { EvidenceGap, EvidenceRecord } from "../../ask/evidence.ts";
import type { CardSource } from "../../officials/card-sources.ts";
import { readFederalSourceProjection } from "./publication.ts";
import type { FederalFact } from "./types.ts";
import { federalCardSources, federalDeadlineDate } from "./presentation.ts";
;

export const isOpenFederalRule = (row: FederalFact, now: string): boolean => {
  if (row.kind !== "RULE" || row.withdrawn || row.acceptsComments === false || !row.closesAt || !row.commentUrl) return false;
  const instant = (value: string, end = false) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(value);
    const offset = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" }).formatToParts(new Date(`${value}T${end ? "12" : "05"}:00:00Z`)).find(part => part.type === "timeZoneName")?.value.replace("GMT", "") ?? "-05:00";
    return Date.parse(`${value}T${end ? "23:59:59" : "00:00:00"}${offset}`);
  };
  return instant(row.closesAt, true) >= Date.parse(now) && (!row.opensAt || instant(row.opensAt) <= Date.parse(now)) && (!row.publishedAt || instant(row.publishedAt) <= Date.parse(now));
};
export interface FederalMemberRead {
  memberId: string;
  bills: FederalFact[];
  referrals: FederalFact[];
  contributions: FederalFact[];
  /** Full text is read from native bill partitions only when requested. */
  texts: FederalFact[];
  sources: CardSource[];
  coverage: { congress: string; govinfo: string; lda: string };
  totalBills: number;
}
/** Individual money is shown as filed report totals; donor identities remain in saved source evidence. */
function contributionTotals(records: FederalFact[]): FederalFact[] {
  const groups = new Map<string, { row: FederalFact; cents: bigint; dates: string[] }>();
  for (const row of records) {
    if (row.organization || !/^-?\d+(?:\.\d{1,2})?$/.test(row.amount ?? "")) continue;
    const key = `${row.filingId}:${row.title}:${row.recipientId}:${row.recipientName}`, parts = row.amount!.split("."), cents = BigInt(parts[0]) * BigInt(100) + BigInt((parts[1] ?? "").padEnd(2, "0")) * BigInt(parts[0].startsWith("-") ? -1 : 1);
    const group = groups.get(key) ?? { row, cents: BigInt(0), dates: [] };
    group.cents += cents; if (row.contributionDate) group.dates.push(row.contributionDate); groups.set(key, group);
  }
  return [...records.filter(row => row.organization), ...[...groups.values()].map(({ row, cents, dates }) => {
    const absolute = cents < BigInt(0) ? -cents : cents; dates.sort();
    return { ...row, id: `${row.filingId}:individual-total:${row.title}:${row.recipientId}:${row.recipientName}`, amount: `${cents < BigInt(0) ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`,
      contributionDate: dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} through ${dates.at(-1)}` };
  })];
}
export async function readFederalMember(memberId: string, options: PromotedCivicDataReadOptions & { offset?: number; limit?: number; includeText?: boolean; includeLinks?: boolean } = {}): Promise<FederalMemberRead> {
  const blank: FederalMemberRead = { memberId, bills: [], referrals: [], contributions: [], texts: [], sources: [], totalBills: 0, coverage: { congress: "NOT_RECORDED", govinfo: "NOT_RECORDED", lda: "NOT_RECORDED" } };
  if (!/^congress:[A-Z]\d{6}$/.test(memberId)) return blank;
  const [congress, lda] = await Promise.all([
    readFederalSourceProjection("congress-api", memberId, options), readFederalSourceProjection("senate-lda", memberId, options),
  ]);
  const records = congress.kind === "PROMOTED" ? congress.value.records : [];
  const allBills = records.filter(row => row.kind === "BILL" && `congress:${row.bioguideId}` === memberId).sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  const bills = allBills.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 20));
  const ids = new Set(bills.map(row => row.billId));
  const referrals = records.filter(row => row.kind === "COMMITTEE_REFERRAL" && ids.has(row.billId));
  const contributionRecords = lda.kind === "PROMOTED" ? lda.value.records.filter(row => row.kind === "LOBBYING_CONTRIBUTION" && `congress:${row.bioguideId}` === memberId && row.amount) : [];
  const contributions = contributionTotals(contributionRecords);
  const govinfo = options.includeLinks === false ? [] : await Promise.all(bills.map(row => readFederalSourceProjection("govinfo", `bill:${row.billId}`, options)));
  const texts = govinfo.flatMap(result => result.kind === "PROMOTED" ? result.value.records.filter(row => row.kind === "BILL_TEXT" || row.kind === "BILL_TEXT_LINK") : []);
  const links = records.filter(row => row.kind === "BILL_TEXT_LINK" && ids.has(row.billId));
  return { memberId, bills, referrals, contributions, texts: [...links, ...texts].map(row => options.includeText ? row : { ...row, text: undefined }),
    sources: federalCardSources([...bills, ...referrals, ...links, ...texts, ...contributionRecords]), totalBills: allBills.length,
    coverage: { congress: congress.kind, govinfo: govinfo.some(row => row.kind === "PROMOTED") ? "PROMOTED" : govinfo.some(row => row.kind === "STORE_UNREACHABLE") ? "STORE_UNREACHABLE" : "NOT_RECORDED", lda: lda.kind } };
}
export interface FederalRuleRead { rules: { rule: FederalFact; sources: FederalFact[] }[]; coverage: Record<string, string>; totalRules: number }
export async function readFederalRules(options: PromotedCivicDataReadOptions & { offset?: number; limit?: number } = {}): Promise<FederalRuleRead> {
  const now = options.now ?? new Date().toISOString();
  const sources = ["regulations-gov", "federal-register"] as const;
  const held = await Promise.all(sources.map(source => readFederalSourceProjection(source, "rules", options)));
  const groups = new Map<string, FederalFact[]>();
  for (const result of held) if (result.kind === "PROMOTED") for (const row of result.value.records) {
    const key = row.documentNumber || `${row.source}:${row.nativeId}`;
    const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
  }
  const rules = [...groups.values()].flatMap(group => {
      const regulations = group.find(row => row.source === "regulations-gov");
      if (regulations?.withdrawn) return [];
      const rule = group.find(row => row.source === "regulations-gov" && isOpenFederalRule(row, now)) ?? group.find(row => isOpenFederalRule(row, now));
      return rule ? [{ rule, sources: group }] : [];
    }).sort((a, b) => a.rule.closesAt!.localeCompare(b.rule.closesAt!));
  return { coverage: Object.fromEntries(sources.map((source, index) => [source, held[index].kind])), totalRules: rules.length,
    rules: rules.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? rules.length)) };
}

export function federalEvidence(row: FederalFact, subjectId?: string): EvidenceRecord {
  const text = row.kind === "RULE" ? `${row.title}. ${row.text ?? ""} Comments close ${federalDeadlineDate(row) ?? "date not supplied"}${row.closesAt?.includes("T") ? ` (closing instant ${row.closesAt})` : ""}. Comment at ${row.commentUrl ?? row.sourceUrl}.`
    : row.kind === "LOBBYING_CONTRIBUTION" ? `${row.organization ?? "Lobbying contributions"}: filed ${row.amount ?? "amount not supplied"} to ${row.recipientName ?? "recipient"} on ${row.contributionDate ?? "date not supplied"}.`
      : row.kind === "COMMITTEE_REFERRAL" ? `${row.billId}: referred to ${row.title} (${row.committeeId}).`
        : row.kind === "BILL_TEXT" ? `${row.title}: ${row.text ?? ""}`
          : `${row.title}${row.bioguideId ? `; sponsor Bioguide ${row.bioguideId}` : ""}${row.action ? `; latest action ${row.actionDate ?? ""}: ${row.action}` : ""}`;
  return { kind: row.kind === "RULE" ? "PUBLIC_COMMENT_ACCESS" : row.kind === "LOBBYING_CONTRIBUTION" ? "FINANCE_TRANSACTION" : row.kind === "BILL_TEXT" ? "SOURCE_PASSAGE" : "OFFICIAL_ACTION",
    id: row.id, ...(subjectId ? { subjectId, canonicalSubjectId: subjectId } : {}), text,
    occurredAt: row.kind === "LOBBYING_CONTRIBUTION" ? row.contributionDate?.slice(0, 10) ?? row.publishedAt : row.publishedAt, sourceUrl: row.sourceUrl, sourceOrg: row.publisher, retrievedAt: row.checkedAt };
}
export async function federalAskEvidence(memberId: string | null, question: string, options: PromotedCivicDataReadOptions = {}) {
  const records: EvidenceRecord[] = [], gaps: EvidenceGap[] = [], denominators: Record<string, number> = {};
  const references = new Set([...question.matchAll(/\b(h[.\s]*r|s|h[.\s]*j[.\s]*res|s[.\s]*j[.\s]*res|h[.\s]*con[.\s]*res|s[.\s]*con[.\s]*res|h[.\s]*res|s[.\s]*res)[.\s]*(\d+)\b/gi)]
    .map(match => `${match[1].toLowerCase().replace(/[.\s]/g, "")}:${match[2]}`));
  const memberQuestion = references.size > 0 || /\b(text|bills?|legislation|sponsor(?:ed|s)?|acts?|committees?|lobby(?:ing|ists?)?|contributions?|money|fund(?:ing|ed)?|record|accomplishments?|work)\b|tell me about|overview/i.test(question);
  if (memberId?.startsWith("congress:") && memberQuestion) {
    const member = await readFederalMember(memberId, { ...options, limit: Number.MAX_SAFE_INTEGER, includeLinks: false });
    records.push(...[...member.bills, ...member.referrals, ...member.contributions].map(row => federalEvidence(row, memberId)));
    const identitySources = new Map(member.contributions.flatMap(row => row.honoreeJoin?.status === "JOINED"
      ? [[`${row.honoreeJoin.rosterVersionId}:${row.bioguideId}`, { row, join: row.honoreeJoin }] as const] : []));
    records.push(...[...identitySources.entries()].map(([id, { row, join }]): EvidenceRecord => ({
      kind: "SOURCE_PASSAGE", id: `lda-honoree:${id}`, subjectId: memberId, canonicalSubjectId: memberId,
      text: `The filed honoree ${JSON.stringify(row.honoreeName)} uniquely matches ${join.matchedName}, ${join.chamber}, ${join.state}, Bioguide ${row.bioguideId} in the held federal roster.`,
      occurredAt: null, sourceUrl: join.sourceUrl, sourceOrg: join.sourceOrg, retrievedAt: join.checkedAt,
    })));
    denominators.sponsoredBillsHeld = member.totalBills;
    if (/\b(lobby|lobbying|lobbyist|lobbyists|contributions)\b/i.test(question) && member.coverage.lda !== "PROMOTED") {
      gaps.push({ whose: "OURS", statement: "We have not verified a recipient identity link between the Senate lobbying contribution filings and this member." });
    }
    // Text queries read only the named bill, or bills whose exact title contains a substantive query word.
    if (references.size > 0 || /\b(text|bills?|legislation|sponsor(?:ed|s)?|act)\b/i.test(question)) {
      const words = question.toLowerCase().match(/[a-z]{5,}/g)?.filter(word => !["bills", "sponsor", "sponsored", "legislation", "their", "which"].includes(word)) ?? [];
      const selected = member.bills.filter(row => references.has(row.billId?.split(":").slice(1).join(":") ?? "") || question.includes(row.billId ?? "\0") || words.some(word => row.title.toLowerCase().includes(word)));
      for (const bill of selected) {
        const held = await readFederalSourceProjection("govinfo", `bill:${bill.billId}`, options);
        if (held.kind === "PROMOTED") records.push(...held.value.records.filter(row => row.kind === "BILL_TEXT").map(row => federalEvidence(row, memberId)));
      }
      denominators.billTextsReturned = records.filter(row => row.kind === "SOURCE_PASSAGE").length;
    }
  }
  if (/\b(rule|rules|regulation|regulations|comment|comments|deadline|deadlines|participate)\b|voice heard|weigh in/i.test(question)) {
    const rules = await readFederalRules(options);
    records.push(...rules.rules.flatMap(({ sources }) => sources.map(row => federalEvidence(row, memberId ?? undefined))));
    denominators.federalRulesOpenForComment = rules.rules.length;
  }
  return { records, gaps, denominators };
}
