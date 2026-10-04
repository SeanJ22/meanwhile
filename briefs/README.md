# Meanwhile — corrected build briefs

Prepared October 3, 2026, Arizona time. Replaces the supplied common, River, eleven builder briefs and start prompts. This package does not push branches, create tasks, start a hunt, or change the live site.

## What to give Claude

Give Claude this whole package. Ask it to use these files as the execution briefs for the full approved 321-step plan. The original lane step lists are preserved. Put `briefs/` and `start-prompts.md` on `board/briefs` with the approved version 6 plan as `plan/plan.md` and design as `plan/design.md`; the approved plan/design must be supplied separately. This package does not adopt proposed policy changes or rewrite them.

## What changed

- Keeps six scheduled Claude builders, River and five initial Codex builders.
- Removes routine manual Codex restarts: existing Claude workers continue their paired Codex lanes after a recorded ownership handoff. This must work in a real startup run before it is described as unattended.
- Uses one active owner per lane, saved checkpoints, matching permissions and explicit draft-PR exceptions.
- Adds the final-release exception and reserves time for deployment and verification before the 36-hour target.
- Requires failed release candidates to be retired before replacements can merge, and reuses after-deploy checks for the same commit.
- Makes RL-06 implementation explicit, handles SC-17 as parked, and stops finished worker schedules.
- Separates database/HTTP evidence from actual UI verification.
- Reuses PR #706's repairs if present instead of blindly rebuilding them.
- Gives every session a starting model and narrowly scoped escalation guidance.

The handoff fallback can reduce parallelism when several Codex tasks stop together. It shifts work onto Claude's allowance. No brief can remove provider usage limits or guarantee the 36-hour result. River must report the actual pace and remaining scope rather than promise equal cost or equal step sizes.

## Suggested models

These are recommendations for this work, not measured Meanwhile benchmarks. Select them in the task settings.

| Session | Starts in | Suggested model | Why |
|---|---|---|---|
| river | Claude | Opus 5.5 | Integration, release judgment, conflicting changes and cross-lane decisions. |
| measures | Claude | Sonnet 5.5 | Structured calculations, status reporting and existing Admin connections. |
| hunters | Claude | Opus 5.5 | Worker concurrency, spending controls and recovery across the running system. |
| registry | Claude | Sonnet 5.5 | Well-defined registry, source and refresh contracts. |
| meetings | Claude | Sonnet 5.5 | Collector, refresh and history changes with concrete acceptance conditions. |
| auditors | Claude | Opus 5.5 | Failure diagnosis, provenance, evidence quality and deciding whether repairs really worked. |
| people | Claude | Sonnet 5.5 | Profiles, source-backed statements and existing publishing connections. |
| admin | Codex | GPT Sol 6.1 | Admin controls and UI/data connections; escalate difficult gateway or authorization problems. |
| slide | Codex | GPT Astra 6 | Publication and verification connections where a mistake can publish the wrong fact or halt delivery. |
| ballot | Codex | GPT Sol 6.1 | Collector and Ask implementation against explicit contracts; escalate difficult multi-source reasoning. |
| bank | Codex | GPT Sol 6.1 | Playbook storage, fix history and reusable methods with focused tests. |
| frontend | Codex | GPT Sol 6.1 | Components, layouts, accessibility and browser-driven implementation. |

Codex: start Sol 6.1 at medium reasoning; Astra 6 at high if the control is available. Claude: normal/adaptive reasoning. Use higher effort or the stronger model for specific hard problems, then return to the normal setting. The common brief explains escalation and which Claude model takes over each stopped Codex lane.

The allocation uses the providers' stated positioning: OpenAI describes Sol 6.1 as balancing speed/cost with strong coding and Astra as its choice for the most demanding reasoning; Anthropic describes Sonnet 5.5 as its faster, lower-cost complement and Opus 5.5 for complex work requiring sustained judgment. Subscription allowance and API pricing are different; these briefs do not authorize buying API usage.

Sources consulted October 4 UTC / October 3 Arizona:
- [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [Anthropic Sonnet 5.5 guidance](https://www.anthropic.com/claude-sonnet-5-5)

## Launch order

1. Publish the corrected documents on `board/briefs` after authorization. This is a documents branch, not a production release.
2. Start River setup and one builder on useful work to confirm publication, fresh-session continuation and handoff.
3. Start the remaining six-Claude/five-Codex lane allocation under the configured schedules and prompts.
4. River combines ready batches, ships roughly every eight hours and makes a final deadline release early enough to check it live.
5. Finished builders stop; the authorized standing River continues collecting future repair branches.

Creating the branch is separate from launching the workers. No additional rollout approval is needed when Sean's authorization already covers the same action. A platform denial must be reported truthfully, not bypassed by changing the text of a brief.
