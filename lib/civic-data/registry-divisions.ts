import { sql, type SQL } from "drizzle-orm";
import { requireBallotState } from "../ballot/state-scopes.ts";
import type { Division } from "../registry/types.ts";
import { civicDataPromotions } from "../db/schema.ts";

export type RegistryDivisionMatch = Pick<Division, "ocdId" | "label" | "state" | "sourceDataset">;
export const registryDivisionLabel = (label: string) => label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function registryDivisionsQuery(state: string, labels: readonly string[]): SQL {
  return sql`WITH RECURSIVE walk(step,node) AS (
    SELECT 0,${civicDataPromotions.payload} FROM ${civicDataPromotions}
      WHERE ${civicDataPromotions.recordClass}='REGISTRY_RUNTIME_BINDING' AND ${civicDataPromotions.scope}='US:reader-registry-runtime-bindings'
        AND ${civicDataPromotions.validationReceipt}->>'decision'='GOOD'
    UNION ALL
    SELECT n.step,n.node FROM walk w
      LEFT JOIN civic_data_payload_parts p ON p.hash=w.node->>'$civicPayloadPart'
      CROSS JOIN LATERAL (SELECT CASE WHEN p.hash IS NULL THEN w.node
        WHEN p.payload->>'kind'='object' THEN p.payload->'value'
        WHEN p.payload->>'kind'='array' THEN p.payload->'groups' ELSE p.payload END node) r
      CROSS JOIN LATERAL (
        SELECT w.step+1 step,r.node->CASE w.step WHEN 0 THEN 'registry' ELSE 'divisions' END node
          WHERE w.step<2 AND jsonb_typeof(r.node)='object' AND NOT r.node ? '$civicPayloadPart'
        UNION ALL
        SELECT w.step,e.node FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.node)='array'
          THEN r.node ELSE '[]'::jsonb END) e(node)
        UNION ALL
        SELECT w.step,r.node WHERE p.hash IS NOT NULL AND w.step=2 AND jsonb_typeof(r.node)='object'
      ) n WHERE n.node IS NOT NULL
  )
  SELECT DISTINCT jsonb_build_object('ocdId',node->'ocdId','label',node->'label','state',node->'state','sourceDataset',node->'sourceDataset') division
    FROM walk WHERE step=2 AND upper(node->>'state')=${requireBallotState(state)}
      AND trim(regexp_replace(lower(node->>'label'),'[^[:alnum:]]+',' ','g')) IN
        (SELECT jsonb_array_elements_text(${JSON.stringify([...new Set(labels.map(registryDivisionLabel))])}::jsonb))
  UNION ALL SELECT jsonb_build_object('$missing',node->>'$civicPayloadPart') FROM walk
    WHERE node ? '$civicPayloadPart' AND NOT EXISTS (SELECT 1 FROM civic_data_payload_parts p WHERE p.hash=node->>'$civicPayloadPart')`;
}
