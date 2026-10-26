import type { CardSource } from "../officials/card-sources.ts";
import type { FederalMoneyFact, FederalMoneySource } from "./model.ts";
import { US_JURISDICTIONS } from "../coverage/states.ts";
import { cardAmount, cardDate, cardName, cardPurpose, writeCardSentence } from "../reader/card-writer.ts";
import { compareFederalMoneyActions } from "./model.ts";
import { federalGovernmentName, federalMoneyRecipientState } from "./recipient.ts";

export const FEDERAL_MONEY_SOURCE_LABELS: Readonly<Record<FederalMoneySource, string>> = {
  usaspending: "USAspending",
  "federal-audit-clearinghouse": "Federal Audit Clearinghouse",
  "sam-gov-entities": "SAM.gov",
  openfema: "OpenFEMA",
};

const KIND_LABELS: Readonly<Record<FederalMoneyFact["kind"], string>> = {
  GRANT: "Federal grant", CONTRACT: "Federal contract", LOAN: "Federal loan",
  AUDIT: "Federal audit", ENTITY: "Federal registration", DISASTER: "Disaster declaration",
};

export interface FederalMoneyTarget {
  readonly divisionId: string;
  readonly bodyId?: string;
  /** Exact equivalents from the published government inventory. */
  readonly bodyIds?: readonly string[];
  /** Only unique, source-owned legal names from the state inventory. */
  readonly recipientNames?: readonly string[];
  readonly recipientState?: string;
}
/** This chooses a state dataset for a source-identified recipient; it makes no
 * claim that an inventory listing has a verified service boundary. */
export function federalMoneyStateDivision(state: string | null | undefined): string | null {
  if (typeof state !== "string") return null;
  const jurisdiction = US_JURISDICTIONS.find(row => row.usps === state.toUpperCase());
  return jurisdiction ? `ocd-division/country:us/${jurisdiction.prefix}:${jurisdiction.slug}` : null;
}
export interface FederalMoneyRow {
  readonly fact: FederalMoneyFact;
  readonly label: string;
  readonly relationship: "RECIPIENT" | "GEOGRAPHY" | "BOTH";
  readonly text: string;
}

/** Place of performance never establishes who received an award. Audit and
 * registration records on a body card require the recipient's own join. */
export function federalMoneyRows(records: readonly FederalMoneyFact[], target: FederalMoneyTarget): FederalMoneyRow[] {
  return records.flatMap(fact => {
    const nativeRecipient = target.bodyId && [target.bodyId, ...target.bodyIds ?? []].some(id => fact.bodyIds.includes(id));
    const namedRecipient = target.bodyId && fact.recipient && target.recipientState && federalMoneyRecipientState(fact) === target.recipientState.toUpperCase()
      && target.recipientNames?.some(name => federalGovernmentName(name) === federalGovernmentName(fact.recipient!));
    const recipient = Boolean(nativeRecipient || namedRecipient);
    const county = /^(.+\/county:[^/]+)(?:\/|$)/.exec(target.divisionId)?.[1];
    const disasterState = !target.bodyId && fact.source === "openfema" && fact.details.reportedState === fact.state && target.divisionId === federalMoneyStateDivision(fact.state);
    const geography = fact.kind === "DISASTER" ? Boolean(county && fact.divisionIds.includes(county) || disasterState && fact.divisionIds.includes(target.divisionId)) : fact.divisionIds.includes(target.divisionId);
    if (fact.kind === "AUDIT" || fact.kind === "ENTITY") {
      if (target.bodyId ? !recipient : !geography) return [];
    } else if (fact.kind === "DISASTER") {
      if (!geography) return [];
    } else if (!recipient && !geography) return [];
    const relationship: FederalMoneyRow["relationship"] = recipient ? geography ? "BOTH" : "RECIPIENT" : "GEOGRAPHY";
    return [{ fact, label: KIND_LABELS[fact.kind], relationship, text: writeFederalMoneyCard(fact) }];
  }).sort((left, right) => compareFederalMoneyActions(left.fact, right.fact));
}

function words(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").toLowerCase().replace(/^./, letter => letter.toUpperCase());
}
export function federalMoneyDetails(fact: FederalMoneyFact): { label: string; value: string }[] {
  return Object.entries(fact.details).flatMap(([key, value]) => value === null || value === "" ? [] : [{ label: words(key), value: typeof value === "boolean" ? value ? "Yes" : "No" : String(value) }]);
}

/** Only supported facts enter the sentence; every original field stays in Sources. */
export function writeFederalMoneyCard(fact: FederalMoneyFact): string {
  const subject = fact.recipient ? cardName(fact.recipient) : "An unnamed recipient";
  const on = cardDate(typeof fact.details.actionDate === "string" ? fact.details.actionDate : fact.period) ?? undefined;
  if (["GRANT", "CONTRACT", "LOAN"].includes(fact.kind)) {
    const kind = fact.kind.toLowerCase();
    const agency = typeof fact.details.awardingAgency === "string" ? cardName(fact.details.awardingAgency) : undefined;
    const from = agency && /^(?:U\.S\. )?Department\b/.test(agency) ? `the ${agency}` : agency;
    const purpose = /^Federal (?:grant|contract|loan)(?: [\w:/-]+)?$/i.test(fact.title) ? undefined : cardPurpose(fact.title);
    if (fact.amount !== null && fact.amount < 0) return writeCardSentence({ subject, action: "had", object: `${cardAmount(fact.amount)} taken back from a federal ${kind}`, from, purpose, on });
    return writeCardSentence({ subject, action: "got", object: `${fact.amount === null ? "a" : `a ${cardAmount(fact.amount)}`} federal ${kind}`, from, purpose, on });
  }
  if (fact.kind === "DISASTER") {
    const title = cardName(fact.title.split(/\s+—\s+/)[0]);
    const area = typeof fact.details.designatedArea === "string" ? cardName(fact.details.designatedArea.replace(/\s*\(County\)$/i, " County")) : "the declared area";
    const month = cardDate(typeof fact.details.incidentBegin === "string" ? fact.details.incidentBegin : fact.period, { monthOnly: true });
    const assistance = typeof fact.details.publicAssistance === "boolean" ? fact.details.publicAssistance ? " with public assistance" : " without public assistance" : "";
    return writeCardSentence({ subject: `${title}${month ? `, ${month}` : ""}:`, action: "FEMA disaster declaration", object: `for ${area}${assistance}` });
  }
  if (fact.kind === "ENTITY") return writeCardSentence({ subject, action: "has a federal registration", on });
  const year = fact.period && /^\d{4}$/.test(fact.period) ? fact.period : undefined;
  const detail = fact.details.table;
  const action = detail === "corrective_action_plans" ? "has a corrective action plan in its federal audit" : detail === "findings" || detail === "findings_text" ? "has a finding in its federal audit" : detail === "additional_ueis" ? "is listed in a federal audit" : "reported";
  return writeCardSentence({ subject, action, object: action === "reported" ? `${fact.amount === null ? "its spending of federal money" : `${fact.amount < 0 ? "a reduction of " : ""}${cardAmount(fact.amount)} in federal spending`} in an audit${year ? ` for ${year}` : ""}` : year ? `for ${year}` : undefined });
}

/** A single contribution lets the enclosing card retain its one Sources list. */
export function federalMoneySources(rows: readonly FederalMoneyRow[]): CardSource[] {
  return rows.map(({ fact, label, relationship }) => ({
    what: [
      `${label} — ${fact.title}${fact.provenance.publicationDate ? ` · published ${fact.provenance.publicationDate.slice(0, 10)}` : " · publication date not provided"}`,
      `Recipient: ${fact.recipient ?? "Not supplied"}`, `Relationship: ${relationship === "GEOGRAPHY" ? "Federal money or records for this area" : "This government is the recipient"}`,
      ...(fact.amount !== null ? [`${fact.amountLabel ?? "Amount"}: ${fact.amount < 0 ? `${cardAmount(fact.amount)} taken back` : cardAmount(fact.amount)}`] : []),
      ...(fact.period ? [`Period: ${fact.period}`] : []), ...(fact.uei ? [`UEI: ${fact.uei}`] : []),
      ...federalMoneyDetails(fact).map(detail => `${detail.label}: ${detail.value}`),
      ...Object.entries(fact.identifiers).map(([key, value]) => `${words(key)}: ${value}`),
      ...fact.geography.map(geo => `${words(geo.type)} GEOID: ${geo.geoid}`),
      `Source record: ${fact.sourceId}`, `State: ${fact.state}`, `Match: ${fact.joinReason}`,
    ].join("; "),
    provenance: {
      kind: "OFFICIAL", sourceOrg: fact.provenance.sourceOrg, sourceUrl: fact.provenance.sourceUrl,
      collectedAt: fact.provenance.retrievedAt, verifiedAt: null,
    },
  }));
}
