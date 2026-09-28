# Admin v6 — the one UI acceptance and dependency ledger

Owner of this file: Claude Code (UI assignment, Codex boundary note 2026-09-28 12:12 MST). Codex owns backend contracts, route integration, release and full product acceptance. This is the only UI ledger; update it instead of writing new audits.

Last updated: 2026-09-28, 1:30 PM MST. Branch `claude/meanwhile-admin-interface-021afd` (worktree `C:\Users\seanj\dev\we-the-people\.claude\worktrees\sleepy-lumiere-80f495`), base `72be6002`.

**States used below.** *Not built* · *Built with fixtures* (works against labelled sample data in the dev-only preview) · *Connected* (reads/acts through a deployed or Codex-accepted contract) · *Verified* (proved end to end on the real build) · *Blocked by DEP-…* (named missing backend interface; the UI shows a recoverable "Not connected yet — turns on by itself" state and picks the data up automatically when Codex announces it).

**Honest summary.** UI work ready for integration; these product requirements remain blocked on the named Codex dependencies. Nothing here is "product complete". All sample figures are examples. No action was sent to production, no paid work was started, and the 85635 hunt and its $50 lifetime allowance were not touched.

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
| 10 | Workers explain themselves; counts match the lists | 01, 10, 06 | Status tiles **connected** to the live pulse (checked in, last round, next due, lane counts); jobs/waiting/events built with fixtures | Workers captures; "Last useful progress" shows "Not reported" in production (never inferred from a heartbeat) | **Blocked by DEP-WORKER-EVENTS, DEP-WORKER-VERSION** |
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
| DEP-HUNTS | `hunts` section: place, lifetime limit + source, spent, set aside, unpriced | Build + announce |
| DEP-READER-PROOF | `results` section: six stages, saved files, versions, exact public URL + time seen (MW-011) | Build + announce |
| DEP-STUCK | `stuck` and `sameCause` sections | Build + announce |
| DEP-WORK-ROWS | `workRows` paged section with exact totals | Build + announce (paged) |
| DEP-RECEIPT-HISTORY | `history` paged section of saved receipts with later lifecycle facts | Build + announce (paged) |
| DEP-RECEIPT-LOOKUP | `receiptLookup` by `type` + `key` | Build + announce |
| DEP-WORKER-EVENTS | `workers` section: jobs by stage, waiting reasons, plain event feed (runner-progress `81c2c791` is a partial candidate) | Build projection + announce |
| DEP-WORKER-VERSION | Website vs workers version and update status (inside `workers.update`) | Build + include |
| DEP-CHECKLIST-ITEMS | `checklist` paged section: items with part-by-part proof (definitions already real) | Build + announce (paged) |
| DEP-SYSTEM-AUDIT | Audit status per whole-system definition (inside `checklist.systemGroups`) | Build + include |
| DEP-MONEY-READ | `money` section: account readings, limits, per-work AI costs | Build + announce |
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
| DEP-PERIOD | Period-split reads ("Whole hunt", "Last 24 hours", "September 2026") | Accept a `period` parameter in sections (the selector is UI-only today) |

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
| `tests/admin-v6-ui` | 32 pass, 0 fail |
| Full suite `node --test tests/**/*.test.ts(x)` | See handoff note (recorded at commit time) |
| Browser: 7 screens desktop + 390 px, journeys 3–9, states, keyboard, auto-pickup | Pass (local dev) |

## 9. Optional improvements (do not block acceptance)

- Tile map could shrink at desktop width to lift the state table higher.
- The Now page is long at 390 px (≈10,500 px); a "jump to section" row could help.
- Remember the open Fix list tab and filters per viewer.
