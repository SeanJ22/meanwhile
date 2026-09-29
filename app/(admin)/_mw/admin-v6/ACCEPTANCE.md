# Admin v6 — the one UI acceptance and dependency ledger

Owner of this file: Claude Code (UI assignment, Codex boundary note 2026-09-28 12:12 MST). Codex owns backend contracts, route integration, release and full product acceptance. This is the only UI ledger; update it instead of writing new audits.

Last updated: 2026-09-28, 1:30 PM MST. Branch `claude/meanwhile-admin-interface-021afd` (worktree `C:\Users\seanj\dev\we-the-people\.claude\worktrees\sleepy-lumiere-80f495`), base `72be6002`.

**States used below.** *Not built* · *Built with fixtures* (works against labelled sample data in the dev-only preview) · *Connected* (reads/acts through a deployed or Codex-accepted contract) · *Verified* (proved end to end on the real build) · *Blocked by DEP-…* (named missing backend interface; the UI shows a recoverable "Not connected yet — turns on by itself" state and picks the data up automatically when Codex announces it).

**Honest summary.** UI work ready for integration; these product requirements remain blocked on the named Codex dependencies. Nothing here is "product complete". All sample figures are examples. No action was sent to production, no paid work was started, and the 85635 hunt and its $50 lifetime allowance were not touched.

**Codex integration update, 2026-09-28 14:52 MST.** The authenticated Money and Hunts read adapters from Claude's four committed increments are integrated locally. A saved 85635 lifetime receipt and its published billing attribution supply real scoped values; the same open v6 component picks them up in focused tests. A trusted place adapter now locates the saved hunt in national and Arizona views; no general county/ZCTA overlap is inferred. The shared pulse announces these two read contracts only while the saved policy and owner snapshot are readable, with revisions tied to their source rows. The account-period selector now requests the selected month and names `DEP-PERIOD` for unsupported last-24h or whole-hunt account figures, clearing earlier figures while it waits. The hunt limit remains explicitly lifetime. **This is local integration, not hosted acceptance**; per-work costs, complete other-service bills, run state and most period splits remain unknown. Checklist place binding is separately integrated but its production index is absent, so checklist instances remain unannounced.

**Codex integration update, 2026-09-28 15:35 MST.** Claude's bounded authenticated Workers read is picked up and announced by the existing single pulse. It uses saved policy, research state, heartbeat, up to 25 source receipts, and point reads for at most 16 listed Scouts. The exact 85635 receipt binds place rows; repeated source failures collapse into one event; expired leases are not shown as running; a heartbeat is not credited as progress. A read-only production probe found 51 of 194 assigned tasks unfinished and a repeated `RECEIPT_COUNT_INVALID` voting-site source failure. The full active-job list remains unknown (`DEP-WORKER-ACTIVE-INDEX`) because plain-code collection attempts are outside the bounded Scout list. The UI now labels whole-system lane counts explicitly and names the missing active-job index. Local focused Workers/pulse/UI checks pass; this is not a hosted operator acceptance or a claim that voting sites were delivered. The all-definition checklist backend page is also integrated, but v15 and its post-publish head are absent, so the pulse does not announce it. The history trigger remains staged and unapplied.

**Codex integration update, 2026-09-28 17:35 MST.** The new Claude Workers/Now follow-up (`dec32c9c`, `e14100f6`, `d8c8287f`) is integrated locally through `f2431a61`. It shows each saved missing part beside the affected card, names the selected place and whole-system counts, keeps unknown jobs and version unknown, and advances age wording through the existing pulse. The four focused suites pass 55/55 on the integrated branch. A separate local adapter repair `d34013ff` retains only same-scope last-good Workers detail on transient HTTP/network failure, clears it on 401/403 or incompatible contracts, and rejects late in-flight responses after incompatibility; focused tests pass 18/18. No hosted operator acceptance or complete active-job/version read is claimed. An unsent instruction draft still disappears on internal screen navigation; preserving it by exact place without automatic sending remains owed. This is the same acceptance ledger, not a second one.

**Codex integration update, 2026-09-28 17:41 MST.** Local commit `2d5451ee` lifts the unsent instruction draft to the mounted command center, keyed by exact selected place. Internal screen changes preserve it; place changes show only that place's own draft and discard the previous actionable read-back, so nothing is sent or retargeted automatically. The focused instruction/v6 suite passes 21/21. Hosted keyboard and operator acceptance remain open. This repairs the local draft gap named above without implying that the missing instruction executors are connected.

---

## 1. Contract (agreed in principle with Codex, 2026-09-28 20:18 UTC)

Source: `C:\Users\seanj\dev\meanwhile-evidence\delivery-repair-20260928\admin-v6-claude-contract-request.md` ("Codex response"). UI side: `contract.ts`, `model.ts`.

| Part | Agreed shape | UI implementation |
|---|---|---|
| Announcement | Optional `LivePulse.v6 = { version: 1, sections: {id: {contract, href, revision}}, actions: {kind: {contract, type, requiresStateVersion}}, receiptLookup? }`, emitted only once the exact backend exists | `capabilitiesOf()` (same-origin `/api/admin/…` only) |
| One poller | Consume the shell's single `LiveRefresh` poll through `meanwhile:admin-pulse` | `usePulseFeed()` listens; never fetches `/api/admin/live` (test-guarded) |
| Section read | `GET <href>?scope=<placeKey>[&limit&cursor&q&filters]` → `{contract:"admin-v6/<id>@1", scope, revision, asOf, data, missingParts?, page?}` | `LiveSync` |
| Status meanings | 200 data (valid empty = empty only for the defined universe) · 401/403 denied (not retried) · 409/contract mismatch incompatible (not retried) · other temporary (3 bounded retries, 2 s/8 s/30 s, last good data kept) | `LiveSync.settle()` |
| Paging | Indexed sections need `limit`, `cursor`, exact/unknown `total`; never the whole population per pulse | `PAGED_SECTIONS` = workRows, history, checklist, fixes; `limit=50`; `useListView()` sends search/filters/cursor to the server when `page` is present |
| Actions | Existing `POST /api/admin/action`; exact registry input keys per `admin-v6/action/<kind>@1`; `stateVersion` = latest pulse revision when `requiresStateVersion`, else `null`; `ok:false` 200 is a durable refusal | `actionInput()`, `liveExecutor()` |
| Receipt lookup | `GET <href>?type=<gateway type>&key=<idempotency key>` → `{contract:"admin-v6/receipt@1", receipt \| null}`, never resubmits | `liveExecutor().check()` |
| Place keys | `us`, `st:<usps>`, `geo:<st>.<type>.<geoid>` accepted; `body:<id>` deferred until body identity/overlap is proven | `places.ts`; body keys exist only in the sample |

**Codex acceptance still needed:** the exact per-kind input keys in `actionInput()` are the UI's proposal for each `admin-v6/action/<kind>@1`; Codex implements or amends them per action before announcing it. The `page` envelope field names (`total`, `nextCursor`, `prevCursor`) are the UI's proposal; Codex confirms when the first paged section is built.

---

## 2. The 15 design journeys (handoff-v6 ACCEPTANCE-AND-GAPS §1)

Evidence runs: local dev server, dev-only preview `/admin/v6-preview` (sample data; 404 outside development; removed before the handoff commit), Playwright with a signed local session. Captures in the gitignored `.scratch/v6/` (desktop 1440 px, phone 390 px). Automatic-pickup run: `.scratch/v6-autopickup.mts` on the PRODUCTION component with `/api/admin/live` intercepted in the browser only.

| # | Journey | ADMIN refs | UI state | Evidence | Production dependency |
|---|---|---|---|---|---|
| 1 | See the country and open a state; "← United States" everywhere | 02, 05 | Built with fixtures; 56-tile map + sortable table **connected** to real `US_STATES` | Desktop + 390 px captures; map tile and table open a state by mouse and keyboard (K0, K9) | Per-state totals: **Blocked by DEP-NATIONAL** (shows "Not reported yet", never 0) |
| 2 | Find a stuck local result and follow its proof (six stages, saved files, exact public page, time seen) | 03, 04, 06, 14 | Built with fixtures | Result trail panel; saved-copy states Public / Private / Ready / Failed / Unavailable | **Blocked by DEP-READER-PROOF, DEP-STUCK, DEP-SAVED-COPY** |
| 3 | Give an instruction, read it back, send, watch Queued → Read → Running → final | 08, 01 | Built with fixtures; read-back parser runs client-side (no paid call) | J3 desktop + phone: read-back → preview → Send focused → receipt Done (sample) | Effects: **Blocked by DEP-ACTION-PLANS** (each kind turns on when announced) |
| 4 | Duplicate send is blocked | 08 | **Connected**: client rule + one idempotency key per preview; the gateway's key replay is the server guard | J4: "You already sent this at …" on the second send; unit tests | Server duplicate proof per announced action: Codex |
| 5 | Result unknown → Check what happened, without repeating | 08, 10 | Built with fixtures; live lookup built to the agreed `type`+`key` contract | J5: Unknown → Check → Done (sample); unit test proves GET-only, no resend | **Blocked by DEP-RECEIPT-LOOKUP** (button explains and stays off until announced) |
| 6 | Partial bulk action with per-item results | 08, 05 | Built with fixtures | J6: "Stop failing methods here" → preview lists 3 matching, untickable, amber whole-system → Partly done with Done/Done/Running | **Blocked by DEP-ACTION-PLANS** (server-side full matched population) |
| 7 | Resource request: done, partly done, refused; new job shows on Workers | 08, 09 | Built with fixtures; separate from "Move up the list" | J7: slots → Assigned + new Marana job on Workers; MW-060 engineering → Partly done; update fix → Refused with reason | **Blocked by DEP-RESOURCE-EXECUTOR** |
| 8 | Fixed history: search, filter, paging, details | 13, 11 | Built with fixtures; server search/paging wired via `useListView` | J8: learning filter, search "time zone" + open, paging 1–5 / 6–7 of 7 | **Blocked by DEP-FIX-LIFECYCLE** |
| 9 | Came back details | 13, 11 | Built with fixtures | J9: "When it came back" shown | **Blocked by DEP-FIX-LIFECYCLE** |
| 10 | Workers explain themselves; counts match the lists | 01, 10, 06 | Scoped waiting and saved event feed **connected locally** through `admin-v6/workers@1`; status tiles retain the live pulse. Full job list and version remain unknown. | 17 focused Workers cases plus same-page pickup; read-only 85635 production-shape probe. Hosted operator readback pending. | **Blocked by DEP-WORKER-ACTIVE-INDEX, DEP-WORKER-VERSION** |
| 11 | Two hunts at once; separate limits; no national budget | 09, 02 | Built with fixtures | Now + Money: 2 hunt cards, "no national budget" | **Blocked by DEP-HUNTS, DEP-MONEY-READ** |
| 12 | Offline and reconnect: mutations off, last good data kept, catches up once | 10 | **Verified locally on the production component** (browser, intercepted pulse) | Auto-pickup run: Reconnecting shown, data kept, "Back online" + exactly 1 catch-up read, 0 action posts; J12 offline/stale/reconnecting disable every mutation with the first-rule reason | Hosted proof after release: Codex |
| 13 | View-only role: every mutation off with a reason | 08 | Built; access arrives as a prop | J13: 40 controls off, "Your account can look but can’t make changes." | Role/permission source for the route: **DEP-ACCESS** (Codex passes `access`) |
| 14 | Phone (390 px) and keyboard only | 15 | **Verified in local preview** | 390 px: all 7 screens, 0 px sideways overflow, J3–J9 pass; keyboard K1–K10: skip link, visible 2 px ring, picker Enter/Escape, dialog Send focus + focus trap + Escape + focus return, map tiles, arrow-key tabs | Recheck on the integrated route: Codex |
| 15 | Checklist item part by part (official wording, proof, missing proof) | 12, 04 | Built with fixtures; **all 325 real definitions connected** (`CHECKLIST_PROFILE`, searchable register, system groups list every definition) | Checklist captures; item detail table of parts | Instances/statuses: **Blocked by DEP-CHECKLIST-ITEMS, DEP-SYSTEM-AUDIT** |

## 3. ADMIN-01–15 (Admin-command-center-contract.md) — cross-reference

| ADMIN | Requirement | Where in the UI | UI state | Journeys |
|---|---|---|---|---|
| 01 | Plain language | All screens; approved v6 wording; IDs only under "Technical details" | Built (review by Codex/Sean on the integrated route) | 3, 10 |
| 02 | Clear scope; shared vs local; no stale headline on scope change | Scope bar, breadcrumbs by `navParent`, counts by `within`; shared rows labelled; LiveSync clears old-scope data and drops late answers | Built + unit/browser tested | 1, 11 |
| 03 | Readers first, public link and check time | "What readers can see", six-stage dots, trail stage 6 | Built with fixtures · DEP-READER-PROOF | 2 |
| 04 | Complete delivery trail | Result detail panel | Built with fixtures · DEP-READER-PROOF | 2, 15 |
| 05 | Honest counts; totals for bounded lists | Unknown = "—"/"Not reported"; stage totals from server; paging notes | Built · DEP-NATIONAL, DEP-WORK-ROWS | 1, 6 |
| 06 | Actionable blockers | Stuck rows/detail: cause, age, tried, helped, next, owner, fix | Built with fixtures · DEP-STUCK | 2, 10 |
| 07 | Useful priorities; four lanes | Suggested next steps (ranking explained), four lanes | Built with fixtures · DEP-STUCK | 3 |
| 08 | Working controls; accurate previews; disabled reasons; authorization | One eligibility rule; preview dialog; receipts; only announced actions enabled | Built; runner pause/resume **connected**; others · DEP-ACTION-PLANS | 3–7, 13 |
| 09 | Cost clarity: spent vs set aside, unpriced, per-work drilldown | Money screen, hunt meters | Built with fixtures · DEP-MONEY-READ, DEP-HUNTS | 11, 7 |
| 10 | Automatic updates; honest stale/disconnected; catch up without double counting; keep scope/open item | `usePulseFeed` + `LiveSync` | **Verified locally** (browser auto-pickup run) | 12, 5 |
| 11 | New vs reused | Result kind pill + trail wording; learning statuses | Built with fixtures · DEP-READER-PROOF, DEP-LEARNING | 8, 9 |
| 12 | Understandable scores; profile version; exact items | Checklist header shows `Sean-full-checklist/2026-09-28@1`; percentages round down | Built; definitions **connected** · DEP-CHECKLIST-ITEMS | 15 |
| 13 | Searchable history over the full population | Search box, History, fixed history; server search via `useListView` | Built · DEP-RECEIPT-HISTORY, DEP-FIX-LIFECYCLE | 8, 9 |
| 14 | Safe detail; technical IDs expandable; no secrets | "Technical details" disclosures; saved-copy states | Built with fixtures · DEP-SAVED-COPY | 2 |
| 15 | Actual operator test incl. keyboard/mobile | Local walks recorded here | Local only; hosted operator test: Codex | 14 |

## 4. The automatic-pickup acceptance (AUTOMATIC-INTEGRATION.md)

| Required proof | Result | Evidence |
|---|---|---|
| Backend unavailable → available → the same open page shows real data | **Pass** | Browser, production component: waiting at 2.0 s; real data at 10.7 s after 1 read; `window` marker unchanged (no reload) |
| Later changes appear automatically | **Pass** | Revision v2 → second item at 18.6 s (2 reads total) |
| Scope, filters, unsent input kept | **Pass** | Draft text kept; sort filter kept; URL unchanged |
| Disconnect/reconnect | **Pass** | "Reconnecting" with data kept; "Back online"; exactly 1 catch-up read |
| Permission denial · incompatible version · delayed/out-of-order responses | **Pass (unit)** | `tests/admin-v6-ui/live-sync.test.ts` |
| No duplicate reads in flight · no automatic mutation | **Pass** | Browser: max 1 in flight, 0 action posts; unit: supersede + no POST on announcement |
| Hosted transition after release | Codex | Needs the first announced section in production |

## 5. Controls

"Connected" = a deployed registry action already carries it out. Every other control is enabled only when the pulse announces `admin-v6/action/<kind>@1`; until then its reason reads "Not connected yet. This button turns on by itself…".

| Control (kind) | Screens | State | Dependency |
|---|---|---|---|
| Pause all workers (`global-runner-pause` → `runner.pause`) | Now › Direct work (amber), Workers | **Connected** (not triggered in QA, per Codex) | — |
| Let the workers start again (`global-runner-resume` → `runner.resume`) | Now › Direct work (amber) | **Connected** (not triggered in QA) | — |
| Pause all paid research (`global-paid`) | Now › Direct work (amber) | Built with fixtures | DEP-PAID-PAUSE |
| Check the public page now / Recheck every public page here (`recheck`, `scope-recheck`) | Now, trail, stuck | Built with fixtures | DEP-READER-CHECK |
| Put this work first / Put waiting work here first (`workfirst`, `scope-first`) | Now, Workers, checklist item | Built with fixtures | DEP-ACTION-PLANS |
| Stop the failing method / Stop failing methods here / Stop repeats (`stopmethod`, `scope-stop`, `stoprepeats`) | Now, Work › Same cause | Built with fixtures | DEP-ACTION-PLANS |
| Try another method · Reprocess saved evidence · Use this official address · Resume checks and publishing (`retry-method`, `reprocess`, `use-url`, `resume-publish`) | Instruction read-back | Built with fixtures | DEP-ACTION-PLANS |
| Hide wrong records / Undo (`contain`, `uncontain`) | Stuck item, trail, History | Built with fixtures | DEP-ACTION-PLANS |
| Decide (`decide`; outreach option needs permission) | Next steps, stuck | Built with fixtures | DEP-ACTION-PLANS, DEP-ACCESS (outreach) |
| Start a hunt · pause/resume paid work · change lifetime limit · stop hunt (`hunt-*`) | Now › Direct work | Built with fixtures (limit can't go below spent + set aside) | DEP-HUNT-START, DEP-ACTION-PLANS |
| Move up the list (`fixfirst`) | Fix list, stuck | Built with fixtures | DEP-ACTION-PLANS |
| Focus more resources here (`focus`: engineering / worker slots / stronger AI) | Fix list, Workers update card | Built with fixtures | DEP-RESOURCE-EXECUTOR |
| Create an engineering task (`eng-task`) | Stuck software items, Fix list | Built with fixtures | DEP-ENGINEERING-TASKS |
| Stop this job (`job-stop`) | Workers | Built with fixtures | DEP-ACTION-PLANS |
| Open the saved copy (`doc-request`) | Trail | Built with fixtures | DEP-SAVED-COPY |
| Check what happened | History, receipts | Built with fixtures; live GET built | DEP-RECEIPT-LOOKUP |

## 6. Named dependencies (owner: Codex)

Each shows on screen as a recoverable waiting state and needs no frontend edit once announced in the compatible shape.

| ID | Missing interface | Next action |
|---|---|---|
| DEP-NATIONAL | `national` section: per-state hunts, stuck, checklist items by status, checked-on-page; shared work counted once | Build + announce `admin-v6/national@1` |
| DEP-SCOPE-IDENTITIES | `places` section with county/ZIP (and later body) identities and explicit `within` overlap | Build + announce `admin-v6/places@1` |
| DEP-HUNTS | `hunts` section: exact saved lifetime receipt, limit + source, priced spend, holds, unpriced | Connected and announced locally; hosted readback pending. Run state, general overlap and complete service cost remain gaps. |
| DEP-READER-PROOF | `results` section: six stages, saved files, versions, exact public URL + time seen (MW-011) | Build + announce |
| DEP-STUCK | `stuck` and `sameCause` sections | Build + announce |
| DEP-WORK-ROWS | `workRows` paged section with exact totals | Build + announce (paged) |
| DEP-RECEIPT-HISTORY | `history` paged section of saved receipts with later lifecycle facts | Build + announce (paged) |
| DEP-RECEIPT-LOOKUP | `receiptLookup` by `type` + `key` | Build + announce |
| DEP-WORKER-EVENTS | Bounded scoped waiting and event feed | Connected and announced locally; hosted readback pending. The full active-job list is separately blocked. |
| DEP-WORKER-ACTIVE-INDEX | Bounded complete active-job read, including plain-code collection outside the Scout list, with visible truncation | Add indexed repository contract, then verify jobs and their counts end to end. |
| DEP-WORKER-VERSION | Website vs workers version and update status (inside `workers.update`) | Build + include |
| DEP-CHECKLIST-ITEMS | `checklist` paged section: items with part-by-part proof (definitions already real) | Build + announce (paged) |
| DEP-SYSTEM-AUDIT | Audit status per whole-system definition (inside `checklist.systemGroups`) | Build + include |
| DEP-MONEY-READ | `money` section: account readings, limits, per-work AI costs | Connected and announced locally for dated account/provider readings and lifetime limits; hosted readback pending. Per-work costs and unknown service totals stay unconnected. |
| DEP-LEARNING | `learning` section (MW-027) | Build + announce |
| DEP-FIX-LIFECYCLE | `fixes` paged section: open fixes with task stages; fixed/came-back history with evidence-based learning status | Build + announce (paged) |
| DEP-DECISIONS | `decided` section | Build + announce |
| DEP-ACTION-PLANS | Registry actions for each kind above, announced with exact inputs | Implement per kind + announce |
| DEP-RESOURCE-EXECUTOR | Resource request accepted/assigned/refused by the real scheduler or engineering intake | Implement + announce `focus` |
| DEP-ENGINEERING-TASKS | Authorized tracker adapter with task stages | Implement + announce `eng-task` |
| DEP-READER-CHECK | Exact public-card comparison action | Implement + announce `recheck`/`scope-recheck` |
| DEP-SAVED-COPY | Exact saved-copy route enabled | Enable + announce `doc-request` |
| DEP-HUNT-START | Geography identity with plan version for `expansion.scope.set` | Implement + announce `hunt-start` |
| DEP-PAID-PAUSE | Pause only paid research everywhere | Implement + announce `global-paid` |
| DEP-ACCESS | Viewer / spending / outreach permissions for the signed-in session | Pass `access` from the route |
| DEP-PERIOD | Period-split reads ("Whole hunt", "Last 24 hours", "September 2026") | Account selector now sends the selected period and shows the backend's explicit `PERIOD_NOT_AVAILABLE` for unsupported splits; hunt limits remain lifetime. Full period reads remain open. |

## 7. Integration instructions for Codex

1. **Files (all new, assigned allowlist):** `app/(admin)/_mw/admin-v6/**` and `tests/admin-v6-ui/**`. No existing file was edited. The dev-only preview page `app/(admin)/admin/v6-preview/page.tsx` was removed before the handoff commit, as required.
2. **Mount** in the chosen Admin route (server component):
   ```tsx
   import { LiveRefresh } from "@/app/(admin)/_mw/live-refresh.tsx";
   import { LiveCommandCenter } from "@/app/(admin)/_mw/admin-v6/live-command-center.tsx";
   import { liveReference } from "@/app/(admin)/_mw/admin-v6/reference.ts";
   import { placeKeyOf } from "@/app/(admin)/_mw/admin-v6/places.ts";
   // scope = parseScope(searchParams.scope)
   <>
     <LiveRefresh />   {/* exactly once: the single /api/admin/live poller */}
     <LiveCommandCenter reference={liveReference({ scope, geoLabel, observedAt })} initialScopeKey={placeKeyOf(scope)}
       access={{ role, canSpend, outreachAuthorized }} initialView="now" />
   </>
   ```
   `LiveCommandCenter` uses `useSearchParams`, so wrap it in `<Suspense>` if the route is statically rendered. It keeps scope in `?scope=`; `initialView` + `onViewChange` (on `CommandCenter`) let each screen live on its own route if preferred.
3. **Do not** render the old `MwShell` header around it (v6 has its own header), and do not mount a second pulse poller.
4. **Turn a section on** by building its route to the envelope in §1 and adding it to `LivePulse.v6.sections` with a revision that moves when its source may have changed. Open pages pick it up within one pulse.
5. **Turn an action on** by adding `admin-v6/action/<kind>@1` to `LivePulse.v6.actions` with the registry `type` and `requiresStateVersion`, validating exactly the keys in `actionInput()` (or amending them together with a contract version bump).
6. **Checks run on this branch:** `tsc --noEmit` (no errors in v6 files), `eslint` on changed paths (clean), `node --test tests/admin-v6-ui/*` (32 pass), full `node --test tests/**` (see §8).
7. **Sample isolation:** production modules never import `./sample/` (test-guarded). The sample harness and `sample/register-audit.ts` exist only for the preview and tests; delete `sample/` if a production bundle audit prefers, after dropping the preview.

## 8. Final checks (this branch)

| Check | Result |
|---|---|
| `tsc --noEmit -p .` | No errors in `admin-v6` or `tests/admin-v6-ui` |
| `eslint` on changed paths | Clean |
| `tests/admin-v6-ui` | 32 pass, 0 fail (also inside the 89 rerun below) |
| Full suite `node --test tests/**/*.test.ts(x)` | 8,679 tests: 8,668 pass, 9 fail, 2 skipped on the first run. Six failures were v6 guard findings (sentence-shaped defaults, raw ISO stamps, token fallbacks, a hand-kept state list and a hardcoded host in the sample, function-shaped object literals) — **all fixed**; those guards plus `tests/admin-v6-ui` rerun: 89 pass, 0 fail. The other three are not v6: the rulings-regeneration test timed out on the shared working-tree lock during the parallel run (passes alone); the production-bundle trace test read a stale `.next` build left in this worktree from Sep 23 (skips once removed, as on any checkout without a build); the credential sweep runs only when `.env.local` is present and flags an existing `NETLIFY_SITE_ID` in `docs/log.md` line 1388 and `docs/tracker-resolved.csv` line 418 (not v6 files; for Codex to judge) |
| Browser: 7 screens desktop + 390 px, journeys 3–9, states, keyboard, auto-pickup | Pass (local dev); screens and journeys rewalked after the guard fixes |

## 9. Optional improvements (do not block acceptance)

- Tile map could shrink at desktop width to lift the state table higher.
- The Now page is long at 390 px (≈10,500 px); a "jump to section" row could help.
- Remember the open Fix list tab and filters per viewer.
