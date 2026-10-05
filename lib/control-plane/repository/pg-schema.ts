/**
 * **THE CONTROL-PLANE DATABASE'S OWN SCHEMA, VERSIONED IN THE MODULE.**
 * (Session B, W3.1 / W3.2, 2026-08-30. RULING 220 step 1.)
 *
 * ## Why this is not a Drizzle migration
 *
 * RULING 220 puts Level-2 scheduling state in a DEDICATED database, separate
 * from the reader-serving one, with **schema owned by the provider itself:
 * outside `lib/db`, outside `drizzle.config.ts`, invisible to `pnpm db:gate`**.
 * That is not an evasion of the shipping gate — it is the point. `db:gate` asks
 * PRODUCTION whether the SERVING schema is applied, and freezing a release
 * because control-plane bookkeeping has not migrated would freeze it for a
 * reason with nothing to do with what a reader is told.
 *
 * ## "Not governed by the serving gate" must not become "ungoverned"
 *
 * So this file carries three things a migration would otherwise have given it,
 * and `pnpm control-plane:gate` checks all three:
 *
 * ```
 *   VERSIONED   BOOTSTRAP_VERSION moves when the DDL moves, and the database
 *               records which version it is at
 *   APPLIED     the gate asks the database its version and compares
 *   DRIFT       the gate compares the live table/column set against what this
 *               module declares, so a hand-edit in a console is caught
 * ```
 *
 * ## Idempotent bootstrap, and why every statement is CREATE IF NOT EXISTS
 *
 * The provider brings its own schema up on connect. A worker starting on a
 * fresh machine must not need a separate migration step it could skip — a
 * scheduler whose first act can be to fail on a missing table is a scheduler
 * that requires an operator, which is the thing the whole workstream is
 * removing. Idempotent DDL is what makes "just connect" safe to run from every
 * process, every time.
 */

/**
 * Moves whenever `BOOTSTRAP_DDL` moves. The gate compares against it.
 *
 * ## What version 9 adds, and why (Admin Pass C, ADM-C6, 2026-09-06)
 *
 * The Operator Control Room routes every state-changing thing the owner can do
 * — a button, a chat instruction, a delegated agent job — through ONE typed
 * Action Gateway. Three tables are what make that gateway more than a helper:
 *
 * ```
 *   cp_log_admin_receipts   §3.7 — every action, permitted or refused, leaves a
 *                           durable append-only receipt. "A toast is not proof."
 *                           It is also the IDEMPOTENCY INDEX: the gateway looks
 *                           for `<type>:<idempotencyKey>` before it does any
 *                           work, so a double-click, a retried fetch and a
 *                           replayed chat tool call are one action with one
 *                           receipt rather than two state changes
 *   cp_log_agent_jobs       the delegated-agent bridge's own history — one
 *                           append per state a job reaches. Reserved: the
 *                           record shape is declared in
 *                           `lib/control-plane/gateway/agent-job.ts` and the
 *                           bridge that writes it lands beside it
 *   cp_admin_config         the owner's operational policy, one aggregate at id
 *                           "current". Today it carries exactly one clause: may
 *                           paid API fallback be used (§9A.22). It is an
 *                           AGGREGATE and not a log because the question the
 *                           executor asks is "what is the policy NOW", and a
 *                           policy assembled by folding a log is a policy two
 *                           readers can disagree about. Its history is not
 *                           lost: every change is made by a gateway action and
 *                           the receipt log holds the change
 * ```
 *
 * Additive: no existing table, column or statement moved, so a store at v8
 * reads exactly as it did and the three new tables are created when the next
 * exact installed STANDING_PARENT runtime opens the durable repository. There
 * is no arbitrary-checkout production bootstrap command.
 *
 * ## What version 11 adds, and why (the field manual, 2026-09-19)
 *
 * `cp_field_manual` — one aggregate, id "live" — is the single growing store of
 * learned discovery knowledge every model-driven worker reads (as a projection)
 * before it walks and writes back to when it finds something, with no human
 * graduation step. It consolidates knowledge that was scattered across
 * `data/method/knowledge.json`, `cp_method_candidates`, `lib/hunt/branch-manifest.ts`
 * and the hunt dossiers, each entry keeping its original shape so nothing is
 * lost. Additive: no existing table, column or statement moved, and the one new
 * table is created when the next installed runtime opens the durable repository.
 */
/*
 * ## What version 12 adds, and why (meetings discovery attempts, 2026-09-23)
 *
 * `cp_log_discovery_attempts` — the unpaid meetings-discovery executor's record
 * of every walk of a government's own site: what it read, what permission it
 * walked under, what it found or why it stopped, and when the need is due
 * again. It is the per-need attempt record RULING 250 asks for; nothing else
 * held one. Additive: no existing table, column or statement moved, and the
 * one new table is created when the next installed runtime opens the durable
 * repository.
 */
/*
 * ## What version 13 adds, and why (Ask-gap observations, 2026-09-25)
 *
 * `cp_ask_gap_observations` — one aggregate per government body, Ask gap code
 * and UTC day, holding exactly the body id, the code, its record class, the
 * day and a count of the answers that told a reader that gap. The owner
 * approved recording the body behind an unanswered Ask question so targeted
 * work can be created (2026-09-25), and approved nothing personal: no
 * question, no reader, no instant (`lib/control-plane/ask-gap-observations.ts`).
 * Additive: no existing table, column or statement moved, and the one new
 * table is created when the next installed runtime opens the durable
 * repository. Until then Ask's write fails by name after the answer, and the
 * reader is not told.
 */
/** Version 14 adds durable, CAS-leased Admin requests for already-held original bytes.
 * Version 15 reserves an indexed, immutable checklist instance projection and
 * scope head. No writer is enabled by this schema move: a missing head remains
 * UNAVAILABLE, never a zero-instance claim.
 * Version 16 adds atomic action-history companions and the active-claim and
 * latest-cycle indexes. Historical receipts remain readable without backfill.
 * Version 17 preserves writes from older receipt providers while invalidating
 * partial history instead of demanding a companion from those providers. */
// Version 18 adds the exact source-URL artifact index, online while captures continue.
// Version 19 adds the Door Registry table (DB-09).
/*
 * ## What version 20 adds, and why (each task reads only its own history, CH-26, 2026-10-05)
 *
 * Indexes for the reads a task makes about its own work item, subject and
 * lineage, so those reads stop scanning whole tables as history grows
 * (rulings §5: nothing loads the whole country). Each index is on the exact
 * expression the repository's filtered read sends (`value #>> '{path}'` for an
 * aggregate's `listWhere`, `record #>> '{path}'` for a log's `keysWhere`), since
 * Postgres matches an expression index only to the same expression: the older
 * `->>` indexes do not serve `listWhere`. `cp_work_items_repair_parent` is the
 * lineage index: a work item's repair children, found without listing every
 * work item. Every index is built online (`CREATE INDEX CONCURRENTLY`), the way
 * version 18's source-URL index is, so captures and leases continue while it
 * builds. Additive: no table, column or statement moved.
 */
export const BOOTSTRAP_VERSION = 20;

/**
 * The tables, and the shape each one carries.
 *
 * Two kinds and no more, mirroring the interfaces exactly:
 *
 * ```
 *   AGGREGATE     id, revision, updated_at, value   — CAS on revision
 *   APPEND_ONLY   key, record_id, position, record  — unique on (log, record_id)
 * ```
 *
 * The value is `jsonb` rather than columns per field. That is deliberate: the
 * domain types are owned by `work-item.ts`, `route-task.ts` and `attempt.ts`,
 * and mirroring their fields into columns would put a second definition of
 * every aggregate in this file — which would then drift, silently, exactly the
 * way two surfaces answering one question always do.
 */
export const AGGREGATE_KINDS = [
  "work_items",
  "route_tasks",
  "attempts",
  "leases",
  "budget",
  /* The scheduler's durable state. (Session B resume, W3.C — version 2.) */
  "obligations",
  "occurrences",
  "debts",
  /*
   * THE OWNER CONTROL CENTRE'S DATA PLANE. (Session C final, ITEM H — version 3.)
   *
   * The admin host (`ADMIN_ORIGIN`) runs in a Netlify function bundle. It cannot read
   * the always-on machine's filesystem, its Drive mirror, its process table or
   * its scratch output, and `next.config.ts` documents at length what happens
   * to a `process.cwd()` read that nobody traced: it returns nothing, the catch
   * returns null, and the surface renders a gap that is indistinguishable from
   * honest missing data. On a HEALTH page that failure mode tells the owner his
   * pilot is fine because the page could not find the file that says otherwise.
   *
   * So these three exist to be WRITTEN by the runner and READ by the deploy:
   *
   *   owner_snapshots      one aggregate, id "current" — the whole control
   *                        centre at one instant, so seven panels cannot show
   *                        seven different moments and imply they are one
   *   runner_heartbeat     id "pilot-runner" — "is it alive" has to be a fact
   *                        the runner WROTE, never one the page infers from the
   *                        absence of bad news
   *   cache_observations   id "organic-prod-ask" — the H1 waiver's standing
   *                        check. A "has this ever happened?" fact cannot live
   *                        in a serverless function's memory, and the ledger in
   *                        `lib/ask/prompt-cache.ts` is per-process
   *
   * Every one of them is AGGREGATE-ONLY at rest and in render, enforced by
   * field name in `lib/control-plane/owner-surface.ts`.
   */
  "owner_snapshots",
  "runner_heartbeat",
  "cache_observations",
  /*
   * LEVEL 1 — RESEARCH. (Level 1 activation, 2026-09-01 — version 4.)
   *
   *   research_state   id "level-1" — what the standing runner measured about
   *                    the Scout lane on its last cycle: lane enabled, the
   *                    worker credential confirmed BY NAME, the bounds, the
   *                    rolling spend, the queue counts, the Scouts running.
   *                    The admin Research view DERIVES ACTIVE/DEGRADED/
   *                    INACTIVE from it and from the heartbeat; no verdict is
   *                    stored, because a stored verdict outlives its truth
   */
  "research_state",
  /* PDC: mutable method-candidate lifecycle is canonical runtime state, never a tracked Git file. */
  "method_candidates",
  /*
   * THE STATE READINESS CONTROL PANEL'S DATA PLANE. (2026-09-03 — version 7.)
   *
   *   readiness_snapshots  one aggregate per state, keyed by two-letter state
   *                        code — the whole materialized readiness table for
   *                        that state at one instant, written by a publisher
   *                        and read by the operator panel at one instant. Like
   *                        owner_snapshots it is DERIVED, never authored: there
   *                        is no admin-writable status field anywhere in it.
   */
  "readiness_snapshots",
  /*
   * THE OWNER'S OPERATIONAL POLICY. (Admin Pass C, ADM-C6 — version 9.)
   *
   *   admin_config  one aggregate, id "current" — what the owner has decided
   *                 about how the system may operate, as opposed to what it
   *                 has measured. Today that is one clause: whether paid API
   *                 fallback is permitted (§9A.22), which defaults OFF and
   *                 must still read OFF after a deploy or a restart. That
   *                 requirement is the whole reason it is here rather than in
   *                 browser state: a toggle stored in a tab is a toggle that
   *                 silently resets, and one stored in an env var is a toggle
   *                 the owner cannot move.
   *
   *                 An AGGREGATE, so the executor's question — "what is the
   *                 policy now" — has exactly one answer. The history of the
   *                 policy lives in the receipt log, where every change was
   *                 made.
   */
  "admin_config",
  /*
   * THE FIELD MANUAL. (Owner directive 2026-09-19 — version 11.)
   *
   *   field_manual  one aggregate, id "live" — the single growing store of
   *                 learned discovery knowledge. Every model-driven worker reads
   *                 a PROJECTION of it (narrowed to its role and jurisdiction, so
   *                 it costs cents cached rather than the whole store's ~70K
   *                 tokens) before it walks, and writes what it learned straight
   *                 back with no human admission step. An AGGREGATE because the
   *                 question is "what do we know that applies here, now"; it only
   *                 ever grows (an entry is refreshed, never removed) so a
   *                 consolidation that keeps every meaning cannot shrink it.
   */
  "field_manual",
  /*
   * WHAT READERS WERE TOLD ASK DOES NOT HOLD. (2026-09-25 — version 13.)
   *
   *   ask_gap_observations  one aggregate per body, gap code and UTC day, id
   *                         `<body id>#<code>#<day>`: the body, the code, its
   *                         record class, the day and a count. Nothing about a
   *                         reader or a question. An AGGREGATE because a second
   *                         ask the same day is a count, never a new row.
   */
  "ask_gap_observations",
  /*
   * THE DOOR REGISTRY. (DB-09 — version 19.)
   *
   *   doors  one aggregate per door, id = the door id: what reads it, the
   *          bodies and hosts behind it, what it holds, how often it is
   *          checked, and whether it is open, shut or set aside. An AGGREGATE
   *          because the question every reader asks is "what is this door now";
   *          the history of each change is the receipt log. Additive.
   */
  "doors",
  /** Original-byte copy requests; never source acquisition or a second scheduler. */
  "admin_evidence_copy_requests",
] as const;

export const APPEND_ONLY_LOGS = [
  "transitions",
  "escalations",
  "dispositions",
  "artifacts",
  "costs",
  /*
   * THE OWNER'S HISTORY AND HIS DECISIONS. (Session C final, ITEM H — version 3.)
   *
   *   owner_digests    every digest the runner wrote, so the page can show the
   *                    latest AND the history. Append-only because a digest is
   *                    a reading taken at a time; rewriting one would be
   *                    rewriting what was true then
   *   owner_decisions  the INTENT a decision button appends. Append-only for
   *                    the same reason the disposition log is: it is the commit
   *                    point, and the canonicalisation that follows replays it
   *                    rather than mutating it
   */
  "owner_digests",
  "owner_decisions",
  /*
   * LEVEL 1 — RESEARCH. (Version 4.)
   *
   *   research_intents  the owner's PAUSE / RESUME / RUN_CYCLE_NOW intents,
   *                     appended by the admin API under the admin security
   *                     boundary, and the runner's HONORED records beside
   *                     them. Append-only: an intent is a fact about a moment
   *   scout_results     every typed Scout result, keyed by obligation id —
   *                     the durable learning, and the resume cursor the next
   *                     Attempt on that obligation reads
   */
  "research_intents",
  "scout_results",
  "worker_results",
  /*
   * THE NIGHTLY DOOR. (RULING 242 — version 5.)
   *
   *   promotion_pipeline  every typed transition SCOUTED -> CONFIRMED ->
   *                       VERIFIED -> AUDITED -> APPROVED_FOR_PROMOTION, and
   *                       every REFUSED record with its reasons, keyed by
   *                       item id. The only path toward reader truth
   *   window_runs         one record per nightly window, keyed by the
   *                       America/New_York date it answered for
   *   window_incidents    a stage failure, typed, keyed by window id; the
   *                       next window catches up what it names
   *   window_intents      explicit owner RUN_WINDOW_NOW requests, and the
   *                       runner's HONORED record beside it
   */
  "promotion_pipeline",
  "window_runs",
  "window_incidents",
  "window_intents",
  /*
   * SOFTWARE RELEASE REVIEW. (Admin Pass B, 2026-09-06 — version 8.)
   *
   *   software_release_reviews  the owner's decisions on a SOFTWARE BUILD
   *                             (APPROVE / NEEDS_CHANGES / DISCARD / feedback /
   *                             the Raised State variant / the composite
   *                             OWNER_APPROVED_FOR_PRODUCTION), keyed by the
   *                             exact staging SHA each was made against, plus
   *                             the Admin's own note that it observed a
   *                             manifest for that SHA. Append-only, never
   *                             updated, never deleted, joined to nothing
   *                             civic. Additive: no existing table or
   *                             statement moved.
   */
  "software_release_reviews",
  /*
   * THE ACTION GATEWAY. (Admin Pass C, ADM-C6 — version 9.)
   *
   *   admin_receipts  every action the console submitted and what came of it,
   *                   keyed under one log key ("admin-action") with the record
   *                   id `<action type>:<idempotency key>`. Two jobs, and the
   *                   second is the load-bearing one:
   *
   *                     PROOF        §3.7 — who initiated it, what it was, its
   *                                  authority class, the target, the input
   *                                  digest, the code SHA and state revision it
   *                                  was rendered against, started, completed,
   *                                  outcome, refusal, downstream work ids,
   *                                  where to read the result back, what would
   *                                  undo it. A refusal is a receipt too: a
   *                                  refusal that leaves no record is
   *                                  indistinguishable from a click that never
   *                                  arrived
   *                     IDEMPOTENCY  the gateway reads this log BEFORE it does
   *                                  any work and returns the existing receipt
   *                                  when the id is already present, so a
   *                                  double-click, a retried fetch and a
   *                                  replayed chat tool call are one action
   *
   *                   Deriving the record id from the action rather than from
   *                   the clock is what makes the second job work: the store's
   *                   own append idempotency then does the deduplication, and
   *                   a differing record under one id is refused rather than
   *                   silently accepted.
   *
   *   agent_jobs      the delegated-agent bridge's history — one append per
   *                   state a job reaches (requested, started, finished), never
   *                   an edit, so a job that died is still visibly a job that
   *                   was requested. Declared here with its record shape in
   *                   `lib/control-plane/gateway/agent-job.ts` so the storage
   *                   is in place and versioned before the bridge that writes
   *                   it, rather than arriving as a second schema move later.
   *
   *   discovery_attempts  one append per walk of a government's own site for
   *                   its meeting route (v12, 2026-09-23), keyed by
   *                   jurisdiction id. Record shape: `MeetingsDiscoveryAttempt`
   *                   in `lib/hunt/meetings-site-discovery.ts`. Append-only
   *                   because a walk is a reading taken at a time; a later walk
   *                   never rewrites what an earlier one saw.
   */
  "admin_receipts",
  "agent_jobs",
  "discovery_attempts",
] as const;

/** Every table this schema declares, for the drift check. */
export const DECLARED_TABLES: readonly string[] = [
  "cp_schema_version",
  "cp_log_heads",
  "cp_admin_action_history_projection",
  "cp_admin_action_history_scope_ref",
  "cp_admin_action_history_readiness",
  "cp_checklist_scope_heads",
  "cp_checklist_instance_projections",
  ...AGGREGATE_KINDS.map((k) => `cp_${k}`),
  ...APPEND_ONLY_LOGS.map((l) => `cp_log_${l}`),
];

/**
 * **ONE STATEMENT PER ENTRY, AND THE DRIVER IS WHY.**
 * (Session B resume, W3.D, 2026-08-31.)
 *
 * `BOOTSTRAP_DDL` documents itself as "a list rather than one blob because the
 * driver executes one statement per call" — and then `appendOnlyTable` returned
 * a CREATE TABLE and a CREATE INDEX in a single template string. Over
 * `@neondatabase/serverless`'s HTTP client every query is a PREPARED statement,
 * and Postgres refuses `cannot insert multiple commands into a prepared
 * statement` (SQLSTATE 42601).
 *
 * So the bootstrap could never have run against a real Postgres database. That
 * was invisible for as long as it was: `control-plane:gate` exits 0 on
 * NOT_CONFIGURED, no control-plane database was provisioned, and the file and
 * memory providers do not execute DDL. The first connection to a live database
 * failed on the first log table.
 *
 * These builders return ARRAYS now, so a statement is a statement and the list
 * cannot silently hold a blob again.
 */
function aggregateTable(name: string): readonly string[] {
  return [
    `CREATE TABLE IF NOT EXISTS cp_${name} (
      id          text PRIMARY KEY,
      revision    bigint NOT NULL,
      updated_at  timestamptz NOT NULL,
      value       jsonb NOT NULL
    );`,
  ];
}

/**
 * **THE POSITION IS UNIQUE PER LOG KEY, AND THE DATABASE ENFORCES IT.**
 * (Session B resume, W3.D, 2026-08-31 — schema version 2.)
 *
 * This index was `CREATE INDEX` — NOT unique — while `pgAppendOnlyRepository`
 * computed `position` as `COALESCE(MAX(position) + 1, 0)` over the same
 * `log_key` inside the INSERT. Under READ COMMITTED, which is what Neon
 * serves by default, two concurrent inserts carrying DIFFERENT `record_id`s
 * each see the same committed maximum and each write that position. Neither
 * violates `PRIMARY KEY (log_key, record_id)`, so both commit and the log
 * holds two records at one position.
 *
 * That is not a hypothetical about a busy system. It is the ordinary result of
 * the two-worker contention this control plane is FOR, and the log is the
 * replay history — `reconcile()` walks dispositions in position order to
 * finish writes a crash interrupted. Two records at one position make that
 * order ambiguous, and an ambiguous replay order is a recovery that can apply
 * commits in a sequence that never happened.
 *
 * The fix is two things, deliberately, and neither is sufficient alone:
 *
 * 1. **A UNIQUE index**, so the invariant is a property of the DATABASE. A
 *    correctness rule enforced only by application discipline is enforced only
 *    until the next caller.
 * 2. **A transaction-scoped ADVISORY LOCK per log key** in the writer, so
 *    concurrent appends to one log SERIALIZE instead of racing and then losing
 *    one to a constraint violation. The unique index alone would be correct and
 *    would turn ordinary contention into a failure rate.
 */
function appendOnlyTable(name: string): readonly string[] {
  return [
    `CREATE TABLE IF NOT EXISTS cp_log_${name} (
      log_key     text NOT NULL,
      record_id   text NOT NULL,
      position    bigint NOT NULL,
      recorded_at timestamptz NOT NULL,
      record      jsonb NOT NULL,
      PRIMARY KEY (log_key, record_id)
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS cp_log_${name}_order
      ON cp_log_${name} (log_key, position);`,
  ];
}

/**
 * The bootstrap, as a list of statements.
 *
 * A list rather than one blob because the driver executes one statement per
 * call, and because a failure then names the statement that failed rather than
 * "the bootstrap".
 */
export const ARTIFACT_SOURCE_INDEX_DDL = `CREATE INDEX CONCURRENTLY IF NOT EXISTS cp_log_artifacts_source_url
     ON cp_log_artifacts (md5(record->>'canonicalUrl'), (record->>'recordedAt') DESC NULLS LAST, (record->>'artifactId') ASC);`;

/** One index the bootstrap builds online, with the name its catalog status is read by. */
export interface OnlineIndex { readonly name: string; readonly ddl: string; readonly inProgressCode: string }

export const ARTIFACT_SOURCE_INDEX: OnlineIndex = { name: "cp_log_artifacts_source_url", ddl: ARTIFACT_SOURCE_INDEX_DDL,
  inProgressCode: "CONTROL_PLANE_SOURCE_INDEX_BUILD_IN_PROGRESS" };

function onlineIndex(name: string, on: string): OnlineIndex {
  return { name, ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name} ON ${on};`, inProgressCode: "CONTROL_PLANE_INDEX_BUILD_IN_PROGRESS" };
}

/** Version 20 (CH-26): the scoped history reads' indexes, each on the exact expression its read sends. */
export const SCOPED_HISTORY_INDEXES: readonly OnlineIndex[] = [
  onlineIndex("cp_attempts_work_item", "cp_attempts ((value #>> '{workItemId}'))"),
  onlineIndex("cp_route_tasks_work_item", "cp_route_tasks ((value #>> '{workItemId}'))"),
  onlineIndex("cp_occurrences_work_item", "cp_occurrences ((value #>> '{workItemId}'))"),
  onlineIndex("cp_work_items_repair_parent", "cp_work_items ((value #>> '{planRepair,parentWorkItemId}'))"),
  onlineIndex("cp_log_scout_results_subject", "cp_log_scout_results ((record #>> '{subjectId}'))"),
  onlineIndex("cp_log_costs_recorded_at", "cp_log_costs (recorded_at)"),
];

/** Every index the bootstrap builds online, by its DDL statement. */
export const ONLINE_INDEXES: ReadonlyMap<string, OnlineIndex> = new Map(
  [ARTIFACT_SOURCE_INDEX, ...SCOPED_HISTORY_INDEXES].map(index => [index.ddl, index] as const));

export const BOOTSTRAP_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS cp_schema_version (
     singleton   boolean PRIMARY KEY DEFAULT true CHECK (singleton),
     version     integer NOT NULL,
     applied_at  timestamptz NOT NULL
   );`,
  /*
   * THE POSITION ALLOCATOR — one row per (log, key), holding the next position.
   *
   * A separate table rather than an advisory lock, and the reason is the
   * driver. `@neondatabase/serverless`'s `neon()` client speaks HTTP: each
   * query may land on a different backend connection, so there is no stable
   * SESSION to hold a session-scoped advisory lock and no client-side
   * transaction to scope a transaction-scoped one. A lock that silently is not
   * held is worse than no lock, because the code reads as if it were.
   *
   * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` needs neither. It is one
   * statement, so it is one implicit transaction; the conflict path takes a ROW
   * LOCK on the head row, so concurrent allocators for one key serialize and
   * each receives a distinct position. That is the "genuinely unique ordered
   * sequence", and it is enforced by the database rather than by a convention.
   */
  `CREATE TABLE IF NOT EXISTS cp_log_heads (
     log_table     text NOT NULL,
     log_key       text NOT NULL,
     next_position bigint NOT NULL,
     PRIMARY KEY (log_table, log_key)
   );`,
  `CREATE TABLE IF NOT EXISTS cp_checklist_scope_heads (
     scope_id                 text NOT NULL,
     instruction_receipt      text NOT NULL,
     projection_id            text NOT NULL,
     source_snapshot_revision bigint NOT NULL,
     snapshot_published_at    timestamptz NOT NULL,
     scope_revision           text NOT NULL,
     observed_at              timestamptz NOT NULL,
     profile                  text NOT NULL,
     inventory_complete       boolean NOT NULL,
     reads_complete           boolean NOT NULL,
     captured_counts          jsonb NOT NULL,
     PRIMARY KEY (scope_id, instruction_receipt)
   );`,
  `CREATE TABLE IF NOT EXISTS cp_checklist_instance_projections (
     projection_id  text NOT NULL,
     definition_id  text NOT NULL,
     obligation_key text NOT NULL,
     ordinal        bigint NOT NULL,
     instance       jsonb NOT NULL,
     PRIMARY KEY (projection_id, definition_id, obligation_key, ordinal)
   );`,
  ...AGGREGATE_KINDS.flatMap(aggregateTable),
  ...APPEND_ONLY_LOGS.flatMap(appendOnlyTable),
  // The action-history tables follow their canonical receipt source.
  `CREATE TABLE IF NOT EXISTS cp_admin_action_history_projection (
  gateway_receipt_id text PRIMARY KEY,
  gateway_log_key text NOT NULL DEFAULT 'admin-action' CHECK (gateway_log_key = 'admin-action'),
  projection_version integer NOT NULL CHECK (projection_version = 1),
  gateway_type text NOT NULL,
  idempotency_key text NOT NULL,
  source_position bigint NOT NULL UNIQUE CHECK (source_position >= 0),
  source_recorded_at timestamptz NOT NULL,
  source_hash char(64) NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  mapping_state text NOT NULL CHECK (mapping_state IN ('MAPPED', 'SCOPE_KNOWN_KIND_UNMAPPED', 'UNMAPPED')),
  action_kind text,
  unmapped_reason text,
  target_ref text,
  target_label text,
  CONSTRAINT cp_action_history_mapping_complete CHECK (
    (mapping_state = 'MAPPED' AND action_kind IS NOT NULL AND unmapped_reason IS NULL) OR
    (mapping_state <> 'MAPPED' AND action_kind IS NULL AND unmapped_reason IS NOT NULL)
  ),
  CONSTRAINT cp_action_history_source FOREIGN KEY (gateway_log_key, gateway_receipt_id)
    REFERENCES cp_log_admin_receipts (log_key, record_id)
);`,
  `CREATE TABLE IF NOT EXISTS cp_admin_action_history_scope_ref (
  gateway_receipt_id text NOT NULL REFERENCES cp_admin_action_history_projection (gateway_receipt_id),
  scope_key text NOT NULL,
  instruction_log_key text NOT NULL DEFAULT 'admin-action' CHECK (instruction_log_key = 'admin-action'),
  instruction_receipt_id text,
  scope_kind text NOT NULL CHECK (scope_kind IN ('GLOBAL', 'INSTRUCTION')),
  PRIMARY KEY (gateway_receipt_id, scope_key),
  CONSTRAINT cp_action_history_scope_shape CHECK (
    (scope_kind = 'GLOBAL' AND scope_key = 'us' AND instruction_receipt_id IS NULL) OR
    (scope_kind = 'INSTRUCTION' AND scope_key <> 'us' AND instruction_receipt_id IS NOT NULL)
  ),
  CONSTRAINT cp_action_history_instruction_source FOREIGN KEY (instruction_log_key, instruction_receipt_id)
    REFERENCES cp_log_admin_receipts (log_key, record_id)
);`,
  `CREATE INDEX IF NOT EXISTS cp_admin_action_history_by_instruction
  ON cp_admin_action_history_scope_ref (scope_key, instruction_receipt_id, gateway_receipt_id);`,
  `CREATE INDEX IF NOT EXISTS cp_admin_action_history_by_position
  ON cp_admin_action_history_projection (source_position, gateway_receipt_id);`,
  `CREATE TABLE IF NOT EXISTS cp_admin_action_history_readiness (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  projection_version integer NOT NULL CHECK (projection_version = 1),
  status text NOT NULL CHECK (status IN ('INCOMPLETE', 'READY')),
  source_through_position bigint NOT NULL CHECK (source_through_position >= 0),
  source_count bigint NOT NULL CHECK (source_count >= 0),
  projected_count bigint NOT NULL CHECK (projected_count >= 0),
  source_set_hash char(64) NOT NULL CHECK (source_set_hash ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz NOT NULL,
  CONSTRAINT cp_action_history_ready_counts CHECK (status <> 'READY' OR source_count = projected_count)
);`,
  `CREATE OR REPLACE FUNCTION cp_admin_action_history_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin action history is immutable' USING ERRCODE = '23514';
END $$;`,
  `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cp_admin_action_history_projection_immutable' AND tgrelid = 'cp_admin_action_history_projection'::regclass) THEN
    CREATE TRIGGER cp_admin_action_history_projection_immutable
BEFORE UPDATE OR DELETE ON cp_admin_action_history_projection
FOR EACH ROW EXECUTE FUNCTION cp_admin_action_history_reject_mutation();
  END IF;
END $$;`,
  `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cp_admin_action_history_scope_immutable' AND tgrelid = 'cp_admin_action_history_scope_ref'::regclass) THEN
    CREATE TRIGGER cp_admin_action_history_scope_immutable
BEFORE UPDATE OR DELETE ON cp_admin_action_history_scope_ref
FOR EACH ROW EXECUTE FUNCTION cp_admin_action_history_reject_mutation();
  END IF;
END $$;`,
  `CREATE OR REPLACE FUNCTION cp_admin_action_history_assert_projection() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  source_row cp_log_admin_receipts%ROWTYPE;
  scope_count bigint;
BEGIN
  SELECT * INTO source_row FROM cp_log_admin_receipts
    WHERE log_key = NEW.gateway_log_key AND record_id = NEW.gateway_receipt_id;
  IF NOT FOUND OR source_row.position <> NEW.source_position OR
     source_row.recorded_at <> NEW.source_recorded_at OR
     source_row.record->>'receiptId' <> NEW.gateway_receipt_id OR
     source_row.record->>'type' <> NEW.gateway_type OR
     source_row.record->>'idempotencyKey' <> NEW.idempotency_key
  THEN RAISE EXCEPTION 'admin history/source receipt mismatch' USING ERRCODE = '23514'; END IF;
  SELECT count(*) INTO scope_count FROM cp_admin_action_history_scope_ref
    WHERE gateway_receipt_id = NEW.gateway_receipt_id;
  IF (NEW.mapping_state = 'UNMAPPED' AND scope_count <> 0) OR
     (NEW.mapping_state <> 'UNMAPPED' AND scope_count <> 1)
  THEN RAISE EXCEPTION 'admin history scope cardinality mismatch' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;`,
  `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cp_admin_action_history_projection_parity' AND tgrelid = 'cp_admin_action_history_projection'::regclass) THEN
    CREATE CONSTRAINT TRIGGER cp_admin_action_history_projection_parity
AFTER INSERT ON cp_admin_action_history_projection DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cp_admin_action_history_assert_projection();
  END IF;
END $$;`,
  `CREATE OR REPLACE FUNCTION cp_admin_action_history_assert_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  action_type text;
  projected_kind text;
  action_subject text;
  action_outcome text;
  original_subject text;
  original_type text;
  original_outcome text;
BEGIN
  SELECT p.gateway_type, p.action_kind, a.record->>'subject', a.record->>'outcome'
    INTO action_type, projected_kind, action_subject, action_outcome
    FROM cp_admin_action_history_projection p
    JOIN cp_log_admin_receipts a ON a.log_key = p.gateway_log_key AND a.record_id = p.gateway_receipt_id
    WHERE p.gateway_receipt_id = NEW.gateway_receipt_id;
  IF NEW.scope_kind = 'GLOBAL' THEN
    IF NEW.scope_key IS DISTINCT FROM 'us' OR
       ((action_type = 'runner.pause' AND projected_kind = 'global-runner-pause') OR
        (action_type = 'runner.resume' AND projected_kind = 'global-runner-resume')) IS NOT TRUE
    THEN RAISE EXCEPTION 'unproven global action scope' USING ERRCODE = '23514'; END IF;
  ELSE
    SELECT record->>'subject', record->>'type', record->>'outcome'
      INTO original_subject, original_type, original_outcome
      FROM cp_log_admin_receipts WHERE log_key = 'admin-action' AND record_id = NEW.instruction_receipt_id;
    IF action_type IS DISTINCT FROM 'expansion.scope.set' OR projected_kind IS NOT NULL OR
       action_subject IS DISTINCT FROM NEW.scope_key OR action_outcome IS DISTINCT FROM 'DONE' OR
       original_type IS DISTINCT FROM 'expansion.scope.set' OR
       original_subject IS DISTINCT FROM NEW.scope_key OR original_outcome IS DISTINCT FROM 'DONE'
    THEN RAISE EXCEPTION 'unproven instruction action scope' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;`,
  `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cp_admin_action_history_scope_parity' AND tgrelid = 'cp_admin_action_history_scope_ref'::regclass) THEN
    CREATE CONSTRAINT TRIGGER cp_admin_action_history_scope_parity
AFTER INSERT ON cp_admin_action_history_scope_ref DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cp_admin_action_history_assert_scope();
  END IF;
END $$;`,
  `CREATE OR REPLACE FUNCTION cp_admin_action_history_invalidate_readiness() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.log_key <> 'admin-action' THEN RETURN NEW; END IF;
  UPDATE cp_admin_action_history_readiness SET status = 'INCOMPLETE'
    WHERE singleton = true AND status = 'READY';
  RETURN NEW;
END $$;`,
  `DO $$ BEGIN
  DROP TRIGGER IF EXISTS cp_admin_action_history_receipt_companion ON cp_log_admin_receipts;
  DROP FUNCTION IF EXISTS cp_admin_action_history_assert_receipt();
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cp_admin_action_history_receipt_invalidation' AND tgrelid = 'cp_log_admin_receipts'::regclass) THEN
    CREATE CONSTRAINT TRIGGER cp_admin_action_history_receipt_invalidation
AFTER INSERT ON cp_log_admin_receipts DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cp_admin_action_history_invalidate_readiness();
  END IF;
END $$;`,
  // Bootstrap executes one standalone statement per query, outside a transaction.
  // CONCURRENTLY lets the standing runner keep appending while this index is built.
  // URLs can exceed the btree row limit; the query also checks exact equality.
  ARTIFACT_SOURCE_INDEX_DDL,
  `CREATE INDEX IF NOT EXISTS cp_attempts_lease_id ON cp_attempts ((value->>'leaseId'));`,
  `CREATE INDEX IF NOT EXISTS cp_log_owner_digests_cycle_kind_position
     ON cp_log_owner_digests (log_key, (record #>> '{runtimeOutcome,kind}'), position DESC);`,
  /*
   * The due-work index. RULING 220 names indexed due-time queries as one of the
   * two things the filesystem provider cannot carry — a due-time query over a
   * directory is a full scan, and a SQL index is the boring correct tool.
   */
  `CREATE INDEX IF NOT EXISTS cp_route_tasks_state
     ON cp_route_tasks ((value->>'state'));`,
  `CREATE INDEX IF NOT EXISTS cp_leases_expiry
     ON cp_leases ((value->>'expiresAt'));`,
  /*
   * THE DUE-TIME INDEX, which is the whole reason a standing obligation stores
   * its next-due rather than only deriving it. RULING 220 names an indexed
   * due-time query as one of the two things the filesystem provider cannot
   * carry, and this is it: "which obligations are due?" is a range scan here
   * and a full directory scan there.
   */
  `CREATE INDEX IF NOT EXISTS cp_obligations_next_due
     ON cp_obligations ((value->>'nextDueAt'))
     WHERE (value->>'active')::boolean;`,
  `CREATE INDEX IF NOT EXISTS cp_debts_retry
     ON cp_debts ((value->>'retryAt'));`,
  `CREATE INDEX IF NOT EXISTS cp_occurrences_obligation
     ON cp_occurrences ((value->>'obligationId'));`,
  // Version 20 (CH-26): built online, after every table they index exists.
  ...SCOPED_HISTORY_INDEXES.map(index => index.ddl),
];

/**
 * Duplicate (log_key, position) pairs the version-1 schema could have admitted.
 *
 * Run BEFORE the unique index is created, because `CREATE UNIQUE INDEX` over a
 * table that already holds a duplicate fails with a constraint error that names
 * the index rather than the data. A database that never raced has nothing here
 * and the query returns zero rows; one that did needs a person, and the gate
 * says which log and which position rather than "the bootstrap failed".
 */
export function duplicatePositionQuery(log: string): string {
  return `SELECT log_key, position, count(*) AS n
          FROM cp_log_${log}
          GROUP BY log_key, position
          HAVING count(*) > 1`;
}

/** The statement that records which version the database is now at. */
export function recordVersionStatement(version: number, nowIso: string): string {
  return `INSERT INTO cp_schema_version (singleton, version, applied_at)
          VALUES (true, ${version}, '${nowIso}')
          ON CONFLICT (singleton) DO UPDATE
            SET version = GREATEST(cp_schema_version.version, EXCLUDED.version),
                applied_at = CASE WHEN EXCLUDED.version >= cp_schema_version.version THEN EXCLUDED.applied_at ELSE cp_schema_version.applied_at END;`;
}

/** What the gate found, and every field is a fact it read rather than assumed. */
export interface SchemaVerdict {
  readonly configured: boolean;
  readonly reachable: boolean;
  readonly appliedVersion: number | null;
  readonly expectedVersion: number;
  readonly missingTables: readonly string[];
  readonly unexpectedTables: readonly string[];
  readonly problems: readonly string[];
}

/**
 * Judge a live reading against what this module declares.
 *
 * PURE, so the gate's rule is testable without a database — which matters more
 * than usual here, because the database is exactly what a session without the
 * credential cannot reach. A gate whose logic could only be exercised against
 * the thing it guards is a gate nobody can check.
 *
 * **An unreachable database is NOT a pass.** It is `reachable: false` with the
 * reason, and the caller decides whether that is fatal — a gate that treated
 * "could not connect" as "nothing wrong" would go green on every machine that
 * has no control plane at all.
 */
export function judgeSchema(input: {
  readonly configured: boolean;
  readonly reachable: boolean;
  readonly appliedVersion: number | null;
  readonly liveTables: readonly string[] | null;
  readonly unreachableReason?: string;
}): SchemaVerdict {
  const problems: string[] = [];

  if (!input.configured) {
    return {
      configured: false,
      reachable: false,
      appliedVersion: null,
      expectedVersion: BOOTSTRAP_VERSION,
      missingTables: [],
      unexpectedTables: [],
      problems: [],
    };
  }

  if (!input.reachable || input.liveTables === null) {
    return {
      configured: true,
      reachable: false,
      appliedVersion: null,
      expectedVersion: BOOTSTRAP_VERSION,
      missingTables: [],
      unexpectedTables: [],
      problems: [
        `the control-plane database is configured and could not be reached: ${
          input.unreachableReason ?? "no reason given"
        }. A gate that read this as "nothing wrong" would go green on a database that does not ` +
          "exist, which is the shape of an unenforced check.",
      ],
    };
  }

  const live = new Set(input.liveTables);
  const missingTables = DECLARED_TABLES.filter((t) => !live.has(t));
  /* Only `cp_`-prefixed tables are ours to judge. A dedicated database might
     legitimately hold something else one day, and claiming otherwise would make
     this gate an opinion about the whole database. */
  const unexpectedTables = [...live].filter(
    (t) => t.startsWith("cp_") && !DECLARED_TABLES.includes(t),
  );

  if (missingTables.length > 0) {
    problems.push(
      `${missingTables.length} declared table(s) are absent: ${missingTables.join(", ")}. The ` +
        "bootstrap is idempotent and runs on connect, so an absent table means no provider has " +
        "connected to this database yet, or something dropped it.",
    );
  }
  if (unexpectedTables.length > 0) {
    problems.push(
      `${unexpectedTables.length} control-plane table(s) exist that this module does not ` +
        `declare: ${unexpectedTables.join(", ")}. Schema is owned by the provider module; a ` +
        "table nobody declared is a hand edit, and a hand edit nobody can see is how a schema " +
        "stops being what its code says it is.",
    );
  }
  if (input.appliedVersion === null) {
    problems.push(
      "the database records no schema version. It cannot be placed against " +
        `BOOTSTRAP_VERSION ${BOOTSTRAP_VERSION}, and an unplaceable schema is not a current one.`,
    );
  } else if (input.appliedVersion !== BOOTSTRAP_VERSION) {
    problems.push(
      `the database is at schema version ${input.appliedVersion} and this module declares ` +
        `${BOOTSTRAP_VERSION}. Connect a provider to bring it up, or the code and the database ` +
        "are two different schemas.",
    );
  }

  return {
    configured: true,
    reachable: true,
    appliedVersion: input.appliedVersion,
    expectedVersion: BOOTSTRAP_VERSION,
    missingTables,
    unexpectedTables,
    problems,
  };
}
