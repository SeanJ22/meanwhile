# AZ — the descent

**Walked 2026-08-26** by `pnpm descent --state az`. RULING 169 — a walk is counted or it did not
happen. Every number below is per LEVEL, because a run total hides the level that returned nothing.

**Verdict: STOPPED** — pass 2 was still producing — 1143 new link(s) — so this walk STOPPED rather than finished, and following them is the next session's resume point

| Tier | Found | Followed | Yielded | Barren | Declined | Catalogued | Candidates NEW | Candidates known |
|---|---|---|---|---|---|---|---|---|
| **State** | 8 | 6 | 5 | 1 | 2 | 5 | **129** | 3 |
| **Statewide and multi-county districts** | 36 | 32 | 16 | 16 | 4 | 16 | **130** | 5 |
| **County** | 107 | 36 | 14 | 22 | 71 | 14 | **207** | 7 |
| **Local and special districts** | 9 | 9 | 4 | 5 | 0 | 4 | **16** | 0 |
| **City** | 1 | 1 | 1 | 0 | 0 | 1 | **3** | 0 |
| **Everything else the state names** | 14 | 14 | 6 | 8 | 0 | 6 | **181** | 39 |

**Totals: 175 found · 98 followed · 666 CANDIDATE bodies not already matched in the registry.** That last number is the one that says whether the descent worked; every other column measures effort.

**They are CANDIDATES and not bodies, and the distinction is load-bearing.** A candidate is a link whose text
named a governing body; confirming it is a body, resolving it to a division and giving it an id is the next
motion. Reporting this number as *bodies discovered* would be a claim about coverage this product does not
have — the partial that reconciles (RULING 100). Detection is recall-first on purpose (RULING 57): a false
positive is a row somebody reads and deletes, and a false negative is a township water authority nobody ever
hears of again.

**Tiers with no body held at all: minor-civil.** That is the map of what is missing.

## Why each level was declined where it was

| Tier | Reason | Count |
|---|---|---|
| state | `ALREADY_RECORDED` | 1 |
| state | `NOT_A_DOCUMENT` | 1 |
| county | `DEPTH_LIMIT` | 67 |
| county | `ALREADY_RECORDED` | 4 |
| multi-county | `DEPTH_LIMIT` | 3 |
| multi-county | `NOT_A_DOCUMENT` | 1 |
