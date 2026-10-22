# Returned: cal-01

lane: cal-01
owner: cal-01
writer: the cal-01 lane
check: civic-data-firewall
ready: CAL-01 6f7403b1b998220fc51c72430e5d5b0b8d884d89
river: cbe5ee1481879e9af0372bb611754e92c3c23a52
at: 2026-10-22T23:16:33Z
state: returned
fix_subject: fix:f99b19e5
fix: River · stream/cal-01 — civic-data-firewall failed for cal-01: Exact failure (gates83.log, tree 814f7c2b69cd = river + this READY + DS-01's NE-01 + main):

## Failure

```
CAL-01 READY 6f7403b1b (restore finding publication and nationwide calendar delivery) fails the civic-data release firewall, the first gate of `pnpm gates`, so it did not ship in release 83.

Exact failure (gates83.log, tree 814f7c2b69cd = river + this READY + DS-01's NE-01 + main):
  civic-data-release-firewall … FAIL — 1 release-coupling finding(s).
  ROUTINE_PATH_WRITES_REPOSITORY · lib/civic-data/contract-handoff.ts · A filesystem writer reachable from scripts/ingest.ts can bypass the canonical production data plane.
  preflight REFUSED in 94.68s. The expensive tier was not run on this tree.

Cause: the READY adds lib/civic-data/contract-handoff.ts, whose writeContractHandoff() does mkdtempSync + writeFileSync (a private contracts.json in the OS temp directory) so the parent can hand a child its exact contract selection (--contracts-file, --contracts-count, --contracts-sha256), and scripts/ingest.ts reaches it. The firewall (lib/civic-data/firewall.ts, the writerCode rule near line 836) has no allowlist: no routine data command may reach any filesystem writer. This is a design clash with that rule, not a flaky test, so River did not change the firewall.

To bring it back: hand the child its selection without writing a file from a routine path, for example the selection as a hashed argument or stdin, or an env value of bounded size, with the same count and sha256 checks on the child side (readContractHandoff already has them); or, if a temp file really is needed, ask Sean to approve a narrow exception to the firewall for this one file and add it with its own test. Then merge main, run `pnpm gates` locally (the firewall runs first and takes about 95 s), and send a new READY. DS-01's NE-01 ships alone in release 83; this READY clashed with DS-01's in scripts/routine-civic-data-runner.mts (acquireChildMemory) and River kept both sides, so no change is needed from you for that.
```

## Repair

Fix on stream/cal-01 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
