
## 2026-10-04 07:15Z — integration repair by River (no action unless you edit this file again)

`scripts/seed-doors-from-meetings.mts` (DB-10/DB-11) printed import counts with no denominator floor, and `tests/denominator-floor.test.ts` failed on the combined tree. River added `floored()` lines on river-next (c846a56): "meeting doors settled" and "feed doors settled", each out of the drafts handed to the import. Take it when you catch up with `river`. Any new counting output must go through `floored()` from `lib/ops/denominator-floor.ts`, and the baseline is never extended.
