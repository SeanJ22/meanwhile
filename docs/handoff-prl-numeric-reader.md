# PRL numeric Reader handoff — 2026-09-28

`lib/sources/prl/snapshot.ts` projects only the promoted `PRL_PROFILE` snapshot after the existing exact Bioguide join (`congress:<Bioguide>`). The existing `/api/profile/[subject]` route returns `{ profile: PrlReaderProfile | null }`; no route or acquisition behavior changed.

`PrlReaderProfile` retains `subjectId`, `bioguideId`, `statementCount`, `measuredAt`, `readAt`, `categories[].sentence`, `attribution`, and `sourceUrl`. It now also carries:

- `shares: Record<PrlCategoryKey, number | null>` with exactly `policy`, `attack-policy`, `attack-personal`, `creditclaiming`, and `bipartisanship`. These are PRL's published 0–100 means. Missing, nonnumeric, nonfinite, or out-of-range values become `null`; they are never calculated from prose or `statementCount`.
- `categories: { id: PrlCategoryKey; share: number; sentence: string }[]`. An entry exists only for a valid numeric share and its existing attributed sentence. `share` is that source value, without rescaling or rounding. Older sentence rendering remains valid.
- `retrievedAt`, equal to the snapshot's `fetchedAt`; `readAt` is retained for old clients.
- `communicationSources`, copied from nonblank literal `profile.sources` labels. A label of `"all"` does not prove any particular statement platform or a complete feed.

The tracked deterministic fixture has 536 exact Bioguide profiles, all with positive `statementCount` and five numeric shares (2,680 values). Its profiles all say `measuredAt: 2026-08-16`; the snapshot says `fetchedAt: 2026-08-19T15:24:21.701Z`, and every source label is `"all"`. This describes the fixture, not today's production holding or a statement-feed denominator. The statement counts range from 4 to 61,624, but PRL's share means do not consistently equal category count divided by `statementCount`, so no chart should treat that count as the shares' denominator.

R2 recent-statement availability is **unverified**. This checkout holds only `data/prl/prl-profiles.json`, not archive rows or a per-subject statement index; its archive S3 configuration is absent. `lib/sources/prl/archive-store.ts` defines object-store access and `receipt.ts` defines per-dataset row/object-key receipts, but neither proves production rows or which original URL/text/category fields were held. A recent-statements UI must keep its feed unproved until an authorized read-only production inventory establishes exact subject coverage and a bounded source-backed reader route.

Focused checks: `tests/reader-prl-delivery.test.ts` and `tests/voting-sites-prl-data-plane.test.ts` pass 10/10; targeted ESLint and diff check pass. No provider, archive, or production call was made.
