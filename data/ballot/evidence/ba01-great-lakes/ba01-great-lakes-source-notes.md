Source recovery and unresolved differences, 2026-10-20

Ohio
- County FWAB page -> fresh link click recovered official documents when a direct PDF fetch returned 403; retained text captures identify exact source and capture.
- Allen County .gov homepage links the public Dropbox FWAB PDF. Retained parent page, original PDF gzip, and numbered pdftotext capture. Hancock .gov links the public Google Docs candidate roster. Retained parent, raw public text export and numbered capture.
- Newest Mercer official FWAB dated October 15 spells CD4 independent candidate Tracey L. Tackett; earlier Clark capture spelled Tracy L. Tackett. The newer official spelling replaces the earlier value, keeping the record ID. Party remains null as on the newest list; losing spelling retained in the Clark source capture.
- Cuyahoga/Clark late notices say Ron Ula/Michael C. Lehnerd withdrew October15. A CandidacyRemoval now retains the old raw candidacy and ID, links earlier and withdrawal provenance, records first observation 2026-10-20, and states the explicit withdrawal. The separately retained Clark notice confirms votes will not count. Root handles reader filtering.
- Remaining core counties: Lucas (House41–44/Senate11), Stark (House48–51/Senate29), Warren (House55/56), Delaware60, Clermont62, Portage72, Wood75, Wayne77, Columbiana79, Miami80, Sandusky88. Miami FWAB recovered names but omitted district number; official district confirmation remains needed.
- Lucas main site403; public lookup XML ballot is accessible but exposes one contest at a time. Warren46Day PDF403. Stark public candidate index accessible, PDF source URLs not exposed in extracted tool view. Portage redirects403. These are retrieval gaps, not claims of no contests.

Illinois
- General eID sejIrI%2BQmww%3D, direct SBE candidate/list pages403. Search-indexed SBE general records are discovery leads only; not given false HTTP200 receipts.
- Sangamon .gov without www works; candidate publications currently countywide/board only, sample page says Coming Soon. Public linked Platinum VRMS lookup403. Cook/Will/Champaign/McHenry direct routes403. Continue alternate official county-hosted certified lists/sample ballots.

Minnesota
- Public candidate search POST to btnStateOfficesWOJudicial works with fresh cookies and ASP.NET hidden fields; returns all filings, including primary losers, so it is not a general-election certified roster.
- Fresh lbGenStateMediaFile/lbStateMediaFile export postbacks redirect to NoMatchesFound. Do not exclude or add candidates based on the unfiltered filing search.

Other assigned states
- Michigan, Indiana, Iowa and Missouri held core roster/candidate equality is asserted by the replay script against saved official documents. Indiana/Iowa/Missouri retention rows are additional to candidate-core counts.
- Wisconsin file transferred to Pacific; Great Lakes --write no longer writes it.
- Optional Google Civic elections-list request was rejected by automatic approval review before execution as unnecessary/unapproved. No credential exposed or retry attempted; official-source work continues without it.

Run source replay: python scripts/ba01-great-lakes.py
