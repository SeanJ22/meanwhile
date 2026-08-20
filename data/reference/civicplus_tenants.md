# civicplus_tenants.csv — source note

## ⚠ This is a PARTIAL list. It is not an enumeration of CivicPlus's tenant base.
Best estimate of coverage: **~12% of CivicPlus's claimed client base.** Read the completeness section
before using this for anything.

## Source
- **Source URL:** https://github.com/biglocalnews/civic-scraper — file `docs/civicplus_sites.csv`
- **Maintainer:** Big Local News (Stanford) — the site list backing the `civic-scraper` / Agenda Watch project.
- **Fetch date:** 2026-08-19, via `git clone --depth 1`. Repo HEAD `c47916b141bdcda2397b4e35f3afbf47f7a56066`.
- **Source format:** CSV, 10 columns. **Output format:** UTF-8 CSV, 11 columns, header row.
- Not fetched from civicplus.com — that host is blocked here
  (`403 — request blocked: no rule or allowlist entry allows host "www.civicplus.com"`), and CivicPlus
  publishes no customer directory (`/customers/` returns 404).

## Method
1. Searched for any published CivicPlus customer directory — **none exists**.
2. Container-side enumeration of `*.civicplus.com` via certificate-transparency and passive-DNS services —
   all blocked (see "What was tried and failed").
3. Scanned the Step 1 and Step 2 files for CivicPlus signatures in their website columns:
   **1 hit in 39,182 populated Census `web_address` values; 0 in 17,346 populated CCD `website` values.**
   Official directories record vanity domains (`www.muscatineiowa.gov`), not platform-hosted URLs, so they
   are useless as a platform-detection surface *without* crawling and fingerprinting each site.
4. Fell back to the open-source list above, which was compiled by crawling the legacy
   `{state}-{slug}.civicplus.com` hostname pattern.

## Row count
- **1,550 rows** (denominator: 1,550 data rows in the source CSV — 1:1, none dropped, none added)
- **1,527 USA / 23 Canada.** 48 distinct US states.
- By level: 1,093 municipality, 296 county, 157 other, 3 municipality & county, 1 regional.
- 0 duplicate `portal_url`.
- All four required fields (`jurisdiction_name`, `state`, `portal_url`, `platform`) populated on all 1,550 rows.

## Completeness — how complete I believe this is, and why
**Roughly 12%, and skewed.** CivicPlus states it serves **"13,000+ local government customers"**
(https://www.civicplus.com/about-us/). 1,527 US rows ÷ 13,000 ≈ **11.7%**.

Three independent reasons this is a floor, not a census:
1. **Pattern-bound.** Every one of the 1,550 endpoints is on `*.civicplus.com`. CivicPlus's mainstream
   product puts clients on their own vanity domains (`www.cityname.gov`), which this pattern cannot see.
   The vanity-domain population is invisible to the method and is almost certainly the larger share.
2. **Stale.** `last_year_observed` is 2020 for 1,387 of 1,550 rows; only 3 rows exceed 2021. The list
   reflects a crawl from around 2020. Six years of churn — new clients, migrations, renames — is unrecorded.
   *I could not date the file precisely:* the shallow clone collapses history, so the `2026-06-18` commit
   date is the clone artifact, not the file's last substantive edit. Do not read it as a 2026 refresh.
3. **Unknown source completeness.** Big Local News does not document how the list was assembled or what
   coverage they believed it had. I am inheriting an undocumented sampling frame.

The 48-state spread and the plausible ranking (TX 128, CA 117, IL 83, OH 64, KS 62) suggest broad rather
than regionally biased sampling — but breadth is not completeness.

## What was tried and failed
| Method | Result |
|---|---|
| `crt.sh` certificate transparency | container proxy: `403 no rule or allowlist entry allows host "crt.sh"`; via WebFetch: `ROBOTS_DISALLOWED` |
| `api.certspotter.com`, `urlscan.io`, `search.censys.io` | container proxy 403, all three |
| Common Crawl index, Wayback Machine | container proxy 403, both |
| GitHub code search API | `403 — This GitHub API path is not available: sessions are bound to their configured repositories` |
| civicplus.com customer directory | 404; no such page published |
| Census `web_address` / CCD `website` signature scan | 1 hit / 39,182 and 0 / 17,346 — not a viable surface |

## Caveats
- `country`, `govt_level`, `first_year_observed`, `last_year_observed` are carried through from the source
  unmodified. No value was inferred or filled.
- 23 Canadian rows are retained and flagged in `country`, not silently dropped.
- 7 rows carry `whitelisted = FALSE` upstream; that column was not carried through and no row was excluded
  on it. Mentioned so the difference from the source file is on the record.
- URLs are **unverified.** No endpoint was fetched — all platform hosts are blocked from this environment.
  Assume a meaningful share are dead six years on.

## License / use restrictions
- Source repo is **Apache License 2.0**, © 2020 Big Local News. Permissive; redistribution allowed with
  attribution and license notice retained. Attribute Big Local News if you redistribute this list.
- The underlying facts (which government uses which vendor) are not themselves copyrightable.
