-- STAGED, UNAPPLIED. Required before the Workers version card can read the
-- newest FRESHNESS_CYCLE without scanning arbitrary owner-digest history.
-- The existing (log_key, position) index alone cannot bound a kind filter.
CREATE INDEX cp_log_owner_digests_cycle_kind_position
  ON cp_log_owner_digests (log_key, (record #>> '{runtimeOutcome,kind}'), position DESC);

-- No live schema bootstrap, production DB, or runner write is changed here.
