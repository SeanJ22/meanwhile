# OF-01: reader changes required

OF-01 is stopped under the task instruction: “If the reader itself needs a change, write the exact change in your report and stop there.” No reader, source, publication, schedule, migration, Admin setting, or production data was changed. This is a diagnosis, not a READY step.

Repository: `SeanJ22/meanwhile`. Branch: `stream/of-01`, cut from the fetched `river` commit `7dbad3bb5f2ebdee6ab41f9e094237aa00eecb83` on October 20, 2026. The connected GitHub branch lookup and subsequent shell fetch agreed on that base.

The reader outcome remains every federal and statewide elected official, with sources and contacts. The changes below are needed for verified people to reach residents (§0); acquiring additional people alone cannot satisfy that outcome.

## Required reader change: retain the Vice President

`lib/reader/national.ts:119`, inside `currentPresidentRoster`, accepts only this title:

```ts
/^President(?: of the United States)?$/i
```

Change that title predicate to:

```ts
/^(?:President|Vice President)(?: of the United States)?$/i
```

Keep the country division, current-membership, and returned division-link filtering. Both roles must retain their individual IDs, memberships, source pages, and contact fields. The existing roster field can carry both people; no reader API shape change is needed for this predicate.

Reproduction: the exact function was extracted from the checked-out source, its TypeScript annotations removed with Node's `stripTypeScriptTypes`, and executed with two holders, each linked to the country through a current membership. Input: President of the United States and Vice President of the United States. Output: President of the United States only. This is a direct function reproduction; it does not establish database publication or live delivery.

`readNationalPresident` calls this function at `lib/reader/national.ts:136`. The resulting roster feeds `ReaderStatePackage.president` and the national row in `lib/reader/coverage.ts:87`. A Vice President added to the national people store would therefore be removed before reaching that reader row.

## Required reader change: preserve statewide people alongside legislative authority

`lib/reader/state.ts:113` selects only people whose identity occurs in the official legislative roster. Line 115 builds `legislativePeople` from that selection. Whenever an official legislative roster is available, independently verified statewide executives absent from that roster are discarded from this reader value.

This value is used by both `lib/reader/coverage.ts:27` and the division representation path at `lib/registry/server.ts:626`. The full composite people roster is already read into `state.people`; acquisition is not the only possible loss point.

The exact change required is to limit the legislative-authority restriction to state legislative people and retain nonlegislative people and their existing division links. For the current holder model, replace the line 113 filter with:

```ts
const matching = authoritative && roster ? roster.officeholders.filter(holder =>
  !(holder.level === "STATE" && ["upper", "lower"].includes(holder.chamber ?? "")) ||
  [...personIdentityKeys(holder)].some(key => authoritativeKeys.has(key))
) : [];
```

Keep the following `matchingIds` and division-link filtering and the existing merge with the authoritative roster. Before shipping, test actual nonlegislative and mixed-membership records so an authoritative legislative roster cannot remove a verified executive or restore an ended legislative seat. Use the real migrations schema for store integration tests. This proposed change was not applied or integration-tested.

## Separate publication blocker outside OF-01's owned files

`lib/civic-data/people-source-publication.ts:52-53` counts all people linked to the country as `currentPresidents` and rejects any count other than one. Lines 68-76 then verify those people using the President-only verifier. A correctly acquired President plus Vice President cannot publish through this national contract as written.

The publication owner must count current holders by office, verify each role against its own captured administration/profile evidence, and publish each independently under §3. A missing Vice President page must preserve the verified President and the Vice President's last verified facts. This file is outside the permitted paths. No bypass, duplicate publishing route, or altered office title was introduced.

## Binding measurement and remaining scope

Code registers state runtime bindings only in `lib/civic-data/manual-contracts.ts:117-127`, with explicit-owner invocation. They are absent from `AUTOMATIC_REFRESH_CONTRACT_IDS`; the runtime routine-contract leaf is empty. A new contract file also needs an actual registration path into the runner; an unimported file would not schedule anything. The existing `lib/reader/state.ts:107` still throws for a missing binding.

The current production binding count and freshness for all 50 states and DC remain unmeasured. The supplied `DATABASE_URL` is labeled `WTP_DB_ROLE=local`; `WTP_PRODUCTION_DATABASE_URL_READONLY` is absent. Local data was not reported as production evidence. No production query, refresh, or publication ran.

The missing statewide offices' individual source-to-store losses remain unmeasured. The legislative reader filter above is an identified downstream loss mechanism, not proof that each missing office has already been acquired or promoted. Association parser output, official-page verification, selection-method matching, contact acquisition, and production promotion still need per-source measurement after the reader dependency is resolved.

TX, CA, OH, NY, FL, GA, PA, WA, AZ, and NJ have not been compared against their official office lists in this stopped investigation. None is claimed complete. No release or runner-day acceptance check occurred.

## Verification and next ownership

- Passed: fetched branch-base comparison and the isolated exact-function Vice President reproduction described above.
- Blocked: the initial full-module reproduction could not import `sharp` from `lib/photos/decode.ts` in the supplied dependency installation. This is not a passing integration test. No substitute SQL schema or database test was used.
- Reader owner: apply and test the two reader changes above, preserving sources, contacts, existing officials, current memberships, and first-use performance.
- Publication owner: remove the national one-person assumption with per-office source verification.
- OF-01: after those dependencies are resolved, resume statewide source measurements and repairs across every state and DC, add the official Vice President source, wire scheduled binding refresh, publish independently verified facts promptly, then check the ten named states against their official lists on the released site after a runner day.

This branch contains only this report. It is not marked `READY: OF-01`, merged, deployed, or working for readers.
