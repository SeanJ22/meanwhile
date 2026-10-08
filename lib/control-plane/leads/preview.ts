/** What an upload of research leads would send, or why it cannot be sent as it is. Changes nothing. */

import { LEADS_MAX_ROWS } from "./order.ts";
import { parseLeads, type ParsedLead, type ParsedLeads } from "./parse.ts";

/** Comfortably under the size one request to the console may carry. */
export const LEADS_SEND_MAX_BYTES = 4_500_000;

export type LeadsPreview =
  | ({ readonly ok: true } & ParsedLeads)
  | { readonly ok: false; readonly says: string; readonly skipped?: ParsedLeads["skipped"] };

export function previewLeads(text: string): LeadsPreview {
  const parsed = parseLeads(text);
  if (parsed.leads.length === 0) return { ok: false, says: "No links were found in what you pasted or uploaded.", skipped: parsed.skipped };
  if (parsed.leads.length > LEADS_MAX_ROWS) {
    return { ok: false, says: `That is ${parsed.leads.length.toLocaleString("en-US")} links; one upload takes at most ${LEADS_MAX_ROWS.toLocaleString("en-US")}. Split it.` };
  }
  const bytes = Buffer.byteLength(JSON.stringify(parsed.leads.map((l: ParsedLead) => ({ link: l.link, notes: l.notes }))));
  if (bytes > LEADS_SEND_MAX_BYTES) return { ok: false, says: "Those notes are too long to send in one upload. Split the list, or keep fewer columns." };
  return { ok: true, ...parsed };
}
