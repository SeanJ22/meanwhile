import { section3Page } from "../control-plane/promotion/section3.ts";
import { manualClassForKind } from "../control-plane/promotion/source-kinds.ts";
import { preferCurrentSource, receiptSourceKind } from "./source-conflicts.ts";
import { createHash } from "node:crypto";
import { ELECTION_FIELD_KINDS, electionFieldState, sourcedElectionDate, type ElectionFieldInput, type PublishedElectionField } from "./election-fields.ts";
import { prepareManualProjectionSuccessor } from "./manual-successor.ts";
import { processRegisteredManualCandidate } from "./promotion.ts";
import type { RoutineDataStore } from "./store.ts";
import type { ManualSourceReview } from "./types.ts";

export type ElectionFieldVerifier = (input: {
  readonly recordClass: string; readonly fields: Readonly<Record<string, unknown>>;
  readonly page: { readonly url: string; readonly text: string; readonly retrievedAt: string; readonly linkingPage?: ElectionFieldInput["linkingPage"] };
  readonly now: string; readonly minimums: readonly string[];
}) => { readonly live: boolean; readonly reason: string | null };

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const MONTH = "January|February|March|April|May|June|July|August|September|October|November|December";
const writtenDate = new RegExp(`\\b(?:${MONTH})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+20\\d{2})?\\b`, "gi");

/** Deadline revisions replace the same contextual field rather than accumulating old dates. */
function fieldId(field: ElectionFieldInput): string {
  const context = field.quote.replace(writtenDate, "<date>").replace(/\b\d{4}-\d{2}-\d{2}\b/g, "<date>").replace(/\s+/g, " ").trim().toLowerCase();
  return `election-field:${hash(JSON.stringify([field.divisionId, field.kind, field.sourceUrl, context])).slice(0, 32)}`;
}

function datesInQuote(quote: string): Set<string> {
  const dates = new Set(quote.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []);
  const year = /\b(20\d{2})\b/.exec(quote)?.[1];
  const months = MONTH.split("|");
  const pattern = new RegExp(`\\b(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`, "gi");
  for (const match of quote.matchAll(pattern)) {
    const y = match[3] ?? year;
    if (!y) continue;
    const month = months.findIndex(name => name.toLowerCase() === match[1].toLowerCase());
    const date = new Date(Date.UTC(Number(y), month, Number(match[2])));
    if (date.getUTCMonth() === month && date.getUTCDate() === Number(match[2])) dates.add(date.toISOString().slice(0, 10));
  }
  return dates;
}

/** Ready fields publish together through the existing pointer; unrelated gaps never hold them. */
export async function publishElectionFields(input: {
  readonly store: RoutineDataStore; readonly now: string; readonly fields: readonly ElectionFieldInput[];
  readonly verify: ElectionFieldVerifier;
}) {
  const records = new Map<string, PublishedElectionField>();
  const conflicts: NonNullable<import("./types.ts").RoutineCandidate["excludedFacts"]>[number][] = [];
  const sources = new Map<string, ManualSourceReview>();
  const gaps: { divisionId: string; kind: string; detail: string }[] = [];
  for (const field of input.fields) {
    const capture = field.document.capture;
    const state = electionFieldState(field.divisionId);
    const gap = (detail: string) => gaps.push({ divisionId: field.divisionId, kind: field.kind, detail });
    if (!state || !ELECTION_FIELD_KINDS.includes(field.kind) || field.sourceUrl !== field.document.url || !capture ||
        capture.evidence.canonicalUrl !== field.document.url || capture.partial || capture.transport !== "REACHABLE" ||
        capture.httpStatus === null || capture.httpStatus < 200 || capture.httpStatus >= 300 ||
        capture.evidence.contentHash !== `sha256-${hash(capture.evidence.text)}` || capture.evidence.text !== field.document.text) {
      gap("Saved complete source capture is missing or does not match these bytes."); continue;
    }
    const page = { url: field.sourceUrl, text: capture.evidence.text, retrievedAt: capture.observedAt, linkingPage: field.linkingPage, sourcePolicy: capture.sourcePolicy, campaign: capture.campaign };
    // An election office's phone line is a fact too: it must be on the saved page.
    const office = field.kind === "election_office";
    if (office && !field.phone?.trim()) { gap("Election office has no phone line on the saved page."); continue; }
    const values: Record<string, unknown> = { value: field.value, ...(office ? { phone: field.phone } : {}) };
    field.quote.split(/\r?\n/).filter(Boolean).forEach((line, index) => { values[`quote${index}`] = line; });
    const verdict = input.verify({ recordClass: office ? "SERVICE_CONTACT" : field.kind.endsWith("_lookup") ? "VOTER_ACCESS_ROUTE" : "BALLOT_CONTEST",
      fields: values, minimums: Object.keys(values), page, now: input.now });
    if (!verdict.live) { gap(verdict.reason ?? "Value or quote is unverified."); continue; }
    const dates = datesInQuote(field.quote);
    if (field.dates.some(date => !sourcedElectionDate(date) || !dates.has(date)) || ["registration_deadline", "early_voting"].includes(field.kind) && field.dates.length === 0) {
      gap("Date is not supported by the quoted calendar context."); continue;
    }
    const id = fieldId(field);
    const previous = records.get(id);
    const sourceKind = section3Page(page, "BALLOT_CONTEST", input.now).kind;
    if (previous && (previous.value.text !== field.value || JSON.stringify(previous.value.dates) !== JSON.stringify(field.dates))) {
      const priorSource = sources.get(previous.value.url);
      const currentWins = preferCurrentSource({ sourceUrl: field.sourceUrl, sourceOrg: capture.evidence.sourceId, collectedAt: capture.observedAt,
        verifiedAt: input.now, kind: sourceKind }, { sourceUrl: previous.value.url, sourceOrg: previous.value.sourceOrg, collectedAt: previous.value.collectedAt,
        verifiedAt: previous.value.verifiedAt, ...(priorSource ? { kind: receiptSourceKind(priorSource.sourceClass) } : {}) });
      conflicts.push({ key: id, code: "CONFLICT_SUPERSEDED", detail: "Kept the higher source kind, then the newer election field read.",
        record: currentWins ? previous.value : { value: field.value, dates: field.dates, sourceUrl: field.sourceUrl, collectedAt: capture.observedAt } });
      if (!currentWins) continue;
    }
    records.set(id, { id, kind: "ELECTION_FIELD", value: {
      state, divisionId: field.divisionId, fieldKind: field.kind, text: field.value, quote: field.quote, dates: field.dates,
      url: field.sourceUrl, navigationUrl: field.kind.endsWith("_lookup") ? field.value : null,
      ...(office ? { phone: field.phone } : {}),
      verifiedAt: input.now, collectedAt: capture.observedAt, sourceOrg: capture.evidence.sourceId,
    } });
    sources.set(field.sourceUrl, { requestedUrl: field.sourceUrl, finalUrl: field.sourceUrl, publisher: capture.evidence.sourceId,
      sourceClass: manualClassForKind(sourceKind), retrievedAt: capture.observedAt, httpStatus: capture.httpStatus,
      rawHash: (capture.evidence.sourceDocument?.contentHash ?? capture.evidence.contentHash).slice(7), reviewOutcome: "SUPPORTED",
      reviewedEvidence: "Saved official source; section3Record confirmed this field's value and quote within its freshness window." });
  }
  if (!records.size) return { candidateId: null, promotedVersionId: null, fields: [] as string[], gaps };
  const { candidate, expectedBaseVersionId } = await prepareManualProjectionSuccessor({ contractId: "ballot-navigation",
    version: input.now, sourceThrough: input.now,
    sourceReceipt: { contractVersion: 1, reviewedAt: input.now, reviewedBy: "code:section3Record", sources: [...sources.values()] },
    payload: { kind: "ballot-navigation", records: [...records.values()] as unknown as readonly (Record<string, unknown> & { id: string })[] },
  }, input.store, input.now);
  const outcome = await processRegisteredManualCandidate(input.store, "ballot-navigation", { ...candidate, excludedFacts: [...(candidate.excludedFacts ?? []), ...conflicts] }, input.now, expectedBaseVersionId);
  if (!outcome.promoted) throw new Error(`ELECTION_FIELD_PUBLICATION_HELD:${outcome.candidate.failureDetail ?? outcome.candidate.state}`);
  return { candidateId: outcome.candidate.candidate.id, promotedVersionId: outcome.promoted.versionId, fields: [...records.keys()], gaps };
}
