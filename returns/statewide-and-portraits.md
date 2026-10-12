# Returned: statewide-and-portraits

lane: statewide-and-portraits
owner: statewide-and-portraits
writer: the statewide-and-portraits lane
check: civic-data-release-firewall
ready: SL-03 45a243b760c3ca4060bb116de5727c5e7cbc0fa1
river: db756190b7a17253216864c38d1ee0937db512ac
at: 2026-10-12T23:58:27Z
state: returned
fix_subject: fix:710f5c1a
fix: River · stream/statewide-and-portraits — civic-data-release-firewall failed for statewide-and-portraits: civic-data-release-firewall (preflight) fails on statewide-and-portraits READY 45a243b760c3 (SL-03) folded alone on river db756190b7a1: ROUTINE_ADAPTER_REACHES_MANUAL_DOOR · scripts/people-portraits-refresh.mts · people-portraits-de is cloc

## Failure

```
civic-data-release-firewall (preflight) fails on statewide-and-portraits READY 45a243b760c3 (SL-03) folded alone on river db756190b7a1: ROUTINE_ADAPTER_REACHES_MANUAL_DOOR · scripts/people-portraits-refresh.mts · people-portraits-de is clocked by the standing runner; its adapter may promote only through its registered routine door.
```

## Repair

Fix on stream/statewide-and-portraits and publish a new READY commit; River folds the new READY and clears this return when it integrates.
