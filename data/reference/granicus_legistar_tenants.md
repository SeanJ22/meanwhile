# granicus_legistar_tenants.csv — source note

## ⚠ THIS IS NOT AN ENUMERATION. The Granicus/Legistar tenant base could not be enumerated.
39 tenant hostnames, scavenged from test fixtures and documentation in open-source scraper repos.
That is a **convenience sample of unknown and certainly negligible coverage**, not a list. It is delivered
only so the work is traceable. **Do not treat it as a tenant base, a denominator, or a sampling frame.**

## What this file actually is
Hostnames matching `*.legistar.com` that appear as examples inside three open-source projects:
- https://github.com/biglocalnews/civic-scraper (Apache-2.0) — `tests/legistar_site.py`, VCR cassettes
- https://github.com/fgregg/legistar-scrape (MIT) — scraper source and tests
- https://github.com/CouncilDataProject/cdp-scrapers (MPL-2.0) — tests and docs

Fetch date 2026-08-19, via `git clone --depth 1`.

**Row count: 39** (denominator: 39 distinct `*.legistar.com` hostnames found across those repos).
Four hostnames were excluded as non-tenants — `webapi` (the Legistar API endpoint), `bigipserverinsite`
(an F5 load-balancer hostname leaked into a cassette), and the documentation placeholders `somewhere` and
`synecdoche`. 43 raw matches − 4 = 39.

**`jurisdiction_name` and `state` are blank on all 39 rows.** The sources give only the hostname. Filling
these would mean inferring "chicago" → Chicago, IL, which is exactly the kind of guess you asked me not to
make. `client_slug` is populated on all 39 so you can resolve them yourself if you want them.

## Completeness — how complete I believe this is, and why
**Negligible, and not meaningfully quantifiable.** Granicus states it serves **"more than 7,000 public
sector organizations"** globally (https://granicus.com/about-us/) — but that spans its whole product
portfolio (govDelivery, govAccess, govMeetings, Legistar, streaming). Granicus publishes **no
Legistar-specific client count**, so there is no honest denominator to divide 39 into. What is certain is
that these 39 were selected by scraper authors as test cases, which is a sampling process with no
relationship to the population. The state skew visible in the slugs (heavily AZ, CA, AK) is an artifact of
which developers wrote which tests.

## Why enumeration failed
Legistar tenants live at `{client}.legistar.com`. Enumerating them means either subdomain discovery or
brute-forcing the API. Every avenue was closed:

| Method | Result |
|---|---|
| `crt.sh` certificate transparency (`%.legistar.com`) | container proxy: `403 — request blocked: no rule or allowlist entry allows host "crt.sh"`. Via WebFetch: `ROBOTS_DISALLOWED` |
| `api.certspotter.com` (CT log API) | container proxy `403 no rule or allowlist entry allows host "api.certspotter.com"` |
| `urlscan.io`, `search.censys.io` | container proxy 403, both |
| Common Crawl index / Wayback Machine | container proxy 403, both |
| Direct probe of `webapi.legistar.com/v1/{client}` | container proxy `403 ... allows host "webapi.legistar.com"`. Reachable via WebFetch (returns 404 at `/v1/`), but WebFetch is one URL per call and returns model-summarised text, not bytes — unusable for probing thousands of candidate slugs |
| `www.legistar.com`, `granicus.com` direct | container proxy 403, both |
| GitHub code search API (`q=legistar`) | `403 — This GitHub API path is not available: sessions are bound to their configured repositories.` Only repo-scoped endpoints work, so I could clone known repos but not search for unknown ones |
| Census `web_address` scan (39,182 populated URLs) | **0 legistar.com hits** |
| CCD `website` scan (17,346 populated URLs) | **0 legistar.com hits** |
| Published Granicus customer directory | none exists |

**The two methods that would work are both outside this environment:** (a) a certificate-transparency query
for `*.legistar.com`, which needs unrestricted network access; (b) crawling each of the 90,837 Census units'
websites and fingerprinting the HTML for Granicus markup, which needs bulk outbound HTTP. Either would
produce a real enumeration. Neither is possible from here.

## Caveats
- **No URL in this file was verified.** `legistar.com` is unreachable from this environment. Some of these
  hostnames come from test fixtures over a decade old (`legistar-scrape` is © 2013) and are likely dead.
  Note `phila` and `philly` both appear — at most one is currently live.
- Rows are traceable: `evidence_source_file` names the exact file each hostname was found in.

## License / use restrictions
- Source repos: Apache-2.0 (Big Local News), MIT (Forest Gregg / Mjumbe Poe), MPL-2.0 (Council Data Project).
  All permissive. The extracted facts — hostnames — are not copyrightable.
