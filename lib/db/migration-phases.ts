export type MigrationPhase = "expand" | "contract";

export const PRODUCTION_MIGRATION_HEADLINE = "Production migrations";
export interface ProductionMigrationOutcome {
  readonly phase: string;
  readonly state: "SUCCEEDED" | "REFUSED" | "FAILED";
  readonly summary: string;
  readonly targetHost: string;
}

export function migrationOutcomeOf(value: unknown): ProductionMigrationOutcome | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<ProductionMigrationOutcome>;
  if (typeof row.phase !== "string" || row.phase.length > 24 ||
      !["SUCCEEDED", "REFUSED", "FAILED"].includes(row.state ?? "") ||
      typeof row.summary !== "string" || row.summary.length > 2000 ||
      row.targetHost !== "ep-dry-river-axwtolzc") return null;
  return { phase: row.phase, state: row.state as ProductionMigrationOutcome["state"],
    summary: row.summary, targetHost: row.targetHost };
}

/** Error output is displayed and stored only after private environment values and URLs are removed. */
export function redactMigrationOutput(output: string, env: Record<string, string | undefined>): string {
  for (const [name, value] of Object.entries(env)) {
    if (value && value.length >= 5 && /TOKEN|SECRET|PASSWORD|KEY|DATABASE_URL/.test(name)) output = output.split(value).join("[private]");
  }
  return output.replace(/(?:postgres(?:ql)?|https?):\/\/[^\s"'<>]+/gi, "[private URL]");
}

/** One narrowing statement, with the rule that recognised it. */
export interface ContractSignal {
  /** The rule id — stable, so a failure message can be grepped for. */
  readonly rule: string;
  /** Why that shape narrows what the database will accept. */
  readonly why: string;
  /** The statement itself, collapsed to one line for a log. */
  readonly statement: string;
}

export interface PhaseDeclaration {
  readonly phase: MigrationPhase;
  /** Why this migration sits on that side. Never a shrug. */
  readonly why: string;
}

/** The ordering each phase requires; `sentence` is what a failing run prints. */
export const PHASE_ORDERING: Readonly<
  Record<MigrationPhase, { readonly apply: "before-deploy" | "after-deploy"; readonly sentence: string }>
> = {
  expand: {
    apply: "before-deploy",
    sentence:
      "EXPAND — additive. Apply it to production BEFORE the deploy that carries the code naming " +
      "it. The old build is unaffected by the new table or column; the new build cannot run " +
      "without it.",
  },
  contract: {
    apply: "after-deploy",
    sentence:
      "CONTRACT — narrowing. Apply it to production only AFTER the deploy that stops writing the " +
      "old shape is serving. Applying it first breaks the build that is live right now.",
  },
};

/** Shapes that narrow what the database accepts. An unrecognised shape falls through to expand. */
const CONTRACT_RULES: readonly {
  rule: string;
  why: string;
  test: (statement: string) => boolean;
}[] = [
  {
    rule: "delete-rows",
    why: "Stored rows used by the previous code are retired after its readers are replaced.",
    test: (s) => /^DELETE\s+FROM\b/i.test(s),
  },
  {
    rule: "drop-column",
    why: "A column the live build still writes stops existing.",
    test: (s) => /\bDROP\s+COLUMN\b/i.test(s),
  },
  {
    rule: "drop-table",
    why: "A table the live build still reads or writes stops existing.",
    test: (s) => /\bDROP\s+TABLE\b/i.test(s),
  },
  {
    rule: "drop-default",
    why: "A write that omits the column stops landing and starts failing. This is the 0011/0014 shape.",
    test: (s) => /\bDROP\s+DEFAULT\b/i.test(s),
  },
  {
    rule: "set-not-null",
    why: "A write that omits the column stops being accepted.",
    test: (s) => /\bSET\s+NOT\s+NULL\b/i.test(s),
  },
  {
    rule: "add-constraint",
    why: "A row shape the live build still writes starts being rejected, and existing rows can refuse the statement itself.",
    test: (s) => /\bADD\s+CONSTRAINT\b/i.test(s),
  },
  {
    rule: "drop-constraint",
    why: "A guarantee the code relies on stops being enforced, so the code has to stop relying on it first.",
    test: (s) => /\bDROP\s+CONSTRAINT\b/i.test(s),
  },
  {
    rule: "drop-index",
    why: "A query plan the live build depends on can collapse, and a unique index is a guarantee as well as an index.",
    test: (s) => /\bDROP\s+INDEX\b/i.test(s),
  },
  {
    rule: "rename",
    why: "The old name stops resolving for the build that is still using it.",
    test: (s) => /\bRENAME\b/i.test(s),
  },
  {
    rule: "add-not-null-column-without-default",
    why:
      "Postgres refuses the statement outright on a table that already holds rows, and the live " +
      "build's insert omits the column. 0011 was hand-corrected for exactly this and 0020 is the " +
      "same shape.",
    test: (s) =>
      /\bADD\s+COLUMN\b/i.test(s) && /\bNOT\s+NULL\b/i.test(s) && !/\bDEFAULT\b/i.test(s),
  },
];

export function statementsIn(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((chunk) =>
      chunk
        .split("\n")
        .map((line) => line.replace(/--.*$/, ""))
        .join("\n")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((s) => s.length > 0);
}

/** Every narrowing statement in a migration's SQL, with the rule that saw it. */
export function contractSignalsIn(sql: string): ContractSignal[] {
  const found: ContractSignal[] = [];
  for (const statement of statementsIn(sql)) {
    for (const rule of CONTRACT_RULES) {
      if (rule.test(statement)) {
        found.push({
          rule: rule.rule,
          why: rule.why,
          statement: statement.length > 140 ? `${statement.slice(0, 137)}…` : statement,
        });
      }
    }
  }
  return found;
}

/** One narrowing statement makes the whole (atomically applied) file a contract. */
export function phaseFromSql(sql: string): { phase: MigrationPhase; signals: ContractSignal[] } {
  const signals = contractSignalsIn(sql);
  return { phase: signals.length > 0 ? "contract" : "expand", signals };
}

/** Hand-written, one entry per committed migration; the suite checks each against phaseFromSql. */
const MIGRATION_PHASES: Readonly<Record<string, PhaseDeclaration>> = {
  "RB-A3_expand": { phase: "expand", why: "Adds place rebuild requests and hourly fact counts alongside the live fact table before the shared door writes them." },
  "0051_rb_a1_shared": { phase: "contract", why: "Widens the existing entity kinds and place key, preserving old rows with unknown year zero; installs the reader id lookup and fills existing event identities after deploy." },
  "0050_pk01_saved_picks": { phase: "expand", why: "Adds private ballot storage before the new save endpoint serves readers." },
  "0045_src_mn_retire_campaign_load": { phase: "contract", why: "After the native writer is retired, deletes its state campaign load and publications while preserving captured source files." },
  "0046_ck01_audit_flags": { phase: "expand", why: "Adds nullable owner flag metadata and indexes and permits null fact_id for a named legacy reader record. Every old writer still supplies fact_id and keeps working; apply before code that uses the new columns." },
  "0047_ck01_flag_target": { phase: "contract", why: "After the flag writers serving scalar or named reader targets deploy, require every flag to name one of those targets. The ADD CONSTRAINT is narrowing, so it is separate from the columns required before deploy." },
  "0044_rs01_retire_copies": { phase: "contract", why: "After direct canonical readers deploy, removes obsolete reader copy documents, publication queues and their triggers while retaining source candidates, facts and history." },
  "0043_rs01_place_reads": { phase: "expand", why: "Indexes each canonical meeting source calendar by body, so one place query retrieves every source without an adapter list or a publication copy. Existing readers and writers keep working." },
  "0042_rm01_confirmation_times": { phase: "expand", why: "Indexes unchanged-version confirmation times so the reader edge reads only what was confirmed since it last published." },
  "0041_mt02_meeting_body_queue": { phase: "expand", why: "Adds a queue table and triggers that note which meeting partitions changed; no existing table or column is altered." },
  "0040_r1_edge_changes": { phase: "expand", why: "Indexes promotion times so the reader edge reads only what was promoted since it last published." },
  "0038_src_mn_federal_money_lookup": { phase: "expand", why: "Indexes exact federal native IDs without indexing source descriptions or loading state inventories." },
  "0000_square_stryfe": {
    phase: "expand",
    why: "Creates meetings, agenda_documents and search_log with their indexes. Nothing existed before it.",
  },
  "0001_demonic_bullseye": {
    phase: "expand",
    why: "Creates the reactions store and its indexes. Purely additive.",
  },
  "0002_daily_romulus": {
    phase: "expand",
    why: "Creates intake_limiter and adds a nullable suspect_reason to reactions.",
  },
  "0003_marvelous_warpath": {
    phase: "expand",
    why: "Adds reactions.scale_version with a default, so rows written by the older build still land.",
  },
  "0004_blushing_zarda": {
    phase: "expand",
    why: "Adds run_class (defaulted) and a nullable run_id to search_log, plus an index.",
  },
  "0005_tired_invisible_woman": {
    phase: "expand",
    why:
      "Creates the feedback table and its index. Nothing read or wrote it before this, so no " +
      "deployed build can be disturbed by its arrival.",
  },
  "0006_lonely_marvex": {
    phase: "expand",
    why:
      "Adds two nullable meeting columns and WIDENS five others from NOT NULL to nullable. " +
      "Dropping a NOT NULL accepts strictly more, so the live build is unaffected.",
  },
  "0007_first_violations": {
    phase: "contract",
    why:
      "Adds a CHECK constraint pairing ocd_id with division_vintage. A build that writes one " +
      "without the other starts being rejected, and existing rows can refuse the statement itself.",
  },
  "0008_same_fallen_one": {
    phase: "expand",
    why:
      "Adds a nullable feedback.reply_to. A build that predates the column simply omits it and " +
      "the insert still lands.",
  },
  "0009_keen_vulcan": {
    phase: "expand",
    why:
      "Adds a nullable reactions.free_text — the optional verbatim. A build that predates it " +
      "omits it and the insert still lands.",
  },
  "0010_skinny_meteorite": {
    phase: "expand",
    why: "Adds run_class (defaulted) and a nullable run_id to reactions, plus an index.",
  },
  "0011_organic_cerise": {
    phase: "contract",
    why:
      "Backfills coverage_tier with a default and then DROPS that default, so a write omitting " +
      "the tier fails instead of landing as UNKNOWN. The deployed build must already be stating " +
      "the tier before the default goes.",
  },
  "0012_spicy_changeling": {
    phase: "contract",
    why:
      "The same shape for coverage_tier_distribution — backfill, then DROP DEFAULT. Applying it " +
      "ahead of the code that fills the column is what forced 0013 to exist.",
  },
  "0013_tier_distribution_bridge": {
    phase: "expand",
    why:
      "Puts the coverage_tier_distribution default BACK so the live build's writes land again. " +
      "Restoring a default accepts strictly more, so it is safe ahead of any deploy.",
  },
  "0014_tier_distribution_no_default": {
    phase: "contract",
    why:
      "Drops the bridge default again. Its own header states the rule: applied only AFTER the " +
      "code that fills the column is serving. This is the pair that proves migrate-always-first " +
      "is wrong.",
  },
  "0015_fast_mojo": {
    phase: "expand",
    why:
      "Creates the write_alarm table and its index — the store that records a refused write to a " +
      "sold store. Additive; nothing existed before it.",
  },
  "0016_known_cerebro": {
    phase: "expand",
    why: "Creates the three questionnaire tables and their indexes.",
  },
  "0017_lively_mulholland_black": {
    phase: "expand",
    why: "Creates feedback_contact and adds a nullable feedback.contact_ref.",
  },
  "0018_plain_silver_samurai": {
    phase: "contract",
    why:
      "DROPS feedback.reply_to. A deploy still writing that column would fail, so the code that " +
      "stopped writing it has to be live first.",
  },
  "0019_next_scarlet_witch": {
    phase: "expand",
    why: "Creates speak_your_mind and its three indexes.",
  },
  "0020_dazzling_deathbird": {
    phase: "contract",
    why:
      "Adds two NOT NULL columns with no default. Postgres refuses that on a table holding rows, " +
      "and the live build's insert omits them — the 0011 shape, uncorrected.",
  },
  "0021_mixed_red_ghost": {
    phase: "expand",
    why:
      "Creates ask_interactions and its three indexes. THE INCIDENT OF 2026-08-28: the code " +
      "naming this table merged and deployed while the table did not exist on production, which " +
      "is exactly the ordering an expand-phase migration forbids.",
  },
  "0022_adorable_hemingway": {
    phase: "expand",
    why:
      "Adds five evidence columns to ask_interactions — three defaulted, two nullable — so a " +
      "build that predates them still writes successfully. The second half of the same incident.",
  },
  "0023_tricky_sister_grimm": {
    phase: "expand",
    why:
      "Creates demand_signals and its two indexes (OWN-Q6). Purely additive: it touches no " +
      "existing table and no existing column, so every build that predates it — including the " +
      "one live while this applies — keeps working untouched. Applied to production BEFORE the " +
      "code that names the table merges, which is the ordering the 2026-08-28 incident taught " +
      "and the ordering the owner authorized on 2026-08-31.",
  },
  "0024_living_invaders": {
    phase: "expand",
    why:
      "Adds one NULLABLE column, ask_interactions.answer_effort (ITEM K, 2026-09-01), so the " +
      "Ask trace records the reasoning effort an answer was produced at rather than only the " +
      "model. Nullable and undefaulted, which is what makes it expand: every build that " +
      "predates the column — including the one live while this applies — keeps inserting " +
      "successfully, because nothing it writes mentions the column and the column demands " +
      "nothing of it. A NOT NULL or a defaulted column would have been a contract in disguise, " +
      "and a default would additionally have recorded an effort for the deterministic answer " +
      "modes, which never call a model at all.",
  },
  "0025_typical_fixer": {
    phase: "expand",
    why:
      "Creates the routine civic-data candidate, transition-event and promotion tables with " +
      "their indexes. The migration is purely additive, so it is safe before the build that " +
      "first reads or writes those tables.",
  },
  "0026_lame_sunset_bain": {
    phase: "contract",
    why:
      "Adds fail-closed civic-data identity, state, pointer/LKG and append-only event constraints. " +
      "Existing rows are scanned and nonconforming writes begin failing, so the conforming PDC " +
      "store code must be serving and the read-only integrity census must pass before application.",
  },
  "0027_pdc_candidate_history_shape": {
    phase: "expand",
    why:
      "Restores the existing 0026 history trigger's intended acceptance by resolving NEW fields " +
      "in separate table-specific IF branches. No constraint, assertion, column or data changes. " +
      "The already deployed PDC store writes the same shape; apply this compatible correction " +
      "before deploying the release that records it, after isolated positive and negative proof.",
  },
  "0028_wise_ikaris": {
    phase: "expand",
    why:
      "Creates civic_data_reader_projections (the prepared reader serving copy) with its unique " +
      "index and two inline CHECK constraints on the NEW table only. Purely additive: no existing " +
      "build reads or writes it, and the inline checks constrain rows this migration's own table " +
      "will hold, never an existing one — so it is safe to apply BEFORE the deploy that first " +
      "writes the prepared snapshot.",
  },
  "0029_unchanged_confirmation_receipts": {
    phase: "expand",
    why:
      "Replaces the 0026 event-insert rule with the same rule plus one accepted shape: a repeated " +
      "PROMOTED event that is an UNCHANGED_CONFIRMATION_V1 receipt naming its exact pointed, live " +
      "version and read-model hash, or that receipt's companion sources event. Every other event " +
      "is judged exactly as before. No table, column, constraint or row changes. The deployed " +
      "build never writes the new receipt, and the build that does refuses safely without it " +
      "(STORE_REFUSED, then promotes as before). Apply BEFORE the deploy that records it.",
  },
  "0030_database_transfer_daily": {
    phase: "expand",
    why: "Creates daily database byte aggregates. Existing readers and writers are unaffected by the new table.",
  },
  "0031_civic_payload_parts": {
    phase: "expand",
    why: "Creates immutable civic payload parts. The new store requires it; the old store keeps reading inline payloads.",
  },
  "0032_feedback_site": {
    phase: "expand",
    why: "Adds feedback.site with a live default, so existing feedback inserts that omit it still work.",
  },
  "0034_reader_events": { phase: "expand", why: "New aggregate and anonymous membership tables; existing capture stores are unaffected." },
  "0035_r1_fact_store": { phase: "expand", why: "Creates the fact store tables. Nothing reads or writes them before the build that ships with it." },
  "0049_r3_legistar_members_retire_index": { phase: "contract", why: "Drops the live-only member index after the covering member lookup replaces it." },
  "0048_r3_legistar_members": { phase: "expand", why: "Adds the exact member lookup index; no reader or writer depends on it before it exists." },
  "0037_r1_fact_scale": { phase: "expand", why: "Adds the fact watermark, the pass cursors and the trigger that queues changed places; existing writers keep working." },
  "0036_ne01": { phase: "expand", why: "Adds defaulted read counters and reader selection functions; existing readers and writers keep working." },
  "0033_feedback_context": {
    phase: "expand",
    why: "Adds nullable report context columns. Older feedback writers keep working and existing reports retain unknown context.",
  },
  "0039_sb01b_state_pointer_retirement": { phase: "expand", why: "Permits retiring replaced national pointers only after every exact state replacement is GOOD; existing writers retain their mutation rules." },
};

/** The declaration for a tag, or null when there is none. Never a default. */
export function declaredPhase(tag: string): PhaseDeclaration | null {
  return Object.prototype.hasOwnProperty.call(MIGRATION_PHASES, tag)
    ? MIGRATION_PHASES[tag]
    : null;
}
