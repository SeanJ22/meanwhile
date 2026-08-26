# How do they have it, and how do we get it ourselves?

**Item 6 of the sources-and-incumbency brief, 2026-08-26.** The required
analysis for every DERIVED source. A registry entry without this is incomplete.

**When a discovered source carries more than we do, the question is never *can
we take theirs*. It is *how did they get this, and what is OUR route to the same
fact?***

## The four buckets, and the trap

Every THEM-ONLY field is assigned to exactly one, **with evidence, never a
guess**:

- **(a) A primary source we have not walked.** The best case. Register it, walk
  it, report what it yields.
- **(b) They asked.** A survey, a questionnaire, an email, a phone call. **No
  crawler reproduces this.** Our route is asking too — which is what the
  first-party questionnaire already is.
- **(c) They paid, licensed, or partnered.** The honest output is a cost and a
  counterparty, not a route. Propose nothing; the free-source floor stands.
- **(d) A person typed it.** Human editorial labour with no underlying feed.
  **This is the answer sessions skip and it is frequently the true one.** The
  remedy is labour or an argued absence — never a crawler.

**THE TRAP, stated so it is not fallen into: *they have it, therefore it is
gettable* is FALSE.** (c) and (d) are real answers, and when the honest verdict
is one of them the correct output is an argued absence with its reasoning, not a
hunt that runs until it runs out of moves.

---

## Citizens Count — the source that prompted this

`citizenscount.org`, published by the **Live Free or Die Alliance**, a 501(c)(3).
**DERIVED-POINTER.** Terms page answers **HTTP 404** at rungs 2 and 3
(2026-08-26), so **no permission is asserted and nothing is ingested from it** —
stated affirmatively.

### Field-level coverage delta — `03255` / New Hampshire state and federal offices

| Field | Us | Them | Verdict |
|---|---|---|---|
| Officeholder names, state + federal | ✓ | ✓ | **BOTH** |
| Officeholder names, school board / select board / town | ✓ | ✗ | **US ONLY** |
| Meetings | ✓ | ✗ | **US ONLY** |
| Local body definitions and who-governs | ✓ | ✗ | **US ONLY** |
| Ballot measures in plain language | ✓ | ✗ | **US ONLY** |
| Contact — phone and email | ✓ | ✓ | **BOTH** |
| Campaign site | ✓ | ✓ | **BOTH** |
| Roll-call-derived positions on named issues | partial | ✓ | **THEM ONLY** |
| Bill summaries in plain language | partial | ✓ | **THEM ONLY** |
| Candidate biographies | ✗ | ✓ | **THEM ONLY** |
| **Photographs — INCUMBENTS** | partial | ✓ | **THEM ONLY** |
| **Photographs — CHALLENGERS** | ✗ | ✓ | **THEM ONLY** |
| Municipal clerk data | partial | ✓ | **THEM ONLY** |

**US ONLY is reported too**, because it is evidence of where this product is
already ahead: **Citizens Count covers STATE AND FEDERAL OFFICES ONLY.** Its
Newbury page runs president down to NH House and stops — no school board, no
select board, no meetings. That gap is the whole reason this product exists, and
it is registered as a coverage note rather than a criticism.

### Every THEM-ONLY field, bucketed with its evidence

| Field | Bucket | Evidence |
|---|---|---|
| **Roll-call-derived positions** | **(a)** | The roll calls are published by the **NH General Court** — `gc.nh.gov/nhgcrollcalls/` and the `rollcallhistory` table on the public SQL Server, whose schema joins them to a legislator on `EmployeeNo` with no name matching. Registered 2026-08-26. **We are not blocked; we had not asked the body.** |
| **Bill summaries** | **(d)**, with an (a) component | Nobody publishes a plain-language summary of an NH bill as data. The General Court publishes the DOCKET and the bill text — the facts — and the prose is somebody writing it. A staffed nonprofit summarising a session's bills is labour, not a pipeline. **Our route is our own summarisation of a cited primary**, which the never-generate-a-position rule already governs. |
| **Candidate biographies** | **(b)** | Biographical prose about a challenger comes from the candidate. **This is the questionnaire's job**, and RULING 112 already makes it symmetric by construction. |
| **Photographs — INCUMBENTS** | **(a) — AND THE EXPECTED ANSWER IS REFUTED, MEASURED** | The brief expected the legislature's member directory to be a bulk photo primary, on the evidence that Ebel's Citizens Count image is served as `candidate-images/kebelmh5.jpg`, a legislative-directory naming convention. **Walked 2026-08-26: `gc.nh.gov/house/members/member.aspx?member=377093` serves `/house/images/memberpics/nophoto.jpg`.** The General Court does not carry her portrait. So the file name is a convention Citizens Count uses, not a pointer to a General Court asset, and this field is **NOT bucket (a) for New Hampshire.** It reverts to **(b)**. |
| **Photographs — CHALLENGERS** | **(b)**, and the evidence is in the file names | Challenger images sit in **month-dated folders** — `2026-06/`, `2026-07/`, `2026-08/` — uploaded as candidates announced, and the fallback file is literally named **`no-photo-provided.png`**. That name is the evidence: candidates are ASKED for a photo and a silhouette stands in when none arrives. **No crawler reproduces this. The hunt for this portion stops**, and the honest route is asking. |
| **Municipal clerk data** | **(a)** | The **NH Secretary of State** publishes a clerk directory; Citizens Count points at it. Registered 2026-08-26. **Walled at HTTP 403, rungs 2 and 3** — a wall with a date, re-walked on RULING 53's 14-day clock, not an absence. |

### The neutrality consequence, and it is a product rule

**When photos arrive by ASKING, non-responders have none — and a card with a
face reads as more legitimate than a card without one.** That is response rate
rendering as credibility, at the visual layer, where no audit looks.

Citizens Count serves ONE identical silhouette to every such candidate, which is
the right shape. **Audited on our own surfaces, 2026-08-26:** the placeholder is
`IdentityPortrait`, the SAME component with the SAME geometry for every
candidate, rendering initials in an identical circle — the four-door photo rule's
own reason for it. **Not a smaller shape, not a different frame, not a missing
element.** A photo-less candidate's card carries the identical circle at the
identical size.

**Photo-less candidates, measured 2026-08-26 from
`data/ballot/candidate-cards-2026.json`: 46 of 122 curated cards carry no
portrait.** Every one renders the same initials circle.

*Stated as a PAIR, because the two denominators are different measurements and
blending them would be the data-destruction pattern this repo names most often:*
**122 candidates have a curated card at all, against 367 candidate rows across the
four pilot ballots.** So 245 candidates have no card record either way — that is
the hunt gap, not the photo gap, and it is a bigger number than the one this
section is about.

---

## GatherGov — bucket (c), costed and not proposed

`gathergov.com/api`. **It is not a civic-meetings product**: its own page reads
*"America's Real Estate Development Pipeline"*, operated by Turl Street Group
LLC, Dover DE. **No pricing and no licence published** — sales-gated behind
*Book a Demo*.

**Cost: UNPUBLISHED. Counterparty: Turl Street Group LLC. Nothing is
proposed.** The free-source floor stands: every free route in the manifest is
walked and counted first, and this session added `ftp.azsos.gov` and
`gc.nh.gov/downloads/` to that set without spending anything.

---

## `az-civic-tools` — bucket (a) throughout, which is why it is a good pointer

Every THEM-ONLY field it carries names its own primary: bills, sponsors and
votes from **`azleg.gov`**; boundaries from **`irc.az.gov`**. Both registered
2026-08-26. **Nothing about it is bucket (c) or (d)** — it is a volunteer
project reading government data, so our route is the same government data.

Its **organization recommendations** are excluded affirmatively, and that is a
bucket question refused rather than answered: a licence states what may be done,
not what should be.
