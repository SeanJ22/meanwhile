import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import type { FederalMoneyFact, FederalMoneyPartition, FederalMoneySource } from "./model.ts";
import { federalMoneyLookupPath } from "./lookups.ts";

export async function locateFederalMoneyFacts(source: FederalMoneySource, state: string, facts: readonly FederalMoneyFact[], query: ReadOnlyQuery | null) {
  if (!facts.length) return [];
  if (!query) throw new Error("The federal partition index is unavailable.");
  const [rows] = await query([{
    text: "WITH matched AS MATERIALIZED (SELECT p.key FROM civic_data_promotions p WHERE p.payload ? 'lookupKeys'" +
      " AND (p.payload->'lookupKeys') @? $3::jsonpath)" +
      " SELECT substr(native.key, 4) AS id, p.payload->'partition' AS partition FROM matched" +
      " CROSS JOIN LATERAL (SELECT record_class, payload FROM civic_data_promotions WHERE key = matched.key OFFSET 0) p" +
      " CROSS JOIN LATERAL jsonb_array_elements_text(p.payload->'lookupKeys') native(key)" +
      " WHERE p.record_class = 'FEDERAL_MONEY' AND p.payload->>'formatVersion' = '2'" +
      " AND p.payload->>'source' = $1 AND p.payload->>'state' = $2 AND native.key = ANY($4::text[])",
    params: [source, state, federalMoneyLookupPath("id", facts.map(row => row.id)), facts.map(row => `id:${row.id}`)],
  }]);
  return (rows ?? []).map(row => ({ id: String(row.id), partition: row.partition as FederalMoneyPartition }));
}
