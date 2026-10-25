# Hourly counts

Every fact write, civic-data pointer move, door write, and work-list change updates
`count_hour` in its own database transaction. The table keeps RB-A1’s
state/hour/step/nonnegative-count shape; its versioned step contains the kind,
step and metric. Stock entering and leaving is counted separately so corrections
and future clock changes preserve that shape. The dimension is the saved family,
including new families; there is no family allowlist. Baselines record inventory
without inventing activity in the migration hour. Counts distinguish live facts,
published sets, work states, and door states. Work-list clock boundaries are
saved as timed counter changes, so leases and due times keep changing the count
correctly while the runner is stopped.

The production deploy takes the first reading. The independent Netlify function
then runs at five minutes past every hour. It reads
only the counters and grouped oldest waiting times. Its saved rows contain an
hour, finish time, problem count, bytes read and one oldest-waiting summary per
state; at most three rows are retained. Admin reads those small summaries; the
full age query runs only in the hourly job.
It never loads or saves records, source documents, page targets or replay caches.
The former `line-keeper:current` inventory is deleted when the replacement runs.

Admin uses the same counters, by state, family, stage and hour. Eastern hour labels
include EST or EDT. Oldest waiting times keep ageing on Admin even when a writer
or the keeper stops. A missing or late completed run is stated on Now.

A growing waiting pile or an hour with no movement creates owned work in the
existing fix list and daily brief. Counters never close a fix: its owner still
has to repair the cause and check the records on the live site. Spending limits,
pauses and alerts remain in their existing settings.
