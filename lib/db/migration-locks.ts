/** A failed NOWAIT rolls back the inner subtransaction, releasing every partial table lock before sleeping. */
export function migrationTableLockBlock(tables: readonly string[]): string {
  if (tables.some(table => !/^[a-z_][a-z0-9_]*$/.test(table))) throw new Error("A migration declares an invalid table to lock");
  if (!tables.length) return "";
  return `DECLARE lock_deadline timestamptz := clock_timestamp() + interval '10 seconds';
    BEGIN
      LOOP
        BEGIN
          LOCK TABLE ${tables.map(table => `public.${table}`).join(", ")} IN SHARE ROW EXCLUSIVE MODE NOWAIT;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          IF clock_timestamp() >= lock_deadline THEN RAISE; END IF;
        END;
        PERFORM pg_sleep(0.05);
      END LOOP;
    END;`;
}
