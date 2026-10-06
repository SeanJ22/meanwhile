# Frontend continuation by auditors — Oct 6, 2026 (session_013XuMrjNo4YeLKPMgKjHxKc)

Lock: NOT claimed. This session's permissions refused a push to stream/frontend, so the work is on
branch `claude/sleepy-mendel-g0jfki` (built on stream/frontend ab109934d + river 8061e21). River: fold
it from there, or the next frontend run cherry-picks it onto stream/frontend.

## Failed-live returns answered (returns/frontend.md, Oct 6 2:50 AM EDT)

- FE-15 / FE-14 / FE-22 (Public statements leak, every federal member card and every candidate card):
  PRL's "Measured … Read …" line, the americaspoliticalpulse.com citation and the CC BY licence link
  left the card face. They now sit in the card's Sources row (`prlCardSource` carries the measured
  date, the citation and the licence URL; `PublicStatementsProfileContent` contributes it through
  `CardSourcesContribution`, so the battlecard gets it too, not just the official modal). The face
  keeps "N statements tracked." Reader sees: the same bars, no read date or host above Sources.
- FE-14 (ballot contest line "New Hampshire Secretary of State filing · read August 13th, 2026"):
  the in-place FilingNote panel is gone. The contest still says "Candidates as filed with <org>" /
  "Nominees per the certified primary canvass (<issuer>)" on its face; the link and read date are
  in a Sources section at the foot of each candidate contest.
- FE-14 (candidate row "… 03301 (read 2026-08-22, merrimackcounty.net)"): the phone label shows
  without its trailing "(read DATE, HOST)"; that date and host go to the row's Sources.
- Sources rows "Last checked: We're working on getting this info" under a shown read date: the
  candidate bio sources now pass the read date their label states ("…, read 2026-08-21") as Last
  checked, and the label no longer repeats it.
- FE-42 (challengers' cards stop early): "Official actions" is now always a section — the record
  when held, "We're working on getting this info" when not — so every candidate card has the same
  reading order. NOT fixed: Kris Mayes not marked Incumbent. lib/ballot/incumbency-resolve.ts
  marks INCUMBENT only when a committed candidacy/person identity matches the sourced officeholder;
  that identity link is people's (CA-15) data, not a card change.
- FE-34 (no Online only pins): the frontend path works, the cause is upstream. Live
  /api/meetings at 85701 (Oct 6 ~08:00Z): 252 meetings, 84 online-only across 15 bodies, and
  0 of 65 coverage bodies carry `officeContact` (no body.officeAddress published). groupByVenue
  pins an online sitting only at its body's published office address, so there is nothing to pin.
  Owner: whoever publishes the body directory's officeAddress (lib/civic-data/worker-body-directory.ts,
  people CA-06). Needs River routing.
- FE-28 (dead links): publishReaderLinkHealth has no production caller. Hook prepared:
  .factory/hooks/FE-28-link-sweep-publishes-reader-health.patch (bank, scripts/link-sweep.mts:
  publish after recordSweep on --apply). Also nothing runs scripts/link-sweep.mts in the runner;
  hunters' pilot-runner needs a daily `link-sweep.mts --apply` child. Neon cost: one recordSweep
  write per sweep (existing), no new control-plane reads; the publish writes one Netlify blob.

## Checks
See the READY commit message for the tested SHA and results.
