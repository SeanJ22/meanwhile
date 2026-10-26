import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import type { FederalMoneyFact, FederalMoneyPartition, FederalMoneySource } from "./model.ts";

export async function locateFederalMoneyFacts(source: FederalMoneySource, state: string, facts: readonly FederalMoneyFact[], query: ReadOnlyQuery | null) {
  if (!facts.length) return [];
  if (!query) throw new Error("The federal partition index is unavailable.");
  const [rows] = await query([{
    text: "SELECT r.row_id AS id,reader_payload_value(reader_payload_node(p.payload)->'partition') AS partition" +
      " FROM civic_data_rows r JOIN civic_data_promotions p ON p.key=r.promotion_key AND p.current_version_id=r.version_id" +
      " WHERE r.record_class='FEDERAL_MONEY' AND r.collection='federalMoney' AND r.state=$2 AND r.row_id=ANY($3::text[])" +
      " AND reader_payload_node(p.payload)->>'formatVersion'='2' AND reader_payload_node(p.payload)->>'source'=$1",
    params: [source, state, facts.map(row => row.id)],
  }]);
  return (rows ?? []).map(row => ({ id: String(row.id), partition: row.partition as FederalMoneyPartition }));
}
