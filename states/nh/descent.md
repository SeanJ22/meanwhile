# NH — the descent

**Walked 2026-08-26** by `pnpm descent --state nh`. RULING 169 — a walk is counted or it did not
happen. Every number below is per LEVEL, because a run total hides the level that returned nothing.

**Verdict: STOPPED** — pass 2 was still producing — 771 new link(s) — so this walk STOPPED rather than finished, and following them is the next session's resume point

| Tier | Found | Followed | Yielded | Barren | Declined | Catalogued | Candidates NEW | Candidates known |
|---|---|---|---|---|---|---|---|---|
| **State** | 2 | 2 | 2 | 0 | 0 | 2 | **53** | 0 |
| **Statewide and multi-county districts** | 55 | 33 | 13 | 20 | 22 | 13 | **105** | 20 |
| **County** | 8 | 8 | 3 | 5 | 0 | 3 | **9** | 2 |
| **Local and special districts** | 26 | 26 | 19 | 7 | 0 | 19 | **61** | 0 |
| **Town, township, borough, village, plantation, unincorporated place** | 8 | 6 | 1 | 5 | 2 | 1 | **9** | 0 |

**Totals: 99 found · 75 followed · 237 CANDIDATE bodies not already matched in the registry.** That last number is the one that says whether the descent worked; every other column measures effort.

**They are CANDIDATES and not bodies, and the distinction is load-bearing.** A candidate is a link whose text
named a governing body; confirming it is a body, resolving it to a division and giving it an id is the next
motion. Reporting this number as *bodies discovered* would be a claim about coverage this product does not
have — the partial that reconciles (RULING 100). Detection is recall-first on purpose (RULING 57): a false
positive is a row somebody reads and deletes, and a false negative is a township water authority nobody ever
hears of again.

**Tiers with no body held at all: city, other.** That is the map of what is missing.

## Why each level was declined where it was

| Tier | Reason | Count |
|---|---|---|
| multi-county | `DEPTH_LIMIT` | 21 |
| multi-county | `NOT_A_DOCUMENT` | 1 |
| minor-civil | `NOT_A_DOCUMENT` | 2 |
