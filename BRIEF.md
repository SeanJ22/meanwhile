# Official polling-place doors for Montana, Rhode Island and Wisconsin (Sean's order, Oct 29 ~9 PM ET)

Sean: "Montana, Rhode Island and Wisconsin voting sites are still blocked by Cloudflare on the state sites. Find another way.
Don't try to get past Cloudflare's bot check. Go to the people who run the polls: Montana's counties, Rhode Island's cities
and towns, and Wisconsin's municipal clerks publish their own polling place and early voting lists, mostly on .gov sites.
Start with the counties and towns that cover the most voters in each state and work down. Also check whether the Wisconsin
Elections Commission publishes polling places through the state's GIS data hub. Add these as doors so they go live as data.
Stop when every county or town in the three states has its sites, or a named reason why not."
Election Day is Nov 3, 2026. Read CLAUDE.md, docs/rulings.md (never edit it; §2 and §3 matter here) and docs/how-it-works.md.

## How doors work (repo: /home/user/meanwhile; use a read-only worktree of origin/river-next-153)
- The daily state job `scripts/fetch-voting-sites.mts --state=<ST> --promote` reads every registered door for the state FIRST
  (`registeredVotingSourceDoors`, lib/ballot/voting-source-publication.ts), before walking the state site Cloudflare blocks.
- A door is a control-plane `cp_doors` row of kind `official-voting-source` whose `config.votingSource` is a JSON
  `VotingSourceDoor` (lib/ballot/voting-source-types.ts:58) and `config.votingState_<ST>` = true. The row is built by
  `saveVotingSourceDoor` -> `checkDoorDraft` + `applyDerivedRow` (lib/doors/registry.ts, lib/doors/page-doors.ts).
- Look at real working doors for the right `shape`, `covers`, `scope`, `matchingUnit`, `delegation`, `extraction`, `electionPageUrl`
  and `electionAssociationVerified` values: e.g. read-only SQL on the control plane (Neon MCP run_sql, project
  withered-sunset-39821877): `SELECT id, value->'config'->>'votingSource' FROM cp_doors WHERE value->>'kind'='official-voting-source'
  AND value->>'status'='OPEN' AND (value->>'lastSuccessAt') IS NOT NULL LIMIT 20` — pick county/town-level HTML, PDF and ArcGIS examples
  from other states. Never write to any database. Never print or copy credentials.
- Prove each door parses: run the repo's own voting-source reader on the live public page locally with NO database writes
  (find the read path used by `acquire()` in scripts/fetch-voting-sites.mts and the readers under lib/ballot/; call it directly
  in a small scratch script, or use an existing test harness). A door counts only if the reader extracts this election's sites
  (name + address, and hours/dates for early voting where the page has them) for its jurisdiction.

## Rules
- Official sources only: the county/city/town/municipal clerk's own site (usually .gov, sometimes .us/.org/.com run by that
  government — record why it is official), or the state's own GIS hub. No Cloudflare/bot-check workaround, no browser to get past
  a challenge, no third-party aggregator as the source. If a site answers 403/challenge, record it as the reason and move on.
- Coverage order: biggest voter populations first (use held population/registration data or Census counts), then work down.
- For every county/town you do NOT add a door for, give a named reason: "no polling-place list published", "list is a scanned
  image the reader cannot parse", "site blocked (403/challenge)", "single polling place at <address> published only in a PDF notice"
  (still a door if the reader parses it), etc.
- Do not change repo code. If the reader fails on a common page shape that would unlock many towns, describe the exact gap
  (shape, example URLs, what fails, file:line) in your report instead of patching it.

## Output (write files, River inserts them)
- Directory: /home/user/doors-voting/<ST>/
  - `doors.json`: an array of VotingSourceDoor objects, each one proven to parse (include in each: url, publisher, shape, covers,
    scope {ocdId, name, state}, electionDate "2026-11-03", electionPageUrl, electionAssociationVerified, matchingUnit, extraction as
    needed, and `discoveredFrom` = how you found it).
  - `coverage.csv`: one row per county (MT) / city-town (RI) / municipality (WI, at least every municipality you reached; list the
    rest as not yet reached with population): name, ocdId, population, door url or blank, sites parsed (count), reason if none.
  - `report.md`: what you covered, counts, the sources used, blocked sites, reader gaps.
- Write doors.json incrementally (biggest places first) so River can insert early batches; append, never rewrite earlier entries.
