import type { RecordProjection } from "../control-plane/repository/types.ts";

/** Only the fields consumed by wiring, partitions, hosts and outcome installation. */
export const DOOR_INSTALL_FIELDS = {
  formatVersion: true, doorId: true, kind: true, ocdId: true, bodyIds: true, hosts: true,
  config: true, holds: true, meeting: true, status: true,
} as const satisfies RecordProjection;

/** Status and read-now belong to the live door, so a derive never overrides them. */
export const DOOR_DERIVE_FIELDS = ["kind", "ocdId", "bodyIds", "hosts", "config", "holds", "checkEveryMinutes", "notes", "meeting"] as const;
export const DOOR_HEADER_FIELDS = ["formatVersion", "doorId", "kind", "bodyIds", "hosts", "status", "updatedAt"] as const;

/** Select named columns before passing a stored door to a SQL function. */
export function doorFieldsSql(source: string, fields: readonly string[]): string {
  if (!/^(?:[A-Za-z_]\w*\.)?value$/.test(source) || fields.some(field => !/^[A-Za-z_]\w*$/.test(field))) {
    throw new Error("A door projection needs a record column and explicit field names");
  }
  return `(jsonb_build_object(${fields.flatMap(field => [`'${field}'`, `${source}->'${field}'`]).join(",")}) - ` +
    `ARRAY(SELECT field FROM unnest(ARRAY[${fields.map(field => `'${field}'`).join(",")}]) fields(field) WHERE NOT (${source} ? field)))`;
}
