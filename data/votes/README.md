# Federal vote first seeds

The federal files in this directory are bundled first-seed evidence, not live
production authority:

- `votes-snapshot.json` and `bill-summaries.json` seed `FEDERAL_ROLL_CALL`.
- `key-votes-snapshot.json` and `key-vote-positions.json` seed
  `FEDERAL_KEY_VOTE`.

Production readers first query the canonical civic-data promotion pointer. A
seed may open only when that store successfully answers that no pointer has
yet been recorded. A missing connection, read error, malformed pointer, or
invalid promotion proof fails closed and never falls back to these files.

The only production acquisition commands are `pnpm votes:fetch` and
`pnpm key-votes:positions`. Both write candidates, append outcome events, and
atomically promote GOOD versions in the production data plane; neither writes
this directory or invokes software CI/release machinery.

The reviewed key-question and roll-identity denominator is versioned in
`lib/votes/key-vote-selection-v1.ts`. Current official questions, tallies,
verification evidence, law metadata, and exact member positions are mutable
runtime facts and live only in the promoted projection after first seed.
