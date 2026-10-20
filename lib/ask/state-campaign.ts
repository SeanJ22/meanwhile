import { readCampaignFinanceForPlace } from "../funding/state-reader.ts";
import { campaignFinanceRecordText } from "../funding/state-view.ts";
import type { EvidenceGap, EvidenceRecord } from "./evidence.ts";
import { normalizeName } from "../routing/exact-name.ts";
import { statesNamedInQuestion } from "./reader-officials.ts";
import { factReader } from "../facts/db.ts";

const RECORDS_QUESTION = /^(?:(?:what|which) campaign(?: finance| money)? (?:records|reports|filings) (?:are (?:held|available|reported)|do (?:you|we) have|have (?:you|we) (?:got|recorded))|(?:show|list) (?:the )?campaign(?: finance| money)? (?:records|reports|filings))(?:\b|$)/;

export function stateCampaignQuestion(question: string): boolean {
  return /\bcampaign(?:s| finance)?\b|\bdonors?\b|\bpolitical (?:money|contributions?|funding)\b|\bPACs?\b/i.test(question);
}

/** A question about the records held for a place needs no person or body
 * identity. An explicit place must match a selected division. */
export function stateCampaignRecordsAsk(question: string, divisions: readonly string[]): string[] | null {
  const words = normalizeName(question);
  if (!RECORDS_QUESTION.test(words)) return null;
  const states = statesNamedInQuestion(question);
  if (states.length) {
    const exact = [...new Set(divisions.flatMap(id => {
    const match = /^(ocd-division\/country:us\/(?:state|district|territory):([a-z]{2}))/.exec(id);
    return match && states.includes(match[2]!.toUpperCase()) ? [match[1]!] : [];
    }))];
    return exact.length ? exact : null;
  }
  const place = /\b(?:for|in|from|near|about) (.+)$/.exec(words)?.[1]?.replace(/^the /, "");
  if (place && !/^(?:here|my area|our area|my zip|this place)$/.test(place)) {
    const exact = divisions.filter(id => {
      const name = id.split(":").at(-1)!.replaceAll("_", " ");
      return normalizeName(name) === place || /\/county:[^/]+$/.test(id) && normalizeName(`${name} County`) === place;
    });
    return exact.length ? exact : null;
  }
  for (const kind of ["place", "county", "state", "district", "territory"]) {
    const exact = divisions.filter(id => new RegExp(`/${kind}:[^/]+$`).test(id));
    if (exact.length) return exact;
  }
  return null;
}

/** A held campaign place can be named even when it is absent from the ZIP's
 * meeting divisions. Resolve its existing place ID inside the selected state. */
export async function resolveStateCampaignRecordsAsk(question: string, divisions: readonly string[]): Promise<string[] | null> {
  const direct = stateCampaignRecordsAsk(question, divisions);
  if (direct) return direct;
  const words = normalizeName(question);
  if (!RECORDS_QUESTION.test(words)) return null;
  const place = /\b(?:for|in|from|near|about) (.+)$/.exec(words)?.[1]?.replace(/^the /, "");
  const states = [...new Set(divisions.flatMap(id => /\/(?:state|district|territory):([a-z]{2})(?:\/|$)/.exec(id)?.[1]?.toUpperCase() ?? []))];
  if (!place || !states.length) return null;
  const query = factReader();
  if (!query) return [];
  const rows = await query(`SELECT DISTINCT p.place_id FROM entity_place p JOIN entity e ON e.id=p.entity_id
    WHERE e.state=ANY($1::text[]) AND e.kind='committee' AND e.id LIKE 'campaign-committee:%'
      AND p.place_id ~ ('^ocd-division/country:us/(state|district|territory):' || lower(e.state) || '/')
      AND p.place_id ~ '/(place|county):[^/]+$'
      AND (replace(regexp_replace(p.place_id, '^.*/(place|county):', ''), '_', ' ')=$2
        OR p.place_id LIKE '%/county:%' AND replace(regexp_replace(p.place_id, '^.*/county:', ''), '_', ' ') || ' county'=$2)`, [states, place]).catch(() => null);
  if (!rows) return null;
  return rows.map(row => String(row.place_id));
}

export async function stateCampaignEvidence(divisions: readonly string[], subjectId?: string, options: Parameters<typeof readCampaignFinanceForPlace>[1] = {}) {
  const records = new Map<string, EvidenceRecord>(), gaps: EvidenceGap[] = [];
  const filers = new Set<string>();
  let more = 0, unavailable = 0;
  for (const division of new Set(divisions)) {
    try {
      const read = await readCampaignFinanceForPlace(division, options);
      if (read.nextCursor) more++;
      if (read.status !== "HELD") { unavailable++; continue; }
      for (const row of read.records) {
        if (row.sources.length) filers.add(row.committee);
        for (const [index, source] of row.sources.entries()) records.set(`${row.id}:${index}`, {
          id: `${row.id}:${index}`, kind: "FINANCE_COMMITTEE", subjectId: row.person.id,
          text: campaignFinanceRecordText(row), sourceUrl: source.filingUrl, sourceOrg: source.publisher,
          retrievedAt: source.retrievedAt, publicationDate: source.publicationDate, official: true,
        });
      }
    } catch { unavailable++; }
  }
  if (unavailable) gaps.push({ whose: "OURS", statement: "We're working on getting this info about campaign money for this place." });
  if (more) gaps.push({ whose: "OURS", statement: "More campaign totals are available on this place's card." });
  return { records: [...records.values()], gaps, filers: [...filers], denominators: { stateCampaignRecordsReturned: records.size, stateCampaignMorePages: more, stateCampaignUnavailablePlaces: unavailable } };
}
