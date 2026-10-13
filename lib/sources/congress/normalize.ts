import { createHash } from "node:crypto";
import { FEDERAL_SOURCES } from "./targets.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { US_STATES } from "../../control-plane/readiness/catalog.ts";
import type { FederalCapture, FederalFact, LdaRoster } from "./types.ts";
import { joinLdaHonoree } from "./lda-honoree.ts";

type Row = Record<string, unknown>;
export const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
export const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : [];
export const string = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value) : "";
const date = (value: unknown): string | null => string(value) && Number.isFinite(Date.parse(string(value))) ? string(value) : null;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function billIdentity(row: Row): string {
  const congress = string(row.congress), type = string(row.type ?? row.billType).toLowerCase(), number = string(row.number ?? row.billNumber);
  return /^\d+$/.test(congress) && /^(hr|s|hjres|sjres|hconres|sconres|hres|sres)$/.test(type) && /^\d+$/.test(number) ? `${congress}:${type}:${number}` : "";
}
export function billPage(id: string): string {
  const [congress, type, number] = id.split(":");
  const types: Record<string, string> = { hr: "house-bill", s: "senate-bill", hjres: "house-joint-resolution", sjres: "senate-joint-resolution", hconres: "house-concurrent-resolution", sconres: "senate-concurrent-resolution", hres: "house-resolution", sres: "senate-resolution" };
  return `https://www.congress.gov/bill/${congress}th-congress/${types[type]}/${number}`;
}
export function packageBillId(id: string): string {
  const m = /^BILLS-(\d+)(hr|s|hjres|sjres|hconres|sconres|hres|sres)(\d+)[a-z]+$/i.exec(id);
  return m ? `${m[1]}:${m[2].toLowerCase()}:${m[3]}` : "";
}

/** Every input row survives, including malformed and unmatched source-native rows. */
export function normalizeFederalCapture(capture: FederalCapture): FederalFact[] {
  return normalizeFederalCaptureWithRoster(capture);
}
export function normalizeFederalCaptureWithRoster(capture: FederalCapture, honoreeRoster?: LdaRoster): FederalFact[] {
  const base = (nativeId: string, kind: FederalFact["kind"], title: string, publishedAt: unknown, sourceUrl = capture.url): FederalFact => ({
    id: `${capture.source}:${kind}:${nativeId}`, nativeId, kind, title, source: capture.source,
    sourceUrl, publisher: FEDERAL_SOURCES[capture.source].publisher, official: true, publishedAt: date(publishedAt), checkedAt: capture.retrievedAt,
  });
  const unknown = (row: unknown, reason: string): FederalFact => ({ ...base(digest(row), "UNPARSED", "Unparsed source record", null), reason });
  if (capture.kind === "bill-text") {
    const id = capture.context?.packageId ?? capture.context?.billId;
    if (!id || !capture.body.trim()) return [unknown(capture.body, "Bill text lacks its native edition identity or bytes.")];
    const publicUrl = capture.source === "govinfo" && capture.context?.packageId ? `https://www.govinfo.gov/app/details/${capture.context.packageId}` : capture.url;
    return [{ ...base(id, "BILL_TEXT", id, capture.context?.publishedAt, publicUrl), billId: capture.context?.billId ?? packageBillId(id),
      text: capture.body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&") }];
  }
  const root = object(JSON.parse(capture.body));
  if (capture.kind === "members") return rows(root.members).map(row => {
    const id = string(row.bioguideId);
    const state = Object.values(FIPS_TO_STATE).find(value => value.postal === string(row.stateCode ?? row.state))?.postal ?? US_STATES.find(value => value.name === string(row.state))?.code.toUpperCase();
    return /^[A-Z]\d{6}$/.test(id) ? { ...base(id, "MEMBER", string(row.name), row.updateDate, `https://www.congress.gov/member/${id}`), bioguideId: id, ...(state ? { state } : {}) } : unknown(row, "Member has no Bioguide identifier.");
  });
  if (capture.kind === "bill" || capture.kind === "sponsored") {
    const bills = capture.kind === "bill" ? [object(root.bill)] : rows(root.sponsoredLegislation);
    return bills.flatMap(row => {
      const billId = billIdentity(row);
      if (!billId) return [unknown(row, "Bill has no native Congress/type/number identity.")];
      const sponsors = rows(row.sponsors);
      const sponsor = sponsors[0] ?? {};
      const bioguideId = string(sponsor.bioguideId) || capture.context?.bioguideId;
      return [{ ...base(billId, "BILL", string(row.title ?? row.latestTitle), row.introducedDate, billPage(billId)), billId,
        ...(bioguideId ? { bioguideId } : {}), ...(string(sponsor.state) ? { state: string(sponsor.state) } : {}),
        action: string(object(row.latestAction).text), actionDate: date(object(row.latestAction).actionDate), updatedAt: date(row.updateDateIncludingText ?? row.updateDate) }];
    });
  }
  if (capture.kind === "committees") return rows(root.committees).map(row => {
    const id = string(row.systemCode), billId = capture.context?.billId;
    return id && billId ? { ...base(`${billId}:${id}`, "COMMITTEE_REFERRAL", string(row.name), rows(row.activities).map(a => string(a.date)).sort().at(-1), billPage(billId)), billId, committeeId: id } : unknown(row, "Committee referral has no native committee or bill ID.");
  });
  if (capture.kind === "text-versions") return rows(root.textVersions).flatMap(row => rows(row.formats).map(format => ({
    ...base(`${capture.context?.billId}:${row.date}:${format.type}`, "BILL_TEXT_LINK", string(row.type), row.date, string(format.url)), billId: capture.context?.billId,
  })));
  if (capture.kind === "govinfo-summary") {
    const packageId = string(root.packageId), billId = packageBillId(packageId);
    if (!packageId) return [unknown(root, "govinfo package has no native packageId.")];
    return [{ ...base(packageId, "BILL_TEXT_LINK", string(root.title), root.dateIssued, string(root.detailsLink) || `https://www.govinfo.gov/app/details/${packageId}`), billId }];
  }
  if (capture.kind === "rules") {
    const federalRegister = capture.source === "federal-register";
    return rows(federalRegister ? root.results : root.data).map(row => {
      const a = federalRegister ? row : object(row.attributes), id = string(federalRegister ? a.document_number : row.id);
      if (!id) return unknown(row, "Rule has no native document ID.");
      const regulationId = string(object(a.regulations_dot_gov_info).document_id);
      return { ...base(id, "RULE", string(a.title), federalRegister ? a.publication_date : a.postedDate,
        federalRegister ? string(a.html_url) : `https://www.regulations.gov/document/${id}`),
        text: string(a.abstract ?? a.docAbstract), documentNumber: string(federalRegister ? a.document_number : a.frDocNum),
        docketId: federalRegister ? string((a.docket_ids as unknown[] | undefined)?.[0]) : string(a.docketId),
        opensAt: date(federalRegister ? a.comments_open_on : a.commentStartDate), closesAt: date(federalRegister ? a.comments_close_on : a.commentEndDate),
        commentUrl: federalRegister ? string(a.comment_url) || (regulationId ? `https://www.regulations.gov/commenton/${regulationId}` : string(a.html_url) || null) : `https://www.regulations.gov/commenton/${id}`,
        withdrawn: a.withdrawn === true, ...(!federalRegister && typeof a.openForComment === "boolean" ? { acceptsComments: a.openForComment === true && a.withinCommentPeriod !== false } : {}) };
    });
  }
  if (capture.kind === "contributions") return rows(root.results).flatMap(filing => {
    const filingId = string(filing.filing_uuid), url = string(filing.filing_document_url) || `https://lda.gov/filings/public/contribution/${filingId}/print/`;
    const items = rows(filing.contribution_items);
    if (!filingId) return [unknown(filing, "LD-203 filing has no filing_uuid.")];
    // Filings attesting no contributions are retained, without inventing a member's zero.
    if (!items.length) return [{ ...base(filingId, "LOBBYING_CONTRIBUTION", "LD-203 contribution report", filing.dt_posted, url), filingId,
      honoreeJoin: { status: "UNJOINED", reason: "NO_CONTRIBUTIONS", detail: "The report contains no contribution items; it does not establish a member's zero." } }];
    return items.map((item, index) => {
      const id = string(item.id) || String(index);
      const honoreeName = string(item.honoree_name);
      const joined = joinLdaHonoree(honoreeName,
        capture.context?.honoreeRosterVersionId === honoreeRoster?.versionId ? honoreeRoster : undefined, capture.context?.honoreeRosterFailure);
      return { ...base(`${filingId}:${id}`, "LOBBYING_CONTRIBUTION", string(item.contribution_type), filing.dt_posted, url), filingId,
        amount: string(item.amount), contributionDate: string(item.date), recipientId: string(item.recipient_id ?? item.fec_committee_id),
        recipientName: string(item.payee_name), honoreeName, honoreeJoin: joined.join,
        ...(joined.bioguideId ? { bioguideId: joined.bioguideId } : {}), ...(joined.state ? { state: joined.state } : {}),
        organization: item.contributor_type === "organization" ? string(item.contributor_name) || null : null };
    });
  });
  return [unknown(root, "Unsupported source response shape.")];
}
