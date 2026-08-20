# boarddocs_tenants.csv — source note

## ⚠ THIS FILE HAS ZERO DATA ROWS. The BoardDocs tenant base could not be enumerated at all.
The CSV contains a header row and nothing else. That is deliberate: it is an explicit empty result, not a
failed write and not a partial list dressed up as a complete one. Verify by row count — 1 line, header only.

## What BoardDocs is and why it resists enumeration
BoardDocs (Diligent) hosts board agendas at `go.boarddocs.com/{state}/{client-slug}/Board.nsf/Public`.
Unlike Legistar, tenants are **path segments on a single shared host**, not subdomains. That removes the
one enumeration method that works on subdomain-per-tenant platforms: certificate transparency logs contain
`go.boarddocs.com` once and reveal nothing about who is on it. There is no DNS surface to enumerate.

That leaves three options, all unavailable:
1. **A published client directory** — Diligent/BoardDocs does not publish one.
2. **Brute-forcing `/{state}/{slug}/`** — needs bulk outbound HTTP to a blocked host, and
   **`go.boarddocs.com` returns `ROBOTS_DISALLOWED`**, so crawling it would violate the site's own stated
   crawl policy. I did not attempt it.
3. **Crawling school-district websites and fingerprinting BoardDocs links** — needs bulk outbound HTTP.

## Size of what is missing
BoardDocs "has helped **nearly 4,000 organizations**" (Ohio School Boards Association,
https://www.ohioschoolboards.org/boarddocs). So the gap between this file and reality is on the order of
**0 / ~4,000**. Denominator for a school-focused effort: the 12,546 independent school districts from
Step 1, or the 13,299 CCD regular districts flagged `derived_census_comparable` in Step 2.

## What was tried
| Method | Result |
|---|---|
| `go.boarddocs.com/oh/` state index | WebFetch: `ROBOTS_DISALLOWED` — and no evidence such an index exists |
| `www.boarddocs.com`, `go.boarddocs.com` direct | container proxy: `403 — request blocked: no rule or allowlist entry allows host "..."` |
| Published Diligent/BoardDocs customer list | searched; none published |
| State school-board associations that resell BoardDocs (OSBA, NYSSBA, FSBA) | checked OSBA — names exactly one district, in a testimonial. No member lists published |
| `crt.sh` / `api.certspotter.com` CT logs | blocked; and structurally useless here — path-based tenancy leaves no per-tenant certificate |
| `urlscan.io`, Common Crawl, Wayback Machine | container proxy 403, all three |
| GitHub code search for BoardDocs URL lists | API restricted to repo-scoped endpoints |
| Grep of 3 cloned civic-scraper/agenda repos for `go.boarddocs.com/{st}/{slug}` | **0 matches** — none of these projects support BoardDocs |
| Census `web_address` scan (39,182 populated URLs) | **0 boarddocs.com hits** |
| CCD `website` scan (17,346 populated URLs) | **0 boarddocs.com hits** |

## The method that would work
Crawl the `website` field of the CCD LEA file — populated for **17,346 of 19,711 districts (88.0%)**, far
better than the Census file's 43.1% — fetch each district's board page, and fingerprint outbound
`go.boarddocs.com/{state}/{slug}/` links. That is a real, tractable enumeration and would likely recover
most of the ~4,000. It needs bulk outbound HTTP, which this environment does not have, and it should
respect `go.boarddocs.com`'s robots policy by fingerprinting **district** sites rather than crawling
BoardDocs itself.

**Caveat carried forward, per your instruction:** the CCD file is version `0a` preliminary. Use it as the
discovery surface only. Do not key any persistent record to CCD statuses or treat `nces_leaid` presence
there as a source of record.

## License / use restrictions
Not applicable — no data was obtained.
