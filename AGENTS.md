<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# MEANWHILE — NON-NEGOTIABLE PROJECT LAW

**Read this before you write code. It outranks convenience, habit, and any
route-level conclusion you reach while working.**

Canonical source: `docs/governance/ledger.jsonl` — RULING 205, 206, 207, 208.
Full current law: `CLAUDE.md` ("The acquisition doctrine") and
`docs/governance/policies/`. Open a session with
`pnpm governance:open --task <domain>`. This block is a MIRROR: if it and the
ledger ever disagree, **the ledger wins** and this file is the thing that is
wrong.

```
IT EXISTS = GET IT
ROUTE FAILED             = TRY ANOTHER PATH
ROUTE BLOCKED            = TRY ANOTHER PATH
EXTRACTION FAILED        = TRY ANOTHER EXTRACTION PATH
VENDOR != RECORD         URL != RECORD
ONE ROUTE SUCCESS        != SOURCE UNIVERSE COMPLETE
NEEDS_SEAN != STOP
API/CREDENTIAL REQUEST   = PARALLEL ESCALATION + CONTINUED HUNT
EFFORT != EVIDENCE       EXHAUSTION != DISPOSITION
THE WORKER MAY STOP; THE OBLIGATION DOES NOT
```

**IT EXISTS = GET IT (RULING 205).** If a public civic record exists, the
obligation is to acquire it, read it, link it to the exact body and meeting, and
make it answer a reader's question — `DISCOVERED → ACQUIRED → EXTRACTED →
NORMALIZED → CANONICALLY_LINKED → QUERY_RETRIEVABLE → READER_VERIFIED`. No
upstream success implies a downstream one. A route disposition closes a
RouteTask; it never closes the record obligation.
`ROUTE_BLOCKED → NO_SOURCE_FOUND → COMPLETE` is forbidden.

**Only three things close it.** (1) Acquired and reader-answerable. (2)
Affirmative, source-backed evidence about the RECORD ITSELF — not created, not
yet published, lawfully withheld, destroyed under retention, or not publicly
obtainable. **Our failure to retrieve it is never that evidence.** (3) Every
machine route worked and only a human/offline act left — that is `PUBLIC RECORD
STILL OWED — HUMAN/OFFLINE ACCESS REQUIRED`, and the obligation stays open.

**VENDOR != RECORD (RULING 206).** Granicus, Legistar, CivicClerk, BoardDocs,
Diligent, CivicPlus, Hyland are filing cabinets.
`GOVERNMENT → RECORD → REPRESENTATION(S) → ROUTE(S)`. The record is this body,
this meeting, this version — not the URL that served it. A blocked document host
is a fact about that host, never about the API, the portal, the accessible
rendering, an archive, another custodian, or the record. Lost one
representation? Resolve another one of the same record.

**ONE ROUTE SUCCESS != SOURCE UNIVERSE COMPLETE (RULING 207).** Materially
distinct representations carry different facts. An API 200 does not retire the
PDF; a readable PDF does not retire the API; a meeting page is a branching
surface, not a URL to log and leave. An adapter is a **route portfolio**, not one
fetch function, and its known routes are a floor. Reconcile all material
representations into one canonical record with provenance and supersession.
Deduplicate exact duplicates; never skip a distinct one because something else
returned 200.

**NEEDS_SEAN != STOP (RULING 208).** If a token, account, export, feed or quota
would materially help, say exactly what and why — provider, mechanism, record
class, scopes, what it unlocks, what continues without it — then **keep working
every other path**. An escalation never closes, pauses or satisfies the
obligation it is about, and one blocked record never freezes the rest of the
hunt. Never put a secret in chat, a prompt, a tracker row, a commit, a fixture
or a log.

**EFFORT != EVIDENCE. EXHAUSTION != DISPOSITION.** Many URLs tried, tokens
spent, time elapsed, a big PR, a tracker row opened, one worker exhausted — all
execution facts about us, none of them completion. A session out of ideas says
*"I have run out of ideas"* (a claim about the session), never *"this is not
published"* (a claim about a government). **A tracker row is a record of work,
never a substitute for it.**

**The boundary, which is not caution.** Persistence is never intrusion. Do not
bypass authentication, misuse or steal credentials, impersonate a user, exploit
a vulnerability, defeat anti-bot controls, or reach non-public systems. The rule
is not "break the lock" — it is **do not let one lock define the public
information universe.**

**Two more that bind everywhere, from `CLAUDE.md`:** never generate a candidate
position (every rendered stance carries a source record, or the field is null),
and the product never tells anyone how to vote. A null renders as its NAMED GAP,
and the name says WHOSE gap it is — **our collection state is never rendered as
a claim about a government.**
