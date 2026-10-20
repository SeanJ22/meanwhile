# LK-01: the line keeper

The hourly observer fills the existing Admin Now and Scoreboard readers. It runs
at five minutes past every hour Eastern, including overnight (the Netlify cron
is UTC and remains hourly through daylight saving transitions). It has no AI,
dispatch, publish, alert or gate authority. Runner downtime does not stop it.

`line-keeper-initialize` seeds compact source, job, waiting-work and destination
inventories after a production deploy is published. Hourly work never falls
back to an inventory seed. Event totals use the last closed UTC hour. Mutable
source and queue clocks use changes through the current check, so a continuously
updated snapshot cannot disappear behind that boundary. Changed rows fold into
its own checkpoint; retained clocks keep ageing locally. A gap in that
inventory remains visible. Two hourly reports are retained in the current
checkpoint; weekly posting latency uses current promoted changes and real
stamp events. Repeated delivery of an already recorded hour does no work.

The country table uses the existing held-place projection, owed list and score
calculation. Its readonly input memo retains source reads separately for each
state. Changed source pointers and confirmations invalidate their inputs;
unchanged inputs are replayed locally. Only compact country scores reach Admin.
The initializer and hourly runtime log their own Neon response bytes and their
transfer cost at $0.10/GB. Project traffic uses differences in TX-01’s existing
daily counters, including web and runner clients, sampled hourly. A missing or
broken baseline is labeled as a process-only floor until initialized. Inputs are compressed in the keeper's own snapshots.

The eight links retain separate intake/output counts by state and kind. Pages
and useful records count; finished runs do not establish delivery. The same
report includes zero-fetch/zero-save work, paid empty work, source and dispatch
clocks, registered workers, database callers, and missing meeting stamps after
90 minutes. The public browser compares exact identities and values through the
ordinary reader responses and visible controls. Every changed public record is checked; quiet paths use a retained sample.
Observed counts are never multiplied into a claimed national live count.
Meetings outside the published shown window do not count as missing live pins.
Missing evidence stays unknown and becomes owned fix work.

Findings use `withFixAdded` in the existing fix list, and the existing daily brief.
Only those two fields and their update time are patched into Admin settings,
with a revision check. No spending limit, pause or alert setting is rewritten.
The next independent observation must find the same state/kind/link carrying
useful work and exact facts on the live page before an item closes. A meeting
stamp repair additionally needs that exact version and record's stamp. Unresolved
meeting checks stay in the observer after they leave the weekly display window.

`preview.mts` uses two explicit read-only production roles, suppresses accounting
writes, and can inject only read-only retained state and country inputs. Run it
with `--check-pages --today --out=<file>`; use `--initialize-clocks` for a separate
one-time seed, or `--state=<prior-preview>` for an incremental check.
`--country-changes --country-cache=<seed>` includes the existing country score.
The preview reports every proposed fix with its owner, UTF-8 configuration growth,
and the extra bytes four whole-record readers would transfer at their observed
read rate. Historical replay uses hourly event evidence, not reconstructed past
browser pages or today's source inventory relabeled as history.

Results now reads the retained publication index, with exact approval/version
witness joins. Missing accepted-record counts remain unknown. Meeting publication
now invokes the existing stamp writer immediately; an observation failure leaves
publication intact and an unchanged recheck can repair the missing stamp.
