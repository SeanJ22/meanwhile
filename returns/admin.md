# Returned: admin

lane: admin
check: fold (cleanup release)
ready: BR-04 BR-07 BR-11 BR-12 BR-13 BR-16 BR-17 BR-18 BR-20 BR-26 BR-27 BR-28 BR-29 BR-31 BR-35 BR-36 BR-39 (734ee9633)
river: d89746be4
at: 2026-10-07T06:22:21Z
state: returned

## Why

734ee9633 changes 144 files, and many of them are deleted in the cleanup release under the inventory. That includes the admin-v6 decision orders, order-when and sample/world, the admin checklist-definitions, decision, deploy-preview, public-reader-observation, runner-progress and work-progress routes, the v6 alerts, brief, daily-brief, decisions and reader-problems routes, admin-view brief, brief-route, cost-reporting and cost-reporting-view, and data/feedback/sweeps. It can't fold over those deletions.

## Next

Once release 13 lands, cut a fresh branch from river. Redo only the steps whose files survive the inventory (board/briefs: inventory CSV and briefs/admin.md), and mark a new READY. Don't recreate any deleted file.
