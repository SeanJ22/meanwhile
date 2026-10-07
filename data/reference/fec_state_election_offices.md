# fec_state_election_offices.csv — source note

## Source
- **Source URL:** https://www.fec.gov/introduction-campaign-finance/how-to-research-public-records/state-election-offices/
- **Publisher:** Federal Election Commission (United States).
- **What it is:** the FEC's own index of every state's election office — the authority that receives
  candidate filings in that state.
- **Columns:** jurisdiction, office, url, phone. 58 rows.

## Why this repo holds it

The NJ Hunt measured that the variable deciding whether a candidate's contact is reachable is NOT the
number of routes in the branch manifest. It is **what each state's filing authority publishes**. Morris
County's clerk publishes a filed email and a filed street address for every candidate in the county;
New Hampshire's authority publishes a name and a town. The manifest is identical in both states and the
same seven routes are mechanical in both — what differs is what two of them return.

There is no national floor for that, so the next state must be ASKED rather than assumed. This is the
national index to the question.

## Acquisition
- Fetched 2026-08-22 by `corepack pnpm fec:directories`, rung 2 (plain fetch).
- HTTP 200, 166309 bytes of HTML, parsed to 58 rows.
- **Content-checked, not merely status-checked.** The response must contain the word "election" and the
  names of the three covered states before it is parsed. A 200 whose body is not about the thing asked
  for is not that thing, and this project has been caught by that shape seven times.
- A zero-row parse exits NON-ZERO. A parser that returns nothing has told you about itself.

## Licence
- **Public domain.** A work of the United States federal government (17 U.S.C. § 105). No attribution
  obligation attaches, and none is claimed to.

## Trust caveats
- This is the page as served on the fetch date. The FEC revises it; re-run the command to refresh.
- It is an INDEX OF OFFICES, not of publishing practice. It names who the authority is; it does not say
  what that authority publishes. Answering that still requires walking the route.
