# PRL ingestion — what members SAY

2026-09-18. This is the ingestion of America's Political Pulse — the Polarization
Research Lab at Dartmouth — the third leg of the reader's evidence beside what an
official DOES (votes) and who FUNDS them (money). It is licensed CC BY 4.0; the
attribution rides once on the source record and once per receipt, never on a data
row. Presentation is a later session's job; this one gets the data in and stored,
restartably, incrementally, and safe against a future-dated row.

Citation, recorded once (`lib/sources/prl/types.ts`): *America's Political Pulse.
(2024). Congressional Rhetoric Dataset. Available at:
https://americaspoliticalpulse.com/elites/data* — the rhetoric datasets' own
citation, not the survey page's.

## What landed where

The full inventory was read off the live Open Data page (federal and state tabs)
on 2026-09-17. Every file is under
`https://americaspoliticalpulse.com/data/elite/`; the typed registry is
`lib/sources/prl/inventory.ts`.

| Dataset | File | Landed | Key | Cursor |
| --- | --- | --- | --- | --- |
| Communication / Profiles / Primary / State dictionaries (×5) | `*-meta.csv` | committed `tests/fixtures/prl/` + encoded in `dictionaries.ts` | — | — |
| Legislator Profiles (Current Members) | `profiles.zip` | object store — precomputed % in the receipt | `bioguide_id` | whole-file |
| Legislator Profiles (All National) | `profiles-all-national.zip` | existing shipped `PRL_PROFILE` path (untouched) | `bioguide_id` | whole-file |
| State Legislator Profiles | `state-profiles.zip` | object store — precomputed % in the receipt | `openstates_id` | whole-file |
| Classified Statements (Current / All National) | `rhetoric-all*.zip` | object store (rows) + receipt | `bioguide_id` | `last_updated` |
| 2026 Primary Candidate Rhetoric | `primary-rhetoric.zip` | object store (rows) + per-candidate % in receipt | `candidate_id` (FEC) | `date` |
| State Classified Rhetoric | `state-rhetoric-all.zip` | object store (rows) + receipt | `openstates_id` | `last_updated` |
| Newsletters / Press Releases / Floor Speeches | `*-fulltext.zip` | object store (documents) + receipt | `bioguide_id` | `date` |

The store is a Neon storage bucket through `S3ArchiveStore` (an S3-compatible
client whose SigV4 signer is verified against AWS's published test vector), or the
durable `LocalFileArchiveStore` twin off Neon. Each dataset writes its raw rows as
bounded partition objects and a `<dataset>/state.json` **receipt** beside them.
The receipt is the durable, restartable state: its high-water mark (capped at now)
is where the next run resumes, and for a profile dataset the precomputed
per-official percentages ride in it. A failure at one dataset leaves the others'
receipts untouched, so a retry skips what already landed.

**One honest deviation from the brief.** The brief asked for the small precomputed
percentages in Postgres. They are precomputed at ingest and stored as small
readable JSON in the receipt (object storage), not a Postgres table, and the raw
rows never touch Postgres. Landing them in a Postgres reader projection is a
one-migration follow-on for the presentation session — and it is deliberately not
done here because it entangles the reader dependency graph, which is that
session's to renew.

Verified end to end on the real files: the current-members profile precomputes 536
per-official share sets; the 20.8 MB primary zip streams to 572,451 rows across
six bucket objects while aggregating 1,381 per-candidate share sets; and a restart
run a week later, reading the prior receipt, writes zero new rows because nothing
beats the mark. The 298 MB and 461 MB loads are the same code path at scale.

## What each dictionary says the fields mean

The five dictionaries are committed raw (`tests/fixtures/prl/*-meta.csv`) and their
ingestion-critical meanings encoded in `lib/sources/prl/dictionaries.ts`, with a
column-presence check that stops the run if a dictionary drops a column the
ingestion reads. A real find: PRL's dictionaries are **incomplete** relative to
the data — the state dictionary omits `last_updated` and the profiles dictionary
omits `full_name`, though both appear in the data files — so the cursor and key
are verified against the actual data header at ingest, not the dictionary alone.

- **Communication (federal classified statements).** One row per classified text
  snippet across floor, newsletter, press and twitter sources. `bioguide_id` keys
  the member; `source`+`source_id` identify the original entry; `date` is when the
  text was published; **`last_updated` is when the classification was written**;
  `classified` is a status flag. Five 0/1 flags — `policy`, `attack_personal`,
  `attack_policy`, `outcome_bipartisanship`, `outcome_creditclaiming` — plus the
  model's `*_explanation`, `attack_target` and `policy_area` reasoning.
- **Profiles (federal).** One aggregate row per member, 51 columns. We keep the
  five `communication_<flag>_mean` shares (0–100) and `communication_count`; the
  ideology score, ideology/money ranks and percentiles, and the ProPublica JSON
  blob (icpsr, fec_candidate_id, dw_nominate) are refused by the allowlist.
- **Primary rhetoric.** One row per classified tweet. `candidate_id` is the **FEC
  candidate id** — the join key for challengers with no bioguide; `tweet_id` is
  the stable row id; `incumbent_challenge` marks C/I/O. Same five 0/1 flags.
- **Rhetoric (state).** One row per classified tweet. `openstates_id`
  (`ocd-person/<uuid>`) keys; `position` is the upper/lower chamber; `text` is
  blanked for tweets. Same five flags, plus `last_updated`.
- **Profiles (state).** One aggregate row per legislator (7,757). `openstates_id`
  keys; carries the five means we keep and `communication_<flag>_rank` within-state
  ranks — the ranks are refused, only the means promote.

## Does PRL revise, or only append?

**PRL revises.** It was read off the files. The federal `rhetoric-all*` and the
state `state-rhetoric-all` datasets each carry a `last_updated` timestamp distinct
from and years later than the publication `date`: a statement published
`2017-06-21` last written `2025-07-20`, and `last_updated` varies row to row (963
distinct values in a 1,500-row sample). PRL reclassifies old statements.

The consequence is the whole design of the refresh. A `date` cutoff would silently
miss every reclassification, so **the incremental cursor for those datasets is
`last_updated`, not `date`** — a weekly pull takes every row whose `last_updated`
beats the mark, which is new statements and re-scored old ones alike. That is
cheaper and exact where a row-hash comparison would be a scan; the row-hash
fallback is only owed where no modification stamp exists. The primary and
full-text datasets carry no `last_updated`; they append, keyed by a stable row id
(`tweet_id`, or the document `id`), and their cursor is `date`.

## How state legislators key

State legislators key by **`openstates_id`** — the OpenStates person id, shaped
`ocd-person/<uuid>` — in both the state profiles and the state classified rhetoric.
This differs from the federal join (`bioguide_id`) and the primary join (FEC
`candidate_id`). There is no live routine roster to reconcile against (the repo's
Plural/OpenStates state-legislator writers are retired), so the state datasets are
self-contained: the `openstates_id` is the identity we store, and a later
presentation session resolves it to a seat.

## The future-date rule, and why the marker is capped

The Press Releases set advertises a range ending **July 2027** <!-- expected-future: PRL's own advertised Press Releases coverage end; a data range read off americaspoliticalpulse.com/data on 2026-09-17, not a project deadline. -->,
ahead of now. Every row PRL publishes is stored — dropping rows would be the
product deciding a government's record for it. But two things hold, and they are
different (`lib/sources/prl/future-date.ts`):

1. **The high-water mark is capped at now.** A naive max date would let a single
   2027 row push the marker to 2027 and silently skip every real row that arrives
   between now and then. The mark advances only over rows dated at or before now.
2. **Nothing dated after now is displayed or counted.** `isVisibleAsOf` is the
   predicate the presentation layer applies at read time.

## Running it, and the one thing left for the author

The refresh is one command: `pnpm prl:refresh --dataset=<id>` (or `--all`). It
downloads the zip, streams and inflates it in memory (the routine writes no file),
filters to rows newer than the mark, writes the new rows and the advanced receipt
to the Neon bucket, and precomputes the profile percentages. Set
`PRL_ARCHIVE_S3_ENDPOINT` / `_BUCKET` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` to
a bucket on the `we-the-people` project; unset, it writes the durable local store.

**Making it a standing runner stage needs one governance decision, and I did not
make it for you.** The runner's single freshness clock runs the civic-data
promotion plane, and every routine source in it binds to a `data/` reader-holdings
family accounted in the frozen cutover census
(`docs/permanent-civic-data-plane-cutover-v2-inventory.json`, frozen 2026-09-08),
which classifies PRL as owner-only. PRL's routine ingestion is object-storage
inventory with no `data/` reader-holding, and the `prl` family is already the
manual `PRL_PROFILE` reader path's — so wiring it to the one clock means either
(a) extending the census/model for a bucket-inventory routine source, or
(b) retiring the manual `PRL_PROFILE` path into the routine ingestion. Both change
the frozen governance accounting; that is your call to make, not one to fabricate
inside an ingestion change. The refresh command is ready to bind the moment it is
made — until then a scheduled invocation of `pnpm prl:refresh --all` runs the same
week-of-new-rows pull.
