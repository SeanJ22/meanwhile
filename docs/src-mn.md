# Federal money sources

SRC-MN registers one national routine contract for each source. The standing runner admits them independently of Sends or paid acquisition. It publishes each state's acquired pages immediately, retains unmatched native rows, and saves a continuation in that state's existing civic-data pointer. The runner's existing minute sweep copies new state pointers to readers while source children are still working. A national marker reports loaded, joined and unjoined rows per state without carrying the country's records. Pending backfill resumes at the next admission; an actual later failure uses the source retry clock.

| Source | Acquisition | Refresh |
| --- | --- | --- |
| USAspending | Source-discovered earliest transaction date, then annual state transaction extracts for grants, contracts and loans; recipient and performance queries are deduplicated by transaction ID | Nightly provider refresh; daily check |
| Federal Audit Clearinghouse | Paged general reports, findings, findings text, corrective action plans and additional UEIs joined by report ID; historical 1998–2015 official archives | Daily accepted/revised submissions and findings |
| SAM.gov | Public state extracts for registered and unregistered entities; bulk avoids the entity search result-window ceiling | Daily live entity updates |
| OpenFEMA | Paged DisasterDeclarationsSummaries for every state and territory | Every twenty minutes, matching the official catalog's `R/PT20M` |

Provider documentation and exact fixture provenance are in [the fixture metadata](../tests/fixtures/federal-money/provenance.json). Requests honor Retry-After on rate limits and failures. DATA_GOV_API_KEY reads FAC, and SAM_GOV_API_KEY reads SAM. Neither secret enters saved response URLs, facts or reader output.

Recipient bindings use held UEIs, Census government IDs, NCES IDs or OCD IDs. FAC child records inherit their recipient *binding* through the source's report ID without changing their original source UEI field. Geographic reach uses exact Census GEOIDs/FIPS and stays separate from recipient identity. A registration address does not establish a government's territory. An unmatched row stays held with its reason. Source failures preserve the previous good facts and record the actual reason on that state's source door.

Incremental checks overlap the preceding pass's start time, so source updates arriving during pagination or historical backfill remain eligible for the next check. A bounded work slice retains each unvisited state's durable counts and cursor.

An initial empty or pending page saves its acquisition checkpoint as metadata while keeping the fact count at zero. The validator receives the actual metadata member, and no absence is asserted. Optional cursor fields are normalized to their durable JSON shape before hashing.

The reader publishes proven source pointers in separate state artifacts. Government and district cards collect their source contributions into the card's single bottom Sources list. Ask receives the same source facts and has deterministic sourced answers for federal money, audit, registration and disaster questions. Missing sources and unfinished backfills remain visible.

No database columns or migrations are introduced. The existing civic-data candidate, promotion, confirmation and operational door JSON columns retain their classifications in `lib/db/identity-domains.ts`.

Workspace validation uses an exact live OpenFEMA response, official USAspending/SAM response examples, and FAC's published rollup output. FAC general/findings API samples remain unavailable; their transport and relational tests are explicitly synthetic. Documentation examples never seed current production facts. All four direct source transports, production loading and Git remote access remain unverified from this workspace. Automatic approval review rejected the direct source/Git network access check.

The live-site and production checks under DONE run after River releases, by Sean's oversight session.

DONE: report rows loaded per state, rows joined and unjoined, and three live examples on meanwhileusa.com in three different states.
