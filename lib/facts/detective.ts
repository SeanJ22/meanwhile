import type { HuntPacket, PacketField } from "../hunt/packet.ts";
import type { Query } from "./publish.ts";

export interface SourceCheckFailure {
  readonly governmentId: string;
  readonly entityId: string;
  readonly label: string;
  readonly field: string;
  readonly reason: string;
  readonly detail: string;
}

export async function readSourceCheckFailures(query: Query | null, governments: readonly string[]): Promise<SourceCheckFailure[]> {
  if (!query || !governments.length) return [];
  const rows = await query(`SELECT DISTINCT ep.place_id,b.entity_id,e.name,b.field,b.reason,b.detail FROM blank b
    JOIN entity e ON e.id=b.entity_id JOIN entity_place ep ON ep.entity_id=b.entity_id
    WHERE ep.place_id=ANY($1::text[]) AND b.stage IN ('CHECK','ACQUIRE') ORDER BY ep.place_id,b.entity_id,b.field`,[governments]);
  return rows.map(row=>({governmentId:String(row.place_id),entityId:String(row.entity_id),label:String(row.name),field:String(row.field),
    reason:String(row.reason),detail:String(row.detail ?? "")}));
}

const checklist = (field:string) => field.startsWith("member") || field === "name" ? "OFF-04" : field.startsWith("office:") ? "OFF-02"
  : field.startsWith("term") ? "OFF-06" : ["email","phone"].includes(field) ? "OFF-09" : field === "website" ? "OFF-08"
  : field.startsWith("office_") || field === "homepage" ? "GOV-08" : field.startsWith("comment:") ? field === "comment:time_limit" ? "PAR-03" : field === "comment:attend" ? "PAR-01" : "PAR-02"
  : field === "location" ? "MTG-08" : field === "starts_at" ? "MTG-06" : field === "agenda_url" ? "DOC-01" : "MTG-01";

export function withSourceCheckFailures(packet:HuntPacket,failures:readonly SourceCheckFailure[]):HuntPacket {
  const own = failures.filter(row=>row.governmentId===packet.governmentId);
  if (!own.length) return packet;
  const blanks = new Map(packet.blanks.map(field=>[`${field.subjectId}:${field.checklistId}`,field]));
  for (const failed of own) {
    const id=checklist(failed.field);
    const field:PacketField={subjectId:failed.entityId,subjectLabel:failed.label,checklistId:id,family:id.split("-")[0],requirement:`Repair ${failed.field}`};
    blanks.set(`${field.subjectId}:${field.checklistId}`,field);
  }
  const keys = new Set(blanks.keys());
  return {...packet,sourceFailures:own,blanks:[...blanks.values()],held:packet.held.filter(field=>!keys.has(`${field.subjectId}:${field.checklistId}`))};
}
