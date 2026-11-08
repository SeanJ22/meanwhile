# Returned: robots-off-netlify

lane: robots-off-netlify
owner: robots-off-netlify
writer: the robots-off-netlify lane
check: connection proofs
ready: NB-01 bf885d9797a76a279c33429fc89eaaab08c3cce0
river: 97a693b6948a504d07eb53ea1818d4a17ee7447f
at: 2026-11-08T03:54:44Z
state: returned
fix_subject: fix:438a452d
fix: River · stream/robots-off-netlify — connection proofs failed for robots-off-netlify: READY bf885d9797a7 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, wit

## Failure

```
READY bf885d9797a7 refused: its message lacks "connected end to end" and "still working on the next scheduled run". Every READY message states that the work is connected end to end and that it is still working on the next scheduled run, with the evidence for each.
```

## Repair

Fix on stream/robots-off-netlify and publish a new READY commit; River folds the new READY and clears this return when it integrates.
