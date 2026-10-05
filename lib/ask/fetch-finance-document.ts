import { readFinanceDoor } from "../funding/finance-door-reader.ts";
import { validFinanceDoorDetailSource } from "../funding/finance-detail-source.ts";
import type { DoorRecord } from "../doors/registry.ts";
import type { EvidenceRecord } from "./evidence.ts";
import type { FinanceDetailRead } from "./fetch-through-key.ts";

/** Re-read the document address and map held by this exact published filing.
 * An API key reference can authorize only this registered HTTPS host; redirects
 * never forward a key. Raw private columns stay inside the source reader. */
export async function fetchFinanceDocument(input: {
  readonly summary: EvidenceRecord; readonly deadlineMs: number;
  readonly fetchImpl?: typeof fetch; readonly env?: Readonly<Record<string, string | undefined>>;
}): Promise<FinanceDetailRead> {
  const { summary } = input, source = summary.stateDetailSource;
  const unavailable: FinanceDetailRead = { summary, records: [], complete: false, status: "UNAVAILABLE" };
  if (!validFinanceDoorDetailSource(source) || !summary.sourceUrl || Date.now() >= input.deadlineMs) return unavailable;
  try {
    const url = new URL(summary.sourceUrl);
    if (url.protocol !== "https:" || url.username || url.password || !source.hosts.includes(url.hostname)) return unavailable;
    const headers: Record<string, string> = {};
    if (source.config.keyRef) {
      const key = (input.env ?? process.env)[source.config.keyRef];
      if (!key || !(source.config.keyParam || source.config.keyHeader) || source.config.keyParam && source.config.keyHeader) return unavailable;
      if (source.config.keyParam) url.searchParams.set(source.config.keyParam, key);
      if (source.config.keyHeader) headers[source.config.keyHeader] = key;
    }
    const remaining = input.deadlineMs - Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const operation = async () => {
      const response = await (input.fetchImpl ?? fetch)(url.href, { method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(remaining) });
      if (!response.ok || response.status === 206) return unavailable;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (Date.now() >= input.deadlineMs) return unavailable;
      const now = new Date().toISOString();
      const door = { doorId: source.doorId, kind: source.kind, ocdId: source.ocdId, hosts: source.hosts, config: source.config } as unknown as DoorRecord;
      const read = readFinanceDoor(door, [{ url: summary.sourceUrl!, bytes, retrievedAt: now, complete: true }]);
      if (!read.paginationComplete) return unavailable;
      const filings = read.filings.filter(f => f.committeeId === source.committeeId && f.ocdId === source.ocdId && f.electionYear === source.electionYear &&
        f.candidateName === source.candidateName && f.office === source.office);
      const records: EvidenceRecord[] = [];
      for (const filing of filings) {
        if (!filing.period || !filing.funding) continue;
        for (const [index, organization] of filing.funding.organizations.entries()) records.push({
          kind: "FINANCE_SUMMARY", id: `finance-detail:${filing.id}:${index}`, subjectId: summary.subjectId,
          canonicalSubjectId: summary.canonicalSubjectId,
          text: `${organization.filedName}${organization.filedType ? ` (${organization.filedType})` : ""}: $${organization.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}; ${filing.period}.`,
          sourceUrl: filing.sourceUrl, sourceOrg: summary.sourceOrg, retrievedAt: now });
        if (filing.funding.individualTotal !== null) records.push({ kind: "FINANCE_SUMMARY", id: `finance-detail:${filing.id}:individuals`,
          subjectId: summary.subjectId, canonicalSubjectId: summary.canonicalSubjectId,
          text: `Aggregate individual giving: $${filing.funding.individualTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}; ${filing.period}.`,
          sourceUrl: filing.sourceUrl, sourceOrg: summary.sourceOrg, retrievedAt: now });
      }
      const complete = filings.length > 0 && filings.every(f => Boolean(f.period && f.funding)) &&
        (source.kind !== "campaign-finance-search-api" || Boolean(source.config.totalPath));
      return { summary, records, complete, status: complete ? "COMPLETE" : records.length ? "PARTIAL" : "UNAVAILABLE" } as FinanceDetailRead;
    };
    return await Promise.race([operation(), new Promise<FinanceDetailRead>(resolve => { timer = setTimeout(() => resolve(unavailable), remaining); })])
      .finally(() => { if (timer) clearTimeout(timer); });
  } catch { return unavailable; }
}
