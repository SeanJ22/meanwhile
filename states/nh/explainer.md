# How government works in New Hampshire

**NOT PUBLISHED. INTERNAL ONLY.** Written 2026-08-26; publication is a separate
decision Sean makes later. Getting it publicly wrong about how someone's
government works is a trust cost that does not come back.

**Every factual claim below traces to a row in `states/nh/sources.md`.** A claim
the registry cannot back does not go in. Where the registry says a source is
walled, this file says what is not known rather than filling the gap.

**Structure is described, never evaluated.** *New Hampshire's legislature is the
third-largest legislative body in the English-speaking world* is structure.
*New Hampshire's legislature is unwieldy* is an opinion, and it does not appear.

**Freshness cadence: re-read against the registry every 90 days, and whenever a
registry row it depends on changes.** An explainer that silently goes stale is
worse than none. Last checked against the registry **2026-08-26**.

---

## The legislature is enormous, and that is the first thing to know

New Hampshire's legislature is called the **General Court**. It has two
chambers: a **House of Representatives** and a **Senate**.

The Senate has **24 members**. The House is far larger. The General Court's own
member file, read on 26 August 2026, lists **384 people currently serving in the
House and 24 in the Senate**.

*Source: the General Court's own downloads page, `gc.nh.gov/downloads/`,
registered in `sources.md` as a PRIMARY bulk download.*

What that size means for a reader is practical rather than abstract: your
representative's district is small, several representatives may share it, and
the person who represents you is more likely than in most states to be someone
you could meet.

## Who represents you, and how to reach them

The General Court publishes, for every member: their name, chamber, county,
district, seat number, mailing address, a work email, and their committee
assignments with phone numbers.

Of the 408 people in that file on 26 August 2026, **406 have a published work
email** and **266 have a published phone number**.

*Source: the same file. The two counts are stated as counts because the file is
what they were measured from.*

## What the state itself lets you do

**You can submit testimony on a bill online.** The General Court runs an online
testimony submission system, and it publishes the testimony that is submitted —
the name, the town, who the person is representing, the committee, the bill, and
the text.

*Source: `gc.nh.gov`'s own navigation and the `houseRemoteTestify` table in the
schema the General Court publishes for its public database. Registered in
`sources.md`.*

This is not a small thing. It means an ordinary person can put a written
position in front of a committee before it votes, and that what they wrote
becomes part of the public record.

## Money in New Hampshire elections goes to one place

New Hampshire routes campaign-finance filing to **one office for the whole
state**: the Secretary of State. Candidates for governor, executive councillor,
state senator, state representative and **county office** all register and file
there, as do political committees.

*Source: RSA 664:6 and RSA 664:7, read from the General Court's own statute site
on 26 August 2026 and quoted in `sources.md`.*

Some states do this differently — Arizona, for example, sends county and
municipal filings to county and city officers instead. New Hampshire does not.

**One detail worth knowing, because the state chose it deliberately:** for
people who give **$50 or less in total** across an election cycle, the law says
their personal identifying information is not made publicly available.

*Source: RSA 664:6, I, read 2026-08-26.*

## Towns decide a surprising amount for themselves

New Hampshire towns adopt their own ballot system under **RSA 669**, and a town
may run its local offices with party labels or without them. **The statute
cannot tell you which one a particular town chose** — only the town's own ballot
or annual report can.

**School district ballots carry no party at all**, by statute.

*Source: RSA 669 and RSA 671:20, recorded in `states/nh/NOTES.md`.*

## What we cannot tell you yet, and why

**Who is registered to lobby, and for whom.** New Hampshire publishes a lobbyist
registry. As of 26 August 2026 that website refuses every automated request this
project has tried. We have not read it, so we are not going to describe it.

**Where state campaign money comes from.** Same office, same refusal, same date.

*Source: the walls are recorded in `sources.md` with the rungs walked and the
date, and they are re-tested on a 14-day clock. A wall is a measurement on a
date, not a permanent property.*
