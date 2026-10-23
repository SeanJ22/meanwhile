# Kansas and New Mexico retention questions

Current result: all 63 Kansas questions and 41 of 43 New Mexico questions have
requested statute/sample/certified-notice support. The strict command
`python scripts/ba02-retention-ks-nm.py --check` **fails for two New Mexico source
forms**, listed below. It must not be reported as passing all 106 questions.
All 106 cards have saved question text, with the two pending questions sourced
truthfully to the official state registry.

Run without `--check` to regenerate the two state inputs and `ks-questions.json`
and `nm-questions.json`. The script verifies source hashes, wording, named judges
and court scope. Strict checking additionally requires a primary source form
for every question and verifies byte-identical regeneration without writing.
The scheduled assembler reads the committed state inputs directly.

Kansas: 63 questions use the Legislature's current retention templates:
Constitution Article 3 Section 5 (two Supreme Court justices), K.S.A. 20-3006
(five Court of Appeals judges), and K.S.A. 20-2908 (56 district and magistrate
judges). The last statute and complete 2026 Secretary of State candidate table
are reused from `data/ballot/evidence/ba01-south`. Each inserted name is checked
against that table; each court/position comes from its held certified office
record. `ks-questions.json` retains templates, inserted values and source URLs.

New Mexico: 43 questions cover 32 district judges, eight Metropolitan Court
judges and three statewide justices/judges. Primary wording is transcribed from
saved 2026 samples and signed clerk election notices, independently matched to
the official certified candidate record and current GENERAL 2026 registry.
Prepared results headings differ from actual ballots in several districts:
Doña Ana names the 3rd Judicial District, Sierra includes "THE", and Sandoval
adds a comma after "Judge". The primary document's exact text wins, including
McKinley's printed omissions of "Judge" for Gurley and the final question mark
for Decker. Replaced registry wording is retained in `nm-questions.json`.

The archived Bernalillo PDF is an actual unmarked official-authored sample,
received second hand. Its archive URL and publisher are stated as such, with
`secondHand: true`; no original government URL is invented. The saved imprint
establishes the election date, county and style. All 20 questions match the
current official registry verbatim and all 20 names match the certified roster.
`scripts/ba02-bernalillo-sample-check.py` reproduces that authentication. Its 17
local questions supply the remaining Second District and Metropolitan wording;
stronger government-hosted samples supply the three statewide questions.

The current SOS Election Handbook and its official backlink are saved for legal
support. NMSA 1978 sections 1-26-2 through 1-26-6 establish retention/rejection
for the four office classes, but do not prescribe a literal question template.
No result, recommendation or judicial evaluation is imported. The SOS registry
query `cty=01` identifies Santa Fe County, not Bernalillo; these identifiers are
not Census/FIPS codes.

## Two pending source forms

- `nm-general-2026-judicial-retention-district-court-judge-ninth-judicial-district-division-01` — Benjamin S Cross. Current official registry question: "Shall BENJAMIN S CROSS be retained as Judge of the Ninth Judicial District, Division 1?"
- `nm-general-2026-judicial-retention-district-court-judge-ninth-judicial-district-division-04` — Donna J Mowrer. Current official registry question: "Shall DONNA J MOWRER be retained as District Court Judge, Division 4?"

The [current newspaper reproduction](https://www.easternnewmexiconews.com/story/2026/10/07/news/nov-3-sample-ballot/234334.html),
updated October 6, prints each alternative twice for Curry and Roosevelt:
"Shall BENJAMIN S CROSS be retained as Judge of the 9th Judicial District,
Division 1?" and "Shall DONNA J MOWRER be retained as Judge of the 9th Judicial
District, Division 4?" These differ from the official registry. The article
provides no government authorship, county credit, official PDF or source
attribution. Those alternatives remain unproven as official ballot wording;
the cards retain the truthful official registry values until an authenticated
actual sample, certified notice or literal statutory form is acquired.
`nm-ninth-question-conflicts.json` records both exact strings and source URLs
for each of those two contests.

`nm-ninth-source-routes.json` records the current access and discovery status.
The public county pages and archives, personal SOS sample portal, certified
candidate list, newspaper/notice routes and all 153 current-year SOS WordPress
attachments supplied no qualifying Ninth wording capture. The portal works
with cookies but requires a voter lookup; its public address lookup and the
notice detail require CAPTCHA. No personal identity or CAPTCHA bypass was
used. The handbook, Constitution VI 33–34, NMAC 1.10.11/1.10.16 and public
formatting/guide searches supplied no literal retention template. NMAC 1.10.16
expressly excludes judicial retention from its ballot-question definition.
Unused failure-route raw captures and garbled OCR were removed; saved primary
raws, required extracts, statutory support and official registry bytes remain.
