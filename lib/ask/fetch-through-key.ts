/** @freshness-reads-here: retrieval dates are minted only after this path's
 * registered API read returns a successful, nonempty body. Parsed filing rows
 * carry that actual page-read instant; timeouts retain the stored summary's
 * original date and never restamp it. `input.now` is the question's calendar,
 * not evidence of when these live bytes were read. */
import { fetchFinanceDocument } from "./fetch-finance-document.ts";
import { readSourceApi, type SourceApiOptions } from "../control-plane/scheduler/scout-api.ts";
import { ripcordPulled } from "../ripcords.ts";
import type { EvidenceRecord, EvidenceSubject } from "./evidence.ts";

export interface FinanceDetailSource { readonly committeeId: string; readonly cycle: number }
export interface FinanceDetailRead {
  readonly records: readonly EvidenceRecord[];
  readonly complete: boolean;
  readonly status: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
  readonly summary: EvidenceRecord;
}
/** Explicit requests for the underlying filings, rather than ordinary totals. */
export function asksForFinanceDetail(question: string): boolean {
  return /\b(?:every|all|list|itemized|itemised|older|previous)\b/i.test(question) &&
    /\b(?:pac(?:s)?|donor(?:s)?|contribut(?:or(?:s)?|ions?)|filing(?:s)?|receipts?|campaign money|finance|document(?:s)?)\b/i.test(question);
}
const object = (v: unknown): Record<string, unknown> | null => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const text = (v: unknown): string | null => typeof v === "string" && v.trim() ? v.trim() : null;
const pacTypes = new Set(["N", "Q", "O", "U", "V", "W"]);
const publicEntities = new Set(["CCM", "COM", "ORG", "PAC", "PTY"]);
const sourceLink = (value: unknown, fallback: string): string => {
  try {
    const u = new URL(String(value));
    if (u.protocol === "https:" && !u.username && !u.password && ["www.fec.gov", "docquery.fec.gov", "api.open.fec.gov"].includes(u.hostname)) return u.href;
  } catch { /* An absent filing address stays at its actual API source. */ }
  return fallback;
};

/** Reads only the held FEC committee identity, through the already registered
 * credentialed read transport. No model, unrelated subject, guessed committee,
 * contributor total, or private individual row enters the answer. */
export async function fetchThroughKey(input: {
  readonly question: string;
  readonly subject: EvidenceSubject;
  readonly records: readonly EvidenceRecord[];
  readonly deadlineMs: number;
  readonly now?: Date;
  readonly apiOptions?: SourceApiOptions;
  readonly readApi?: typeof readSourceApi;
}): Promise<FinanceDetailRead | null> {
  if (input.subject.kind !== "PERSON" || !asksForFinanceDetail(input.question)) return null;
  const state = input.records.filter(r => r.kind === "FINANCE_SUMMARY" && r.subjectId === input.subject.id && r.stateDetailSource && r.sourceUrl);
  if (state.length) {
    const unique = state.filter((r, i) => state.findIndex(other => other.sourceUrl === r.sourceUrl && JSON.stringify(other.stateDetailSource) === JSON.stringify(r.stateDetailSource)) === i);
    const reads = await Promise.all(unique.map(summary => fetchFinanceDocument({ question: input.question, summary, deadlineMs: input.deadlineMs, fetchImpl: input.apiOptions?.fetchImpl, env: input.apiOptions?.env })));
    const records = reads.flatMap(r => r.records), complete = reads.every(r => r.complete);
    return { summary: state[0]!, records, complete, status: complete ? "COMPLETE" : records.length ? "PARTIAL" : "UNAVAILABLE" };
  }
  if (ripcordPulled("ripcord.fecContributorDisplay")) return null;
  const summaries = input.records.filter(r => r.kind === "FINANCE_SUMMARY" && r.subjectId === input.subject.id && r.fecDetailSource && r.sourceUrl);
  if (summaries.length !== 1) return null;
  const summary = summaries[0]!, source = summary.fecDetailSource!;
  if (!/^C\d{8}$/.test(source.committeeId) || !Number.isSafeInteger(source.cycle) || source.cycle < 1900 || source.cycle % 2 !== 0) return null;
  const records: EvidenceRecord[] = [], seen = new Set<string>(), cursors = new Set<string>();
  const now = input.now ?? new Date(), yearMatch = /\b((?:19|20)\d{2})\b/.exec(input.question);
  const year = yearMatch ? Number(yearMatch[1]) : /\bthis year\b/i.test(input.question) ? now.getUTCFullYear() : null;
  // A filing identity held for one election cycle does not establish an older
  // candidate/committee relationship. Older source documents remain linked.
  if (year !== null && ![source.cycle - 1, source.cycle].includes(year)) return { records, complete: false, status: "UNAVAILABLE", summary };
  const onlyPacs = /\bpacs?\b/i.test(input.question);
  const params: Record<string, string> = { committee_id: source.committeeId,
    two_year_transaction_period: String(source.cycle), is_individual: "false", per_page: "100", sort: "-contribution_receipt_amount" };
  if (year !== null) { params.min_date = `${year}-01-01`; params.max_date = `${year}-12-31`; }
  let expected: number | null = null, visited = 0, complete = false, owedRows = false;
  try {
    while (Date.now() < input.deadlineMs) {
      const remaining = input.deadlineMs - Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        (input.readApi ?? readSourceApi)("fec_api", { path: "schedules/schedule_a/", params },
          { ...input.apiOptions, timeoutMs: remaining }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Detail deadline")), remaining); }),
      ]).finally(() => { if (timer) clearTimeout(timer); });
      if (Date.now() >= input.deadlineMs || result.status !== 200 || result.bytes <= 0 || !result.text) break;
      const receivedAt = new Date().toISOString();
      const body = object(JSON.parse(result.text, (key: string, value: unknown, context?: { source?: string }) =>
        (key === "sub_id" || key === "last_index") && typeof value === "number" && context?.source && /^\d+$/.test(context.source) ? context.source : value)), pagination = object(body?.pagination);
      if (!Array.isArray(body?.results)) break;
      const count = pagination?.count;
      const countValid = typeof count === "number" && Number.isSafeInteger(count) && count >= 0;
      if (expected !== null && countValid && expected !== count) break;
      if (countValid) expected = count as number;
      for (const value of body.results) {
        const row = object(value), id = text(row?.sub_id), committee = text(row?.committee_id);
        if (!row || !id || committee !== source.committeeId || seen.has(id)) throw new Error("FEC detail identity or pagination is ambiguous");
        seen.add(id); visited++;
        const entity = text(row.entity_type), contributor = object(row.contributor), type = text(contributor?.committee_type), line = text(row.line_number);
        if (entity === "IND" || entity === "CAN") continue;
        if (!entity || !publicEntities.has(entity) || !line) { owedRows = true; continue; }
        if (!(line.startsWith("11") || line === "12")) continue;
        if (onlyPacs && entity !== "PAC" && (!type || !pacTypes.has(type))) { if (!type) owedRows = true; continue; }
        const name = text(row.contributor_name), amount = row.contribution_receipt_amount;
        if (!name || typeof amount !== "number" || !Number.isFinite(amount)) { owedRows = true; continue; }
        const receiptDate = text(row.contribution_receipt_date)?.slice(0, 10) ?? null;
        if (year !== null && (!receiptDate || !receiptDate.startsWith(`${year}-`))) continue;
        const sourceUrl = sourceLink(row.pdf_url, result.sourceUrl);
        records.push({ kind: "FINANCE_SUMMARY", id: `fec-detail:${source.committeeId}:${id}`, subjectId: input.subject.id,
          canonicalSubjectId: summary.canonicalSubjectId,
          text: `${name}: $${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${receiptDate ? `, received ${receiptDate}` : ""}; filed entity ${entity}${type ? `, committee type ${type}` : ""}.`,
          sourceUrl, sourceOrg: "Federal Election Commission", retrievedAt: receivedAt });
      }
      if (expected !== null && visited > expected) throw new Error("FEC detail exceeds its published count");
      if (!countValid) break;
      if (visited === expected) { complete = !owedRows; break; }
      const next = object(pagination?.last_indexes);
      const index = typeof next?.last_index === "string" || typeof next?.last_index === "number" && Number.isSafeInteger(next.last_index) ? String(next.last_index) : null;
      const amount = typeof next?.last_contribution_receipt_amount === "string" || typeof next?.last_contribution_receipt_amount === "number" ? String(next.last_contribution_receipt_amount) : null;
      const cursor = `${index}:${amount}`;
      if (!body.results.length || !index || amount === null || cursors.has(cursor)) break;
      cursors.add(cursor); params.last_index = index; params.last_contribution_receipt_amount = amount;
    }
  } catch { /* Never log transport errors or a credential-bearing API URL. */ }
  return { records, complete, status: complete ? "COMPLETE" : records.length ? "PARTIAL" : "UNAVAILABLE", summary };
}

/** Rows are delivered as normal sourced evidence; a full filing list does not
 * become an overlong prose answer or a fabricated sum of transactions. */
export function composeFinanceDetail(read: FinanceDetailRead): { answer: string; citedUrls: string[] } {
  const answer = read.complete
    ? `The requested filed organization receipts are listed below, with their sources. These are individual filing rows, not totals added across reports.`
    : `The full filing detail could not be read before the answer deadline. ${read.summary.text} The stored filing and any rows read are linked below.`;
  return { answer, citedUrls: [...new Set([read.summary.sourceUrl!, ...read.records.map(r => r.sourceUrl!)])] };
}
