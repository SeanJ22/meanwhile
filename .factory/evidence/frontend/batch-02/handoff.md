# Frontend first ready batch — 2026-10-05

FE-05, FE-06, FE-07, FE-10, FE-39, FE-43, FE-44 are ready for River integration. The full suite completed on `337ad670e`: 9,355 passes, 11 skips, four failures. Every failure was repaired and its owning guard rechecked at `9529c69fd` (36/36). Types, build and browser fixture also passed at that SHA. No assertion, artifact allowlist, provider policy or budget was widened. The old BAL-41 assertion now follows the approved FE-44 national-office rule.

Screenshots from the previous checkpoint remain exactly recoverable with `git show 52386f752:.factory/evidence/frontend/batch-01/card-390-dark.png` and its three companion width/theme paths. The current working copies are under ignored `.scratch/frontend/batch-01/`; new images remain outside tracked shipping source, as the current asset guard requires. All prior checkpoint objects and the recovery bundle remain preserved.

This is code readiness. Local browser checks use a synthetic navigation/list fixture and an explicit `/usr/bin/chromium` substitution; they do not establish deployed homepage or live-data acceptance. River owns deployment/live readback. A HEAD request to meanwhileusa.com was refused by this lane's network proxy (403) at 18:55Z; FE-19 live examples therefore need River's accessible lane.

Next WIP is isolated in `/tmp/frontend-next`; it is not part of this ready boundary. Do not fold later WIP. That batch covers shared PersonCard, shared gaps/copy settings, component token conversion, Admin CSS merge, online office pins, nearby/own-government separation and the copy guard. Admin must connect `lib/design/copy-settings.ts` in its settings projection and gateway publication startup once that module is pushed. All engineering dependencies go through River.
