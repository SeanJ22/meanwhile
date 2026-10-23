# SAM daily quota and Admin connection

The production read-only request recorded in [sam-read-only.json](sam-read-only.json) answered `900804`, with reset `2026-10-24T00:00:00Z` (October 23, 8 PM Eastern). No additional real SAM calls were made during this quota hold.

`request()` checks the shared evidence-store hold before every SAM HTTP call. A quota answer on HTTP 429, 200 or 202 saves only its original observation and reset, then exits before retry sleep or polling. The reset is the later of the next UTC quota day, `nextAccessTime`, the description's timestamp and `Retry-After`. Saved quota bytes, private keys and download tokens are excluded from source captures. A successful HTTP response carrying a quota notice is removed from temporary extract state so it cannot reassert yesterday's hold after reset.

The feeding step is SAM's acquisition request/control-response parser. The downstream step is the existing Admin reliability API and Workers source-reliability card. Both acquisition and Admin read the same shared evidence key. Existing registered source-outage recording preserves last verified reader facts and includes the reset in the saved failure reason.

Focused tests prove:

- The first quota answer makes one request and zero retry sleeps. Later state acquisitions, fresh durable-store instances and a separate Node process make zero more calls before reset.
- A quota response on the POST extract-download path stops pending polls immediately.
- An earlier advertised time cannot cause a same-quota-day retry; later publisher times win. Requests resume exactly at reset. The original observation remains available for Admin.
- The full refresh across CT, DE and FL makes only the first request, saves each state's outage with its reset and makes zero calls on a later invocation before reset. The actual Admin command center displays “Waiting for daily reset” and “reset Oct 23, 8:00 PM ET”; at reset it displays “Reset time passed.” Unknown request history is not counted as zero.

All 85 focused checks passed across quota, providers, continuation, extract refresh, general refresh, reliability and the Workers UI. TypeScript, focused ESLint and whitespace checks passed. These use local stores and intercepted requests, and do not claim SAM entity publication from real data.

The [browser measurement](sam-quota-admin.json) feeds the actual saved quota response through the production quota helper and actual command center. It uses a controlled observation clock, real Admin module CSS and system Chromium in place of the unavailable pinned build. The source status appears in 473 ms at 1280 px and 391 ms at 390 px, with no page errors. These are local functional timings. The first browser harness served HTML for unrelated API routes and caused an alert-panel error; returning an explicit unavailable response corrected that harness defect, with no product change. Screenshots: [desktop](sam-quota-admin-1280.png), [phone](sam-quota-admin-390.png).

The enabled follow-up starts after 8 PM Eastern. It must honor any later saved reset, then replay real SAM acquisition → registered publication → public reader/card and the next daily admission. On success it records the proofs on River's board; on a code defect it fixes and pushes another READY. SAM's real-data publication and live post-shipping scheduled promotion remain open until those observations exist.
