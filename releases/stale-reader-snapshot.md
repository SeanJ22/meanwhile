# Stale reader snapshot (manifest seq 2979, 2026-09-29T05:38:58Z)

## Correction (2026-10-05 18:20Z), from Sean's check on the runner host

**Actual cause:** `/etc/meanwhile/runner.env` on the Linux runner set `WTP_READER_EDGE_DIR=/var/lib/meanwhile/reader-edge`, a default written by `deploy/runner/setup.ps1` (`ConvertTo-LinuxRunnerSettings` overrides). `resolveReaderArtifactWriteStore()` in `lib/meetings/edge-store.ts` returns the local file store whenever that variable is set, before it checks `NETLIFY_SITE_ID` and the token. The runner therefore wrote the reader artifacts to a folder on the droplet and logged `PUBLISHED` at local sequences 113 to 117, while production stayed at 2979. No purge ran either, because purge happens only for the `netlify-blobs` store.

**The staging-site theory below was wrong.** `NETLIFY_SITE_ID` and `WTP_BLOBS_SITE_ID` were already the live site, and the token was set. The "SKIPPED_NO_STORE" alternative was wrong too: a store was configured, just the local one.

**Fix applied:** Sean commented out `WTP_READER_EDGE_DIR` in runner.env at 11:08 AM MST (18:08Z). The next cycle should publish to Netlify Blobs on the live site as sequence 2980 or higher. The live result is recorded in status.md ("Stale snapshot live check").

**Code fixes assigned 18:20Z:**
- hunters: remove the `WTP_READER_EDGE_DIR` default from `deploy/runner/setup.ps1` (keep stripping any incoming copy), so re-running setup can't bring it back.
- slide: the runner logs which store it published to (local folder or Netlify Blobs), and a local-folder publish on the production runner is a visible failure in Admin. This replaces the 17:45Z slide return, which was based on the wrong theory.

---

## Original notes (17:36Z), superseded where they conflict with the correction above

Repo river 85a0ad660; read-only.

## Facts
- Prod /api/reader/manifest: sequence 2979, generatedAt 2026-09-29T05:38:58.475Z (fetched 2026-10-05).
- CP cp_log_owner_digests, routine supervisor digests by host:
  - SeanLenovo (Windows scheduled runner): 2026-09-28 00:10Z .. 2026-09-29 05:39:50Z, 306 cycles, 0 READER_EDGE_PUBLISH_FAILED.
    Last cycle routine-civic-data-supervisor:SeanLenovo:2026-09-29T05:38:11Z (sha 72be6002) = the 05:38:58 manifest.
  - no routine cycles at all 2026-09-29 05:40Z .. 2026-10-02 00:03Z (cutover gap)
  - meanwhile-runner (Linux, 146.190.74.145): 2026-10-02 00:03Z .. now, 125 cycles; READER_EDGE_PUBLISH_FAILED only 11x (2026-10-02 00:12Z..00:50Z), none since.
- Data plane civic_data_reader_projections MEETING:composed-reader-snapshot seq 2218 composed 2026-10-05T16:29:05Z.
- So since 2026-10-02 the Linux runner's publishRoutineReaderEdge returns true ~114 times while the production store never advances.
- Any PUBLISHED against the live store would bump the sequence (changed meetings/authority every pass). Non-advancing "success" results:
  SKIPPED_NO_STORE (no NETLIFY_SITE_ID/NETLIFY_BLOBS_TOKEN -> returns true, reader-edge-publication.ts:88-89),
  NOT_COMPOSABLE (only FAILED throws, :362), CURRENT/RACED, or PUBLISHED to a *different* Netlify project.
- 11 failures on Oct 2 happen only inside the non-null-store branch -> a store WAS configured on the Linux host.
- deploy/runner/README.md "Staging Blobs destination" (fd5491ef9, 2026-09-30) told Sean to set NETLIFY_SITE_ID +
  NETLIFY_BLOBS_TOKEN in /etc/meanwhile/runner.env to the staging project meanwhile-runner-staging
  (acafb24c-9803-4d0d-8f6c-8b9d21d96169). Resume-day step 1 (4555fe3e3/b804ce0b8, 2026-09-30) says replace it with the live
  Project ID; only the step-2 vault readback asserts it. resolveReaderArtifactWriteStore (lib/meetings/edge-store.ts:222-229)
  takes whatever NETLIFY_SITE_ID says; purge goes to that site too.
- Supervisor digest records only the generic detail; the real error is stderr (journalctl on the Linux host).

## Root cause (most likely)
Runner cutover SeanLenovo -> Linux meanwhile-runner (not a code commit). The Linux runner.env points the reader
artifact store at a non-live Netlify project (staging acafb24c per README) — publishes land in the staging
project's reader-artifacts store and report success. Second possibility, same fix: token/site unset -> SKIPPED_NO_STORE
reported as success. Unverified: I cannot read the host env or journal.

## Confirm (one command on host, no secrets printed)
grep -E '^(NETLIFY_SITE_ID|WTP_BLOBS_SITE_ID|NETLIFY_BLOBS_SITE_ID|WTP_READER_EDGE_DIR)=' /etc/meanwhile/runner.env
journalctl -u meanwhile-runner.service --since 2026-10-02 | grep -E 'readerEdge|READER_EDGE_' | tail -20

## Fix
Config: set NETLIFY_SITE_ID (+WTP_BLOBS_SITE_ID) to live project ID and NETLIFY_BLOBS_TOKEN to a token authorized for it; restart service.
Next cycle republishes from the current prepared row (full publish, seq 2980) and purges reader-manifest.
Code (slide lane, lib/civic-data/reader-edge-publication.ts): make non-publishing outcomes visible failures in production;
carry the status into the supervisor detail.
