-- STAGED, UNAPPLIED control-plane index. This is not a serving Drizzle migration.
-- The Admin active-claim repository refuses to join Attempts until this exact
-- index is installed by a reviewed CP schema/bootstrap change. No production
-- database mutation is performed by this proposal.
CREATE INDEX cp_attempts_lease_id ON cp_attempts ((value->>'leaseId'));

-- Existing v13 index used for the active-lease range:
-- cp_leases_expiry ON cp_leases ((value->>'expiresAt'))
-- The lease producer stores `expiresAt` via Date.toISOString() (canonical UTC),
-- so its textual order matches instant order. A future direct writer that
-- bypasses that invariant would need separate corruption detection before a
-- complete-universe claim; this read does not interpret arbitrary offsets.
