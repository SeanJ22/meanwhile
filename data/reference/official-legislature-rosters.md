# Official legislature rosters

`official-legislature-rosters.json` lists, for 41 states, the 71 web pages where each state legislature publishes its own current member roster (one page for a state whose chambers share a list, two for a state with a separate House and Senate page). The entries were chosen for OR-01 by reading each legislature's own site and are the addresses the official-state-people source asks for, alongside the member pages it already holds.

The file carries no people, only where to look. A member listed on a saved roster page, and a seat the page explicitly shows as Vacant, publish from that saved page with its capture time; a member missing from a page is never read as a vacancy. A state with no entry here is found from its held member pages. Nine legislatures that publish rosters only through an API (AL, DE, GA, MT, RI, SD, UT, VT, WY) have no page listed.

A route that moves is replaced in this file as data, with no code change: change it only to an address the legislature itself publishes, and name the state and the old address in the change. The reader is `lib/sources/people/roster-routes.ts`.
