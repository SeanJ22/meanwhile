# Returns that need Sean's decision

Written by FX-01 (overnight fix lane). Times are Eastern. Only Sean decides these; FX-01 has not acted on them.

## 1. Vice President: on the place page, or only in the National section? (open since release 88, 2:42 AM Oct 23)

- What happened: the Vice President (JD Vance, whitehouse.gov source) was live on every place page from about 2:08 to 2:40 AM (releases 85 to 87), under "United States" with the President and Cabinet. That met ds-01's return (vp-live-r85), so FX-01 sends ds-01 nothing more.
- Release 88 (pm-01 NX-PLACE-1/2/3) took the President, Vice President and Cabinet off every place's "Who governs here?" list on purpose and moved them to a National section that says "National government, coming soon". Nothing feeds that section yet (it waits for NX-01). Live now: ZIP 85016 lists 23 officials (was 46), no Trump, no Vance.
- Choose one:
  - (a) Keep release 88; NX-01 feeds the National section, and the Vice President comes back on /national, not on each place page.
  - (b) pm-01 keeps the President, Vice President and Cabinet on the place list until the National section has cards.
  - (c) River ships a revert of NX-PLACE-1 alone.

## 2. The planning round never reaches most states (River's open item 4)

- A full 57-state planning round takes hours (ak about 18 minutes, al about 20), and each release restarts it, so the latest line reads "2 states completed, 55 failed" (2:51 AM). The same first states (ak, al, ar, as) repeat.
- This is a design question, not a code defect in one lane: should a round resume where the last one stopped after a release, rotate its start state, or run states in parallel? FX-01 has not changed it.

## 3. Official voting pages that carry key-like tokens (open, raised ~12:10 PM Oct 23 by VS-07-FX)

- What happens: when a live official page contains something that looks like an API key or token, the evidence store classes the capture as restricted. There is no encrypted evidence storage for restricted captures, so the page is held and the sites it lists do not publish.
- What readers miss today: Wheeling, IL (ZIP 60090 shows 0 voting sites), the Cochise County, AZ voter page, and El Paso County, TX's 39 early-voting and 123 Election Day sites.
- Choose one:
  - (a) Turn on encrypted evidence storage for restricted captures (needs a key and storage setting only Sean can provide), so the original page is kept privately and its sites publish.
  - (b) Approve publishing from a cleaned copy: the token-like strings are removed before the page is saved as evidence, and the sites are verified against that copy.
  - (c) Keep holding these pages.
- FX-01 has not acted on this.
