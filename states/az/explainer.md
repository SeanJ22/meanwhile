# How government works in Arizona

**NOT PUBLISHED. INTERNAL ONLY.** Written 2026-08-26; publication is a separate
decision Sean makes later.

**Every factual claim traces to a row in `states/az/sources.md`.** Structure is
described, never evaluated. **Freshness cadence: re-read against the registry
every 90 days and whenever a registry row it depends on changes.** Last checked
**2026-08-26**.

---

## Where campaign money gets filed depends on which election it is

This is the thing about Arizona that surprises people, and it is written into
statute rather than being an accident of how websites are organised.

Arizona law assigns a **filing officer** for campaign-finance reports based on
which election the money is trying to influence:

- **Statewide and legislative elections** — the **Secretary of State**.
- **County, school district, community college district and special taxing
  district elections** — the **county officer in charge of elections**.
- **City and town elections** — the **city or town clerk**.

*Source: A.R.S. § 16-928, read from the Arizona Legislature's own statute site
on 26 August 2026 and quoted in `sources.md`.*

So there is no single place to look. The state's own table of filing
jurisdictions lists **109 of them: the state, 15 counties, and 93 cities and
towns.**

*Source: `Jurisdictions.txt`, published by the Secretary of State, read
2026-08-26.*

What that means for a reader: money in a school board race or a city council
race is filed somewhere different from money in a governor's race, and finding
it means knowing which office holds it.

## Arizona has a public campaign-finance system, and it publishes its own tables

The Secretary of State runs a campaign-finance system and publishes reference
tables for it openly — including a register of **every campaign committee in the
state**: 8,828 of them as of 26 August 2026, each with its name, address, type,
the date it organised, and the date it terminated if it has.

*Source: `Committees.txt`, published by the Secretary of State, read
2026-08-26.*

## Arizona funds some candidates publicly, and says which ones

Arizona runs a **Citizens Clean Elections** system. A candidate either
participates in it — accepting public funding with limits attached — or does
not. That is a filed fact, not an interpretation, and the state records it on
the committee itself.

Of the candidate committees in the state's register on 26 August 2026, **810
are recorded as participating in Clean Elections and 3,767 as not
participating.**

*Source: the committee-type field in `Committees.txt`.*

## Two things the state itself lets you do

**Request to Speak.** Arizona runs an official system through the Legislature
that lets a member of the public sign up to speak on a bill at a committee
hearing, and to register a position on it.

**E-Qual.** Arizona lets you sign a candidate's nomination petition online, and
give the $5 qualifying contributions that a Clean Elections candidate needs, at
`apps.azsos.gov/equal/`.

*Source: both registered in `sources.md` as official civic-action mechanisms,
walked 2026-08-26.*

Both are unusual. Most states make you do these things on paper.

## Who draws the districts

Arizona's legislative and congressional district boundaries are drawn by the
**Independent Redistricting Commission**, a separate body from the legislature.
The current boundaries took effect in 2022, and there are **30 legislative
districts**.

*Source: the Commission publishes them at `irc.az.gov`. Registered in
`sources.md`, and see the honesty note below.*

## What we cannot tell you yet, and why

**We have not read the redistricting commission's own boundary files.** As of 26
August 2026 that site refuses the automated requests this project has made. Our
map of Arizona's districts comes from the Census Bureau instead. Those two
should agree, and **we have not yet checked whether they do**.

*Source: the wall and the unchecked comparison are both recorded in
`sources.md`, with dates.*

**We have not counted how many candidates on a given Arizona ballot are Clean
Elections participants.** The state publishes participation per committee; tying
those committees to the people on a particular ballot is work not yet done, and
we would rather say that than estimate it.
