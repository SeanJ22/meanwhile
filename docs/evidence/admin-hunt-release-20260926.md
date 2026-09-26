# Admin completion and 85635 launch preparation

September 26, 2026, Arizona MST. Release owner: Codex, following the explicit handoff from Claude. Final integration branch: `codex/85635-reader-census`, preserving batch F and released PRs #426–428. **Release verification is in progress; this file is not a READY declaration.**

The hunt remains paused. No Send, paid acquisition, search call, new expansion assignment or hunt budget activation occurred. The owner must test Admin and explicitly authorize the start. The approved budget is **$50 total Anthropic token usage for this hunt**, including all models, retries and escalations across concurrent work and restarts. Other services are accounted separately and do not consume this cap. No additional spending caps were introduced. Internal `lifetime` fields mean the duration of this one hunt, not an account-wide or perpetual budget.

## Integrated fixes

- Complete the handed-off Ask group-money/identity changes and Cochise category-feed wiring. Move the fire-district placement reference out of canonical reader holdings; retain both the manifest and reader closure gates.
- Use published Census ZCTA membership for ZIP Send and preview. Derive state membership from ZIP counties, not every state in an overlapping metro. Keep unknown and unpublished vintages explicit.
- Resolve Patagonia secondary-school identity against both held Census and NCES directories without collapsing it into the distinct elementary district. Regeneration also catches previously stale crosswalk outputs; this is reuse of held inputs, not geographic expansion.
- Let the existing Diligent adapter accept independently linked and named public school-board portals through the normal discovery, crosswalk, retained evidence and publication system. Test board/committee separation, local time and unpublished agenda behavior. The FHASD annual schedule remains a complementary source: its later dates are not all in the API, so this route alone does not close its 90-day coverage.
- Search beyond healthy connected feeds when the owner's existing paid-search switch permits it. Connect the already implemented guarded browser to both standing Scout entry points. Preserve public-page access decisions and authentication boundaries.
- Refresh worker-consumed field-manual state after successful writeback. Capture the exact inherited revision per task; demonstrate a newly learned route actually used by the next task in the same running worker runtime.
- Default acquisition to Haiku 4.5, with deterministic methods first and justified Sonnet 5 / Opus 5.5 escalation. Retain the exact model, reason, time and total cost. Existing Ask comparisons are not acquisition-quality evidence.
- Add one visible-page live-update subscription to the existing Admin shell, keeping failures visible and last-good data intact.
- Serve the existing Ask engine through a small native Netlify function and record instance identity/request ordinal for genuine cold-first measurements. Keep-warm is not evidence of cold acceptance. Actual deployed timing remains required.

## Budget proof and the first-attempt failure

An isolated Neon branch of the control plane was used; production received no test writes. Twelve separate Node processes each attempted a $10 reservation against one $50 hunt. The first attempt admitted only three; the ledger confirmed $30 held. Its individual refusal diagnostics were not retained, and that limitation is preserved. An instrumented reproduction exposed session-advisory-lock contention, including refusals after bounded retries.

The Postgres HTTP transport does not guarantee session affinity between lock, read, write and unlock. Budget mutations now use the database's existing atomic `UPDATE ... WHERE revision` comparison instead. A losing writer receives `ConcurrentModification`; the durable reservation code retries its pure decision against the new revision before returning any admission. File and memory providers retain their exclusive locks. No cap, accounting rule or validation gate was removed.

The repaired isolated check at **12:35:53 AM MST** admitted five and refused seven specifically because the $50 was fully held. A fresh process two controlled days later refused another $0.01; the ledger still held $50. Offline tests also cover settlement, failed/unmeasured requests, retries, escalation, overlapping Sends, editing a hunt and explicitly starting a separate future hunt. The actual paid request receipts and reader-result economics remain to be measured after launch.

Raw, sanitized external evidence is under `C:/Users/seanj/dev/meanwhile-evidence/admin-completion/2026-09-25/`: `hunt-budget-neon-process-proof.json`, per-attempt process results, and `hunt-budget-first-attempt-investigation.json`. The isolated branch expires automatically; no polling job was installed.

## Provider reporting

The server-side snapshot collector reloads the five reporting credentials from the exact configured file **`C:/Users/seanj/dev/we-the-people/.env.local`**. Only the existing console publisher receives its path; browser bundles and other worker children do not receive the reporting secrets. Model and search credentials are unchanged. Sync runs through the existing publisher scheduler and Admin reads cached results.

Read-only reporting verified Anthropic usage/cost and organization access, Neon consumption v2 for three projects, GitHub billing usage and Netlify account/site/deployment access. Anthropic and GitHub return dollar totals. Neon returns consumption units without an invoice-dollar total through this access. Netlify deployment credits are a partial estimate, not a complete account bill. Brave uses request-level estimates. Exa retains request-level estimates because `EXA_SERVICE_API_KEY` is absent; the existing search key is unchanged. Missing reporting does not block launch.

The Admin Money panel separates account reports, token-ledger attribution, hunt/platform costs, reservations, estimates, credits, periods, sync times, stale data and errors. Provider totals and their component request estimates are never added together. Account totals are not the cost of this hunt. Provider reconciliation can lag request accounting.

## Scope and inherited evidence

The preserved preparation directory is `C:/Users/seanj/dev/meanwhile-evidence/85635-preparation-20260925`. Its 133 body/reference rows are an open scope ledger, **not 133 governments or a completed denominator**. Preserve all 61 branch identifiers, 23 current coverage capabilities, retrieval rungs and descent walks, shared state/federal records, unresolved local-body/territory frontiers and evidence-qualified exclusions. Missing queue entries do not exclude work. Distinguish not published from not acquired.

Reuse Claude's valid registration, scheduler, carried-meeting, unchanged-last-checked, automatic campaign-site publication and reader-edge proofs wherever the integrated changes do not invalidate them. New closure proof covers changed reader paths. Remaining release checks are the exact committed reader closure, complete gates, normal deployment, runner SHA handoff, signed-in Admin preview and live updates, cached billing sync, affected reader behavior and genuinely cold Ask.

The final release/readiness report and Admin improvement handoff must record actual outcomes, remaining defects and exact owner acceptance steps. Targeted held-data checks return validated single-person money answers for Lupe Diaz (LD 19, relevant to 85635) and Kevin Volk (LD 17). This does not prove every ballot/card identity symptom fixed. The Innis/Sargent no-model diagnostics were inconclusive; inspect the original surface before closing either identity issue. No successful subset completes the eventual 85635 hunt.


## September 26, 5:10 AM MST integration checkpoint

The full reader closure was renewed against production read-only authority at 4fd7e1cb: all executor and render passes completed, finalization succeeded and the required Census gate passed. Evidence is committed at bf85b4e1. The final integration also includes named/partial Admin scope previews, state-attributed standing assignment counts (computed before row trimming), and native cold-request geography prefetch. The prefetch overlaps the existing file read with network reads; it adds no timer or keep-warm mechanism. Focused checks pass; integrated local/CI gates and deployed verification remain required.

Released production is 4cb9a6b9 (#428). Its actual 4096 MB / 2 vCPU native function is the documented provider maximum. Four genuine cold deterministic samples finished in 2.962–3.149 seconds, with two failing the three-second requirement. Boundary receipts preserve instance ordinals, process age, handler duration and complete client time. No average or first streamed token is counted as acceptance. The final eight-case production probe is prepared and must run only after deployment.

Billing is connected for Anthropic reporting, GitHub metered billing and Neon consumption units; Neon dollar totals are unavailable. Exa, Brave and Netlify retain clearly labeled partial estimates. The observed account-period totals are platform accounting, not this hunt's spend. Isolated durable concurrent reservations enforce only the hunt's $50 Anthropic token limit. No hunt period was activated.

Current full-scope blockers remain visible: the five-body preview is registered coverage, not a complete scope certificate; unregistered relevant branches need normal admission; automatic validation/publication must be established for every required family; and the entire hunt needs connected live progress. Existing owner-only manual contracts are not silently activated or treated as a substitute for these connections. Valid isolated Ohio/Puerto Rico Send-to-reader evidence proves representative workflow pieces, not the paid hunt or every family.
