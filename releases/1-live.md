# Release 1 (dcddcf5) live check, as of 13:51Z

Read-only: SQL on production plus git on main. Browser and Admin are unreachable from River's environment.

| Category | Steps |
|---|---|
| Checked live | 0 |
| Data checked; screen not yet checked | 1 (DB-09: cp_doors exists at schema v19, 0 rows) |
| Built, proving over time | 11 (CH-06, DB-48, DP-07, DP-09, SC-11, DB-03, DB-04, DB-05, DB-06, DB-08, DB-54) |
| Deployed, live check pending | 68: 7 behind WTP_DOORS_READ (off), 1 behind WTP_ADAPTER_PUBLICATION (pr), and most need a browser, Admin or an owner order (no Send since deploy) |
| **Failed live (returned)** | **28**: DP-10, DP-13, DP-14, DP-16, DP-18, FE-17, FE-18 (auditors); DP-19, DP-20, DP-24, DP-27, DP-28, DB-49, DB-51, DB-57 (bank); BR-23, SC-13, SC-16 (measures); DB-27 (meetings); CA-40, CA-41, CA-42 (people); DB-10, DB-11, DB-23, DB-25, DB-32, DB-33 (registry) |

Cause: these READY commits shipped libraries whose runtime call was left as a hook. Also: the cp_fix_map table was never migrated, and the door registry was never seeded in production (0 rows). Details and evidence are in returns/<lane>.md (14:00Z).

Production notes:
- The first cycle on dcddcf5 started at 13:42:56Z.
- No paid worker has run since 05:52Z (SCOUT_COST_CEILING refusals). That ceiling is Sean's spending control and River leaves it alone.
- 174 free aborts against api.marginalia.nu while its circuit was latched (hunters).
- MEETING last promoted 06:17Z.
- FEDERAL_DIRECTORY and FEDERAL_KEY_VOTE promoted 13:44–13:45Z.

Recheck after the first dcddcf5 cycle:
- SC-18: cp_readiness_snapshots must not be written after 13:43Z.
- SC-15: the owner snapshot should come from dcddcf5 with no census.
