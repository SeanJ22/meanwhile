# Release 3 live check

- **Merged:** #709 at 22:03:42Z as 6af6f8a. Its tree is identical to tested river 13d29c5, and river is fast-forwarded to 6af6f8a. **CI:** run 37377643973 passed every job (admission, verify, build default and standalone, test 1-4, gates). The earlier run 37377627379 was cancelled by the concurrency group; see the PR comment.
- **Deployed:** `/api/build` reported 6af6f8a at 22:06:05Z. **Post-deploy integrity:** run 37380007629 succeeded (reused by `river.mjs observe`, not dispatched).
- **Runner adoption:** adopted. At 22:39Z the heartbeat read testedSha and effectiveExecutableSha 6af6f8a, with a cycle started 22:34:59Z. No supervisor pass had finished on 6af6f8a yet: the last two on ecf4026 reported 25 failures (21:55Z) and 530 (22:34Z).
- **Browser:** Playwright with Chromium pinned to the agent-proxy CA through its SPKI (`--ignore-certificate-errors-spki-list`, which trusts only that CA). Public pages only, no Admin sign-in. The basemap is unavailable here (api.maptiler.com is blocked in this environment).

| Step | State | Evidence |
|---|---|---|
| FE-39 | **Checked live** (failed in release 1) | https://meanwhileusa.com/ welcome card: "Start where you live … Any U.S. zip works", with no named places. "OR START WITH ONE OF THESE: Tucson, AZ / …" is gone (3-live/fe39-home.png). |
| CA-30 | **Checked live** (failed in release 1) | Ask at 85701, "What does a NO vote on Proposition 425 mean?": the answer card quotes the stored line "NO: A 'NO' vote shall have the effect of not allowing Pima County to adjust its 1979-80 base expenditure limit.", sources Pima County ballot language (3-live/ca30.png). /ballot?zip=85701 Prop 425 shows a YES line and a NO line (3-live/ballot-85701.png). |
| CA-51 | **Checked live** (failed in release 1) | Ask at 07866, "Who is running for Morris County Board of County Commissioners?": "On your ballot for the 2026 General Election on November 3rd, 2026, Member of the Board of County Commissioners: Tayfun SELEN (Republican) and Christopher (Chris) RUSSO (Democratic)." This matches /ballot (3-live/ca51.png). |
| reader-edge-publication-return | Deployed; runner side waits for adoption | Check the runner log/supervisor names its store after adoption. |
| Other 35 steps | Deployed; not yet screen-checked | Admin screens (BR-14, BR-23, BR-25, …) need Sean's Google sign-in; runner-side steps wait for adoption. |
