# We The People — Visual Walkthrough Feedback, Aug 25 2026 — Part 2

**Source:** dictated visual walkthrough, evening of 8/25, following the morning session in `we-the-people-feedback-2026-08-25.md`. Original document ran as prose with two stray numbered items; roughly 35 distinct issues were in it. This file is the cleaned version. Issue IDs below are authoritative.

**Repo:** https://github.com/SeanJ22/We-The-People.git

**Walkthrough path:** Tucson / Vail, zip 85641 (sidebar → Who Governs Here → meetings → polling locations → map → Vail Unified battlecards) → New Jersey (Morris Hills → Morris County → dark mode → ballot) → New Hampshire (Kearsarge Regional School District).

**Companion documents:** the 8/22, 8/24, and 8/25 morning files. IDs continue from all three. The full set can be handed over together without collision.

---

## Read this first

**Progress since this morning:** the sidebar is close, the Who Governs Here width is right, the Filters push-down behavior is good, and the Vail Unified small battlecard is working well. Sean called each of those out unprompted.

**Two items are now on their third pass.** Role text truncation (LBL-2, first raised 8/22) and the meeting card titling the venue instead of the body (MTG-6, first raised 8/24). Sean's standing instruction on both, in his words: **if it happens once somewhere, assume it happens everywhere.** Fix these at the component level, not the instance.

**One item came back the same day.** BAL-13, the View ballot card width, was specified this morning and is unchanged this evening.

**New surface area:** dark mode was exercised for the first time this session and has its own section. Nothing there was reported before.

---

## 1. Sidebar

### LAY-11 — Empty space when Filters is collapsed
**Where:** sidebar
**Now:** Floating empty space sits in the sidebar when Filters is closed.
**Should:** Remove it. Floating empty space isn't acceptable.
**Keep as-is:** clicking Filters pushes the sidebar down and hides the other pills. Sean's words — I like that, I think that is smart. **That behavior is correct and should not be touched.** The defect is only in the collapsed state.

---

## 2. Alignment — one rule, many surfaces

### ALIGN-1 — Everything reads left to right, nothing indents right
**Where:** Who Governs Here, small battlecards, and every representation list in the product
**Now:** Names sit indented to the right of the district or body they serve, instead of flowing from the left.

**Observed on:**
- Who Governs Here — names under the district they serve
- Who Governs Here — state representatives and the governor
- Kearsarge Regional School District small battlecard
- Morris County small battlecard

**Should:** Move all of it left so the content flows left to right. **This applies to every representative everywhere, not only the ones highlighted in the screenshots.** Sean's instruction: assume this is how all of them look, not just one.
**Screenshots:** two — one highlighting the Who Governs Here names and where they go, one on the Kearsarge small battlecard with a small arrow pointing left

### WGH-10 — Who Governs Here width is right `POSITIVE`
The panel width landed. It looks better. Only the alignment inside it needs work — see ALIGN-1.

### WGH-11 — Asterisks: remove them, or move them next to the word
**Where:** Who Governs Here, Morris County
**Now:** Asterisks are pushed all the way to the right, away from the text they annotate.
**Should:** Either remove them per the 8/24 sourcing standard, or place each one immediately next to the word it annotates, the way an asterisk appears in ordinary text. **Sean is fine with the asterisks existing if they're positioned correctly** — the objection is the placement, not the mark.
**Relates to:** SRC-1 and SRC-3 (8/24). This softens those slightly: asterisks are acceptable when they sit against the word.

---

## 3. Meetings

### MTG-9 — Meeting card still doesn't name the entity `RECURRING — SECOND PASS`
**Where:** zip 85641 → meetings card → Vail School District
**Now:** Clicking the bubble gives no way to tell you're looking at the Vail School District. It says "governing board meeting," which is fine as far as it goes, but nothing identifies the body.
**Should:**
1. **Vail School District** — the entity, at the very top
2. "8 public meetings"
3. The address, as currently rendered
4. "Meetings in the next 30 days"
5. The meetings themselves — "governing board meeting" is correct here

**The point:** the user has to understand what they're looking at. Whether it's Vail School District, a city council, or anything else, the entity name goes at the top.
**Note:** This is MTG-6 from 8/24, which specified exactly this for Tucson Unified. Not fixed, and now confirmed in a second jurisdiction. Fix it at the card component.
**Screenshot:** yes — also carries the MTG-10 highlights

### MTG-10 — Extra lines in the meeting card
**Where:** same card
**Now:** Extra lines that serve no apparent purpose.
**Should:** Remove them. Highlighted in the same screenshot as MTG-9.

### MTG-11 — Meetings card stays up when the user clicks away
**Where:** meetings card, when clicking "Where can I vote?", Ask, or Change Zip
**Now:** The Public Meetings card on the right stays open.
**Should:** Minimize it. Clicking anywhere else means the meetings card goes back to not being viewed.
**Relates to:** BC-16 (8/25 morning) — same one-card-at-a-time rule, now extended beyond cards to Ask, Change Zip, and the voting controls.
**Screenshot:** yes — arrow marking what should minimize

---

## 4. Polling locations

### VOT-1 — Show the nearest polling places, not the whole county
**Where:** "Where can I vote?" after entering an address
**Now:** Returns everywhere in the county the user can vote. **That's the right behavior and stays.** The problem is the ordering — the location at the top of the list is several miles from the address entered.
**Should:** Draw a radius on the map — roughly 10 miles — around the entered address, and surface the closest locations first. Point the user at the nearest one while keeping the full county list available.
**Scope:** across the board, not scoped to this example.

---

## 5. Map behavior

### MAP-2 — Center the map on what the user clicked
**Where:** map, clicking any shaded area — school district, state house district 19, AZ-6
**Now:** The shaded area renders off-center, which reads as odd.
**Should:** The map moves to center the selected shaded area. Whatever the user clicked becomes front and center.
**Screenshot:** yes

### MAP-3 — Two cards on area click `POSITIVE`
**Where:** clicking an area on the map, e.g. View Vail Unified School District
**Now:** Who Governs Here and the Vail Unified School District card both appear.
**Note:** Sean likes this. It's very clear. Keep it. Note this coexists with the one-card-at-a-time rule in MTG-11 and BC-16 — **these two cards appearing together on an area click is intentional and is not the overlap defect.**

---

## 6. Vail Unified battlecards

### BC-25 — Small battlecard is working `POSITIVE`
**Where:** Vail Unified small battlecard
**Now:** "Who runs it" shows Alison Pratt, Governing Board President. "Runs it day to day" shows the superintendent.
**Note:** Sean's words — super clear, looks really good. **This is the reference pattern for the who-runs-it / runs-it-day-to-day split.** See OFF-7 for the New Hampshire case where the same fields are populated wrong.

### OFF-6 — No photo for the Vail superintendent
**Where:** John Carruth large battlecard
**Now:** No picture.
**Should:** The photo is on the Vail Unified website.
**Standing rule for all school districts:** superintendent photos are easy to find and are almost always on the district site under a link that simply says "superintendent." Capture them everywhere.
**Note:** Sean allows that 85641 may not have been through the Arizona hunt yet, so this specific instance may resolve on its own. The standing rule applies regardless.
**Relates to:** OFF-3, OFF-5 — third session with a missing-photo report.

### BC-26 — Superintendent labeled "incumbent"
**Where:** John Carruth large battlecard
**Now:** Shows "incumbent."
**Should:** Superintendents aren't elected in the Vail School District. The incumbent label applies to elected offices only — branch on whether the role is elected before rendering it.

### BC-27 — Speak Your Mind text is squished in the pill
**Where:** John Carruth large battlecard → Speak Your Mind
**Now:** "What would you say if John Carruth were standing in front of you?" is crammed into the pill with no breathing room.
**Should:** Better, clearer spacing. Padding and line treatment inside the pill.
**Keep as-is:** the navy blue and white in light mode looks better and Sean likes it. Only the text spacing changes.
**Screenshot:** yes — red outline on the affected area

---

## 7. New Jersey

### BC-28 — Morris Hills Regional School District has no leadership data
**Where:** clicking the Morris Hills Regional School District area
**Now:** "We haven't sourced who runs it yet."
**Should:** Source it. Sean finds this hard to believe given New Jersey was supposed to be complete — worth checking whether the NJ hunt actually finished or silently skipped districts.
**Screenshot:** yes

### LBL-2 — "President" still truncated `RECURRING — THIRD PASS`
**Where:** Morris County — Stephen H. Shaw, president. **Both the small battlecard and the large battlecard.**
**Now:** The final letter is still cut off, in both card sizes.
**Note:** First reported 8/22 on this exact person. Reported again 8/24 on Tucson. Still broken. **Sean's standing instruction: if it happens once somewhere, assume it happens everywhere.** This is a shared text-bounds defect, not three separate bugs — fix the component and audit every surface that renders a role.
**Screenshot:** yes — the large battlecard case

---

## 8. Dark mode

New surface this session. None of this was reported before.

### DARK-1 — Map lines are overwhelming in dark view
**Where:** map, dark mode
**Now:** The lines and yellow are overwhelming. The same rendering reads fine in light mode.
**Should:** Tone down the contrast. Sean isn't specifying the exact fix and doesn't want a full rework — the direction is to reduce the intensity so the map is readable rather than shouting.
**Screenshot:** yes

### DARK-2 — Speak Your Mind disappears in dark mode
**Where:** Speak Your Mind pill, dark mode
**Now:** Navy blue with white font, which works in light mode and fades into the background in dark mode.
**Should:** Invert the logic. Everything else in dark mode is white font on a dark background, so the pill goes **lighter blue with black font** — the contrast is what makes it the obvious thing to click.
**Principle:** the pill's job is to stand out from its surroundings. That means a different treatment per theme, not one color used in both.
**Screenshot:** yes

### DARK-3 — No theme toggle on the ballot page
**Where:** ballot page
**Now:** Switching between night and day mode requires going back to the map, toggling there, and returning to the ballot.
**Should:** A toggle available on the ballot page itself, and the setting **persists across the session no matter where it's switched.**

---

## 9. Ballot

### BAL-14 — View ballot card: width still wrong, and it vanishes in dark mode `RECURRING — SAME DAY`
**Where:** ballot page, every candidate; observed on Cory Booker
**Now:** Not the width of the "Would you vote for them?" box. In dark mode the dark blue and white fades into the background.
**Should:**
- **Width:** matches the "Would you vote for them?" box. Sean highlighted the intended width in the screenshot.
- **Color:** the navy treatment doesn't survive dark mode. Options Sean raised — a lighter blue, or a lighter green. **Green has a specific advantage: it avoids competing with the red and blue of party affiliation.** Either way it changes.
**Note:** specified this morning as BAL-13 and unchanged. Sean: I asked for that last time, it is not done.
**Screenshot:** yes — width highlighted

### BAL-15 — Candidate taglines need a sourcing system
**Where:** ballot page, all candidates; observed on Cory Booker and Veronica Hernandez
**Now:** The tagline renders inline on the ballot — for Booker, campaign language about being a fighter for New Jersey and rejecting lobbyist and corporate PAC donations — with no indication of where it came from. Campaign site, email address, and mailing address also sit on the ballot page as extra text.
**Should:**
- Put the tagline in quotes and attribute it.
- Move campaign site, email address, and address **into the battlecard**.
- Annotate the source in the battlecard's Sources section: the tagline at the front of the ballot card comes from the campaign's own website.
- The information matters — it's the placement that's wrong. It's extra text on the ballot page and belongs one level deeper.

**Why:** we always want people to choose the battlecard, in the campaign's own words. Stripping the ballot page drives them there.
**Scope:** persistent across all ballots. The two named candidates are examples.
**Screenshot:** yes
**Name note:** dictated here as "Veronica Hernandez"; the 8/22 document has "Veronica Fernandez" for the same New Jersey independent Senate candidate. Defer to the app.

### BAL-16 — Auto-collapse the campaign finance breakdowns
**Where:** large battlecard → campaign funds; observed on Cory Booker
**Now:** "Where that money came from" and "What kind of money it was" are expanded by default.
**Should:** Collapsed by default. The information under there is good and valuable — the user opens it by choice.
**Relates to:** BAL-8 (8/24) — same collapse-by-default rule applied to propositions.
**Screenshot:** yes

### BAL-17 — No candidate photos on ballot battlecards
**Where:** ballot → large battlecard, **both Arizona and New Jersey**
**Now:** No picture at all.
**Should:** The ballot battlecard should look the same as the map battlecard — photo included. Same person, same card, same rendering. The map version is the reference.

### BAL-18 — Party affiliation should be a colored pill
**Where:** ballot → large battlecard
**Now:** "Democratic" renders as gray text.
**Should:** A colored pill — blue, red, green, whatever the party's color is. Matches how the map battlecard does it. Sean's emphasis: it should look very, very similar to the map version.

### BAL-19 — Speak Your Mind belongs on the ballot too
**Where:** ballot section
**Now:** Absent.
**Should:** The Speak Your Mind pill appears here as well, so people can jot down what they'd want to say.

### BAL-20 — Incumbency isn't clear on the ballot card
**Where:** ballot card, all candidates
**Now:** Cory Booker is the incumbent and nothing says so clearly.
**Should:** **The ballot card is exactly where incumbency should be stated.** Make it prominent.

### BAL-21 — No Add to Calendar for the registration deadline
**Where:** New Jersey ballot — register to vote by October 13th, 2026
**Now:** November 3rd has Add to Calendar. In-person voting has Add to Calendar. The registration deadline doesn't.
**Should:** Add it. Every date that matters gets the same treatment.
**Relates to:** MTG-4 (8/22) — calendar events carry full detail.

### BAL-22 — Shadowing on the voting pills `POSITIVE`
The shadowing around "Where can I vote" and "Check whether you're registered to vote" looks really good. Sean likes it a lot. Keep it, and treat it as the reference for pill styling elsewhere.

### BAL-23 — "Narrow it" layout is broken `URGENT`
**Where:** New Jersey ballot → clicking "narrow it"
**Now:** Wrapping around on the left and running into everything else on the page. Sean's words — very ugly, convoluted, a disaster.
**Should:** Fix immediately. This is the worst visual defect in the session.
**Screenshot:** yes
**Relates to:** WGH-5 (8/22) — this is the address-narrowing flow, which should be running through the shared street-first component.

### BAL-24 — Duplicate annotations at the bottom of the ballot
**Where:** New Jersey ballot, bottom annotations
**Now:** Multiple annotations saying the same thing. "No local election" appears twice.
**Should:** Deduplicate. Worth finding why it's happening rather than filtering the output — a repeated annotation usually means the same record is being pulled through two paths.

---

## 10. Ask

### ASK-12 — Out-of-scope questions: use the Claude API? `QUESTION — NOT A SPEC`
**Where:** Ask
**Observed:** Sean tested with "Why is it raining?" — deliberately unrelated to the product. Response: no sourced answer for this.
**Sean's question:** could the Claude API handle questions like this, or is that outside scope?

**This is a product decision, not a defect.** Worth noting the current behavior is defensible — a civic app declining a weather question is honest, and the whole trust posture rests on not answering things it can't source. A general-purpose fallback would need clear separation between sourced civic answers and unsourced general ones, or it undermines the sourcing discipline everywhere else. Needs Sean's call before anyone builds toward it.

---

## 11. New Hampshire — Kearsarge Regional School District

**Sean's note:** he's aware he keeps landing on school districts and says that isn't indicative of the app's primary focus — they're just convenient examples. Don't read district-specific priority into this section.

### OFF-7 — Business administrator listed above the superintendent
**Where:** Kearsarge Regional School District, small and large battlecard
**Now:** Lawrence LaBouf, business administrator, sits at the top and in the "runs it day to day" slot. The data **does** contain an interim superintendent of schools, Michael Bissette.
**Should:** The superintendent or interim superintendent is always at the top and always fills "runs it day to day." Never the business administrator.
**Note:** The data is there — this is a selection and ordering bug, not a sourcing gap. Contrast with BC-25, where Vail Unified populates the same two fields correctly. That card is the reference.
**Relates to:** OFF-4 (8/24) — superintendent ordering, same rule.
**Also verify:** whether LaBouf is business administrator, acting superintendent, or both. Sean flagged it as worth triple-checking. *(Names uncertain from dictation — see the naming rule.)*

### BC-29 — Speak Your Mind has its own scroll region
**Where:** Kearsarge large battlecard
**Now:** The Speak Your Mind pill at the bottom sits in a small scroll area of its own.
**Should:** A floating pill fixed at the bottom. **Only the board member list scrolls.** Speak Your Mind stays put and is never covered by anything.

---

## Cross-cutting themes

1. **Left alignment everywhere.** ALIGN-1. One rule across Who Governs Here, small battlecards, and every representation list. The single most repeated visual complaint in this session.
2. **Component-level fixes, not instance fixes.** LBL-2, MTG-9, OFF-6. All three are third or second sightings of a defect already reported elsewhere. Sean's rule: if it happens once, assume it happens everywhere.
3. **Dark mode is a first-class theme.** DARK-1 through DARK-3, BAL-14. Colors chosen for light mode don't survive. Anything whose job is to stand out needs a per-theme treatment.
4. **Ballot battlecards should match map battlecards.** BAL-17, BAL-18, BAL-19. Photo, party pill, Speak Your Mind. Same person, same card, same rendering.
5. **Move detail into the battlecard.** BAL-15. Campaign site, email, address, and tagline sourcing all come off the ballot page. The ballot points; the battlecard holds.
6. **Collapse by default.** BAL-16, plus BAL-8 and LAY-6 from 8/24. Long content is a pill the user chooses to open.
7. **One thing up at a time.** MTG-11, extending BC-16. Clicking anything — including Ask, Change Zip, and voting controls — dismisses what was open. The MAP-3 two-card pattern is the deliberate exception.
8. **The superintendent is the top of a school district.** OFF-6, OFF-7. Photo captured, listed first, filling "runs it day to day."

---

## Screenshots

**Location:** Google Drive → We the People → Screenshots from Feedback → 8.25 → **Part 2**
**Folder link:** https://drive.google.com/drive/folders/1phM3G9oU9J99BOy1tMtrpw11cSn0a9S6

25 screenshots, captured 17:17:53 through 17:53:26. Roughly 17 were promised during the dictation; the rest are context shots.

**Proposed mapping, by timestamp against the walkthrough sequence.** Confirm before building — inferred from timing, not image contents.

| File | Time | Likely issue |
|---|---|---|
| 2026-08-25_17-17-53.PNG | 17:17 | LAY-11 — sidebar empty space, Filters collapsed |
| 2026-08-25_17-18-13.PNG | 17:18 | WGH-10 / ALIGN-1 — Who Governs Here width and name alignment |
| 2026-08-25_17-18-44.PNG | 17:18 | **ALIGN-1 — names highlighted with intended position** |
| 2026-08-25_17-20-07.PNG | 17:20 | **MTG-9 / MTG-10 — Vail meetings card, entity name and extra lines** |
| 2026-08-25_17-22-03.PNG | 17:22 | MTG-11 — arrow marking what should minimize |
| 2026-08-25_17-23-22.PNG | 17:23 | VOT-1 — polling locations after address entry |
| 2026-08-25_17-25-38.PNG | 17:25 | MAP-3 — two cards on area click *(696 KB)* |
| 2026-08-25_17-28-02.PNG | 17:28 | MAP-2 — off-center shaded area |
| 2026-08-25_17-28-27.PNG | 17:28 | BC-25 — Vail Unified small battlecard |
| 2026-08-25_17-30-28.PNG | 17:30 | OFF-6 / BC-26 — John Carruth, no photo, "incumbent" |
| 2026-08-25_17-30-58.PNG | 17:30 | **BC-27 — Speak Your Mind text squished, red outline** *(1.4 MB)* |
| 2026-08-25_17-32-34.PNG | 17:32 | BC-28 — Morris Hills, no leadership sourced |
| 2026-08-25_17-33-03.PNG | 17:33 | WGH-11 / ALIGN-1 — asterisk placement and left alignment |
| 2026-08-25_17-33-54.PNG | 17:33 | LBL-2 — truncated "president," large battlecard *(1.65 MB)* |
| 2026-08-25_17-34-50.PNG | 17:34 | DARK-1 — dark mode map lines |
| 2026-08-25_17-35-14.PNG | 17:35 | DARK-2 — Speak Your Mind in dark mode |
| 2026-08-25_17-37-45.PNG | 17:37 | **BAL-14 — View ballot card, width highlighted** |
| 2026-08-25_17-41-20.PNG | 17:41 | DARK-3 — no theme toggle on the ballot |
| 2026-08-25_17-42-48.PNG | 17:42 | BAL-15 — tagline and campaign contact text to move |
| 2026-08-25_17-44-07.PNG | 17:44 | BAL-16 — campaign finance expanded by default |
| 2026-08-25_17-44-49.PNG | 17:44 | BAL-17 / BAL-18 — missing photo, gray party text |
| 2026-08-25_17-46-00.PNG | 17:46 | BAL-20 — incumbency not clear |
| 2026-08-25_17-49-29.PNG | 17:49 | BAL-21 — registration deadline, no Add to Calendar |
| 2026-08-25_17-51-51.PNG | 17:51 | **BAL-23 — "narrow it" broken layout** |
| 2026-08-25_17-53-26.PNG | 17:53 | BAL-24 — duplicate bottom annotations |

**Four are specifications rather than illustrations.** 17:18:44 shows where the names go. 17:20:07 carries the meeting card structure and the extra lines to cut. 17:30:58 has the red outline on the squished text. 17:37:45 highlights the intended View ballot card width.

**Two sections have no screenshot coverage.** The last capture is 17:53:26, and the dictation continues past it through the Ask test (ASK-12) and the entire New Hampshire section (OFF-7, BC-29). The Kearsarge small battlecard arrow Sean described appears not to have been captured. Both sections are prose-only — ALIGN-1 covers the Kearsarge alignment through the Who Governs Here screenshots, but OFF-7 and BC-29 have no visual reference.

---

## Naming rule

Still in force from 8/22. Every person named here came from dictation and the spellings are unreliable. **The app's existing spelling is authoritative** — match what the app renders, and don't correct an in-app spelling against this document or an outside source.

Uncertain in this session: Alison Pratt, John Carruth, Stephen H. Shaw, Lawrence LaBouf (dictated as "LaBouf, or LeBeouf"), Michael Bissette, and Veronica Hernandez / Fernandez — see the note in BAL-15.

---

## Carryover status

| Item | First raised | Status | Now |
|---|---|---|---|
| **Role text truncation** | 8/22 (LBL-2) | **Not fixed — third pass** | Both small and large battlecard, Morris County |
| **Meeting card names the venue** | 8/24 (MTG-6) | **Not fixed — second pass** | MTG-9, second jurisdiction |
| **View ballot card width** | 8/25 AM (BAL-13) | **Not fixed — same day** | BAL-14, plus a dark mode problem |
| **Superintendent ordering** | 8/24 (OFF-4) | **Not fixed** | OFF-7, business administrator on top |
| **Missing official photos** | 8/22 (OFF-1) | **Not fixed — third session** | OFF-6, Vail superintendent |
| **One card at a time** | 8/25 AM (BC-16) | **Not fixed** | MTG-11, now extends to Ask and voting controls |
| Sidebar height and width | 8/25 AM (LAY-7, WGH-8) | **Mostly fixed** | Width is right, Filters behavior is good. LAY-11 is the remainder. |
| Speak Your Mind polish | 8/25 AM (BC-18–22) | Partially fixed | Light-mode styling improved. BC-27, BC-29, DARK-2 are new defects on it. |
| Asterisks in Who Governs Here | 8/24 (SRC-1, SRC-3) | Not fixed | WGH-11 — and Sean has relaxed the requirement |

---

## Open items needing Sean's input

**SUPERSEDED — see `## Resolutions` below.** Sean ruled on every line in this
section on 2026-08-25, before the session that acts on this document opened. The
section is kept rather than deleted, because a deleted question comes back as
drift (RULING 99's reasoning, applied to a feedback document).

- **ASK-12** — whether to route unsourced questions to the Claude API. Product decision with real implications for the sourcing discipline. Needs a call.
- **DARK-1** — the direction is "tone down the contrast," and Sean explicitly didn't specify the fix. Needs a proposal to react to.
- **BAL-14** — lighter blue or lighter green for View ballot card. Sean leaned green to avoid clashing with party colors but didn't settle it.
- **OFF-7** — confirm whether Lawrence LaBouf is business administrator, acting superintendent, or both.
- **BAL-12** — still open from this morning. Pill sizing uniformity.
- **BAL-11** — still open from this morning. Placement of the two link-to-pill conversions.
- **OFF-5** — still open from this morning. Rockaway photos: fetch problem, or waiting on Sean?

---

## Resolutions

**Recorded 2026-08-25 from Sean's own rulings, given in the brief for the
part2-0825 session.** These supersede the section directly above. Every one of
them is a decision, not a question — the session that acts on this document
returns none of them to him.

| Item | His ruling |
|---|---|
| **ASK-12** | **BUILD IT**, with hard separation — *try it while it's in testing.* Out-of-scope questions route to the Claude API. Unsourced answers are explicitly and visibly marked as unsourced in plain language, carry **no** Sources section, and never borrow the sourced answer's chrome. The routing sits **behind a flag, ON in testing**. Sourced civic answers are unchanged: if a question can be answered from sources, it is — the fallback is last, never first. |
| **BAL-14** | **SETTLED. Green.** Width matches the *"Would you vote for them?"* box per the highlighted capture; colour is green, in both themes. Not open, not to be raised again. |
| **DARK-1** | **PROPOSAL IS THE DELIVERABLE.** He has said all he intends to say — tone down the contrast, no rework. Two or three concrete options with side-by-side captures in both themes and a recommendation. **No map colour change ships** until he reacts. |
| **OFF-7 title** | **The session determines this.** Whether that person is business administrator, acting superintendent, or both is a fact on the district's own website, not a matter of judgement. Go and read it, report what the district publishes and the URL. The naming rule still governs spelling — the app's spelling wins. It becomes a row only if the district publishes nothing, and then the record says what was walked. |
| **OFF-5** | **The session determines this.** *Fetch problem or waiting on Sean* is answerable from the session's own logs and a retry. Attempt the fetch. On failure, report the error and the source URL. On success, the photos queue for Sean under his standing 8/25 blanket approval. |
| **BAL-12** | **DERIVE AND SHIP.** Measure every pill the product renders, across surfaces and both themes; where sizes differ without a reason, make them uniform. The voting-pill treatment (BAL-22) is the reference. Report the denominator. |
| **BAL-11** | **DERIVE AND SHIP THE UNAMBIGUOUS PART.** Find both link-to-pill conversions, capture them in place, propose a placement with captures. Ship it where the correct placement is obvious from the surrounding layout; otherwise present the captures and a recommendation — **a recommendation, not a question.** |

**Standing rulings that also govern this document.**

- **Every item here is an EXAMPLE; the defect is the CLASS** (RULING 136). A
  screenshot of one truncated role label is a report that role labels truncate.
  An item closed at the instance and open at the class is not done, and every
  close carries its class denominator.
- **The annotated captures are SPECIFICATIONS and outrank this prose**
  (RULING 137). Four of them: the name-position markup, the meeting-card
  structure with the lines to cut, the red outline on the squished pill text,
  and the highlighted intended width of the View ballot card.
- **The naming rule is in force.** The app's spelling wins against this
  document and against any outside source.
- **Photos queue for Sean** under his standing 8/25 blanket approval. **The
  wordmark refusal stands** — none is to be generated.
- **These protected behaviours were called out as working and regressing any
  of them is a session failure:** the Filters push-down, the Who Governs Here
  panel width, the MAP-3 two-card pattern, the Vail Unified small battlecard,
  light-mode navy-and-white Speak Your Mind, and the shadowing on the voting
  pills.
