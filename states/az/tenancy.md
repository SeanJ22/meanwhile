# AZ — platform tenancy

**Probed 2026-08-26** by `pnpm tenancy --state az`, over the hosts `pnpm descent` actually saw.

**85 host(s) known · 45 probed · 13 refused on permission (RULING 148).**

| | Count | What it means |
|---|---|---|
| **Reachable now** | **5** | on a platform this project ALREADY reads — the cheapest coverage there is |
| On a platform we do not handle | 3 | scoped work: we know the vendor and have no adapter |
| Nothing detected | 24 | a hunt, not a build. **Not the same fact as the row above** |
| Could not read | 0 | RULING 24 — a check that cannot reach its subject never prints like a pass |

## Every host, and the evidence

| Host | Platform | Adapter? | How we know | Evidence |
|---|---|---|---|---|
| https://az.gov | — | — | nothing detected | — |
| https://azdirect.az.gov | — | — | nothing detected | — |
| https://bc.azgovernor.gov | — | — | nothing detected | — |
| https://azsos.gov | — | — | nothing detected | — |
| http://www.azcourts.gov | — | — | nothing detected | — |
| http://www.azsenate.gov | Granicus ViewPublisher | no | `LINKED` | http://azleg.granicus.com/Mediaplayer.php?publish_id=5 |
| http://www.azsenate.gov | Granicus ViewPublisher | no | `SERVED_BY` | Granicus ViewPublisher, the video-and-agenda product — matched "granicus" on www.azsenate.gov |
| https://financial-aid.medicine.arizona.edu | — | — | nothing detected | — |
| https://greenlee.az.gov | — | — | nothing detected | — |
| https://powerauthority.org | — | — | nothing detected | — |
| https://psychboard.az.gov | — | — | nothing detected | — |
| https://respiratoryboard.az.gov | — | — | nothing detected | — |
| https://vetboard.az.gov | eSCRIBE | no | `SERVED_BY` | eSCRIBE's embedded meeting list — matched "escribe" on vetboard.az.gov |
| https://www.azcourts.gov | — | — | nothing detected | — |
| https://www.azleg.gov | — | — | nothing detected | — |
| https://www.gilacountyaz.gov | Revize | **yes** | `LINKED` | https://cms3.revize.com/revize/gilacounty |
| https://www.gilacountyaz.gov | Revize | **yes** | `SERVED_BY` | Revize's own name in template paths — matched "revize" on www.gilacountyaz.gov |
| https://www.navajocountyaz.gov | CivicPlus | **yes** | `LINKED` | https://cp-civicplusuniversity2.civicplus.com |
| https://www.navajocountyaz.gov | CivicPlus | **yes** | `SERVED_BY` | CivicPlus module paths and its AgendaCenter route — matched "civicplus" on www.navajocountyaz.gov |
| https://www.navajocountyaz.gov | eSCRIBE | no | `SERVED_BY` | eSCRIBE's embedded meeting list — matched "escribe" on www.navajocountyaz.gov |
| https://www.pinalcountyaz.gov | CivicPlus | **yes** | `LINKED` | https://cp-civicplusuniversity2.civicplus.com |
| https://www.pinalcountyaz.gov | CivicPlus | **yes** | `SERVED_BY` | CivicPlus module paths and its AgendaCenter route — matched "civicplus" on www.pinalcountyaz.gov |
| https://www.pinalcountyaz.gov | eSCRIBE | no | `SERVED_BY` | eSCRIBE's embedded meeting list — matched "escribe" on www.pinalcountyaz.gov |
| https://www.santacruzcountyaz.gov | CivicPlus | **yes** | `LINKED` | https://cp-civicplusuniversity2.civicplus.com |
| https://www.santacruzcountyaz.gov | CivicPlus | **yes** | `SERVED_BY` | CivicPlus module paths and its AgendaCenter route — matched "civicplus" on www.santacruzcountyaz.gov |
| https://www.santacruzcountyaz.gov | eSCRIBE | no | `SERVED_BY` | eSCRIBE's embedded meeting list — matched "escribe" on www.santacruzcountyaz.gov |
| https://www.yumacountyaz.gov | — | — | nothing detected | — |
| https://grrc.az.gov | — | — | nothing detected | — |
| https://azdirect.azdoa.gov | — | — | nothing detected | — |
| http://azjudges.info | — | — | nothing detected | — |
| http://government.westlaw.com | — | — | nothing detected | — |
| http://www.azcourthelp.org | — | — | nothing detected | — |
| https://coa1.azcourts.gov | — | — | nothing detected | — |
| http://azrules.westgroup.com | — | — | nothing detected | — |
| http://www.superiorcourt.maricopa.gov | — | — | nothing detected | — |
| https://www.ncsc.org | — | — | nothing detected | — |
| https://www.azsenate.gov | Granicus ViewPublisher | no | `LINKED` | http://azleg.granicus.com/Mediaplayer.php?publish_id=5 |
| https://www.azsenate.gov | Granicus ViewPublisher | no | `SERVED_BY` | Granicus ViewPublisher, the video-and-agenda product — matched "granicus" on www.azsenate.gov |
| http://www.azleg.gov | — | — | nothing detected | — |
| https://www.pima.gov | CivicPlus | **yes** | `LINKED` | https://content.civicplus.com/api/assets/964e45a5-0978-4a14-b0a3-11c76f85cbd0?width=180&amp;height=180&amp;mode=crop |
| https://www.pima.gov | Legistar / Granicus | **yes** | `LINKED` | https://pima.legistar.com/Calendar.aspx |
| https://www.pima.gov | CivicPlus | **yes** | `SERVED_BY` | CivicPlus module paths and its AgendaCenter route — matched "CivicPlus" on www.pima.gov |
| https://www.pima.gov | eSCRIBE | no | `SERVED_BY` | eSCRIBE's embedded meeting list — matched "escribe" on www.pima.gov |
| https://www.azed.gov | — | — | nothing detected | — |

**`LINKED` is the body's own page pointing at a vendor. `SERVED_BY` is a vendor's markup on the body's own
domain — the only route to a vendor that hosts under the customer's name, which a link-out test cannot
find. `DERIVED_LEAD` is a guessed tenant slug and is a LEAD, never a HIT.**
