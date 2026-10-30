// Assignment state uses these four lease fields. A heartbeat alone changes none of them.
const fingerprint = (value: string) => `cp_owner_lease_fingerprint(${["id","routeTaskId","released","expiresAt"].map(key=>`${value}->'${key}'`).join(",")})`;
export const OWNER_LEASE_CHANGES_DDL = [
  `CREATE OR REPLACE FUNCTION cp_owner_lease_fingerprint(identity jsonb,route_task jsonb,released jsonb,expires_at jsonb)
    RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT encode(sha256(convert_to(
      jsonb_build_array(identity,route_task,released,expires_at)::text,'UTF8')),'hex') $$`,
  `ALTER TABLE cp_leases ADD COLUMN IF NOT EXISTS owner_revision bigint,
    ADD COLUMN IF NOT EXISTS owner_changed_at timestamptz,
    ADD COLUMN IF NOT EXISTS owner_fingerprint text GENERATED ALWAYS AS (${fingerprint("value")}) STORED`,
  `CREATE INDEX IF NOT EXISTS cp_leases_owner_changed ON cp_leases(coalesce(owner_changed_at,changed_at),id)`,
  `CREATE OR REPLACE FUNCTION cp_touch_owner_lease() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF TG_OP='UPDATE' AND OLD.owner_fingerprint IS NOT DISTINCT FROM ${fingerprint("NEW.value")} THEN
      NEW.owner_revision:=coalesce(OLD.owner_revision,OLD.revision);
      NEW.owner_changed_at:=coalesce(OLD.owner_changed_at,OLD.changed_at);
    ELSE
      NEW.owner_revision:=CASE WHEN TG_OP='INSERT' THEN 1 ELSE coalesce(OLD.owner_revision,OLD.revision)+1 END;
      NEW.owner_changed_at:=clock_timestamp();
    END IF;
    RETURN NEW;
  END $$`,
  `DROP TRIGGER IF EXISTS cp_owner_lease_change ON cp_leases`,
  `CREATE TRIGGER cp_owner_lease_change BEFORE INSERT OR UPDATE ON cp_leases FOR EACH ROW EXECUTE FUNCTION cp_touch_owner_lease()`,
] as const;

/** A live renewal keeps its queued expiry check; that check reads the current lease before changing counts. */
export const OWNER_LEASE_RENEWAL_DDL = OWNER_LEASE_CHANGES_DDL[3].replace(
  `OLD.owner_fingerprint IS NOT DISTINCT FROM ${fingerprint("NEW.value")}`,
  `(OLD.owner_fingerprint IS NOT DISTINCT FROM ${fingerprint("NEW.value")} OR (
    OLD.value->'id'=NEW.value->'id' AND OLD.value->'routeTaskId'=NEW.value->'routeTaskId'
    AND OLD.value->'released'='false'::jsonb AND NEW.value->'released'='false'::jsonb
    AND (OLD.value->>'expiresAt')::timestamptz>statement_timestamp()
    AND (NEW.value->>'heartbeatAt')::timestamptz>(OLD.value->>'heartbeatAt')::timestamptz
    AND (NEW.value->>'heartbeatAt')::timestamptz<(OLD.value->>'expiresAt')::timestamptz
    AND (NEW.value->>'expiresAt')::timestamptz>(OLD.value->>'expiresAt')::timestamptz))`);
