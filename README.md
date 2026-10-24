# board/river

River's coordination branch. Only River writes it.

- `authorization.md`: Sean's launch authorization, with its time.
- `status.md`: River's status and lock.
- `assignments.md`: lane assignments, handoffs and priorities.
- `returns/<lane>.md`: failures sent back to a lane.
- `releases/`: release records.
- `integration.md`: ready SHAs folded into river.

## Release steps (every River session)

1. Gates pass on the exact river SHA (`pnpm gates`), river promoted, `river.mjs release <n>` opens `release/<n>`.
2. **Preview check before auto-merge (Sean, Oct 24, standing):** load the release's Netlify deploy preview (`https://deploy-preview-<PR>--sparkwtp.netlify.app`) against the production database and check, like a reader in Chrome:
   - `/ballot?zip=85701` and `/ballot?zip=03255`
   - `/api/meetings?zip=85701` and `/api/meetings?zip=60602`
   - one Ask question
   - `/national`
   If any errors or shows "This page didn't load", do not merge: fix it, or drop the lane that broke it.
3. Only then turn on auto-merge.
4. **If the preview cannot reach the production database:** run the same checks on the live site within 5 minutes of the release going live (`/api/build` shows its merge commit). If any fail, publish the previous good deploy in Netlify and post what happened in `status.md`.
5. Then the lanes' live checks (counts by state, Eastern time) in `status.md`.
