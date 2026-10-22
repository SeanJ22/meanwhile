# Official legislature roster pages

`official-legislature-rosters.json` names each state legislature's own current member roster pages (41 legislatures),
keyed by postal code. The `official-state-people` source reads them
beside the member pages it already holds: the listed members and any seat the page itself labels Vacant publish from
the saved page, quoted in the page's words. A member missing from a page is never read as a vacancy.

Every URL is on the legislature's own official site and was taken from the routes researched for OR-01
(stream/officials-recheck). Legislatures that publish their roster only through a JSON or POST API (AL, DE, GA, MT,
RI, SD, UT, VT, WY) have no row yet. A route that moves is replaced here as data; a state without a row is found from
its held member pages.
