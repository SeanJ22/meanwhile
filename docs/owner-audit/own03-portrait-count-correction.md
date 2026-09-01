# OWN03 — the queue is nine, and Tom Horne is not one of them

*Recorded 2026-08-31 by the Session C resume. This corrects a statement that
was being presented to the author as the current state of his own queue.*

## The correction

`docs/log.md` line 34 describes OWN03 as *"Approve or refuse the 9 portraits
queued in `data/photos/door2-statewide-executives-2026-08-28.json`, Mayes,
Fontes and Horne among them"*, and says all three were *"queued off their own
offices' pages (azag.gov, azsos.gov, azed.gov), name-matched and decoded as real
images"*.

**Horne was not queued, and his image was not decoded.** The acquisition
record's own totals say so:

```
statewideExecutives  14        pagesWalked   11
portraitsQueued       9        refusedAtDecode  1
noNamedImageOnPage    1        alreadyHeld      3
```

Ten rows carry a `portrait` object; nine were queued. The tenth is Horne, whose
`decode` reads:

```
ok      false
reason  NOT_AN_IMAGE
detail  no image signature - it begins "<!DOCTYPE html><html lang="en-US">
        <head><title>Just a moment"
bytes   5796
```

The count was right. The names attached to it were not. Presenting Horne for
approval would be asking the author to approve an image the system never
successfully read.

## The nine that ARE queued, and are genuinely awaiting a decision

| Subject | Office | Source |
| --- | --- | --- |
| Adrian Fontes | Secretary of State (AZ) | `azsos.gov` |
| Kris Mayes | Attorney General (AZ) | `azag.gov` |
| Kimberly Yee | State Treasurer (AZ) | `wixstatic.com` (office site host) |
| Nick Myers | Corporation Commissioner (AZ) | `azcc.gov` |
| Rachel Walden | Corporation Commissioner (AZ) | `azcc.gov` |
| Kevin Thompson | Corporation Commissioner (AZ) | `azcc.gov` |
| Lea Márquez Peterson | Corporation Commissioner (AZ) | `azcc.gov` |
| René Lopez | Corporation Commissioner (AZ) | `azcc.gov` |
| Dale G. Caldwell | Lieutenant Governor (NJ) | `nj.gov` |

All nine were name-matched on the office's own page — door 2, the portrait a
government body publishes of its own member — and decoded as real images. None
ships without the author's decision (RULING 55).

## What Horne's row actually is, and why it stays open

*"Just a moment..."* is a **Cloudflare managed challenge**. It is a WALL, and
under the transparency mandate a wall never renders as an emptiness and a
blocked route never becomes a blocked fact.

Permission is not the question and was already settled: `docs/sources.md` records
`azed.gov` as **ALLOWED at rung 4**, with the single-pass read recorded as
`CANNOT_TELL` and the row already marked `RECHECK_DUE`. Permission state and
transport state are orthogonal (RULING 182); this is transport.

Re-walked tonight, varying the client, which is the first move the method store
prescribes when one client is refused:

| client | result |
| --- | --- |
| `curl`, project identifier | Cloudflare interstitial |
| bare `node fetch`, project identifier | **403**, Cloudflare interstitial, 5,796 bytes |

Both refused. The obligation stays live.

**But chasing this particular URL is the wrong next move, and that is the more
useful finding.** `docs/sources.md` already records the image as
`Tom Headshot 60px_0.jpg` — **60px against `MIN_PORTRAIT_EDGE` 96** in
`tests/portrait-resolution.test.ts`. Defeating the challenge would yield an
artifact that fails the resolution floor anyway. So this is not a harder fetch;
it is **RULING 206**: one representation lost means resolve ANOTHER
representation of the same record. The owed thing is a Horne portrait, not that
file.

```
RECORD      the portrait the Arizona Department of Education publishes
            of its own Superintendent
ROUTE 1     azed.gov/sites/.../Tom Headshot 60px_0.jpg
            BLOCKED_CURRENTLY (Cloudflare) AND below the resolution floor
NEXT        another representation - door 3, an alternate first-party page,
            an archived copy, another custodian
STATUS      OPEN. Not an absence, and not a decision for the author.
```

Horne therefore does not belong in the author's decision queue at all. He
belongs in the hunt.
