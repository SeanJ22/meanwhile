import { US_STATES } from "../control-plane/readiness/catalog.ts";

const STATE_CAMPAIGN_RECORDS = /(?:State(?: and Municipal)?|Territorial|Local|District) Campaign (?:Finance|Disclosure)|Campaign Finance Reports for State/i;
export const STATE_CF_HEADER = ["jurisdiction", "agency", "agency_url", "email", "phone", "portal_url", "verified_on", "agency_http", "agency_alive", "agency_control_matched", "note"];

/** Actual text-layer office blocks can supply a cell boundary missed by the old directory extraction. */
export function campaignOfficeFromTextBlock(input: { jurisdiction: string; text: string; page: number }): Record<string, string> {
  const cells = input.text.split("*").map(cell => cell.replace(/\s+/g, " ").trim()).filter(Boolean);
  const text = cells.slice(1).join("; ");
  return { jurisdiction: input.jurisdiction, office: cells[0], records_held: text,
    url: /URL\s+(https?:\/\/[^\s;]+)/i.exec(text)?.[1] ?? "",
    email: /E-Mail(?:\s*\([^)]*\))?:\s*([^\s;]+@[^\s;]+)/i.exec(text)?.[1] ?? "",
    phone: /\b\d{3}\/\d{3}-\d{4}\b/.exec(text)?.[0] ?? "", directory_page: String(input.page) };
}

/** Choose a state/territory/district records office before any federal-only office. */
export function compileStateCampaignFinanceAgencies(input: {
  directory: readonly Record<string, string>[];
  previous: readonly Record<string, string>[];
  correctedBlocks: readonly { jurisdiction: string; text: string; page: number }[];
  sourceCheckedAt: string;
}): Record<string, string>[] {
  const supplements = input.correctedBlocks.map(campaignOfficeFromTextBlock);
  return US_STATES.map(state => {
    const jurisdiction = state.name.replace(/^U\.S\.\s+/i, "").toUpperCase();
    const candidates = [...supplements, ...input.directory].filter(row => row.jurisdiction === jurisdiction && STATE_CAMPAIGN_RECORDS.test(row.records_held));
    const source = candidates.find(row => row.url && row.phone);
    if (!source) throw new Error(`FEC_STATE_CAMPAIGN_OFFICE_MISSING:${jurisdiction}`);
    const prior = input.previous.find(row => row.jurisdiction === jurisdiction && row.agency === source.office && row.agency_url === source.url);
    return { jurisdiction, agency: source.office, agency_url: source.url, email: source.email, phone: source.phone,
      portal_url: prior?.portal_url ?? "", verified_on: input.sourceCheckedAt,
      agency_http: prior?.agency_http ?? "", agency_alive: prior?.agency_alive ?? "", agency_control_matched: prior?.agency_control_matched ?? "",
      note: `Campaign-finance reports office as listed by the FEC disclosure directory, PDF page ${source.directory_page}. ${source.records_held}` };
  });
}
