import type { CardSource } from "../officials/card-sources.ts";
import type { FederalMoneyFact, FederalMoneySource } from "./model.ts";
import { US_JURISDICTIONS } from "../coverage/states.ts";
import { readerText } from "../text/reader-names.ts";

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
}
/** This chooses a state dataset for a source-identified recipient; it makes no
 * claim that an inventory listing has a verified service boundary. */
export function federalMoneyStateDivision(state: string | null | undefined): string | null {
  if (typeof state !== "string") return null;
  const jurisdiction = US_JURISDICTIONS.find(row => row.usps === state.toUpperCase());
  return jurisdiction ? `ocd-division/country:us/${jurisdiction.prefix}:${jurisdiction.slug}` : null;
}
interface FederalMoneyRow {
  readonly fact: FederalMoneyFact;
  readonly label: string;
  readonly relationship: "RECIPIENT" | "GEOGRAPHY" | "BOTH";
  readonly text: string;
}

/** Place of performance never establishes who received an award. Audit and
 * registration records on a body card require the recipient's own join. */
export function federalMoneyRows(records: readonly FederalMoneyFact[], target: FederalMoneyTarget): FederalMoneyRow[] {
  return records.flatMap(fact => {
    const recipient = Boolean(target.bodyId && fact.bodyIds.includes(target.bodyId));
    const county = /^(.+\/county:[^/]+)(?:\/|$)/.exec(target.divisionId)?.[1];
    const geography = fact.kind === "DISASTER" ? Boolean(county && fact.divisionIds.includes(county)) : fact.divisionIds.includes(target.divisionId);
    if (fact.kind === "AUDIT" || fact.kind === "ENTITY") {
      if (target.bodyId ? !recipient : !geography) return [];
    } else if (fact.kind === "DISASTER") {
      if (!geography) return [];
    } else if (!recipient && !geography) return [];
    const relationship: FederalMoneyRow["relationship"] = recipient ? geography ? "BOTH" : "RECIPIENT" : "GEOGRAPHY";
    return [{ fact, label: KIND_LABELS[fact.kind], relationship, text: federalMoneyText(fact, relationship) }];
  }).sort((left, right) => (right.fact.provenance.publicationDate ?? "").localeCompare(left.fact.provenance.publicationDate ?? "") || left.fact.id.localeCompare(right.fact.id));
}

function words(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").toLowerCase().replace(/^./, letter => letter.toUpperCase());
}
const NAMED_DETAIL = /name|agency|recipient|jurisdiction|designatedArea|city|county|state|place|district|government/i;
function namesForFact(fact: FederalMoneyFact): string[] {
  return [...(fact.recipient ? [fact.recipient] : []), ...Object.entries(fact.details).flatMap(([key, value]) => NAMED_DETAIL.test(key) && typeof value === "string" ? [value] : [])];
}
export function federalMoneyDetails(fact: FederalMoneyFact): { label: string; value: string }[] {
  const knownNames = namesForFact(fact);
  return Object.entries(fact.details).flatMap(([key, value]) => {
    if (value === null || value === "" || ["table", "placeCode"].includes(key)) return [];
    const text = typeof value === "boolean" ? value ? "Yes" : "No" : typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? value.slice(0, 10) : String(value);
    const mode = /address/i.test(key) ? "address" : NAMED_DETAIL.test(key) ? "name" : "sentence";
    return [{ label: words(key), value: readerText(text, mode, knownNames) }];
  });
}

function federalMoneyText(fact: FederalMoneyFact, relationship: FederalMoneyRow["relationship"]): string {
  const parts = [`${KIND_LABELS[fact.kind]}: ${readerText(fact.title, "sentence", namesForFact(fact))}`];
  if (["GRANT", "CONTRACT", "LOAN"].includes(fact.kind)) {
    parts.push(relationship === "GEOGRAPHY" ? "Reaching this place" : relationship === "BOTH" ? "Received by this government and reaching this place" : "Received by this government");
  }
  if (fact.amount !== null) parts.push(`${readerText(fact.amountLabel ?? "Amount", "title")}: ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(fact.amount)}`);
  if (fact.recipient) parts.push(`Recipient: ${readerText(fact.recipient, "name")}`);
  if (fact.period) parts.push(`Period: ${/^\d{4}-\d{2}-\d{2}T/.test(fact.period) ? fact.period.slice(0, 10) : readerText(fact.period, "sentence")}`);
  if (fact.uei) parts.push(`UEI: ${fact.uei}`);
  for (const detail of federalMoneyDetails(fact)) parts.push(`${detail.label}: ${detail.value}`);
  return `${parts.join("; ")}.`;
}

/** A single contribution lets the enclosing card retain its one Sources list. */
export function federalMoneySources(rows: readonly FederalMoneyRow[]): CardSource[] {
  return rows.map(({ fact, label }) => ({
    what: `${label} — ${readerText(fact.title, "sentence", namesForFact(fact))}${fact.provenance.publicationDate ? ` · published ${fact.provenance.publicationDate.slice(0, 10)}` : " · publication date not provided"}`,
    provenance: {
      kind: "OFFICIAL", sourceOrg: fact.provenance.sourceOrg, sourceUrl: fact.provenance.sourceUrl,
      collectedAt: fact.provenance.retrievedAt, verifiedAt: null,
    },
  }));
}
