# NH — platform tenancy

**Probed 2026-08-26** by `pnpm tenancy --state nh`, over the hosts `pnpm descent` actually saw.

**59 host(s) known · 45 probed · 1 refused on permission (RULING 148).**

| | Count | What it means |
|---|---|---|
| **Reachable now** | **0** | on a platform this project ALREADY reads — the cheapest coverage there is |
| On a platform we do not handle | 2 | scoped work: we know the vendor and have no adapter |
| Nothing detected | 42 | a hunt, not a build. **Not the same fact as the row above** |
| Could not read | 0 | RULING 24 — a check that cannot reach its subject never prints like a pass |

## Every host, and the evidence

| Host | Platform | Adapter? | How we know | Evidence |
|---|---|---|---|---|
| https://www.banking.nh.gov | — | — | nothing detected | — |
| https://www.btla.nh.gov | — | — | nothing detected | — |
| https://www.firemarshal.dos.nh.gov | — | — | nothing detected | — |
| https://www.dncr.nh.gov | — | — | nothing detected | — |
| https://www.courts.nh.gov | — | — | nothing detected | — |
| https://www.nhcdd.nh.gov | eSCRIBE | no | `SERVED_BY` | eSCRIBE's embedded meeting list — matched "escribe" on www.nhcdd.nh.gov |
| https://www.agriculture.nh.gov | — | — | nothing detected | — |
| https://www.nheconomy.com | — | — | nothing detected | — |
| https://www.corrections.nh.gov | — | — | nothing detected | — |
| https://www.energy.nh.gov | — | — | nothing detected | — |
| https://www.des.nh.gov | — | — | nothing detected | — |
| https://www.doit.nh.gov | — | — | nothing detected | — |
| https://www.doj.nh.gov | — | — | nothing detected | — |
| https://www.dol.nh.gov | — | — | nothing detected | — |
| https://www.nhveterans.nh.gov | — | — | nothing detected | — |
| https://www.revenue.nh.gov | — | — | nothing detected | — |
| https://www.dos.nh.gov | — | — | nothing detected | — |
| https://www.dot.nh.gov | — | — | nothing detected | — |
| https://www.dmv.nh.gov | — | — | nothing detected | — |
| https://www.education.nh.gov | — | — | nothing detected | — |
| https://www.wildlife.nh.gov | — | — | nothing detected | — |
| https://www.disability.nh.gov | — | — | nothing detected | — |
| https://www.humane.nh.gov | — | — | nothing detected | — |
| https://www.dhhs.nh.gov | — | — | nothing detected | — |
| https://www.hab.nh.gov | — | — | nothing detected | — |
| https://www.humanrights.nh.gov | — | — | nothing detected | — |
| https://www.insurance.nh.gov | — | — | nothing detected | — |
| https://www.council.nh.gov | — | — | nothing detected | — |
| https://www.judicialcouncil.nh.gov | — | — | nothing detected | — |
| https://gov.liquorandwineoutlets.com | — | — | nothing detected | — |
| https://www.nhlottery.com | — | — | nothing detected | — |
| https://www.nhsec.nh.gov | — | — | nothing detected | — |
| https://www.oplc.nh.gov | — | — | nothing detected | — |
| https://www.public-sector-labor-relations.nh.gov | — | — | nothing detected | — |
| https://www.ase.nh.gov | — | — | nothing detected | — |
| https://www.childadvocate.nh.gov | — | — | nothing detected | — |
| https://www.oca.nh.gov | — | — | nothing detected | — |
| https://www.governor.nh.gov | — | — | nothing detected | — |
| http://www.peasedev.org | — | — | nothing detected | — |
| https://www.pab.nh.gov | — | — | nothing detected | — |
| https://www.pstc.nh.gov | — | — | nothing detected | — |
| https://www.pelrb.nh.gov | — | — | nothing detected | — |
| https://www.puc.nh.gov | eSCRIBE | no | `SERVED_BY` | eSCRIBE's embedded meeting list — matched "escribe" on www.puc.nh.gov |
| https://www.nh.gov | — | — | nothing detected | — |

**`LINKED` is the body's own page pointing at a vendor. `SERVED_BY` is a vendor's markup on the body's own
domain — the only route to a vendor that hosts under the customer's name, which a link-out test cannot
find. `DERIVED_LEAD` is a guessed tenant slug and is a LEAD, never a HIT.**
