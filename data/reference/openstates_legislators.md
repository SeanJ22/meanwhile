# openstates_legislators.csv — source note

## Source
- **Intended source (per your URL):** https://open.pluralpolicy.com/data/ → "Legislator Data", CSV variant at
  `https://open.pluralpolicy.com/data/legislator-csv/`
- **Source actually used:** https://github.com/openstates/people — the canonical upstream YAML repository
  that the `legislator-csv` download is generated from. Linked directly from the Open States data page as the
  "YAML" distribution of the same dataset.
- **Why the substitution:** `open.pluralpolicy.com` and `data.openstates.org` are both blocked by this
  environment's network proxy. Verbatim proxy response:
  `HTTP/1.1 403 Forbidden` / `request blocked: no rule or allowlist entry allows host "open.pluralpolicy.com"`
  `HTTP/1.1 403 Forbidden` / `request blocked: no rule or allowlist entry allows host "data.openstates.org"`
  `github.com` is allowlisted, so the upstream repo was reachable.
- **THIS IS A SOURCE DIVERGENCE.** The row counts below have NOT been reconciled against the official
  `legislator-csv` bundle, because that bundle could not be fetched. Treat the two as equivalent only after
  someone verifies the counts against the packaged CSV.

## Acquisition
- Method: `git clone --depth 1 https://github.com/openstates/people.git`
- Pinned commit: `cd4335d8becbe22664e34c04ce1a2ee1920cd645`
- Commit date: 2026-08-18T20:52:56+05:30
- Fetch date: 2026-08-19
- Source format: one YAML file per person under `data/<jurisdiction>/legislature/*.yml`
- Output format: UTF-8 CSV, header row, 14 columns

## Scope selected
Only `data/<jurisdiction>/legislature/` was read. Deliberately excluded:
`retired/` (13,939 files — former members), `executive/` (204), `municipalities/` (608), `committees/`.

## Row count
- **7,976 rows** (denominator: 7,976 YAML files in the `legislature/` directories — 1:1, no file dropped, no row added)
- Of those: **7,439** state/territory/DC legislators and **537** federal (`us` = US Congress) out of 7,976 total.
  The `us` jurisdiction is retained in the file with `jurisdiction_level=federal` so it can be filtered out;
  it is not a federal *disclosure* source, so it was not dropped outright, but it is not state-level data either.
- 53 jurisdictions: 50 states + DC + PR + `us`.

## Completeness
No values were inferred, interpolated, or filled. Measured gaps in the emitted rows:
- blank `chamber`: 0 / 7,976
- blank `district`: 0 / 7,976
- blank `party`: 0 / 7,976
- records with no current legislative role: 0 / 7,976
- records with more than one concurrent current role: 0 / 7,976

## Method notes that affect trust
- "Current" role = a role of type `upper`/`lower`/`legislature` with no `end_date`, or an `end_date` on or
  after 2026-08-19. Persons carry historical roles too; across all `legislature/` files there are 13,199 role
  entries against 7,976 people, so role selection is doing real work and is the main place this normalization
  could be wrong.
- 3 role entries of type `mayor` appear inside `legislature/` directories upstream. They are excluded from
  chamber selection (not a legislative chamber). This is an upstream data-hygiene quirk, not a fetch error.
- Chamber vocabulary is Open States': `upper`, `lower`, `legislature` (unicameral — NE 49, DC 13).
- Counts reflect **seats currently filled, not seats authorized.** NH lower = 386 against 400 authorized seats;
  CA lower = 79 against 80. The shortfalls are real vacancies in the source, left as-is. Do not read these
  as an incomplete download.
- The repo is community-maintained and updated continuously; the pinned commit is the reproducibility anchor.

## License / use restrictions
- **CC0 1.0 Universal** (public domain dedication) — `LICENSE` at repo root. No attribution required, no
  restriction on redistribution or commercial use.
