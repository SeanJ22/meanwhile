# RS-03: whole-state representation metadata

Cut from River `5307d8b75678fc416f8e062cc9c65839d6d23da8` on `stream/rs-03`. A resident opening whole-state officials now gets the state's held label and metadata, and the answer can enter the same tagged CDN cache as a district. This moves §0's first-visit speed and immediately understandable government tests.

## Cause and replacement

Whole-state divisions are deliberately absent from registration: a state is the scope of that inventory (`lib/registration/candidate.ts`). The representation route sent them through `divisionsByOcdIds`, which loaded resolver geometry and fell through to the generic registration projection. Its `reader_place_payload` recursively walks the government inventory and linked records even though no whole-state division exists. That read repeatedly hit the 1,800 ms database deadline; even a successful search could only return no label. Counties missing from the reviewed registry used the same slow fallback.

The route now asks for representation metadata directly. Valid state, DC and territory roots use the existing held NCES jurisdiction reference labels, validated against the OCD/FIPS jurisdiction classes. Other divisions retain the reviewed registry's metadata; missing entries use an exact projection of the matching registration division's four metadata fields. It understands partitioned payloads and preserves the existing promoted-candidate and GOOD-receipt checks. It does not traverse governments, compose bodies or load resolver geometry.

The route's old generic lookup and geometry preload are removed. The full registration and geometry readers remain used by coverage, address resolution and Ask. Official selection, holder identities, roster gaps, cache tags, the 60-second durable CDN lifetime and publication invalidation retain their existing behavior. Failed metadata reads still return no-store independently of held people.

## Production read-only measurements

Build `wgRZuKYjhKGeM6E7JHWHS`, October 20, **2:44:00–2:46:35 AM ET**. Each of the 100 IDs gets its own newly launched Next production server process, followed by its first request and immediate repeat. All 200 requests run sequentially and finish after the complete JSON body is parsed. There is no competing build, test or preflight. County IDs are selected from each state's existing production registration, including county equivalents in Alaska and Louisiana.

The existing production `readonly` role is used. A read-only transaction confirmed `transaction_read_only=on` and no public-table INSERT, UPDATE or DELETE privileges. No production data, settings, pointers, caches or deployments were changed.

**200/200 HTTP 200, with a nonempty label, metadataStatus HELD and the existing public/durable cache headers.** First and repeat bodies match for every ID. Every response is under three seconds: HTTP maximum **1.606 s**, and maximum including process startup plus the first complete HTTP response **2.391 s**. A fresh process for each ID includes route initialization and has no earlier application visit to reuse.

| Answer | First HTTP range | Repeat HTTP range | Largest division stage |
| --- | --- | --- | --- |
| Whole state | 0.743–1.602 s | 0.108–0.327 s | 2 ms |
| County | 0.791–1.606 s | 0.115–0.442 s | 85 ms |

A separate sequential live check at **2:47 AM ET**, served commit `9a159f69f054c02b98933d836919ad8bc07a12c4`, still shows the original failure: AZ **2.454 / 2.327 s**, null label, metadata HOLDING_UNAVAILABLE and no-store; NH **2.447 / 4.099 s**, null label on both, first HOLDING_UNAVAILABLE/no-store and repeat HELD/cacheable despite the missing label. NH's repeat division stage alone was 2.452 s. The live district AZ-7 answered in **0.552 / 0.113 s** with its label; the repeat was a CDN response. These live timings are retained as observations, including the over-three-second failure.

On the replacement build, AZ answers **1.569 / 0.175 s** and NH **1.602 / 0.327 s** from fresh server processes, with metadata and cache headers. Their 14 and 3 official identities respectively exactly match the fresh live responses. Built HTTP timings use production data but do not include a Netlify CDN or deployed Lambda. Actual CDN hits after release remain River's deployment check.

### Every state and one county in each

The table is refreshed from the merged release-62 build `KWnb5_0hvrexIUj6S3wlj`, October 20, **7:34–7:37 AM ET**. All 200 requests again return HTTP 200, a nonempty label, metadataStatus HELD and public/durable cache headers. Every first/repeat pair matches. The maximum HTTP time is **1.850 s**; including process startup plus the first request, **2.322 s**. The captured production reader responses total **286,928,249 bytes** (4,547 direct selection/proof bytes and 286,923,702 server bytes). Together with the original captured 286,961,466 bytes, both metadata proofs account for 573,889,715 recorded bytes. The page report includes these in the combined read total.

Times below are complete HTTP seconds. The whole-state ID is `ocd-division/country:us/state:<lowercase state code>`; append the county suffix for its county ID. Process startup is separate above and is included in the under-three-second check.

| State | County suffix | State first | State repeat | County first | County repeat |
| --- | --- | ---: | ---: | ---: | ---: |
| AK | county:aleutians_east | 0.868 | 0.129 | 1.088 | 0.210 |
| AL | county:autauga | 1.035 | 0.297 | 0.916 | 0.156 |
| AR | county:arkansas | 0.919 | 0.142 | 1.121 | 0.208 |
| AZ | county:apache | 1.652 | 0.265 | 1.288 | 0.194 |
| CA | county:alameda | 0.980 | 0.462 | 1.072 | 0.254 |
| CO | county:adams | 1.108 | 0.250 | 0.923 | 0.195 |
| CT | county:capitol | 1.048 | 0.140 | 1.103 | 0.172 |
| DE | county:kent | 1.135 | 0.158 | 1.413 | 0.221 |
| FL | county:alachua | 1.808 | 0.421 | 1.850 | 0.428 |
| GA | county:appling | 1.513 | 0.282 | 1.379 | 0.332 |
| HI | county:hawaii | 0.990 | 0.228 | 1.039 | 0.303 |
| IA | county:adair | 1.139 | 0.399 | 0.966 | 0.212 |
| ID | county:ada | 1.093 | 0.333 | 1.372 | 0.311 |
| IL | county:adams | 1.362 | 0.225 | 1.253 | 0.222 |
| IN | county:adams | 1.250 | 0.165 | 1.151 | 0.185 |
| KS | county:allen | 0.970 | 0.164 | 1.011 | 0.203 |
| KY | county:adair | 0.956 | 0.152 | 1.058 | 0.183 |
| LA | county:acadia | 0.905 | 0.140 | 1.049 | 0.154 |
| MA | county:barnstable | 1.029 | 0.197 | 1.050 | 0.183 |
| MD | county:allegany | 0.806 | 0.140 | 1.168 | 0.161 |
| ME | county:androscoggin | 1.187 | 0.147 | 1.197 | 0.169 |
| MI | county:alcona | 0.955 | 0.141 | 0.891 | 0.186 |
| MN | county:aitkin | 1.270 | 0.139 | 1.292 | 0.180 |
| MO | county:adair | 0.869 | 0.254 | 0.898 | 0.181 |
| MS | county:adams | 1.169 | 0.140 | 1.001 | 0.150 |
| MT | county:beaverhead | 0.919 | 0.160 | 1.161 | 0.160 |
| NC | county:alamance | 1.146 | 0.150 | 0.902 | 0.343 |
| ND | county:adams | 0.857 | 0.128 | 1.151 | 0.158 |
| NE | county:adams | 0.808 | 0.122 | 0.925 | 0.176 |
| NH | county:belknap | 1.587 | 0.536 | 1.141 | 0.430 |
| NJ | county:atlantic | 1.335 | 0.197 | 1.242 | 0.229 |
| NM | county:bernalillo | 0.910 | 0.117 | 0.936 | 0.136 |
| NV | county:carson_city | 0.851 | 0.115 | 1.094 | 0.147 |
| NY | county:albany | 0.851 | 0.190 | 1.000 | 0.204 |
| OH | county:adams | 1.044 | 0.175 | 0.832 | 0.228 |
| OK | county:adair | 0.867 | 0.210 | 0.928 | 0.150 |
| OR | county:baker | 0.753 | 0.120 | 0.950 | 0.149 |
| PA | county:adams | 1.172 | 0.177 | 0.987 | 0.215 |
| RI | county:bristol | 0.918 | 0.110 | 0.938 | 0.122 |
| SC | county:abbeville | 1.241 | 0.157 | 0.875 | 0.244 |
| SD | county:aurora | 0.879 | 0.134 | 1.120 | 0.134 |
| TN | county:anderson | 0.945 | 0.157 | 0.802 | 0.133 |
| TX | county:anderson | 0.994 | 0.252 | 1.052 | 0.253 |
| UT | county:beaver | 1.256 | 0.113 | 0.912 | 0.354 |
| VA | county:accomack | 0.889 | 0.134 | 1.087 | 0.161 |
| VT | county:addison | 1.311 | 0.129 | 1.083 | 0.162 |
| WA | county:adams | 1.008 | 0.136 | 0.919 | 0.169 |
| WI | county:adams | 1.188 | 0.130 | 1.118 | 0.164 |
| WV | county:barbour | 1.006 | 0.248 | 1.076 | 0.172 |
| WY | county:albany | 0.886 | 0.106 | 0.876 | 0.121 |

## Verification and River handoff

Ten focused tests pass across division representation, statewide and governing-body holder delivery, registration edge composition and the new metadata cases. The SQL test runs real Postgres semantics for plain and partitioned divisions, refuses an invalid publication, and succeeds with deliberately missing unrelated government bytes. All supported held jurisdiction roots are tested without any database read. Existing route tests now require whole-state labels, metadata and CDN cache headers while preserving official identities.

The production build, TypeScript check, build-output budgets and all 15 reader-trace requirements pass. The largest application trace remains 429 files against its unchanged 430-file ceiling. Modified-file lint and both preflight checks pass.

Reproduce with `scripts/rs-03-representation-check.mts` and the existing private production read-only environment. Raw timings, per-process server logs, readonly identity and the fresh live comparison are retained in `.scratch/rs03/representation/`. Build and focused-test logs are in `/tmp/rs03-representation-{build,tests}.log` for this workspace.

This lane pushes READY for River. River owns integration, combined gates and deployment. The lane checks `board/river:returns/rs-03.md` every 15 minutes after pushing, repairs returns against current River, and continues until its exact READY is integrated.
