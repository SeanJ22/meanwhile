import { section3Page, type Section3Page } from "../control-plane/promotion/section3.ts";
import { manualClassForKind } from "../control-plane/promotion/source-kinds.ts";
import { preferCurrentSource, receiptSourceKind } from "./source-conflicts.ts";
import { createHash } from "node:crypto";
import { ELECTION_FIELD_KINDS, electionFieldState, sourcedElectionDate, type ElectionFieldInput, type PublishedElectionField } from "./election-fields.ts";
import { prepareNavigationSuccessor } from "./navigation-successor.ts";
import { processNavigationCandidate } from "./promotion.ts";
import type { RoutineDataStore } from "./store.ts";
import type { ManualSourceReview } from "./types.ts";

export type ElectionFieldVerifier = (input: {
  readonly recordClass: string; readonly fields: Readonly<Record<string, unknown>>;
  readonly page: { readonly url: string; readonly text: string; readonly retrievedAt: string; readonly linkingPage?: ElectionFieldInput["linkingPage"] };
  readonly now: string; readonly minimums: readonly string[];
}) => { readonly live: boolean; readonly reason: string | null };

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH = MONTHS.map(name => `${name.slice(0, 3)}(?:${name.slice(3)})?\\.?`).join("|");
const writtenDate = new RegExp(`\\b(?:(?:${MONTH})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s*(?:[-–—&,]|to|through|until)\\s*\\d{1,2}(?:st|nd|rd|th)?)?(?:,?\\s+20\\d{2})?|\\d{1,2}(?:st|nd|rd|th)?[\\s-]+(?:${MONTH})(?:,?\\s+20\\d{2})?|\\d{1,2}/\\d{1,2}(?:/(?:20\\d{2}|\\d{2}))?)\\b`, "gi");

/** Deadline revisions replace the same contextual field rather than accumulating old dates. */
export function electionFieldId(field: ElectionFieldInput): string {
  const context = field.quote.replace(writtenDate, "<date>").replace(/\b\d{4}-\d{2}-\d{2}\b/g, "<date>").replace(/\s+/g, " ").trim().toLowerCase();
  return `election-field:${hash(JSON.stringify([field.divisionId, field.kind, field.sourceUrl, context, ...(field.electionDate ? [field.electionDate] : [])])).slice(0, 32)}`;
}

export function datesInQuote(quote: string, electionDate?: string): Set<string> {
  const dates = new Set(quote.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []);
  const year = /\b(20\d{2})\b/.exec(quote)?.[1] ?? electionDate?.slice(0, 4);
  const pattern = new RegExp(`\\b(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`, "gi");
  for (const match of quote.matchAll(pattern)) {
    const y = match[3] ?? year;
    if (!y) continue;
    const month = MONTHS.findIndex(name => name.slice(0, 3).toLowerCase() === match[1].slice(0, 3).toLowerCase());
    const date = new Date(Date.UTC(Number(y), month, Number(match[2])));
    if (date.getUTCMonth() === month && date.getUTCDate() === Number(match[2])) dates.add(date.toISOString().slice(0, 10));
  }
  for (const match of quote.matchAll(new RegExp(`\\b(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:[-–—&,]|to|through|until)\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`, "gi"))) {
    const y = match[4] ?? year;
    if (!y) continue;
    const month = MONTHS.findIndex(name => name.slice(0, 3).toLowerCase() === match[1].slice(0, 3).toLowerCase());
    for (const day of [match[2], match[3]]) {
      const date = `${y}-${String(month + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
      if (sourcedElectionDate(date)) dates.add(date);
    }
  }
  for (const match of quote.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s-]+(${MONTH})(?:,?\\s+(20\\d{2}))?\\b`, "gi"))) {
    const y = match[3] ?? year;
    if (!y) continue;
    const month = MONTHS.findIndex(name => name.slice(0, 3).toLowerCase() === match[2].slice(0, 3).toLowerCase());
    const date = `${y}-${String(month + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
    if (sourcedElectionDate(date)) dates.add(date);
  }
  for (const match of quote.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}|\d{2}))?\b/g)) {
    const y = match[3] ? match[3].length === 2 ? `20${match[3]}` : match[3] : year;
    if (!y) continue;
    const date = `${y}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
    if (sourcedElectionDate(date)) dates.add(date);
  }
  const absoluteContext = quote.replace(/\b(?:before|preceding|prior to) (?:the |an |each |any )?election day\b/gi, "");
  if (electionDate && /\belection day\b/i.test(absoluteContext)) dates.add(electionDate);
  if (electionDate) {
    const election = new Date(`${electionDate}T00:00:00Z`);
    const numbers: Readonly<Record<string, number>> = { one: 1, first: 1, two: 2, second: 2, three: 3, third: 3,
      four: 4, fourth: 4, five: 5, fifth: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
      eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, fifteenth: 15, sixteen: 16,
      seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30 };
    const count = (value: string) => numbers[value.toLowerCase()] ?? Number(value.replace(/(?:st|nd|rd|th)$/i, ""));
    const before = (days: number) => new Date(election.getTime() - days * 86_400_000).toISOString().slice(0, 10);
    for (const match of quote.matchAll(/\b(\d+(?:st|nd|rd|th)?|[a-z]+) days? (?:immediately )?(?:before|preceding|prior to) (?:the (?:date of the )?|each |an |any )?(?:primary election or the general election|general election|election)\b/gi)) {
      const days = count(match[1]);
      if (Number.isInteger(days) && days > 0 && days <= 90) dates.add(before(days));
    }
    if (/\b(?:day|night) before (?:the |an |each )?election\b/i.test(quote)) dates.add(before(1));
    const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    for (const match of quote.matchAll(/\b(?:(\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth) )?(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday) (?:immediately )?(?:before|preceding|prior to) (?:the |an |each |any )?election\b/gi)) {
      const occurrence = match[1] ? count(match[1]) : 1;
      const offset = (election.getUTCDay() - weekdays.indexOf(match[2].toLowerCase()) + 7) % 7 || 7;
      if (Number.isInteger(occurrence) && occurrence > 0 && occurrence <= 5) dates.add(before(offset + (occurrence - 1) * 7));
    }
  }
  return dates;
}

export async function publishElectionFields(input: {
  readonly store: RoutineDataStore; readonly now: string;
  readonly fields: Iterable<ElectionFieldInput> | AsyncIterable<ElectionFieldInput>;
  readonly verify: ElectionFieldVerifier;
}): Promise<{ candidateId: string | null; promotedVersionId: string | null; fields: string[]; gaps: { divisionId: string; kind: string; detail: string }[] }> {
  const records = new Map<string, PublishedElectionField>();
  let heldCapture: ElectionFieldInput["document"]["capture"], heldPage: Section3Page | undefined;
  const conflicts: NonNullable<import("./types.ts").RoutineCandidate["excludedFacts"]>[number][] = [];
  const sources = new Map<string, ManualSourceReview>();
  const gaps: { divisionId: string; kind: string; detail: string }[] = [];
  const fields: string[] = [];
  let candidateId: string | null = null, promotedVersionId: string | null = null, currentState: string | null = null;
  const publish = async () => {
    if (!records.size) return;
    const { candidate, comparison } = await prepareNavigationSuccessor({ contractId: "ballot-navigation",
      version: input.now, sourceThrough: input.now,
      sourceReceipt: { contractVersion: 1, reviewedAt: input.now, reviewedBy: "code:section3Record", sources: [...sources.values()] },
      payload: { kind: "ballot-navigation", records: [...records.values()] as unknown as readonly (Record<string, unknown> & { id: string })[] },
    }, input.store);
    const outcome = await processNavigationCandidate(input.store, { ...candidate,
      excludedFacts: [...(candidate.excludedFacts ?? []), ...conflicts] }, comparison, input.now);
    candidateId = outcome.candidateId; promotedVersionId = outcome.promotedVersionId;
    fields.push(...records.keys());
    records.clear(); sources.clear(); conflicts.length = 0;
  };
  for await (const inputField of input.fields) {
    const field: ElectionFieldInput = inputField;
    const capture = field.document.capture;
    const state = electionFieldState(field.divisionId);
    const gap = (detail: string) => gaps.push({ divisionId: field.divisionId, kind: field.kind, detail });
    if (!state || !ELECTION_FIELD_KINDS.includes(field.kind) || field.sourceUrl !== field.document.url || !capture ||
        capture.evidence.canonicalUrl !== field.document.url || capture.partial || capture.transport !== "REACHABLE" ||
        capture.httpStatus === null || capture.httpStatus < 200 || capture.httpStatus >= 300 ||
        capture.evidence.contentHash !== `sha256-${hash(capture.evidence.text)}` || capture.evidence.text !== field.document.text) {
      gap("Saved complete source capture is missing or does not match these bytes."); continue;
    }
    if (currentState !== state) { await publish(); currentState = state; }
    const page = Object.assign(heldCapture === capture ? heldPage ?? {} : {}, { url: field.sourceUrl, text: capture.evidence.text,
      retrievedAt: capture.observedAt, linkingPage: field.linkingPage, websiteDelegation: field.websiteDelegation,
      sourcePolicy: capture.sourcePolicy, campaign: capture.campaign });
    heldCapture = capture; heldPage = page;
    // An election office's phone line is a fact too: it must be on the saved page.
    const office = field.kind === "election_office";
    if (office && !field.phone?.trim()) { gap("Election office has no phone line on the saved page."); continue; }
    const values: Record<string, unknown> = { value: field.value, ...(office ? { phone: field.phone } : {}) };
    field.quote.split(/\r?\n/).filter(Boolean).forEach((line, index) => { values[`quote${index}`] = line; });
    const verdict = input.verify({ recordClass: office ? "SERVICE_CONTACT" : field.kind.endsWith("_lookup") || field.kind === "registration_page" ? "VOTER_ACCESS_ROUTE" : "BALLOT_CONTEST",
      fields: values, minimums: Object.keys(values), page, now: input.now });
    if (!verdict.live) { gap(verdict.reason ?? "Value or quote is unverified."); continue; }
    const dates = datesInQuote(field.quote, field.electionDate);
    if (field.electionDate && !sourcedElectionDate(field.electionDate) || field.dates.some(date => !sourcedElectionDate(date) || !dates.has(date))) {
      gap("Date is not supported by the quoted calendar context."); continue;
    }
    const publishedDates = field.dates.length || !["registration_deadline", "mail_ballot_request_deadline", "early_voting"].includes(field.kind)
      ? field.dates : [...dates].sort();
    const id = electionFieldId(field);
    const previous = records.get(id);
    const sourceKind = section3Page(page, "BALLOT_CONTEST", input.now).kind;
    if (previous && (previous.value.text !== field.value || JSON.stringify(previous.value.dates) !== JSON.stringify(publishedDates))) {
      const priorSource = sources.get(previous.value.url);
      const currentWins = preferCurrentSource({ sourceUrl: field.sourceUrl, sourceOrg: capture.evidence.sourceId, collectedAt: capture.observedAt,
        verifiedAt: input.now, kind: sourceKind }, { sourceUrl: previous.value.url, sourceOrg: previous.value.sourceOrg, collectedAt: previous.value.collectedAt,
        verifiedAt: previous.value.verifiedAt, ...(priorSource ? { kind: receiptSourceKind(priorSource.sourceClass) } : {}) });
      conflicts.push({ key: id, code: "CONFLICT_SUPERSEDED", detail: "Kept the higher source kind, then the newer election field read.",
        record: currentWins ? previous.value : { value: field.value, dates: publishedDates, sourceUrl: field.sourceUrl, collectedAt: capture.observedAt } });
      if (!currentWins) continue;
    }
    records.set(id, { id, kind: "ELECTION_FIELD", value: {
      state, divisionId: field.divisionId, fieldKind: field.kind, text: field.value, quote: field.quote, dates: publishedDates,
      url: field.sourceUrl, navigationUrl: field.kind.endsWith("_lookup") || field.kind === "registration_page" ? field.value : office ? field.navigationUrl ?? null : null,
      ...(field.electionDate ? { electionDate: field.electionDate } : {}),
      ...(office ? { phone: field.phone } : {}),
      verifiedAt: input.now, collectedAt: capture.observedAt, sourceOrg: capture.evidence.sourceId,
    } });
    sources.set(field.sourceUrl, { requestedUrl: field.sourceUrl, finalUrl: field.sourceUrl, publisher: capture.evidence.sourceId,
      sourceClass: manualClassForKind(sourceKind), retrievedAt: capture.observedAt, httpStatus: capture.httpStatus,
      rawHash: (capture.rawContentHash ?? capture.evidence.sourceDocument?.contentHash ?? capture.evidence.contentHash).slice(7), reviewOutcome: "SUPPORTED",
      reviewedEvidence: "Saved official source; section3Record confirmed this field's value and quote within its freshness window." });
  }
  await publish();
  return { candidateId, promotedVersionId, fields, gaps };
}
