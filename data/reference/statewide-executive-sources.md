# Statewide executive directories

`statewide-executive-sources.json` lists the ten national directories that the standing statewide reader (`lib/sources/statewide/`) uses to find who holds each statewide office. They were chosen for SL-03 and are named here exactly as the reader requests them; none of them is the final authority for a holder.

- `nga` — National Governors Association: <https://www.nga.org/governors/> (Governor; read as html)
- `nlga` — National Lieutenant Governors Association: <https://nlga.us/lt-governors/> (Lieutenant Governor; read as html)
- `naag` — National Association of Attorneys General: <https://www.naag.org/attorneys-general/whos-my-ag/> (Attorney General; read as html)
- `nass` — National Association of Secretaries of State: <https://www.nass.org/membership> (Secretary of State; read as html)
- `nast` — National Association of State Treasurers: <https://nast.org/state-treasurers/> (State Treasurer; read as html)
- `nasact` — National Association of State Auditors, Comptrollers and Treasurers: <https://www.nasact.org/membership> (State Auditor, State Comptroller, State Treasurer; read as html)
- `ccsso` — Council of Chief State School Officers: <https://ccsso.org/our-members> (Superintendent, Commissioner of Education, Chief State School Officer; read as html)
- `naic` — National Association of Insurance Commissioners: <https://content.naic.org/state-insurance-departments> (Insurance Commissioner, Commissioner of Insurance, Director of Insurance; read as html)
- `nasda` — National Association of State Departments of Agriculture: <https://www.nasda.org/about-nasda/state-agriculture-departments/> (Commissioner of Agriculture, Secretary of Agriculture, Director of Agriculture; read as html)
- `wikidata` — Wikidata (CC0 structured data; image licenses retained separately): <https://query.wikidata.org/sparql> (; read as wikidata)

Each directory is read once nationally and every state's rows are kept as leads. A lead becomes a published person only when the holder is named in the office on their own official state page, which is saved with its capture time; the selection method (elected or appointed) comes from that page, never from the directory. A directory that omits an office or fails to load establishes no absent office: the gap is recorded and the prior verified people stay live. The file carries no people, only where to look; changing it changes which publishers are asked, so each change should name the directory it adds or drops and why.
