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

Times below are complete HTTP seconds. The whole-state ID is `ocd-division/country:us/state:<lowercase state code>`; append the county suffix for its county ID. Process startup is separate above and is included in the under-three-second check.

| State | County suffix | State first | State repeat | County first | County repeat |
| --- | --- | ---: | ---: | ---: | ---: |
| AK | county:aleutians_east | 1.116 | 0.114 | 0.872 | 0.138 |
| AL | county:autauga | 0.882 | 0.146 | 1.072 | 0.154 |
| AR | county:arkansas | 0.964 | 0.311 | 0.856 | 0.160 |
| AZ | county:apache | 1.569 | 0.175 | 1.376 | 0.169 |
| CA | county:alameda | 1.076 | 0.169 | 1.050 | 0.184 |
| CO | county:adams | 0.803 | 0.118 | 1.097 | 0.150 |
| CT | county:capitol | 1.086 | 0.145 | 1.124 | 0.138 |
| DE | county:kent | 1.050 | 0.156 | 1.606 | 0.287 |
| FL | county:alachua | 1.102 | 0.249 | 1.141 | 0.267 |
| GA | county:appling | 1.250 | 0.205 | 1.286 | 0.229 |
| HI | county:hawaii | 0.949 | 0.127 | 0.791 | 0.138 |
| IA | county:adair | 1.050 | 0.188 | 0.910 | 0.265 |
| ID | county:ada | 1.304 | 0.268 | 1.139 | 0.442 |
| IL | county:adams | 1.129 | 0.186 | 0.994 | 0.220 |
| IN | county:adams | 1.026 | 0.179 | 0.807 | 0.306 |
| KS | county:allen | 0.750 | 0.148 | 0.950 | 0.176 |
| KY | county:adair | 0.807 | 0.131 | 1.087 | 0.150 |
| LA | county:acadia | 1.098 | 0.127 | 0.921 | 0.177 |
| MA | county:barnstable | 1.024 | 0.153 | 0.995 | 0.161 |
| MD | county:allegany | 1.310 | 0.124 | 0.971 | 0.148 |
| ME | county:androscoggin | 0.821 | 0.148 | 1.073 | 0.150 |
| MI | county:alcona | 0.863 | 0.125 | 0.870 | 0.185 |
| MN | county:aitkin | 0.874 | 0.151 | 0.900 | 0.181 |
| MO | county:adair | 0.803 | 0.134 | 0.910 | 0.165 |
| MS | county:adams | 0.840 | 0.185 | 0.846 | 0.155 |
| MT | county:beaverhead | 0.984 | 0.156 | 0.860 | 0.279 |
| NC | county:alamance | 0.812 | 0.142 | 1.072 | 0.200 |
| ND | county:adams | 0.964 | 0.127 | 0.983 | 0.153 |
| NE | county:adams | 0.743 | 0.113 | 0.898 | 0.144 |
| NH | county:belknap | 1.602 | 0.327 | 1.553 | 0.331 |
| NJ | county:atlantic | 1.127 | 0.196 | 1.107 | 0.267 |
| NM | county:bernalillo | 1.029 | 0.123 | 1.136 | 0.150 |
| NV | county:carson_city | 1.028 | 0.118 | 0.845 | 0.151 |
| NY | county:albany | 0.988 | 0.193 | 0.985 | 0.207 |
| OH | county:adams | 0.888 | 0.177 | 0.835 | 0.166 |
| OK | county:adair | 0.882 | 0.126 | 0.864 | 0.144 |
| OR | county:baker | 1.141 | 0.118 | 1.033 | 0.154 |
| PA | county:adams | 1.032 | 0.228 | 1.466 | 0.301 |
| RI | county:bristol | 0.893 | 0.116 | 1.029 | 0.147 |
| SC | county:abbeville | 0.991 | 0.158 | 0.928 | 0.152 |
| SD | county:aurora | 1.079 | 0.119 | 1.241 | 0.147 |
| TN | county:anderson | 1.254 | 0.156 | 1.239 | 0.150 |
| TX | county:anderson | 1.196 | 0.210 | 0.953 | 0.195 |
| UT | county:beaver | 0.847 | 0.155 | 1.157 | 0.121 |
| VA | county:accomack | 0.934 | 0.148 | 0.917 | 0.157 |
| VT | county:addison | 1.095 | 0.118 | 1.013 | 0.136 |
| WA | county:adams | 0.909 | 0.128 | 0.969 | 0.205 |
| WI | county:adams | 1.202 | 0.126 | 0.984 | 0.147 |
| WV | county:barbour | 0.885 | 0.177 | 1.077 | 0.128 |
| WY | county:albany | 0.931 | 0.108 | 0.906 | 0.115 |

## Verification and River handoff

Ten focused tests pass across division representation, statewide and governing-body holder delivery, registration edge composition and the new metadata cases. The SQL test runs real Postgres semantics for plain and partitioned divisions, refuses an invalid publication, and succeeds with deliberately missing unrelated government bytes. All supported held jurisdiction roots are tested without any database read. Existing route tests now require whole-state labels, metadata and CDN cache headers while preserving official identities.

The production build, TypeScript check, build-output budgets and all 15 reader-trace requirements pass. The largest application trace remains 429 files against its unchanged 430-file ceiling. Modified-file lint and both preflight checks pass.

Reproduce with `scripts/rs-03-representation-check.mts` and the existing private production read-only environment. Raw timings, per-process server logs, readonly identity and the fresh live comparison are retained in `.scratch/rs03/representation/`. Build and focused-test logs are in `/tmp/rs03-representation-{build,tests}.log` for this workspace.

This lane pushes READY for River. River owns integration, combined gates and deployment. The lane checks `board/river:returns/rs-03.md` every 15 minutes after pushing, repairs returns against current River, and continues until its exact READY is integrated.
