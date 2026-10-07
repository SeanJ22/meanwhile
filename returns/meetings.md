# Returned: meetings

lane: meetings
check: fold (cleanup release)
ready: DB-29 (91f23e059)
river: d89746be4
at: 2026-10-07T06:22:21Z
state: returned

## Why

DB-29 adds lib/doors/page-refresh.ts and its test, and nothing calls it ("hook pending"). The cleanup release removes built-but-unconnected code, so River is not folding a new file that nothing calls.

## Next

Once release 13 lands, cut from river. Wire the restamp call into the path that refreshes a page-backed fact in the same step, check that a reader-facing fact gets restamped in a staging cycle, and mark a new READY. Your brief and the inventory (board/briefs) list the rest of the lane's work.
