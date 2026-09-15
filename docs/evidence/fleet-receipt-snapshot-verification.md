# Historical receipt transport verification

Base `e1140c784325a92e531e70ae3bb9683c11f07dcb`, isolated fleet clone and local
repair branch described in `../fleet-receipt-snapshot-handoff.md`.

Implemented: bounded historical receipt cache composed into the existing owner
snapshot, read by the shared Fleet service and real guarded HTTP handler.
Production publisher mounting and permanent authority joins remain pending.

| Check | Actual result |
| --- | --- |
| Six focused receipt/delivery/operations test files | 41 pass, 0 fail |
| TypeScript `--noEmit --incremental false` | Pass |
| Targeted ESLint for changed TypeScript | Pass |
| Actual `pnpm build`, including prebuild/postbuild | Pass |
| `tests/deploy-paths.test.ts` against that completed build | 12 pass, no skips |
| Historical leaf and trusted filesystem store versus base | Byte-identical |

`fleet-receipt-snapshot-tests.tap` records the focused tests. Real isolated
research/receipt fixtures run through the existing owner-snapshot put/CAS and
authenticated HTTP **without injecting a filesystem store into HTTP**. Missing,
mismatched, failed, reversed and held evidence remains visible; served publication
stays UNKNOWN. Prior 36-fact SHADOW journey controls still pass unchanged.
Synthetic transport tests additionally cover invalid/version/future/oversized/
duplicate evidence, stale clocks, stateless publisher restart retention and
collection failure. An unrelated read outage remains UNKNOWN even with a stale
historical cache. No live fetching, dispatch or production datastore was used.

The first focused run caught a compatibility regression in the absent-snapshot
explicit-evidence test seam; the implementation was corrected, not the expected
proof. The first build compiled the app but rejected nullable typing in a new test
helper; that helper was corrected before the successful build. A sandbox esbuild
resolution failure was rerun with approval for the same isolated test command.

## Actual build evidence

`fleet-receipt-snapshot-build.txt` records `pnpm build` with `DATABASE_URL` and
`WTP_CONTROL_PLANE_DATABASE_URL` empty and telemetry disabled. The process check
immediately before the build found no classified heavy PDC/Next/test processes.
No PDC process, workspace, port or active candidate was changed.

- 62 manifests, 428 repository files across the application, zero test files and
  credential shapes in traces.
- Largest application trace 228 / ceiling 230; framework runtime 927 / ceiling 1050.
- Reader trace requirements: 14 routes, 35 requirements, 63 files, zero failures.
- `fleet-receipt-snapshot-trace.json` names the actual Fleet GET manifest. Its only
  noncompiled, non-node_modules repository asset is the existing
  `data/meetings-snapshot.json`; zero receipt archive files are traced.
- Built Fleet chunks contain the new snapshot contract and its named absence
  behavior, and no filesystem-store constructor error marker. This is checked
  against the application build, in addition to the preserved import tests.
- `fleet-receipt-snapshot-deploy-paths.tap`: all 12 real-artifact checks pass.

This is the fleet clone's actual application/GET build. It is not Claude's
combined page build, a populated deployed database read, PDC certification or
served publication proof. Claude should combine the additive backend and verify
both page and Refresh in the final application build; no filesystem remount is
required. No trace gate, policy, proof expectation or Next config was weakened.

## Finite remaining verification, fleet/integration owned

1. At the authorized PDC handoff, bind the historical selector/archive root and
   compose the extension in the existing permanent snapshot publisher. Preserve
   prior extension from the exact revision being CAS-written; test restart and
   conflict behavior there. Never create a competing snapshot writer.
2. Bind Fleet identities through the final permanent observability and typed
   reader contracts specified in the compatibility handoff. Verify candidate,
   validation, pointer/version, LKG and exact reader receipts separately.
3. Claude verifies populated and missing snapshot page/Refresh parity in the
   combined build. The shared service/guarded HTTP checks are available now.
4. Only after operational authorization, observe a real publisher cycle and
   Admin datastore read, missing/recovery history, and exact current served
   proof. Preserve UNKNOWN wherever those joins are absent.

None of these items expands PDC's completion denominator.
