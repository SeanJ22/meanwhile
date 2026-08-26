# NJ — platform tenancy

**Probed 2026-08-26** by `pnpm tenancy --state nj`, over the hosts `pnpm descent` actually saw.

**374 host(s) known · 45 probed · 3 refused on permission (RULING 148).**

| | Count | What it means |
|---|---|---|
| **Reachable now** | **9** | on a platform this project ALREADY reads — the cheapest coverage there is |
| On a platform we do not handle | 12 | scoped work: we know the vendor and have no adapter |
| Nothing detected | 21 | a hunt, not a build. **Not the same fact as the row above** |
| Could not read | 0 | RULING 24 — a check that cannot reach its subject never prints like a pass |

## Every host, and the evidence

| Host | Platform | Adapter? | How we know | Evidence |
|---|---|---|---|---|
| https://www.nj.gov | — | — | nothing detected | — |
| https://nj.gov | — | — | nothing detected | — |
| http://nj.gov | — | — | nothing detected | — |
| https://app.powerbi.com | — | — | nothing detected | — |
| https://www.njleg.state.nj.us | — | — | nothing detected | — |
| https://www.njeda.gov | eSCRIBE | no | `SERVED_BY` | eSCRIBE's embedded meeting list — matched "escribe" on www.njeda.gov |
| https://www.njohsp.gov | — | — | nothing detected | — |
| http://hdl.handle.net | — | — | nothing detected | — |
| https://www.njcourts.gov | — | — | nothing detected | — |
| https://www.assemblydems.com | CivicPlus | **yes** | `LINKED` | https://cp-civicplusuniversity2.civicplus.com |
| https://www.assemblydems.com | CivicPlus | **yes** | `SERVED_BY` | CivicPlus module paths and its AgendaCenter route — matched "civicplus" on www.assemblydems.com |
| https://www.assemblydems.com | eSCRIBE | no | `SERVED_BY` | eSCRIBE's embedded meeting list — matched "escribe" on www.assemblydems.com |
| https://www.njassemblygop.com | CivicPlus | **yes** | `LINKED` | https://cp-civicplusuniversity2.civicplus.com |
| https://www.njassemblygop.com | CivicPlus | **yes** | `SERVED_BY` | CivicPlus module paths and its AgendaCenter route — matched "civicplus" on www.njassemblygop.com |
| https://www.njassemblygop.com | eSCRIBE | no | `SERVED_BY` | eSCRIBE's embedded meeting list — matched "escribe" on www.njassemblygop.com |
| https://njsba.com | eSCRIBE | no | `SERVED_BY` | eSCRIBE's embedded meeting list — matched "escribe" on njsba.com |
| https://vimeo.com | eSCRIBE | no | `SERVED_BY` | eSCRIBE's embedded meeting list — matched "escribe" on vimeo.com |
| https://portalselfreg-cloud.njcourts.gov | — | — | nothing detected | — |
| https://pub.njleg.gov | — | — | nothing detected | — |
| https://portal.njcourts.gov | — | — | nothing detected | — |
| https://www.state.nj.us | — | — | nothing detected | — |
| https://www.njsendems.org | CivicPlus | **yes** | `LINKED` | https://cp-civicplusuniversity2.civicplus.com |
| https://www.njsendems.org | CivicPlus | **yes** | `SERVED_BY` | CivicPlus module paths and its AgendaCenter route — matched "civicplus" on www.njsendems.org |
| https://www.njsendems.org | eSCRIBE | no | `SERVED_BY` | eSCRIBE's embedded meeting list — matched "escribe" on www.njsendems.org |
| https://www.senatenj.com | CivicPlus | **yes** | `LINKED` | https://cp-civicplusuniversity2.civicplus.com |
| https://www.senatenj.com | CivicPlus | **yes** | `SERVED_BY` | CivicPlus module paths and its AgendaCenter route — matched "civicplus" on www.senatenj.com |
| https://www.senatenj.com | eSCRIBE | no | `SERVED_BY` | eSCRIBE's embedded meeting list — matched "escribe" on www.senatenj.com |
| https://www.morriscountynj.gov | Granicus ViewPublisher | no | `LINKED` | https://granicus.com/product/opencities |
| https://www.morriscountynj.gov | IQM2 / Accela | **yes** | `LINKED` | https://morriscountynj.iqm2.com/Citizens/LegalNotice.aspx |
| https://www.morriscountynj.gov | Granicus ViewPublisher | no | `SERVED_BY` | Granicus ViewPublisher, the video-and-agenda product — matched "granicus" on www.morriscountynj.gov |
| https://www.morriscountyclerk.org | Granicus ViewPublisher | no | `LINKED` | https://granicus.com/product/opencities |
| https://www.morriscountyclerk.org | Granicus ViewPublisher | no | `SERVED_BY` | Granicus ViewPublisher, the video-and-agenda product — matched "granicus" on www.morriscountyclerk.org |
| http://www.mclib.info | Granicus ViewPublisher | no | `LINKED` | https://granicus.com/product/opencities |
| http://www.mclib.info | Granicus ViewPublisher | no | `SERVED_BY` | Granicus ViewPublisher, the video-and-agenda product — matched "granicus" on www.mclib.info |
| http://www.morrisparks.net | eSCRIBE | no | `SERVED_BY` | eSCRIBE's embedded meeting list — matched "escribe" on www.morrisparks.net |
| https://njcourts.gov | — | — | nothing detected | — |
| http://mcweb1.co.morris.nj.us | — | — | nothing detected | — |
| http://mcmua.com | — | — | nothing detected | — |
| https://covid19.nj.gov | eSCRIBE | no | `SERVED_BY` | eSCRIBE's embedded meeting list — matched "escribe" on covid19.nj.gov |
| http://www.state.nj.us | — | — | nothing detected | — |
| https://pub.njleg.state.nj.us | — | — | nothing detected | — |
| https://www.njsba.org | eSCRIBE | no | `SERVED_BY` | eSCRIBE's embedded meeting list — matched "escribe" on www.njsba.org |
| https://njsba.org | eSCRIBE | no | `SERVED_BY` | eSCRIBE's embedded meeting list — matched "escribe" on njsba.org |
| http://www.njsba.org | eSCRIBE | no | `SERVED_BY` | eSCRIBE's embedded meeting list — matched "escribe" on www.njsba.org |
| https://youtu.be | — | — | nothing detected | — |
| https://www.njlm.org | CivicPlus | **yes** | `LINKED` | https://cp-civicplusuniversity2.civicplus.com |
| https://www.njlm.org | CivicPlus | **yes** | `SERVED_BY` | CivicPlus module paths and its AgendaCenter route — matched "civicplus" on www.njlm.org |
| https://www.njlm.org | eSCRIBE | no | `SERVED_BY` | eSCRIBE's embedded meeting list — matched "escribe" on www.njlm.org |
| http://njlm.generalcode.com | eCode360 / General Code | no | `LINKED` | https://ecode360.com/NE3548&quot;,&quot;mapUrl&quot;:null,&quot;pdfOnly&quot;:false,&quot;subdivisionName&quot;:&quot;Co |
| http://www.aberdeennj.org | CivicPlus | **yes** | `LINKED` | https://cp-civicplusuniversity2.civicplus.com |
| http://www.aberdeennj.org | CivicPlus | **yes** | `SERVED_BY` | CivicPlus module paths and its AgendaCenter route — matched "civicplus" on www.aberdeennj.org |
| http://www.aberdeennj.org | eSCRIBE | no | `SERVED_BY` | eSCRIBE's embedded meeting list — matched "escribe" on www.aberdeennj.org |
| https://rockawaytownship.org | CivicPlus | **yes** | `LINKED` | https://cp-civicplusuniversity2.civicplus.com |
| https://rockawaytownship.org | eCode360 / General Code | no | `LINKED` | http://www.ecode360.com/RO0312 |
| https://rockawaytownship.org | CivicPlus | **yes** | `SERVED_BY` | CivicPlus module paths and its AgendaCenter route — matched "civicplus" on rockawaytownship.org |
| https://rockawaytownship.org | eSCRIBE | no | `SERVED_BY` | eSCRIBE's embedded meeting list — matched "escribe" on rockawaytownship.org |
| https://www.alexandrianj.gov | eCode360 / General Code | no | `LINKED` | https://ecode360.com/AL1642?needHash=true |
| https://allowaytownship.com | — | — | nothing detected | — |
| https://www.alphaboronj.org | Revize | **yes** | `LINKED` | https://cms7.revize.com/revize/alphanj |
| https://www.alphaboronj.org | eCode360 / General Code | no | `LINKED` | https://www.ecode360.com/AL0476?needHash=true |
| https://www.alphaboronj.org | Revize | **yes** | `SERVED_BY` | Revize's own name in template paths — matched "revize" on www.alphaboronj.org |
| http://www.alpinenj07620.org | — | — | nothing detected | — |
| http://www.andoverboroughnj.org | — | — | nothing detected | — |

**`LINKED` is the body's own page pointing at a vendor. `SERVED_BY` is a vendor's markup on the body's own
domain — the only route to a vendor that hosts under the customer's name, which a link-out test cannot
find. `DERIVED_LEAD` is a guessed tenant slug and is a LEAD, never a HIT.**
