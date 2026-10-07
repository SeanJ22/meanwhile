# Lane: frontend (Reader pages and components)

**Starts in Codex** (suggested model GPT Sol 6.1). Status file: `.factory/frontend.md` on `stream/frontend`. If the Codex run stops, the Claude `auditors` worker (Opus 5.5) continues this lane on the same branch (common.md, "Paired continuation").

Read `briefs/common.md` first. Your work is every row in `briefs/ownership.csv` with `lane = frontend` (93 rows). Each row's full reason and evidence are in the inventory. Take them in the order below.

**Area.** Reader pages, cards and components; the map UI; reader copy; labels and help text as settings.

**Shared files you own:** The shared reader Card and design tokens.

## 1. What stops free acquisition (rulings §2)

_None._

## 2. Groups

### Group N (1 row)

Inventory: Large, slow-changing reference files (the ZIP index, boundary files) move to wtp-assets and are read through the CDN. Facts (body descriptions, seat makeup, coverage tiers, Arizona text compiled into code) live in the database, where the factory checks and updates them, and are published per state to wtp-assets for readers. Readers never pull these from Neon.

| Path | Action |
|---|---|
| `lib/area/facts.ts` | Place data typed into code for three states. Move these facts into the database as data for every state; keep only the reader function here. |

## 3. The rest

| Path | Action |
|---|---|
| `app/about-area/compare/page.tsx` | Read the facts as data for any state, and delete the tracker and "author's ruling" notes. |
| `app/about-area/page.tsx` | Facts exist for three typed-in states only; any other state gets a blank page. Read facts as data for every state, show "We're working on getting this info" when missing, drop RULING comments. |
| `app/ballot/page.tsx` | Core page with place code and banned copy: NH-only roster preload, matcher from a Morris NJ module, pilot ZIP 07866 link, 'read <date>' lines on the face, 'not X' and 'never' lines, failure disclosure. |
| `app/transparency/page.tsx` | Remove the '(Sean, October 1, 2026)' policy comment; keep the page text in step with the rule that every Ask question is saved with the reader's place. |
| `components/ask/ask-box.tsx` | Ask must answer everything. When we hold nothing it shows a dead-end 'we hold no such thing' line or a refusal with category links. Show the AI answer with a leading label instead. |
| `components/ask/ballot-ask.tsx` | Same dead ends as the map Ask: the UNRESOLVED and refusal branches end without a labeled AI answer. Show the AI answer with a leading label; remove RULING citation. |
| `components/ballot/candidate-positions.tsx` | When nothing is held it renders nothing at all; a section not covered yet must say 'We're working on getting this info'. Remove RULING citations. |
| `components/ballot/incumbency-note.tsx` | The footnote is a disclaimer about our own coverage, which Sean's copy rules ban. Delete the footnote text and marker; keep equal effort as the fix. |
| `components/ballot/incumbent-record-link.tsx` | Keep the link; delete the line 'X currently holds this seat, so there's more information about them', a disclaimer about our coverage. |
| `components/ballot/official-filings.tsx` | Delete the hedge paragraph ('A filing alone does not establish...'); keep the records and their Sources. |
| `components/ballot/polling-lookup-fallback.tsx` | Move the 'Verified <date>' line off the face into the card's Sources section. |
| `components/funding/funding-section.tsx` | Individual money must show as totals plus one share (donors giving $200 or less). Remove RULING citations. |
| `components/funding/government-money-section.tsx` | Mount it in the body card's Money section (BodySections in entity-modal), which its own comment says already happens. |
| `components/map/meeting-listing-notice.tsx` | Shows internal jargon ('Unresolved listing group 1: Calendar listing 1') and a paragraph about what we haven't established. Show the meetings plainly; leave the merge question to Admin. |
| `components/map/popup/agenda-section.tsx` | Delete the reader line listing 'supporting records could not be checked: <authorities>' and 'stored document is unavailable here'; show the agenda link or 'not posted yet'. |
| `components/map/popup/official-modal.tsx` | Show 'working on it' and drop the scope gate once lib carries state committees from Open States. |
| `components/map/popup/official-popup.tsx` | Ask /api/votes for any holder and show 'working on it' when empty. Remove RULING citations. |
| `components/map/voting-sites-panel.tsx` | Show the sites and 'We're working on getting this info'; attempts belong in Admin. |
| `components/map/zip-switcher.tsx` | Delete the banned 'A ZIP is orientation, not your exact districts or ballot' line. |
| `components/officials/member-directory.tsx` | Returns nothing for anyone outside the federal/3-state scope, so state legislators' committees never show. Show 'working on it' and drop the gate once lib carries Open States committees. |
| `components/officials/positions-section.tsx` | When a full search found nothing it shows 'working on it'; Sean's rule says that case reads 'Not found in the sources checked' with the search listed in Sources. |
| `components/officials/public-statements-profile.tsx` | Only Congress members can show a profile; state legislators' PRL profiles are held but blocked. Accept state legislator ids. |
| `components/officials/roster-completeness-gap.tsx` | Shows a paragraph ('We have verified X of Y roster identities... incomplete roster'). Show the verified members and 'We're working on getting this info' for the rest. |
| `components/shell/radius-control.tsx` | Built around the 25/60/150 km widening that lets other places' meetings stand in. Once meetings come from the place's own governments, keep it only as an opt-in filter, not seeded from a widened rung. |
| `components/shell/stats-bar.tsx` | Says 'Nothing closer, so showing meetings from farther out' (another place standing in) and 'No meetings collected for this area yet' instead of 'We're working on getting this info'. Remove citation. |
| `lib/design/copy-settings.ts` | Its comment says Admin imports it, but nothing does, so reader labels can't be edited as data. Import it from Admin's settings registry. |
| `lib/map/initial-zoom.ts` | Every other ZIP gets the default. Drop the table and use one rule for every place. |
| `lib/map/style.ts` | Used by the live map. Comment sends readers to docs/state.md, which is being deleted; point it at the system guide or drop it. |
| `lib/map/viewport-radius.ts` | Map logic is right, but it borrows the meetings radius ladder (25/60/150 km) that is being deleted. Ask for the visible area directly with no 150 km cap. |
| `lib/registry/kinds-settings.ts` | Nothing on the site calls it, so Admin's kind edits never reach readers. Wire readerKinds into the site's labels. |
| `lib/registry/wording.ts` | Has a one-state code table (New Hampshire) for agenda law. Make it data covering every state. |
| `lib/signal/reactions.ts` | Used by the reactions API and ballot page. Remove the "(Sean, 2026-10-01)" and "the author's ruling" attributions in comments. |
| `lib/state/defaults.ts` | Start from the reader's own governments; keep radius only as an optional reader filter. |
| `lib/state/resolved-location.ts` | Used by the site. Delete the RULING 222 banner and the RULING 26/27 discussion in comments. |
| `lib/text/absence-claims.ts` | No live code uses it, but the incumbency tests use it to check cards never wrongly say an official holds no office. Keep it for those tests. Delete the RULING 110/139 citations. |
| `tests/area-facts.test.ts` | Pins the hard-coded three-state list; rewrite to check whatever states the national data holds, keeping the source-citation checks. |
| `tests/bc-26.test.ts` | Real reader behavior; remove numbered-ruling labels and the "Sean photographed" note, including the assertion message citing a ruling. |
| `tests/boilerplate.test.ts` | Real reader behavior; remove the numbered-ruling labels. |
| `tests/brand.test.ts` | Real checks; remove the numbered-ruling comments. |
| `tests/campaign-link-label.test.ts` | Real reader behavior; remove the numbered-ruling labels. |
| `tests/carried-row-reason.test.ts` | Real reader behavior; remove the numbered-ruling comment. |
| `tests/frontend-meeting-scope.test.ts` | Online-only pin test is right, but it pins a 150 km widened search that shows other places' meetings. Meetings must be for the place only. |
| `tests/identity-boundary.test.ts` | Real privacy guard, with numbered-ruling comments to remove. |
| `tests/map-layers.test.ts` | One test pins per-ZIP zoom levels for four pilot ZIPs, a place list in code; also a RULING 116 comment. |
| `tests/meeting-card-title.test.ts` | Remove RULING 114/153/147/110 citations and run the sweep on a fixture instead of the committed snapshot file. |
| `tests/meeting-online-marker.test.ts` | Remove RULING 159/191 citations and the session file-ownership note; the snapshot check should use a fixture, not the committed snapshot. |
| `tests/meetings-online-sitting-visibility.test.ts` | Online-only visibility is real, but test (d) pins the radius-widening ladder that shows other places' meetings, which the plan deletes. |
| `tests/mojibake.test.ts` | Real quality check. Its candidate-card test reads the committed data/ballot/candidate-cards-2026.json; check database data or a fixture instead. |
| `tests/neutrality-guards.test.ts` | Guards "never tell anyone how to vote" and reader privacy. Remove the RULING 103 citation. |
| `tests/pill-cluster.test.ts` | Delete the test that checks DESIGN.md's wording, the tombstone that search-box.tsx stays deleted, and the RULING 116 citation. |
| `tests/pill-sizing-reasons.json` | Read by the kept pill-sizing test. Remove the RULING 105 citation from its note. |
| `tests/representation.test.ts` | Reader rendering behavior; ZIPs are test inputs. |
| `tests/returning-reader.test.ts` | Good reader behavior with no pilot showcase; strip the "Sean, October 1" attributions. |
| `tests/tester-flight-relief.test.ts` | Reader map. |
| `tests/tier-grouping.test.ts` | Tier grouping stays; drop the AZ/NJ/NH loop and the 'state's own domain, never a third party' rule, since non-official sources may publish. |
| `tests/visual-feedback-9-2.test.ts` | Checks real behavior that stays, but carries old ruling or owner-attribution labels; strip those labels and comments, keep the assertions. |
| `tests/wording.test.ts` | Reader copy; points to rulings section only. |

**Check and close (35 rows).** The inventory gives these only comment, citation or deleted-file reference fixes, which the cleanup release was doing. Confirm each is done on `river`; finish any leftover; then close the row: `app/ballot/error.tsx`, `app/error.tsx`, `app/layout.tsx`, `app/questionnaire/[token]/page.tsx`, `components/address/address-prompt.tsx`, `components/address/could-govern-notice.tsx`, `components/address/jurisdiction-pill.tsx`, `components/ballot/ballot-narrowing.tsx`, `components/ballot/jurisdiction-note.tsx`, `components/ballot/picks-card.tsx`, `components/demand/demand-pill.tsx`, `components/funding/state-money-section.tsx`, `components/map/door-overlay.tsx`, `components/map/popup/district-popup.tsx`, `components/map/welcome-overlay.tsx`, `components/officials/contact-pills.tsx`, `components/questionnaire/answer-form.tsx`, `components/reactions/reaction-control.tsx`, `components/speak/speak-your-mind.tsx`, `hooks/use-resolved-location.ts`, `hooks/use-stored-zip.ts`, `lib/db/intake-limiter.ts`, `tests/could-govern-pill.test.ts`, `tests/division-representation.test.ts`, `tests/link-ladder.test.ts`, `tests/maptiler-barrier.test.ts`, `tests/maptiler-key-matrix.test.ts`, `tests/marker-pool-ops.test.ts`, `tests/meeting-list-attribution.test.ts`, `tests/meeting-subline.test.ts`, `tests/motion-tokens.test.ts`, `tests/one-at-a-time.test.ts`, `tests/panel-seats.test.ts`, `tests/person-initials.test.ts`, `tests/pill-sizing.test.ts`.

## Notes

- Sources section: rulings §3. Reader copy: rulings §10. Speed and looking at the live page: rulings §6.
