# Returned: ballot-parity

lane: ballot-parity
owner: ballot-parity
writer: the ballot-parity lane
check: release 93 live check: /ballot lost election dates and offices in every state
ready: no step ids unknown
river: dfae00f3c70444f06c95adf66c89c9b4e818827d
at: 2026-10-23T19:43:14Z
state: returned
fix_subject: fix:f4d8286a
fix: River · stream/ballot-parity — release 93 live check: /ballot lost election dates and offices in every state failed for ballot-parity: What failed: every /ballot page lost its election dates and election offices. BL-21-FX deleted the built-in ELECTION_DATES table and the national navigation read; lib/ballot/election-dates.ts:18 electionDatesFor(state, projection, electionD

## Failure

```
Release 93 live check (BL-21-FX, ballot-parity-fx READY 41f20be9a), Oct 23, 3:39 to 3:55 PM EDT. /api/build shows 3fc035eeb (release 93) from 3:39 PM EDT; the runner moved to it at 19:37 UTC.

What failed: every /ballot page lost its election dates and election offices. BL-21-FX deleted the built-in ELECTION_DATES table and the national navigation read; lib/ballot/election-dates.ts:18 electionDatesFor(state, projection, electionDay) now returns only what the state's own navigation record holds, and app/ballot/page.tsx:522-528 reads only the per-state pointer (stateAuthorityPointers("ballot-navigation", ST)). No state has that pointer yet, so every card renders empty.

What I saw on meanwhileusa.com:
- /ballot?zip=85003 (Phoenix): on release 90 (saved 12:44 PM EDT) the page showed "The next election: November 3rd, 2026" with 12 dated steps (data-dated-event). On release 93 it shows 0 dated steps, no Election Day line, and "AZ voting information · Still gathering: election office, voter registration, registration status, sample-ballot lookup, voter registration deadlines, mail-ballot request deadlines, early voting deadlines."
- /ballot?zip=85653 (Marana): the same empty AZ card; none of the three phone lines the READY promised (602-542-8683, 520-724-4330, 520-382-1961) appear anywhere on the page; 0 data-ballot-election-offices.
- The same empty card ("Still gathering", 0 offices, 0 links, 0 dated steps) in 16 ZIPs: AZ 85653 and 85701, CA 90012, TX 78701, FL 33130, NY 10007, PA 19147, NC 28203, GA 30303, OH 43215, MI 48226, WA 98101, CO 80202, WI 53703, MN 55401, NH 03301, DC 20001.
- The runner on 3fc035eeb has not published any per-state ballot-navigation record: the navigation worker-publication tasks are deferred ("Waiting for a worker slot", "Next pass will continue the source read"), and the runner is starved (returns/rn-01.md). Your proof b ("51 due on the next pass") ran against a controlled clock, not this runner.

Why it is a failure, not a wait: a release must not take away what readers already have. Before the state's own record exists, the page has to keep showing what it showed before (the dates table and the national pointer's offices and links), or the state publications have to exist before the reader switches to them.

What passing looks like: on the live site, before and after the runner's first navigation pass, /ballot?zip=85003 keeps "The next election: November 3rd, 2026" and its dated deadlines; 85653 shows the AZ card with the three office lines; every state in a 10+ state sample keeps its Election Day line and deadlines, with no "Still gathering" for anything release 92 showed. Merge river (release 93, 3fc035eeb) into your branch and post a new READY with both proofs, the proof of continuity taken on the production runner's real state (no per-state pointer yet).
```

## Repair

Fix on stream/ballot-parity and publish a new READY commit; River folds the new READY and clears this return when it integrates.

## Sean's condition (Oct 23, 8:50 PM EDT) and the revert

Release 93 was reverted (release 94, live 9:11 PM EDT; pages back as on release 92). Sean: "BL-21-FX stays returned until readers keep the old dates and offices until each state's own record is published." A new READY folds only with proof, on the production runner's real state (no per-state navigation pointer yet), that /ballot keeps: the next election date and deadlines where release 92 showed them (AZ, NH, NJ; e.g. 85003 Phoenix 12 deadlines, 07102 Newark 16, 03301 Concord 6), the state election-office line in every state (e.g. 19147 PA 717/787-5280, 98101 WA 800/448-4881), and Marana 85653's "Your election offices" (Pima County Recorder 520-724-4330, Town Clerk (520) 382-1961); and that each state switches to its own record only once that record is published.
