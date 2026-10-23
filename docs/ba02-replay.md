BA-02 uses saved production rows as the prior, then publishes the changed state inputs only to an isolated memory store. The actual ballot route and real React pick controls read that result. Neither replay script writes to production.

The reader production project is `tiny-hill-13996172`, branch `br-delicate-lab-ax02xuo5`. Supply its existing `readonly` connection as `BA02_READONLY_DATABASE_URL`, without committing the credential. Both capture commands check the PostgreSQL role and the branch identity before reading. Each request is scoped to one of the 15 affected jurisdictions. Prior captures include the current pointer, its candidate envelope, candidate event history, and only the immutable payload parts those values reference.

```sh
node --use-env-proxy --env-file=/path/to/private-reader.env --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/ba02-replay.mts --capture-priors
node --use-env-proxy --env-file=/path/to/private-reader.env --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/ba02-replay.mts --capture-geography
```

The captures are written to `.scratch/ba02-production/<state>.json` and `<state>-geography.json`. The checked-in replay report records each prior and geography capture's SHA-256, observation time and production version, plus the exact changed input hash. It also records the publication-history capture's SHA-256, time and production identity.

The runner's publication history is in the separate control-plane project `withered-sunset-39821877`, production branch `br-tiny-frog-aeufpjeq`. Read it with the connected Neon `run_sql` tool, explicitly naming that project and branch. This query returns metadata only; it changes no rows:

```sql
SELECT DISTINCT ON (log_key)
  log_key, recorded_at, record->'ballotPublication' AS publication
FROM cp_log_owner_digests
WHERE log_key IN (
  'ballot-publication:AK', 'ballot-publication:AZ', 'ballot-publication:CO',
  'ballot-publication:FL', 'ballot-publication:ID', 'ballot-publication:KS',
  'ballot-publication:MO', 'ballot-publication:MT', 'ballot-publication:NM',
  'ballot-publication:WY', 'ballot-publication:MP', 'ballot-publication:SC',
  'ballot-publication:AS', 'ballot-publication:GU', 'ballot-publication:PR'
)
ORDER BY log_key, position DESC;
```

Save the returned rows as `.scratch/ba02-production/publication-history.json` with this wrapper, using the actual capture time:

```json
{
  "capturedAt": "<actual UTC capture time>",
  "production": {
    "projectId": "withered-sunset-39821877",
    "branchId": "br-tiny-frog-aeufpjeq",
    "sql": "SELECT ONLY"
  },
  "rows": ["<the returned objects, without this placeholder string>"]
}
```

Commit the changed state inputs before the strict replay: the production scheduler uses committed Git blob IDs from its clean checkout. Run from the revision being checked:

```sh
NODE_ENV=production node --use-env-proxy --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/ba02-replay.mts
WTP_CHROMIUM_EXECUTABLE=/usr/bin/chromium node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/ba02-page-check.mts
```

The first command replays the ordinary assembler, promoted reader, actual `/ballot` route and React pick controls. It compares changed input admission against the real production publication history. A controlled clock then checks tomorrow's registered daily cadence, unchanged-input retention, and an identical ordinary publisher rerun and page result. The second command opens the route's materialized HTML with compiled application CSS at desktop and phone widths; all external requests and reader writes are blocked. Its screenshots are local replay evidence. They do not claim the branch is deployed or that client event handlers have been hydrated.

Question counts in this replay describe exact saved wording reaching the cards. Qualification of each underlying source against BA-02's sample-ballot, certified-list or retention-statute requirement is a separate evidence check; delivery alone does not establish READY.

River owns the post-release checks on `meanwhileusa.com`. The replay moves BA-01's official source acquisition through BA-02's enrichment and ordinary publication to `/ballot` and My Picks.
