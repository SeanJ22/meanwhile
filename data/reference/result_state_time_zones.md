# State result clocks

`result_state_time_zones.json` gives one IANA clock for each state, DC and inhabited territory. The ballot results use it to date a race call on the state's own clock, and the vote question uses it to decide when a state's polls have closed, without sending the county reference to browsers.

Each state's clock is its government's own clock where one exists (`governmentTimeZone` in `lib/time/county-time-zones.ts`). Where a state keeps several clocks, it is the clock most of its counties keep, counted from the committed national county clocks in `national_county_time_zones.json`, with ties kept in the file's first-county order. A state that observes two clocks therefore shows its majority clock; a split county never picks a state clock by itself.

`scripts/build-result-state-time-zones.mts` rebuilds the file from those committed bytes, and `--check` fails when the file drifts from them. The county clocks come from the National Weather Service county/public-forecast-zone correlation file described in `national_county_time_zones.md`; NOAA's federal data is public domain.
