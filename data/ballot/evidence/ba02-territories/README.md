# Guam and Puerto Rico ballot sources

`python scripts/ba02-territories.py` verifies each capture hash, reproduces PDF
extraction, confirms the source facts, and writes the two state ballot inputs.
It performs no network or database writes.

Guam's own General Election page links the exact November 3 specimen. Its General
Election Ballot Placement URL redirects to the captured GEC roster. The roster
has all 30 legislative candidates and 14 nonpartisan candidates; the certified
August 15 primary summary supplies the gubernatorial tickets and congressional
nominees. The specimen confirms every choice, both explicit running mates, and
the printed vote limits. The Education Board's six-seat limit comes from 17 GCA
§3102.3(b), recaptured from the Judiciary of Guam's Compiler of Laws and quoted
identically by GEC's own qualifications page.

There are six printed contests: Governor and Lieutenant Governor together,
congressional delegate, legislature, Attorney General, Consolidated Commission
on Utilities, and Guam Education Board. The five offices named in the assignment
include governor and lieutenant governor, which are one joint ticket on the
official ballot. All six printed contests are delivered, with 48 choices and two
running mates. Their vote limits are respectively 1, 1, 15, 1, 3, and 6.

The General Election page's linked candidate-information workbook still contains
primary entrants, including candidates absent from the final certified field,
and omits nonpartisan offices. This older workbook is retained as contradiction
evidence, never used to select the general-election field. The newer certified
primary summary, General Election placement roster, and specimen resolve the
field. The older placement roster expands Sarah Nededog's name and prints John
Taitano's suffix differently; the newer specimen's names are used uniformly.

HTTPS requests to GEC returned 503. Public HTTP pages succeeded, including the
GEC redirect to the ballot-placement roster. Future workers should try the
publisher's HTTP route when its HTTPS route fails, then follow and save the exact
official outbound links. Third-party search results supplied leads only.

Puerto Rico's CEE procurement document, §12.0 (printed page 47), explicitly
states the four-year general-election cycle and that the next general election
is November 7, 2028. It supports the absence of a November 3, 2026 general
election. The PR.gov agency directory links the CEE website and establishes its
official publisher. This record makes no claim about other special elections.
