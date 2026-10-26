# Improvement batch 2 (release number set when it opens; was planned as 124)

Not opened yet. Gating on river-next-batch2 d941c6a89 since 11:42 PM EDT. Opens on 9/9 after 123 is live, unless DB-04 posts READY first.

## Lanes

| Lane | READY | What it does | From |
|---|---|---|---|
| RT-01 | c8734c5d8 (carries a13baecf8) | Lets the place-map jobs fill and refresh every state's map of which towns and ZIPs fall in which places. | Your 11:15 AM order |
| BL-02 | 5f28a6871 (carries c3fff3702) | Loads each state's current LegiScan session, and ties bill sponsors to the legislators we hold. | Your 6:05 PM batch list |
| RB-A7 | f856197dd (carries 7996ae820) | Builds each place's page ahead of time and keeps it fresh when its facts change, so a ZIP page reads one saved page. GB-01's board names reach these pages. | Your 6:05 PM batch list |
| DB-03 Admin | 7dc32db25 (carries 04681516c) | Admin loads only the screen you're looking at, and only rows that changed. | Your DB-03 Neon order |
| MD-01 docs out | 8daccccb3 | Deletes MD-01's 14 proof docs. | Your 10:05 PM order |

## What you'll see

- RB-A7, any ZIP page, such as 97204, 70112 or 85701. Now: the page is assembled on each visit. After: the same content, served from a saved page. First visits should be faster.
- RT-01: readers see nothing at first. Behind the scenes, the place map fills state by state (now 0 rows in production). That unblocks RB-A10, which makes ZIPs resolve to the right town.
- BL-02, a state legislator's page in any state with a current session. Now: bills from older sessions only, or none. After: bills from the current session, with each sponsor linked to the legislator.
- DB-03 Admin: Admin screens look the same and load the same rows. Behind the scenes they read far less.
- MD-01 docs out: readers see nothing.

## Neon GB per hour (measured in the two full hours after the runner runs it)

- DB-03 Admin: lower while Admin is open. Its replay showed each screen's first minute dropping from 10 to 16 MB down to 0.6 to 8 MB.
- RB-A7: reader page reads should drop. Page rebuilds add some writes and reads on the runner. Net unknown; I'll measure it.
- RT-01: a small increase while each state's map loads for the first time, then small monthly refreshes.
- BL-02: a small increase from LegiScan session loads.
- MD-01 docs out: none.

## What could go wrong, and how I'll know

- RB-A7: a ZIP whose page isn't built yet shows "didn't load". I'll know from the fixed set plus 20 random ZIPs in 20 states, run right after it goes live.
- RB-A7 page rebuilds read too much Neon: the hourly transfer table, broken out by job.
- RT-01: maps fail to load, or the runner runs short of memory. I'll know from the runner heartbeat memory and the place-map row count by state.
- BL-02: sponsors link to the wrong person. I'll spot-check sponsors on one bill in 3 states.
- As with 123, nothing on the runner side runs until the runner restarts on new code.

## Live report

(filled in when /api/build shows 124)
