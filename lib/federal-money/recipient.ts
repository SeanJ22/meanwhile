import type { FederalMoneyFact } from "./model.ts";

/** A source-coded government area can have a different OCD spelling from its
 * board. Host counties and governments with several areas supply no shortcut. */
export function federalMoneyGovernmentDivision(government: { readonly governmentClass: string; readonly associations: readonly { readonly divisionId: string }[] }): string | undefined {
  const area = government.associations.length === 1 ? government.associations[0].divisionId : null;
  const kind = /^(?:COUNTY|PARISH)(?: GOVERNMENT)?$/i.test(government.governmentClass) ? "county"
    : /SCHOOL/i.test(government.governmentClass) ? "school_district"
      : /\b(?:MUNICIPAL(?:ITY)?|CITY|TOWNSHIP|TOWN|VILLAGE|BOROUGH)\b/i.test(government.governmentClass) ? "place" : null;
  return area && kind && new RegExp(`/${kind}:[^/]+$`).test(area) ? area : undefined;
}

/** Legal-form spelling changes preserve the kind of government. The county,
 * city and village of the same name keep different identities. */
export function federalGovernmentName(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  const leading = /^(COUNTY|CITY|TOWN|VILLAGE|BOROUGH|PARISH) OF (.+)$/.exec(words);
  const trailing = /^(.+?) (COUNTY|CITY|TOWN|VILLAGE|BOROUGH|PARISH)(?: OF)?$/.exec(words);
  return leading ? `${leading[1]}:${leading[2]}` : trailing ? `${trailing[2]}:${trailing[1]}` : `NAME:${words}`;
}

export function federalGovernmentNameForms(name: string): string[] {
  const key = federalGovernmentName(name), colon = key.indexOf(":");
  const kind = key.slice(0, colon), place = key.slice(colon + 1);
  return kind === "NAME" ? [place] : [`${kind} OF ${place}`, `${place} ${kind}`, `${place} ${kind} OF`];
}

/** SQL counterpart for bounded identity queries. `value` is a caller-owned SQL
 * expression; names themselves remain query parameters. */
export function federalGovernmentNameSql(value: string): string {
  const normalized = `trim(regexp_replace(upper(${value}), '[^A-Z0-9]+', ' ', 'g'))`;
  const types = "COUNTY|CITY|TOWN|VILLAGE|BOROUGH|PARISH";
  return `(CASE WHEN ${normalized} ~ '^(${types}) OF (.+)$' THEN regexp_replace(${normalized}, '^(${types}) OF (.+)$', '\\1:\\2') WHEN ${normalized} ~ '^(.+?) (${types})( OF)?$' THEN regexp_replace(${normalized}, '^(.+?) (${types})( OF)?$', '\\2:\\1') ELSE 'NAME:' || ${normalized} END)`;
}

export function federalMoneyRecipientState(fact: FederalMoneyFact): string | null {
  const reported = fact.source === "usaspending" ? fact.details.recipientState
    : fact.source === "federal-audit-clearinghouse" ? fact.details.reportedState
      : fact.source === "sam-gov-entities" ? fact.details.state : null;
  return typeof reported === "string" && /^[A-Z]{2}$/i.test(reported) ? reported.toUpperCase() : null;
}

/** Only the recipient's own named state qualifies a legal-name identity. Place
 * of performance and the state of the acquisition job supply no recipient ID. */
export function federalMoneyRecipientName(fact: FederalMoneyFact): string | null {
  return fact.recipient && federalMoneyRecipientState(fact) === fact.state ? federalGovernmentName(fact.recipient) : null;
}
