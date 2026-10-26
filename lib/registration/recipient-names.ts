import { federalGovernmentName, federalGovernmentNameSql } from "../federal-money/recipient.ts";
import type { RegistrationGovernmentListing } from "./listings.ts";

/** Only a complete state inventory establishes that a legal name identifies
 * one government. Call this before narrowing to a page or a reader's place. */
export function markUniqueGovernmentRecipientNames(listings: readonly RegistrationGovernmentListing[]): RegistrationGovernmentListing[] {
  const names = new Map<string, Set<string>>();
  const key = (row: RegistrationGovernmentListing) => `${row.state.toUpperCase()}:${federalGovernmentName(row.name)}`;
  for (const row of listings) {
    const ids = names.get(key(row)) ?? new Set<string>();
    ids.add(row.id); names.set(key(row), ids);
  }
  return listings.map(row => ({ ...row, recipientNameUnique: names.get(key(row))?.size === 1 }));
}

/** Annotate an existing bounded projection from its complete source inventory
 * inside the same SELECT. Only selected records and one boolean each leave the
 * database; neither another query nor a full-state worker payload is needed. */
export function registrationRecipientNamesSql(sourcePayload: string, selectedPayload: string): string {
  return `(WITH recipient_inventory AS MATERIALIZED (
    SELECT g->>'id' AS id,upper(g->>'state') AS state,${federalGovernmentNameSql("g->>'name'")} AS name
    FROM reader_payload_members(reader_payload_node(${sourcePayload})->'governments') item,
      LATERAL (SELECT reader_payload_node(item.item) AS header) source,
      LATERAL (SELECT header || jsonb_build_object('name',reader_payload_value(header->'name')) AS g) government
  ), recipient_name_counts AS MATERIALIZED (
    SELECT state,name,count(DISTINCT id) AS identities FROM recipient_inventory GROUP BY state,name
  ), selected_inventory AS (SELECT ${selectedPayload} AS payload)
  SELECT payload || jsonb_build_object('governments',coalesce((SELECT jsonb_agg(g || jsonb_build_object(
      'recipientNameUnique',coalesce(names.identities=1,false)) ORDER BY ordinal_index)
    FROM jsonb_array_elements(coalesce(payload->'governments','[]'::jsonb)) WITH ORDINALITY selected(g,ordinal_index)
    LEFT JOIN recipient_name_counts names ON names.state=upper(g->>'state') AND names.name=${federalGovernmentNameSql("g->>'name'")}),
    '[]'::jsonb)) FROM selected_inventory)`;
}
