# Report — remote session, the visual tail

*2026-08-23. Branch `claude/code-review-analysis-sqr1h1`, commit `aac8220`. This is
the session's own close-out report, written to the repo verbatim as delivered so
it is readable by a session rather than only in a chat window (RULING 108).*

## Item endings, by number

| # | Item | Ending |
|---|---|---|
| 1 | Refusal-copy class, swept by pattern | **Done** |
| 2 | DEF: close the class layer | **Done** — 214 → 0 |
| 3 | Absence-to-assertion render defaults | **Done** |
| 4 | LAY-1 and LAY-2 | **Done** |
| 5 | Arizona surfaces | **Partial** — AZ-2/3/4/5 done, AZ-6 kept, **AZ-1 not started** (needs a live statute read) |
| 6 | Reconcile 12 against 8 at 07866 | **Done** |
| 7 | Pin the browser build (`NH91`) | **Done** — 2 of 3 tests now run; the 3rd is a named CANNOT RUN |
| 8 | Rulings | **Done** — 109 and 110 |
| 9 | Tracker and close | **Done** |

## 1. Environment, and the base

- `.env.local` — **absent**, as expected.
- **Only `github.com` is reachable.** `nj.gov` and `en.wikipedia.org` both answer `000` through the proxy.
- **Playwright's Chromium is 1194; the harness wants 1234** — as `NH91` recorded.
- **A local production build runs** — `pnpm build` exits 0.

All four as expected. Base: **`claude/session-setup-nzolw6` at `4c7ae23`** (my branch was already identical to it, 0 commits' divergence).

## 2. Refusal copy — N found, N removed, and the shapes

**N found: 1. N removed: 1.** The instance is still live on `origin/main` at `lib/ballot/battlecard-sections.ts:81` — *"…so we can't describe it here"* — and my sweep catches it under **two** shapes. It was fixed on the branch I built from (`cdd6352`, unmerged), which is why the tree I swept came back at 0 of 365 files.

The **shapes**, not the terms:

1. `intent-not-to-tell` — announces it will not describe/explain/characterise/summarise.
2. `capability-denial` — denies the app's capability to describe the subject.
3. `nothing-to-tell` — declares there is nothing to be told rather than naming what is missing.

The verb list is describe-family **only**, and dropping `say` was a correction: the first draft flagged *"No official boundary is published for this body, so we can't say whether it governs your area"*, which is the render-default rule **working**. Declining a *claim* is required; declining a *description* is the defect. `KNOWN_GOOD` holds seven honest lines this product ships and the test asserts none matches.

## 3. Definitions

- **Class: 1,253 of 1,253** (was 1,013).
- **Form-specific: 216 of 1,253** (unchanged).
- **Neither: 0 of 1,253** (was 214). **No row remains to name.**
- **Districts classified: 510 of 514** (was 295). INDEPENDENT 494, DEPENDENT 16, UNCLASSIFIED 4, 2 TIGER pseudo-entities skipped.

The four still unclassified, individually: **AZ Indian Oasis-Baboquivari** (Census spells it `BABOQUIVARA`), **AZ Tonto Basin Elementary** (Census: `TONTO SCHOOL DISTRICT 33`), **AZ Union Elementary** (its whole distinctive name is *Union*, a structural word in every district name in the country), **NH Prospect Mountain High School Joint Maintenance Agreement District** (not in the 2022 Census of Governments at all — RULING 57's two-enumerations-disagree finding). None renders a refusal.

**The blocker `NH90` named was wrong about the districts.** It was a *lookup* problem, not an evidence problem: the classifier asked the crosswalk, which is the **intersection** of Census and NCES — and that file's own report states 4,083 Census school systems have no NCES match and are absent from it. It was asking the intersection a question only the Census can answer.

**Refusal copy is gone from candidate cards specifically** — confirmed: `battlecard-sections.ts`'s first, mandatory section now names our gap and points at what is held.

**One thing I could not do honestly:** the NH county definition's `basisUrl` is **null**. I had no egress to open RSA 24 or RSA 28, and writing a URL I had not opened is RULING 107's defect. `NH93` carries the confirmation.

## 4. Absence-to-assertion — 4 found, 4 fixed, and the guard

| Where | Was | Now |
|---|---|---|
| `app/ballot/page.tsx` ×2 | `partyLabel ?? "No party label filed"` | renders nothing |
| `candidate-card.tsx` | `bioSourceLabel ?? "source"` | the host, read off the URL already on the row |
| `candidate-card.tsx` | `photoSource ?? "photo"` (alt) | the person's name |
| `agenda-section.tsx` | `extractionNote ?? "extraction failed"` | `"we haven't recorded why"` |

The party label was the real one: a **specific, checkable claim about a named candidate's filing**, made from a null that usually meant nobody had collected it. Every other party surface in the product already guarded on the value; the ballot was the outlier.

Two examined and **cleared**: `startPrecision ?? "MINUTE"` is the established convention (adapters set `"DAY"` explicitly), and `tier ?? "local"` is a single-token type default.

**The guard**: `lib/text/absence-defaults.ts` + `pnpm sweep:absence-defaults` + `tests/absence-defaults.test.ts`. Baseline **only shrinks**; three surviving entries each carry a written reason. It catches all three named instances of the class (JUR-1's *"Governs your area"*, a `"Did not vote"` default, the party label) and passes token defaults.

One defect found and **not** fixed → `NH94`: `coverage.ts` defaults a division-less body's `divisionType` to `"place"`, which closing the class layer made live. Guarded at the definitions path today; the type fix is 39 call sites.

## 5. Layout — how it was verified

**Playwright against a local production build**, DOM assertions, with the captures read as images. Captures read: **`22-15-32`, `22-01-26`, `22-17-11`** — and the sprawl, the horizontal scrollbar with clipped division-type labels, and the crammed filter panel are all visible in them.

**One expanded at a time, confirmed in the DOM.** On arrival: `.sidebar-wgh` 1, `.map-bottom-stack > .coverage-notice` 0, `.stats-collapsed` 1, `.stats-bar` 0. After clicking the counts header: `.stats-bar` 1, `.stats-collapsed` 0, `.sidebar-wgh` 0, `.sidebar-wgh-pill` 1.

**LAY-2's off-centre was arithmetic, not taste.** `.prox-control` carries its own `10px 22px` and sits *inside* `.filters-area`'s `14px 22px`, so two controls inset 44px while every label beside them inset 22px. Measured before and after: everything now sits at **22px**. Every group collapses with its state on the header (`Body type all`, `Date range 90d → 60d`, `District types 8 of 8`…), and a narrowed group opens itself so a set filter can't hide.

Built against the **current** panel, not the 12-body one.

## 6. Arizona

**Duplicate outbound links removed: 2 of 3.** The registration destination resolved three times inside ten lines; it resolves **once** now. Removed: the inline link on the deadline line, and the whole separate checker card. `tests/ballot.test.ts` guards the count at one.

**The pill's destination**: `my.arizona.vote/WhereToVote.aspx?s=individual` — the **Arizona Secretary of State**'s voter portal — inside the next-election box, saying at the point of the tap why it leaves the app.

**AZ-1 confirmed deferred**: hunting-and-fishing and state abortion law each need the law stated with its source named and a **fetch date**. That is a live read. Noted on `AZ01` and `NH83`.

**One thing in the brief I could not apply as written**: *"same pill pattern on the ballot."* The ballot page has **no multi-state selection** — it is built for one zip — so what I applied there is the prominent-pill pattern for the two Secretary-of-State actions. If a different thing was meant, it's a row rather than a guess.

## 7. Twelve against eight at 07866, in one sentence

**The tile counted every body at the reader's point (12) and the panel counted the governing ones (8); the remaining 4 are the boards and committees the panel names in its own next sentence** — so the tile now reads **"Bodies here"** with a second line, *"8 govern here · 4 boards and committees"*, and the pair reconciles on the tile itself.

*(The brief's guess — governments versus component bodies — was close but not it. And `zip-governments.json`'s own 12-against-8 is a **different** pair: 3 statistical CDPs plus Rockaway borough counted in two TIGER layers.)*

## 8. `NH91`

**Pinned**: `playwright` is now an exact version in `package.json` (caret gone), and `EXPECTED_CHROMIUM_REVISION = "1234"` is committed in `lib/ops/chromium-pin.ts`, checked against playwright-core's own `browsers.json` by `tests/chromium-pin.test.ts`.

**Resolved against what's present**: `scripts/browser.mts` launches whatever complete Chromium the image has by explicit path and **prints the substitution**; `ABSENT` throws with the directory searched.

**The 3 tests: 2 now run and pass** on build 1194. **The third cannot** — and it's a finding, not a dodge: its claim is that an unload-time `sendBeacon` escapes `extraHTTPHeaders`, and **on Chromium 1194 the headers do reach it**. Asserting either way would be a claim about a browser this machine doesn't have. It reports `CANNOT RUN` with the build named. `NH96` carries what would close it, and nothing in the repo can — it's a fact about the image.

## 9. Rulings

- **RULING 109** — a brief says what it needs to run, and the session checks before item one. Local-required means credentials, network or production; remote-capable means committed data; **a hunt is always local-required**.
- **RULING 110** — a search that finds nothing must show it looked in the right **form**. Report the shapes, not just the terms — and the instrument has to be shown catching the real thing.

## 10. Tracker

**Opened 4** — `NH93` (NH county `basisUrl` null, data-infrastructure), `NH94` (`divisionType` default, data-infrastructure), `NH95` (the four unclassified districts, data-infrastructure), `NH96` (image ships 1194, repo-ops).

**Needs Sean closed: 1** — **`NH92` ← RULING 109**. It asked exactly the question 109 answers: whether hunt sessions run somewhere with egress or whether container briefs are scoped to rung 1.

**Resolved by the session: 9** — `DI03`, `NH90`, `VF04`, `NH82`, `NH91`, and `NH97`–`NH100`.

**I have to report `NH97`–`NH100` as my own defect**: I ran `tracker add` twice against the same file, so four duplicate rows were created. Only you delete a row, so they are resolved as duplicates of `NH93`–`NH96` rather than removed.

**Noted, not resolved**: `AZ01`, `NH83` (AZ-1 blocked), `DI04` (`governor`/`state_house`/`state_senate` still empty — they're seats, not bodies, which is why closing the layer to 0 didn't close it).

**Open after: 237** — Needs Sean 52, NH hunt 30, NJ hunt 27, AZ hunt 15, Visual feedback 4, Data infrastructure 73, Product/UI 22, Constitution 3, Repo & ops 11.

**What would empty Needs Sean: 45 judgement, 7 work.**

- **Work (7)**: `D70`, `NH31`, `NH32`, `NH33`, `NH43`, `NS06`, `JOB02`.
- **Judgement (45)**: the business and legal set (`B*`, `C*`, `T*`, `V*`, `X*`, `PB10`, `D23`), the photo approvals (`NH26`, `NH30`, `NH65`, `NH78`), the reader-judgement calls (`NH08`, `NH10`, `NH11`, `NS07`, `NS08`), and your own artifacts (`R33`, `R55`, `R56`, `R57`, `NS01`, `NS05`).

## 11. The three-way rendering split

**Bodies that can be described**, of 1,253 registry bodies with a division:

- **Rendering: 1,253 of 1,253** carry a class definition.
- **Out of scope: 0 of 1,253.** Nothing was excluded.
- **In scope and still dark: 1,037 of 1,253** have no *form-specific* definition — their own charter or statute has not been read.

**School-district divisions**, of 516 in the registry:

- **Rendering: 510 of 516** carry an INDEPENDENT/DEPENDENT stamp.
- **Out of scope: 2 of 516** — TIGER pseudo-entities ("not defined"/"unorganized"), which are not districts.
- **In scope and still dark: 4 of 516**, each named above.

## 12. Gates

- **Tests: 1,853 — 1,852 pass, 0 fail, 1 skipped.** (Was 1,847 / 1,843 pass / 4 fail.)
- **Unable to run, named individually: 1** — `tests/beacon-guard.test.ts` › *"an unguarded context leaks — the plant that proves the test can fail"*, `CANNOT RUN` on substituted Chromium 1194.
- **Lint: 0 errors, 12 warnings** — identical to the pre-change baseline, measured by stashing.
- **Build: green.** `pnpm regen` 11 of 11 CURRENT.
- **`pnpm walk:all` COULD NOT RUN and deploy confirmation COULD NOT RUN.** No production access. **Nothing here claims a deploy.**
- `pnpm main:green` reads **CANNOT TELL** — `gh` is absent from this container. Asked GitHub directly instead: main's last human commit `b01f31c` is **green** (Build check run 240); the tip `af17a54` is a `job-watch` bot commit with no check against it — the exact `NH85` shape.

## 13. Branch and commit range

**Branch**: `claude/code-review-analysis-sqr1h1` (pushed).
**Range**: `af17a54..aac8220` — **6 commits** ahead of main, of which the last is mine:

```
aac8220  The class layer closes at 1253 of 1253, and a refusal found by shape   ← this session
4c7ae23  JUR-4 on the ballot: one deliberate annotation…
feb1caf  The hunt at rung 1: two corpora we already paid for…
cdd6352  The refusal clause is gone, the school calendar routes…
040040c  Item 3: the 1,253 and the 174 are different populations…
df95320  A freshness date is written only by the code that read the source…
```

## 14. Where the brief was wrong against the repo

1. **"School districts number 195 unique, not 219."** The registry holds **516** school-district divisions, of which 219 were unclassified. 195 is the count of unique divisions behind the 202 *bodies* carrying neither definition — a different denominator.
2. **"the copy existed under different wording elsewhere."** It exists under the *same* wording — *"so we can't describe it here"* — still live on `origin/main` today. The earlier report's error was the search form, not the wording.
3. **The 12-vs-8 hypothesis** ("a council and a school board under one municipality") isn't it. See item 7.
4. **"Same pill pattern on the ballot"** has no multi-state selection to apply to. See item 6.
5. **"a could-not-run is a build failure rather than a quiet skip"** — I made the *drift* a build failure (`chromium-pin.test.ts`), but made the third beacon test a **named** skip rather than a hard failure. A hard failure would leave `main` red on this image forever, and the repo's own convention (`tests/feedback.test.ts`, RULING 24) is a named CANNOT RUN. If you want the harder rule, that's a one-line change.

**Expansion (RULING 88) does not apply** — this was not a hunt and there were no routes to walk. Saying so rather than filing an empty section.

**RULING 95's credential proof was waived** for this session, per the brief, and no credential was called.
