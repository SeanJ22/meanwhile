import { DOOR_DERIVE_FIELDS, DOOR_HEADER_FIELDS, DOOR_INSTALL_FIELDS, doorFieldsSql } from "./record-fields.ts";
export { DOOR_DERIVE_FIELDS, DOOR_INSTALL_FIELDS } from "./record-fields.ts";

/** Small changed-door pointers, including deletions. The count generation is a committed cursor:
 * every door transaction locks that counter before its pointer is written. */
export const DOOR_READS_DDL = [
  `CREATE TABLE IF NOT EXISTS cp_door_changes (
    id text PRIMARY KEY,generation bigint NOT NULL,revision bigint NOT NULL,updated_at timestamptz NOT NULL,
    install_version text,derive_version text,edited_at text,readable boolean NOT NULL DEFAULT true,deleted boolean NOT NULL DEFAULT false)`,
  `ALTER TABLE cp_door_changes ADD COLUMN IF NOT EXISTS derive_version text,
    ADD COLUMN IF NOT EXISTS edited_at text,ADD COLUMN IF NOT EXISTS readable boolean NOT NULL DEFAULT true`,
  `CREATE INDEX IF NOT EXISTS cp_door_changes_generation ON cp_door_changes(generation,id)`,
  `CREATE OR REPLACE FUNCTION cp_door_install_fingerprint(r jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN r->'meeting' IS NOT NULL AND r->'meeting'<>'null'::jsonb THEN
      encode(sha256(convert_to(jsonb_build_array(${Object.keys(DOOR_INSTALL_FIELDS).map(key => `r->'${key}'`).join(",")})::text,'UTF8')),'hex') END $$`,
  `CREATE OR REPLACE FUNCTION cp_door_derive_fingerprint(r jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT encode(sha256(convert_to(jsonb_build_array(${DOOR_DERIVE_FIELDS.map(key => `r->'${key}'`).join(",")})::text,'UTF8')),'hex') $$`,
  `CREATE OR REPLACE FUNCTION cp_touch_door_changes() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE r record; g bigint;
  BEGIN
    SELECT generation INTO STRICT g FROM cp_control_counts WHERE table_name='cp_doors' AND bucket='*';
    IF TG_OP='DELETE' THEN r:=OLD; ELSE r:=NEW; END IF;
    INSERT INTO cp_door_changes(id,generation,revision,updated_at,install_version,derive_version,edited_at,readable,deleted)
      VALUES(r.id,g,r.revision,r.updated_at,CASE WHEN TG_OP='DELETE' THEN NULL ELSE cp_door_install_fingerprint(${doorFieldsSql("r.value", Object.keys(DOOR_INSTALL_FIELDS))}) END,
        CASE WHEN TG_OP='DELETE' THEN NULL ELSE cp_door_derive_fingerprint(${doorFieldsSql("r.value", DOOR_DERIVE_FIELDS)}) END,r.value->>'editedAt',
        cp_door_count_bucket(${doorFieldsSql("r.value", DOOR_HEADER_FIELDS)})<>'UNREADABLE',TG_OP='DELETE')
      ON CONFLICT(id) DO UPDATE SET generation=excluded.generation,revision=excluded.revision,
        updated_at=excluded.updated_at,install_version=excluded.install_version,derive_version=excluded.derive_version,
        edited_at=excluded.edited_at,readable=excluded.readable,deleted=excluded.deleted;
    RETURN coalesce(NEW,OLD);
  END $$`,
  `DROP TRIGGER IF EXISTS z_cp_door_changes ON cp_doors`,
  `CREATE TRIGGER z_cp_door_changes AFTER INSERT OR UPDATE OR DELETE ON cp_doors
    FOR EACH ROW EXECUTE FUNCTION cp_touch_door_changes()`,
  `INSERT INTO cp_door_changes(id,generation,revision,updated_at,install_version,derive_version,edited_at,readable)
    SELECT d.id,c.generation,d.revision,d.updated_at,cp_door_install_fingerprint(${doorFieldsSql("d.value", Object.keys(DOOR_INSTALL_FIELDS))}),
      cp_door_derive_fingerprint(${doorFieldsSql("d.value", DOOR_DERIVE_FIELDS)}),
      d.value->>'editedAt',cp_door_count_bucket(${doorFieldsSql("d.value", DOOR_HEADER_FIELDS)})<>'UNREADABLE'
    FROM cp_doors d CROSS JOIN cp_control_counts c WHERE c.table_name='cp_doors' AND c.bucket='*'
    ON CONFLICT(id) DO UPDATE SET derive_version=excluded.derive_version,edited_at=excluded.edited_at,readable=excluded.readable
      WHERE cp_door_changes.derive_version IS NULL AND NOT cp_door_changes.deleted`,
] as const;
