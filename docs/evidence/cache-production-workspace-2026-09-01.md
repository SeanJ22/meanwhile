# The production prompt cache, measured — and the Console card that contradicted us

**2026-09-01. Session C, lane B, H1.** Instruments:
`pnpm ask:cache-probe --production`, `data/health/ask-cache-runs/`.

---

## The contradiction this was opened on

The owner read the Anthropic Console on 2026-09-01, workspace **Default**, and
it said **"Prompt caching — Not enabled"**, **"tokens reused —"**, and
recommended setting caching up because the organization's hit rate is low.

The repository was claiming the opposite. `docs/frontier.md` records *"The Ask
probe now measures 62.5% at the API's own `usage` block"*, and the sentence does
not say which workspace it is about. It was about the LOCAL one:
`scripts/ask-cache-probe.mts` expressly refused a production target, so every
number it had ever produced came from this machine's `ANTHROPIC_API_KEY` and
none from the deployed site's.

**Anthropic isolates prompt caches per workspace** (`shared/prompt-caching.md`,
API reference: *"Caches are isolated per workspace on the Claude API … Traffic
for the same prompt split across workspaces writes and reads separate
entries"*). So the local reading was evidence about the local workspace and, on
its own, about nothing else. That is the defect: not a wrong number, a number
whose denominator was never stated.

---

## 1. Which workspace is which — measured, with no credential exposed

Three Anthropic credentials are in play, and they are named here only as
variable names:

| Credential | Where it lives | Readable here? |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | `.env.local` | yes |
| `WTP_WORKERS_ANTHROPIC_API_KEY` | `.env.local` | yes |
| `ANTHROPIC_API_KEY` | Netlify, site `sparkwtp`, scope `functions`, contexts `dev,branch-deploy,deploy-preview,production,dev-server` | **no** |

**The deploy's key is not machine-readable.** Netlify reports
`is_secret=true` for it and returns a **20-character mask** in place of the
value on every context. A first pass compared that mask against the local key
and concluded "different credential"; that conclusion is **RETRACTED** — it was
a comparison against a mask, and sending the mask to Anthropic returns
`401 authentication_error`, which is a fact about the mask and not about the
key.

What CAN be measured is whether two credentials share a cache namespace,
because a prefix written by one is readable by the other **if and only if** they
are in one workspace. Two tests, no value read out:

```
LOCAL <-> WORKERS   one byte-identical max_tokens:0 prefill body
  local key,   cold : input=7 write=7922 read=0
  local key,   again: input=7 write=0    read=7922
  workers key, same : input=7 write=0    read=7922   -> ONE WORKSPACE

PRODUCTION <-> LOCAL   production writes, this machine reads
  production /api/ask/grounded, 07866 : cacheCreationInputTokens=1266
  the byte-identical synthesis request under the LOCAL key:
                                        cache_read_input_tokens=1266
                                                              -> ONE WORKSPACE
```

**All three credentials are in one workspace.** The owner's Console view of
workspace *Default* is therefore a view of the production workspace, unless the
organization holds a second workspace containing none of these three keys.

**Not determined, and it needs the owner:** the workspace's NAME and id. The
Anthropic Admin API (`client.beta.organization`, `GET /v1/organizations/api_keys`)
returns each key's `workspace_id`, and it requires an **Admin API key**
(`sk-ant-admin…`) or an `org:admin` OAuth token; a regular API key is rejected.
This repository holds neither. It unlocks the label only — the workspace
IDENTITY question above is already settled by measurement, so nothing waits on
it.

---

## 2. The production Ask path, from Anthropic's own `usage` block

`pnpm ask:cache-probe --production` drives the DEPLOYED
`https://sparkwtp.netlify.app/api/ask/grounded` over the canonical
reader-question corpus, twice per ZIP, and reads the numbers back out of the
trace — which the route copies verbatim from Anthropic's `usage` fields and
never infers from the `cache_control` marker it sent.

Two runs, same day:

| Reading | calls | reached synthesis | read tokens | write tokens | uncached | hit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `2026-09-01-1788272179879` | 14 | 7 | **15,731** | **9,662** | **583** | **4/7 = 57.1 %** |
| `2026-09-01-1788272772853` | 14 | 6 | **15,731** | **3,593** | **503** | **4/6 = 66.7 %** |

Second run, priced at Claude Opus 5's published `$5 / 1M` input rate with the
documented multipliers (write ×1.25, read ×0.1):

```
  billed $0.03284   ·   no-cache baseline $0.09914   ·   saved $0.06630 (66.9 %)
  97.5 % of all input tokens were inside the cached prefix
```

**Every one of those calls carried `x-wtp-synthetic-run`.** The caller key on
every row is `synthetic-run`, never `prod-ask`, and that is correct rather than
a shortfall: `askCallerKey` resolves a declared synthetic run to
`synthetic-run` on every deployment so a harness asking one question fourteen
times cannot be pooled with readers. **It follows that a `prod-ask` row is
producible only by an organic reader** — no lawful automated action can create
one. The Anthropic-side cache is keyed on workspace + model + prefix bytes and
knows nothing about our caller key, so the production credential, workspace,
prefix and synthesis path exercised here are the reader's; only our own label
differs.

**Rows written to production across this lane: 33 Ask signal rows**, every one
carrying the synthetic marker and therefore excluded from every aggregate the
business sells. 14 + 14 from the two probe runs, 1 from the cross-workspace
test, 4 from the failure diagnosis below.

---

## 3. Which exact requests are not caching, and why

Of the 6 calls that reached the model on the second reading:

| Request | Result | Why |
| --- | --- | --- |
| 85641 · "What outside groups spent money for or against candidates in the Vail school-board race?" (pass 1) | `write=2327 read=0` | **Cold first touch of that prefix.** Unavoidable and correct — the write is what makes the read possible. |
| 07866 · "When does the Morris Hills body meet next?" (pass 1) | `write=1266 read=0` | Cold first touch. |
| 85641 · "What campaign-finance records exist for the Vail candidate?" (passes 1 and 2) | `read=6069` | **Read a prefix a DIFFERENT question wrote.** Two questions retrieving one evidence set share a prefix, which is the whole mechanism working. |
| 85641 · "What outside groups…" (pass 2) | `read=2327` | Read. |
| 07866 · "When does the Morris Hills body…" (pass 2) | `read=1266` | Read. |

**Nothing is failing to cache that could cache.** Three distinct evidence sets
were touched; each must be written exactly once; 4 of 6 model-reaching calls
read. That is 100 % of the achievable reads for this corpus shape.

**Eight calls never reached the model and are not misses.** Six returned
`no-evidence` — the empty-pack refusal, which fires before the network. Two
returned `error`.

### The `error` calls, diagnosed

The same request — 85641, *"Who funded the Vail school-board candidate's
campaign?"*, the heaviest pack in the corpus at 6,069 prefix tokens — failed
three times across the two probe runs and **zero times in four isolated
retries**:

```
attempt 1: HTTP 200 · REJECTED_FELL_BACK · ms 11188 · write=6069 read=0
attempt 2: HTTP 200 · REJECTED_FELL_BACK · ms  7176 · write=0    read=6069
attempt 3: HTTP 200 · REJECTED_FELL_BACK · ms  6307 · write=0    read=6069
attempt 4: HTTP 200 · REJECTED_FELL_BACK · ms  6913 · write=0    read=6069
```

So it is **not a caching failure** — in isolation the same request caches
perfectly — and it is not a property of the prompt. It appears only when the
request is the first of a burst of same-workspace synthesis calls, which is the
shape of a rate limit or an upstream overload.

**It could not be diagnosed further, and that was itself a defect.**
`synthesizeAnswer` collapsed every network failure into the bare string
`error`: a 429, a 529, a socket timeout and a malformed body were
indistinguishable in the trace. Fixed in this lane — the outcome now carries a
`detail` of the HTTP status plus Anthropic's own `error.type` token, or the
thrown error's name, and the route writes it into `trace.synthesis.why`. Never a
response body, never a header, never anything a reader typed. The next
occurrence names itself.

*(Separately and outside this lane: that question renders `REJECTED_FELL_BACK`
on production — the answer is generated and then discarded by validation. That
is the ASK-19 length-budget defect, not a cache or a model finding.)*

---

## 4. Is the explicit breakpoint too narrow? Measured: no, and automatic would be worse

Anthropic offers a top-level automatic breakpoint as well as explicit
`cache_control` markers. Measured against the real Ask workload at
`count_tokens` on 2026-09-01:

```
  synthesisPrompt() renders 1,503 characters = 478 tokens
      (the repository said "≈ 418" — a chars/4 estimate, 60 tokens low)
  system + civic context, one-record pack   = 707 tokens   <- the breakpoint
  whole request including the question tail = 779 tokens
  the question tail                         =  72 tokens (9.2 % of the prompt)
```

On the real production packs the tail measured **79–88 uncached tokens** against
**1,266–6,069** cached — so **97.5 % of the input side is already inside the
cached prefix.** There is almost no headroom left to win by moving the marker.

**Automatic top-level caching is refused, for a measured reason.** It places the
breakpoint on the LAST cacheable block, which here is the reader's question — a
different string on every request. Every call would write a fresh entry that is
never read: a 1.25× surcharge on the whole prompt with zero reads. Anthropic's
own reference names this exact situation ("The prompt ends in unique
per-request content … a pure surcharge") and prescribes what this request
already does: an explicit marker at the end of the SHARED portion.

**A second breakpoint on the system block still cannot fire.** 478 tokens is
below Claude Opus 5's 512-token minimum cacheable prefix, and a prefix under the
minimum caches silently and reports nothing. The existing code said so and was
right; only its number was an estimate, and it is now a count. The margin is
**34 tokens**, which is thin enough that the next edit to the system prompt
could cross it — so the assertion in `tests/ask-prompt-cache.test.ts` now covers
the system side, not only the whole prefix.

**Rejected, with the arithmetic:** padding the system prompt over 512 tokens
would let a second breakpoint cache the constitutional rules across 100 % of Ask
traffic rather than only within one evidence set. It is worth at most
478 × 0.9 tokens per call ≈ **$0.002 per thousand calls**, and it buys that by
adding text to a prompt for no reason except to clear a vendor threshold. No.

**The TTL stays at 5 minutes.** A read refreshes the timer at no cost, and the
1-hour TTL costs 2× on write against 1.25× and needs three requests over one
prefix to break even. This prefix is specific to one ZIP AND one retrieved
evidence set, so most prefixes are touched two or three times at most.

**The real limiter is prefix divergence, and it is a retrieval property, not a
caching one.** The cached prefix contains the retrieved records, so two
questions share it only when they retrieve the SAME evidence set on the same
day. The measurement above shows that happening — two different questions at
85641 shared one 6,069-token prefix — and it is the only lever with room left in
it. It is not a breakpoint change.

---

## 5. The Console card, resolved

**Nothing needs changing to get "tokens reused" off zero: it is already off
zero.** The production workspace recorded **15,731 cache-read tokens** on
2026-09-01, twice, read from Anthropic's own `usage` fields on requests served
by the deployed site's own credential.

The Console card is not a readout of prompt-cache usage, and the distinction is
in the API reference rather than in our opinion: **prompt caching has no enable
switch.** There is no organization or workspace setting that turns it on. It is
activated per request by a `cache_control` marker on a content block, and its
ground truth is the response's `usage.cache_creation_input_tokens` and
`usage.cache_read_input_tokens` — *"the only ground truth that caching is
working"*. A card that says "Not enabled" is an onboarding recommendation
computed over the organization's aggregate traffic, most of which is not the Ask
synthesis rung; it is not a capability gate, and it cannot be reconciled with a
per-request feature by changing anything in this repository.

**What is owed to the owner, precisely:** open the Anthropic Console for this
workspace after 2026-09-01 and read the usage view's cache-read and cache-write
columns rather than the recommendation card. If those columns are still empty
while the numbers above stand, that is a vendor reporting question for
Anthropic — with request ids available from any re-run of
`pnpm ask:cache-probe --production` — and not a defect in the Ask request shape,
which has now been proved from the vendor's own response.

---

## What was corrected in the repository

- `scripts/ask-cache-probe.mts` no longer refuses production, and states in its
  header why RULING 125 does not reach a vendor-side measurement that exists
  nowhere else. It reports every call by name, the saving, and the row count.
- `lib/ask/prompt-cache.ts` and `lib/ask/synthesize.ts` carry the COUNTED 478
  tokens instead of the estimated 418, and `cacheSavings()` derives the saving
  from the published multipliers instead of a report asserting one.
- `lib/ask/synthesize.ts` and `app/api/ask/grounded/route.ts` carry the failure
  detail out of a failed synthesis instead of collapsing it to `error`.

**Still owed and NOT in this lane's file ownership:** `docs/frontier.md` line
141 states the 62.5 % Ask-probe hit rate without naming the workspace it is
about. Under the measurement above the sentence is no longer wrong — the
workspaces are one — but it was not KNOWN to be right when it was written, and
it should name the credential the reading came from. The integration owner owns
that file.
