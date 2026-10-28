import { readFederalMoneyForPlace, type FederalMoneyReadOptions } from "../federal-money/reader.ts";
import { federalMoneyDetails, federalMoneyRows, writeFederalMoneyCard, FEDERAL_MONEY_SOURCE_LABELS, type FederalMoneyTarget } from "../federal-money/view.ts";
import { compareFederalMoneyActions } from "../federal-money/model.ts";
import type { FederalMoneyFact } from "../federal-money/model.ts";
import type { EvidenceGap, EvidenceRecord, EvidenceSubject } from "./evidence.ts";
import { overLengthBudget } from "./length-contract.ts";

export function federalMoneyQuestion(question: string): boolean {
  return !/\b(?:campaign|donors?|contributions?)\b/i.test(question) && /\b(?:grants?|contracts?|loans?|audits?|audit findings|disasters?|FEMA|UEI|SAM\.gov|USAspending|Federal Audit Clearinghouse|federal (?:money|funding|funds|aid|awards?|support|registration)|(?:entity|government) registration)\b/i.test(question);
}

/** A complete question naming the reader's own place needs no model to choose
 * a government. More specific named subjects still use the normal resolver. */
export function federalMoneyPlaceQuestion(question: string): boolean {
  return /^(?:what|which|show) (?:the )?(?:federal )?(?:grants?|contracts?|loans?|funding|money|awards?|audit findings|disaster declarations) (?:reach|reaches|cover|covers|are in|are for|apply to|for) (?:my|our) (?:county|city|school district|congressional district|area)\??$/i.test(question.trim())
    || /^what is (?:my|our) (?:county|city|school district)'s (?:UEI|SAM\.gov registration)\??$/i.test(question.trim());
}
export function federalMoneyPlaceDivisions(question: string, divisionIds: readonly string[]): string[] {
  const level = /\b(?:my|our) congressional district\b/i.test(question) ? "cd" : /\b(?:my|our) school district\b/i.test(question) ? "school_district" : /\b(?:my|our) county\b/i.test(question) ? "county" : /\b(?:my|our) city\b/i.test(question) ? "place" : null;
  return level ? divisionIds.filter(id => id.includes(`/${level}:`)) : [...divisionIds];
}

/** Source-native awards, recipient audits, registrations and county disasters
 * enter the same evidence pack, even when the question is not about a budget. */
export async function federalMoneyEvidence(targets: readonly FederalMoneyTarget[], subjectId?: string, options: FederalMoneyReadOptions = {}) {
  const unique = [...new Map(targets.map(target => [`${target.divisionId}|${target.bodyId ?? ""}`, target])).values()];
  const results = await Promise.allSettled(unique.map(target => readFederalMoneyForPlace(target, options)));
  const records = new Map<string, EvidenceRecord>();
  const gaps: EvidenceGap[] = [];
  const denominators: Record<string, number> = {};
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (result.status === "rejected") { gaps.push({ whose: "OURS", statement: "We're working on getting this info about federal money and records." }); continue; }
    const target = unique[index];
    for (const source of result.value.sources) {
      const key = `federalMoney:${source.source}`;
      const rows = federalMoneyRows(source.records, { ...target, bodyIds: result.value.recipientIds ?? target.bodyIds });
      denominators[`${key}:recordsReturned`] = (denominators[`${key}:recordsReturned`] ?? 0) + rows.length;
      denominators[`${key}:moreRecords`] = (denominators[`${key}:moreRecords`] ?? 0) + (source.moreRecords ? 1 : 0);
      denominators[`${key}:unavailableReads`] = (denominators[`${key}:unavailableReads`] ?? 0) + (source.status === "UNAVAILABLE" ? 1 : 0);
      if (source.moreRecords) gaps.push({ whose: "OURS", statement: `More held records from ${FEDERAL_MONEY_SOURCE_LABELS[source.source]} are available on this government or district card.` });
      if (!rows.length && !source.moreRecords) gaps.push({ whose: "OURS", statement: `We're working on getting this info from ${FEDERAL_MONEY_SOURCE_LABELS[source.source]} for this place.` });
      else if (source.coverageComplete === false) gaps.push({ whose: "OURS", statement: `We're working on getting more records from ${FEDERAL_MONEY_SOURCE_LABELS[source.source]} for this place.` });
      for (const row of rows) {
        const fact = row.fact;
        records.set(fact.id, { kind: "FEDERAL_MONEY", id: fact.id, subjectId: subjectId ?? target.divisionId,
          ...(target.bodyId && row.relationship !== "GEOGRAPHY" ? { bodyId: target.bodyId } : {}),
          text: row.text, sourceUrl: fact.provenance.sourceUrl, sourceOrg: fact.provenance.sourceOrg,
          retrievedAt: fact.provenance.retrievedAt, publicationDate: fact.provenance.publicationDate, official: true,
          federalMoney: { fact, relationship: row.relationship, divisionId: target.divisionId } });
      }
    }
  }
  return { records: [...records.values()], gaps: [...new Map(gaps.map(gap => [gap.statement, gap])).values()], denominators };
}

function wantedKinds(question: string): ReadonlySet<FederalMoneyFact["kind"]> {
  const kinds = new Set<FederalMoneyFact["kind"]>();
  if (/\bgrants?\b/i.test(question)) kinds.add("GRANT");
  if (/\bcontracts?\b/i.test(question)) kinds.add("CONTRACT");
  if (/\bloans?\b/i.test(question)) kinds.add("LOAN");
  if (/\baudits?\b|\bfindings\b|clearinghouse/i.test(question)) kinds.add("AUDIT");
  if (/\bdisasters?\b|\bFEMA\b/i.test(question)) kinds.add("DISASTER");
  if (/\bUEI\b|SAM\.gov|\bregistration/i.test(question)) kinds.add("ENTITY");
  if (!kinds.size) for (const kind of ["GRANT", "CONTRACT", "LOAN"] as const) kinds.add(kind);
  return kinds;
}

function brief(record: EvidenceRecord, question: string): string {
  const { fact } = record.federalMoney!;
  if (/\bUEI\b/i.test(question) && fact.uei) return `${fact.recipient ?? "This government"} has federal entity identifier ${fact.uei}.`;
  // A direct question about a native fact still answers it from the same record.
  const detail = federalMoneyDetails(fact).find(row => new RegExp(`\\b${row.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(question));
  return detail ? `${fact.recipient ?? fact.title}: ${detail.label.toLowerCase()} is ${detail.value}.` : writeFederalMoneyCard(fact);
}

/** A direct federal-source question can answer from its native fields without
 * a model call; every complete row remains in the reader's Records list. */
export function composeFederalMoneyAnswer(input: { question: string; subject: EvidenceSubject | null; records: readonly EvidenceRecord[] }) {
  if (!federalMoneyQuestion(input.question) || input.subject && input.subject.kind !== "BODY") return null;
  const kinds = wantedKinds(input.question);
  const year = input.question.match(/\b((?:19|20)\d{2})\b/)?.[1];
  const received = input.subject?.kind === "BODY" && /\b(?:receiv\w*|got|awarded to)\b/i.test(input.question) && !/\b(?:area|reach\w*|spent in)\b/i.test(input.question);
  const held = input.records.filter(record => record.kind === "FEDERAL_MONEY" && record.federalMoney && (!input.subject || record.subjectId === input.subject.id) && (!received || record.federalMoney.relationship !== "GEOGRAPHY") && kinds.has(record.federalMoney.fact.kind) && (!year || (record.federalMoney.fact.period ?? record.federalMoney.fact.provenance.publicationDate ?? "").includes(year)))
    .sort((a, b) => compareFederalMoneyActions(a.federalMoney!.fact, b.federalMoney!.fact));
  const selected: EvidenceRecord[] = [];
  let answer = "";
  for (const record of held) {
    const sentence = brief(record, input.question);
    const next = `${answer}${answer ? " " : ""}${sentence}`;
    if (overLengthBudget(next)) continue;
    answer = next;
    selected.push(record);
  }
  return answer ? { answer, citedUrls: [...new Set(selected.map(record => record.sourceUrl).filter((url): url is string => Boolean(url)))] } : null;
}
