import { sql } from "drizzle-orm";
import {
  boolean,
  bigint,
  date,
  primaryKey,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";


/** One sitting of a public body, keyed by the source-namespaced id the adapters emit. */
export const meetings = pgTable(
  "meetings",
  {
    /** Source-namespaced: `<adapter>:<tenant>:<upstream id>`. */
    id: text("id").primaryKey(),
    ocdId: text("ocd_id"),
    /** Dataset vintage `ocdId` was resolved against; null with it. */
    divisionVintage: text("division_vintage"),
    bodyName: text("body_name").notNull(),
    title: text("title").notNull(),
    /** Instant of the meeting's start; wall-clock lives with timeZone. */
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "string" }).notNull(),
    timeZone: text("time_zone").notNull(),
    locationName: text("location_name"),
    locationAddress: text("location_address"),
    locationLat: doublePrecision("location_lat"),
    locationLng: doublePrecision("location_lng"),
    /** The published location string for an online meeting, verbatim. Present exactly when the location columns are null. */
    onlineLabel: text("online_label"),
    onlineJoinUrl: text("online_join_url"),
    agendaUrl: text("agenda_url"),
    /** Display only — join on ocdId, never on this. */
    jurisdiction: text("jurisdiction").notNull(),
    status: text("status", { enum: ["SCHEDULED", "CONCLUDED", "CANCELED"] }).notNull(),
    /** Provenance, flattened; never dropped in a transform. */
    sourceUrl: text("source_url"),
    sourceOrg: text("source_org").notNull(),
    collectedAt: timestamp("collected_at", { withTimezone: true, mode: "string" }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("meetings_ocd_id_idx").on(table.ocdId),
    index("meetings_starts_at_idx").on(table.startsAt),
    // The division and its vintage are both present or both absent.
    check(
      "meetings_division_vintage_pairing",
      sql`(${table.ocdId} is null) = (${table.divisionVintage} is null)`,
    ),
  ],
);

export const agendaDocuments = pgTable(
  "agenda_documents",
  {
    id: text("id").primaryKey(),
    meetingId: text("meeting_id").notNull(),
    ocdId: text("ocd_id").notNull(),
    divisionVintage: text("division_vintage").notNull(),
    /** Where the document was fetched from. Observed, never constructed. */
    documentUrl: text("document_url").notNull(),
    /** SHA-256 of the raw bytes — the revision detector. */
    contentHash: text("content_hash").notNull(),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true, mode: "string" }).notNull(),
    contentType: text("content_type").notNull(),
    /** Extracted text; null means extraction failed and the note says why. */
    text: text("text"),
    extraction: text("extraction", { enum: ["html", "pdf", "failed"] }).notNull(),
    extractionNote: text("extraction_note"),
    sourceUrl: text("source_url").notNull(),
    sourceOrg: text("source_org").notNull(),
    collectedAt: timestamp("collected_at", { withTimezone: true, mode: "string" }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [index("agenda_documents_meeting_id_idx").on(table.meetingId)],
);

export const searchLog = pgTable(
  "search_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    /** What happened: a search, an open, a filter. */
    eventType: text("event_type", {
      enum: [
        "SEARCH",
        "BODY_OPENED",
        "MEETING_OPENED",
        "DISTRICT_SELECTED",
        "FILTER_APPLIED",
        "OFFICIAL_OPENED",
        // Routed asks carry the topic id; refusals carry the capped question text.
        "QUESTION_ASKED",
      ],
    }).notNull(),
    /** Zip as entered. Orientation only — never resolved to a person. */
    approximateLocation: text("approximate_location"),
    ocdIds: jsonb("ocd_ids").$type<string[]>().notNull(),
    divisionVintage: text("division_vintage").notNull(),
    detail: jsonb("detail").$type<Record<string, string | number | boolean>>(),
    runClass: text("run_class", { enum: ["ORGANIC", "SYNTHETIC", "UNKNOWN", "AUTHOR"] })
      .notNull()
      .default("ORGANIC"),
    /** Which automated run wrote this row. Null on every `ORGANIC` row by construction. */
    runId: text("run_id"),
    coverageTier: text("coverage_tier", {
      enum: ["TIER_0", "TIER_1", "TIER_2", "TIER_3", "UNKNOWN"],
    }).notNull(),
    coverageTierDistribution: text("coverage_tier_distribution").notNull(),
  },
  (table) => [
    index("search_log_occurred_at_idx").on(table.occurredAt),
    // Every sold aggregate filters on the class.
    index("search_log_run_class_idx").on(table.runClass),
  ],
);

export const reactions = pgTable(
  "reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    /** The kind of record the reaction attaches to. Type-level enum on a text column. */
    targetType: text("target_type", {
      // MEASURE_PROVISION attaches to a contested provision, keyed `<contestId>#<slug>`.
      enum: [
        "FEDERAL_VOTE",
        "CANDIDATE",
        "FUNDING_TOTAL_REACTION",
        "CONTRIBUTOR_REACTION",
        "MEASURE_PROVISION",
      ],
    }).notNull(),
    /** The roll-call key (`house:119-2:283`) — validated against the votes snapshot. */
    targetId: text("target_id").notNull(),
    reaction: text("reaction", {
      enum: [
        "YES",
        "NO",
        "UNSURE",
        "SOMEONE_ELSE",
        // The five-point funding scale, accepted only on the two funding target types.
        "LOVE",
        "LIKE",
        "DISLIKE",
        "HATE",
        "DONT_CARE",
      ],
    }).notNull(),
    scaleVersion: integer("scale_version").notNull().default(1),
    ocdIds: jsonb("ocd_ids").$type<string[]>().notNull(),
    divisionVintage: text("division_vintage").notNull(),
    /** ANONYMOUS today; future tiers exist in the enum so no migration reshapes aggregates. */
    verificationTier: text("verification_tier", {
      enum: ["ANONYMOUS", "LOCALITY_VERIFIED", "VOTER_MATCHED"],
    }).notNull(),
    /** Browser continuity, not identity. Stored only hashed. */
    reactionKeyHash: text("reaction_key_hash").notNull(),
    suspectReason: text("suspect_reason", {
      enum: ["VELOCITY", "LIMITER_UNAVAILABLE"],
    }),
    freeText: text("free_text"),
    runClass: text("run_class", { enum: ["ORGANIC", "SYNTHETIC", "UNKNOWN", "AUTHOR"] })
      .notNull()
      .default("UNKNOWN"),
    runId: text("run_id"),
    /** The coverage tier when written; see `search_log.coverage_tier`. */
    coverageTier: text("coverage_tier", {
      enum: ["TIER_0", "TIER_1", "TIER_2", "TIER_3", "UNKNOWN"],
    }).notNull(),
    /** The counted tier distribution; see `search_log.coverage_tier_distribution`. */
    coverageTierDistribution: text("coverage_tier_distribution").notNull(),
  },
  (table) => [
    // One reaction per browser key per target; a changed answer overwrites.
    uniqueIndex("reactions_key_target_unq").on(
      table.reactionKeyHash,
      table.targetType,
      table.targetId,
    ),
    index("reactions_target_idx").on(table.targetType, table.targetId),
    // Every sold aggregate filters on the class.
    index("reactions_run_class_idx").on(table.runClass),
  ],
);

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    site: text("site", { enum: ["live", "tester"] }).notNull().default("live"),
    /** Context deliberately sent with a report; absent on older/general feedback. */
    about: text("about"),
    zip: text("zip"),
    recordId: text("record_id"),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "string" }).notNull(),
    /** What the reader wrote, scrubbed. Capped at the route. */
    message: text("message").notNull(),
    /** Which entry point this came through: a closed enum, never a URL. */
    surface: text("surface", { enum: ["SIDEBAR", "TRANSPARENCY", "COVERAGE"] }).notNull(),
    contactRef: text("contact_ref"),
    /** Same declaration and meanings as the search log's. */
    runClass: text("run_class", { enum: ["ORGANIC", "SYNTHETIC", "UNKNOWN", "AUTHOR"] })
      .notNull()
      .default("ORGANIC"),
    /** Null on every ORGANIC row by construction — a run identity, never a person's. */
    runId: text("run_id"),
    /** Quarantine, not deletion, as on reactions. */
    suspectReason: text("suspect_reason", {
      enum: ["VELOCITY", "LIMITER_UNAVAILABLE"],
    }),
  },
  (table) => [index("feedback_received_at_idx").on(table.receivedAt)],
);

export const feedbackContact = pgTable(
  "feedback_contact",
  {
    /** The random handle the feedback row carries. Not a foreign key. */
    contactRef: text("contact_ref").primaryKey(),
    /** As the reader typed it. Unscrubbed: it was handed over deliberately. */
    address: text("address").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [index("feedback_contact_received_at_idx").on(table.receivedAt)],
);

export const intakeLimiter = pgTable("intake_limiter", {
  /** sha256("intake-limiter:" + raw key); joins nothing. */
  digest: text("digest").primaryKey(),
  /** UTC day (YYYY-MM-DD) the day counter belongs to. */
  dayBucket: text("day_bucket").notNull(),
  dayCount: integer("day_count").notNull(),
  /** UTC minute (YYYY-MM-DDTHH:MM) the minute counter belongs to. */
  minuteBucket: text("minute_bucket").notNull(),
  minuteCount: integer("minute_count").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const writeAlarm = pgTable("write_alarm", {
  id: uuid("id").primaryKey().defaultRandom(),
  raisedAt: timestamp("raised_at", { withTimezone: true, mode: "string" }).notNull(),
  /** Which sold store refused the write. Closed enum, checked below. */
  store: text("store").notNull(),
  /** The Postgres SQLSTATE, where the driver gave one. */
  errorCode: text("error_code"),
  /** The database's own words, truncated at the call site. Never a value. */
  errorMessage: text("error_message"),
}, (t) => [
  check("write_alarm_store_known", sql`${t.store} IN ('search_log', 'reactions')`),
  index("write_alarm_raised_at_idx").on(t.raisedAt),
]);


export const questionnaireInvitations = pgTable(
  "questionnaire_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The public ballot candidacy. Content key, never a reader key. */
    candidacyId: text("candidacy_id").notNull(),
    contestId: text("contest_id").notNull(),
    /** The filed email from the certified record. Held to send; never rendered. */
    email: text("email").notNull(),
    instrumentVersion: text("instrument_version").notNull(),
    officeClass: text("office_class").notNull(),
    /** The schedule. Identical for every candidate in the contest. */
    plannedInvitedOn: text("planned_invited_on").notNull(),
    plannedRemindersOn: jsonb("planned_reminders_on").$type<string[]>().notNull(),
    deadline: text("deadline").notNull(),
    /** Stamped by the send path only. */
    invitedOn: text("invited_on"),
    remindedOn: jsonb("reminded_on").$type<string[]>().notNull(),
    /** Provenance of the email, so the record can be checked. */
    contactSourceUrl: text("contact_source_url").notNull(),
    contactSourceOrg: text("contact_source_org").notNull(),
    contactCollectedAt: text("contact_collected_at").notNull(),
  },
  (t) => [
    uniqueIndex("questionnaire_invitations_candidacy_idx").on(t.candidacyId),
    index("questionnaire_invitations_contest_idx").on(t.contestId),
  ],
);

export const questionnaireResponses = pgTable(
  "questionnaire_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidacyId: text("candidacy_id").notNull(),
    version: integer("version").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }).notNull(),
    instrumentVersion: text("instrument_version").notNull(),
    officeClass: text("office_class").notNull(),
    /** `[{ questionId, text }]`. **Verbatim. Never truncated, never summarised.** */
    answers: jsonb("answers").$type<Array<{ questionId: string; text: string }>>().notNull(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    uniqueIndex("questionnaire_responses_candidacy_version_idx").on(t.candidacyId, t.version),
  ],
);

export const questionnaireTokens = pgTable(
  "questionnaire_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenDigest: text("token_digest").notNull(),
    candidacyId: text("candidacy_id").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "string" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [uniqueIndex("questionnaire_tokens_digest_idx").on(t.tokenDigest)],
);

export const speakYourMind = pgTable(
  "speak_your_mind",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    /** What kind of public thing this was said to. */
    subjectType: text("subject_type", {
      // Type-level enum on a plain text column; widening needs no migration.
      enum: ["OFFICIAL", "BODY", "MEETING", "CANDIDATE"],
    }).notNull(),
    /** The subject's own public identifier — an ocd-id, a body id, a meeting id. */
    subjectId: text("subject_id").notNull(),
    /** The reader's zip-resolved divisions. */
    ocdIds: jsonb("ocd_ids").$type<string[]>().notNull(),
    divisionVintage: text("division_vintage").notNull(),
    /** What the reader wrote, after the scrub and the self-disclosure pass. Capped at the write path. */
    text: text("text").notNull(),
    selfDisclosure: jsonb("self_disclosure").$type<string[]>().notNull(),
    reviewState: text("review_state", { enum: ["NONE", "HELD"] })
      .notNull()
      .default("NONE"),
    /** WHY it is held, in the abuse policy's own tiers. Never who. */
    reviewReason: text("review_reason", {
      enum: ["T1_ABUSIVE", "T2_CONCERNING", "T3_THREAT"],
    }),
    /** The coverage tier, derived server-side from the row's own divisions. */
    coverageTier: text("coverage_tier", {
      enum: ["TIER_0", "TIER_1", "TIER_2", "TIER_3", "UNKNOWN"],
    }).notNull(),
    /** The counted tier distribution; see `search_log.coverage_tier_distribution`. */
    coverageTierDistribution: text("coverage_tier_distribution").notNull(),
    /** Browser continuity, for dedup and abuse defence. */
    speakKeyHash: text("speak_key_hash").notNull(),
    /** Quarantine, not deletion, as on reactions. */
    suspectReason: text("suspect_reason", {
      enum: ["VELOCITY", "LIMITER_UNAVAILABLE"],
    }),
    runClass: text("run_class", { enum: ["ORGANIC", "SYNTHETIC", "UNKNOWN", "AUTHOR"] })
      .notNull()
      .default("UNKNOWN"),
    /** `sha256("speak-run:" + runId)` — its own digest space, like every other. */
    runId: text("run_id"),
  },
  (table) => [
    index("speak_your_mind_subject_idx").on(table.subjectType, table.subjectId),
    index("speak_your_mind_review_idx").on(table.reviewState),
    index("speak_your_mind_occurred_idx").on(table.occurredAt),
  ],
);

export const askInteractions = pgTable(
  "ask_interactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    /** The reader's words AFTER the scrub. Never the raw text. */
    questionScrubbed: text("question_scrubbed").notNull(),
    /** Anything the scrub blanked, as KINDS — never the values themselves. */
    selfDisclosure: jsonb("self_disclosure").$type<string[]>().notNull(),
    /** What the pipeline understood the reader to be asking for. */
    intent: text("intent").notNull(),
    temporalKind: text("temporal_kind").notNull(),
    /** The PUBLIC civic subjects it resolved to. Facts about governments. */
    subjectIds: jsonb("subject_ids").$type<string[]>().notNull(),
    resolutionState: text("resolution_state", {
      enum: ["BOUND", "AMBIGUOUS", "UNRESOLVED", "NONE"],
    }).notNull(),
    /** How the answer was produced; never inferred. */
    answerMode: text("answer_mode", {
      enum: [
        "GROUNDED_CLAUDE",
        "GROUNDED_COMPOSED",
        "STRUCTURED_GROUNDED",
        "CLARIFY",
        "UNRESOLVED",
        "NO_EVIDENCE",
        "REJECTED_FELL_BACK",
      ],
    }).notNull(),
    /** What the reader actually read. Null where no prose was produced. */
    answerText: text("answer_text"),
    /** Which model wrote it, for audit. Null where none did. */
    answerModel: text("answer_model"),
    answerEffort: text("answer_effort"),
    /** Did structural validation pass? Null where it did not run. */
    validationPassed: boolean("validation_passed"),
    /** How much evidence stood behind it — a denominator, not a score. */
    evidenceRecordCount: integer("evidence_record_count").notNull().default(0),
    evidenceSourceCount: integer("evidence_source_count").notNull().default(0),
    namedGapCount: integer("named_gap_count").notNull().default(0),
    evidenceRecordRefs: jsonb("evidence_record_refs").$type<string[]>().notNull().default([]),
    evidenceSourceUrls: jsonb("evidence_source_urls").$type<string[]>().notNull().default([]),
    evidenceSourceOrgs: jsonb("evidence_source_orgs").$type<string[]>().notNull().default([]),
    /** The oldest and newest retrieval stamps behind the answer, for staleness. */
    evidenceRetrievedFrom: text("evidence_retrieved_from"),
    evidenceRetrievedTo: text("evidence_retrieved_to"),
    /** Which surface asked. Ballot and map questions differ in kind. */
    surface: text("surface", { enum: ["MAP", "BALLOT", "UNKNOWN"] }).notNull(),
    /** Orientation only, exactly as the search log's is. Never a person. */
    approximateLocation: text("approximate_location"),
    ocdIds: jsonb("ocd_ids").$type<string[]>().notNull(),
    divisionVintage: text("division_vintage").notNull(),
    residencyRelation: text("residency_relation", {
      enum: ["CURRENT_HOME", "PROSPECTIVE_HOME", "BROWSING", "UNKNOWN"],
    }).notNull(),
    locationConfidence: text("location_confidence", {
      enum: [
        "UNVERIFIED",
        "SELF_DECLARED_ZIP",
        "ADDRESS_RESOLVED",
        "ADDRESS_VALIDATED",
        "UNKNOWN",
      ],
    }).notNull(),
    coverageTier: text("coverage_tier", {
      enum: ["TIER_0", "TIER_1", "TIER_2", "TIER_3", "UNKNOWN"],
    }).notNull(),
    coverageTierDistribution: text("coverage_tier_distribution").notNull(),
    /** `sha256("ask-interaction:" + key)`, its own digest space. Never exported. */
    askKeyHash: text("ask_key_hash").notNull(),
    runClass: text("run_class", { enum: ["ORGANIC", "SYNTHETIC", "UNKNOWN", "AUTHOR"] })
      .notNull()
      .default("UNKNOWN"),
    /** `sha256("ask-run:" + runId)` — namespaced, like every other run id. */
    runId: text("run_id"),
  },
  (table) => [
    index("ask_interactions_occurred_idx").on(table.occurredAt),
    index("ask_interactions_mode_idx").on(table.answerMode),
    index("ask_interactions_surface_idx").on(table.surface),
  ],
);

export const demandSignals = pgTable(
  "demand_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    /** What the reader was looking at. Two kinds, and the surface is symmetric on both. */
    subjectType: text("subject_type", { enum: ["BODY", "CANDIDATE"] }).notNull(),
    /** The body's or candidate's own key. Never a reader's anything. */
    subjectId: text("subject_id").notNull(),
    /** One value: the pill asks one question. Text column with no CHECK. */
    signal: text("signal", { enum: ["WANT_THIS_SOONER"] }).notNull(),
    ocdIds: jsonb("ocd_ids").$type<string[]>().notNull(),
    divisionVintage: text("division_vintage").notNull(),
    runClass: text("run_class", { enum: ["ORGANIC", "SYNTHETIC", "UNKNOWN", "AUTHOR"] })
      .notNull()
      .default("UNKNOWN"),
    /** `sha256("demand-run:" + runId)` — its own digest space, joining nothing. */
    runId: text("run_id"),
  },
  (table) => [
    index("demand_signals_occurred_idx").on(table.occurredAt),
    index("demand_signals_subject_idx").on(table.subjectType, table.subjectId),
  ],
);

/** Immutable payload storage. A candidate names reused parts instead of
 * rewriting the national registry and its duplicate evidence copies. */
export const civicDataPayloadParts = pgTable("civic_data_payload_parts", {
  hash: text("hash").primaryKey(),
  payload: jsonb("payload").notNull(),
});

export const civicDataCandidates = pgTable(
  "civic_data_candidates",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull(),
    recordClass: text("record_class").notNull(),
    scope: text("scope").notNull(),
    state: text("state").notNull(),
    acquisitionSucceeded: boolean("acquisition_succeeded").notNull(),
    rawHash: text("raw_hash"),
    normalizedHash: text("normalized_hash"),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true, mode: "string" }).notNull(),
    sourceThrough: text("source_through").notNull(),
    parserVersion: text("parser_version").notNull(),
    identity: jsonb("identity").notNull(),
    /** Complete candidate envelope, including normalized evidence and read model. */
    candidate: jsonb("candidate").notNull(),
    validationReceipt: jsonb("validation_receipt"),
    promotedVersionId: text("promoted_version_id"),
    lastKnownGoodVersionId: text("last_known_good_version_id"),
    failureCode: text("failure_code"),
    failureDetail: text("failure_detail"),
  },
  (table) => [
    uniqueIndex("civic_data_candidates_identity_idx").on(
      table.id,
      table.sourceId,
      table.recordClass,
      table.scope,
    ),
    index("civic_data_candidates_projection_idx").on(table.recordClass, table.scope, table.retrievedAt),
    index("civic_data_candidates_source_idx").on(table.sourceId, table.retrievedAt),
    check(
      "civic_data_candidates_state_known",
      sql`${table.state} IN ('FETCHED', 'SOURCE_BLOCKED', 'NORMALIZED', 'PARSE_INVALID', 'IDENTITY_UNRESOLVED', 'TEMPORAL_INVALID', 'SEMANTIC_INVALID', 'HORIZON_UNRESOLVED', 'DEPENDENT_CONSUMER_INVALID', 'CANNOT_TELL', 'VALIDATED', 'PROMOTED')`,
    ),
    check(
      "civic_data_candidates_promotion_fields_coherent",
      sql`(
        ${table.state} = 'PROMOTED'
        AND ${table.promotedVersionId} IS NOT DISTINCT FROM ${table.id}
        AND ${table.lastKnownGoodVersionId} IS NOT DISTINCT FROM ${table.id}
      ) OR (
        ${table.state} <> 'PROMOTED'
        AND ${table.promotedVersionId} IS NULL
      )`,
    ),
    check(
      "civic_data_candidates_envelope_identity_coherent",
      sql`
        jsonb_typeof(${table.candidate}) IS NOT DISTINCT FROM 'object'
        AND (${table.candidate}->>'id') IS NOT DISTINCT FROM ${table.id}
        AND (${table.candidate}->>'sourceId') IS NOT DISTINCT FROM ${table.sourceId}
        AND (${table.candidate}->>'recordClass') IS NOT DISTINCT FROM ${table.recordClass}
        AND (${table.candidate}->>'scope') IS NOT DISTINCT FROM ${table.scope}
        AND ((${table.candidate}#>>'{retrieval,retrievedAt}')::timestamptz) IS NOT DISTINCT FROM ${table.retrievedAt}
        AND (${table.candidate}#>>'{temporal,sourceThrough}') IS NOT DISTINCT FROM ${table.sourceThrough}
        AND (${table.candidate}#>>'{normalization,parserVersion}') IS NOT DISTINCT FROM ${table.parserVersion}
        AND (${table.candidate}#>'{retrieval,succeeded}') IS NOT DISTINCT FROM to_jsonb(${table.acquisitionSucceeded})
        AND (${table.candidate}#>>'{retrieval,rawHash}') IS NOT DISTINCT FROM ${table.rawHash}
        AND (${table.candidate}#>>'{normalization,normalizedHash}') IS NOT DISTINCT FROM ${table.normalizedHash}
        AND (${table.candidate}->'identities') IS NOT DISTINCT FROM ${table.identity}
      `,
    ),
    check(
      "civic_data_candidates_disposition_receipt_coherent",
      sql`(
        ${table.state} IN ('FETCHED', 'NORMALIZED')
        AND ${table.validationReceipt} IS NULL
        AND ${table.failureCode} IS NULL
        AND ${table.failureDetail} IS NULL
      ) OR (
        ${table.state} IN ('VALIDATED', 'PROMOTED')
        AND jsonb_typeof(${table.validationReceipt}) IS NOT DISTINCT FROM 'object'
        AND (${table.validationReceipt}->'contractVersion') IS NOT DISTINCT FROM '2'::jsonb
        AND (${table.validationReceipt}->>'decision') IS NOT DISTINCT FROM 'GOOD'
        AND (${table.validationReceipt}->>'candidateId') IS NOT DISTINCT FROM ${table.id}
        AND (${table.validationReceipt}->>'sourceId') IS NOT DISTINCT FROM ${table.sourceId}
        AND (${table.validationReceipt}->>'recordClass') IS NOT DISTINCT FROM ${table.recordClass}
        AND (${table.validationReceipt}->>'scope') IS NOT DISTINCT FROM ${table.scope}
        AND (((${table.validationReceipt}->>'validatedAt')::timestamptz >= ${table.retrievedAt}) IS TRUE)
        AND ${table.failureCode} IS NULL
        AND ${table.failureDetail} IS NULL
      ) OR (
        ${table.state} IN ('SOURCE_BLOCKED', 'PARSE_INVALID', 'IDENTITY_UNRESOLVED', 'TEMPORAL_INVALID', 'SEMANTIC_INVALID', 'HORIZON_UNRESOLVED', 'DEPENDENT_CONSUMER_INVALID', 'CANNOT_TELL')
        AND jsonb_typeof(${table.validationReceipt}) IS NOT DISTINCT FROM 'object'
        AND (${table.validationReceipt}->'contractVersion') IS NOT DISTINCT FROM '2'::jsonb
        AND ((${table.validationReceipt}->>'decision') IN ('FAIL', 'CANNOT_TELL')) IS TRUE
        AND (${table.validationReceipt}->>'candidateId') IS NOT DISTINCT FROM ${table.id}
        AND (${table.validationReceipt}->>'sourceId') IS NOT DISTINCT FROM ${table.sourceId}
        AND (${table.validationReceipt}->>'recordClass') IS NOT DISTINCT FROM ${table.recordClass}
        AND (${table.validationReceipt}->>'scope') IS NOT DISTINCT FROM ${table.scope}
        AND ((length(btrim(${table.failureCode})) > 0) IS TRUE)
        AND ((length(btrim(${table.failureDetail})) > 0) IS TRUE)
        AND jsonb_typeof(jsonb_path_query_first(${table.validationReceipt}, '$.checks[*] ? (@.verdict != "PASS")')) IS NOT DISTINCT FROM 'object'
        AND (jsonb_path_query_first(${table.validationReceipt}, '$.checks[*] ? (@.verdict != "PASS")')->>'code') IS NOT DISTINCT FROM ${table.failureCode}
        AND (jsonb_path_query_first(${table.validationReceipt}, '$.checks[*] ? (@.verdict != "PASS")')->>'detail') IS NOT DISTINCT FROM ${table.failureDetail}
      )`,
    ),
    foreignKey({
      name: "civic_data_candidates_lkg_candidate_fk",
      columns: [table.lastKnownGoodVersionId, table.sourceId, table.recordClass, table.scope],
      foreignColumns: [table.id, table.sourceId, table.recordClass, table.scope],
    }).onDelete("restrict").onUpdate("restrict"),
  ],
);

/** Append-only proof of every candidate state transition. */
export const civicDataCandidateEvents = pgTable(
  "civic_data_candidate_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => civicDataCandidates.id, { onDelete: "restrict", onUpdate: "restrict" }),
    sequence: integer("sequence").notNull(),
    state: text("state").notNull(),
    at: timestamp("at", { withTimezone: true, mode: "string" }).notNull(),
    detail: text("detail").notNull(),
  },
  (table) => [
    uniqueIndex("civic_data_candidate_events_sequence_idx").on(table.candidateId, table.sequence),
    check("civic_data_candidate_events_positive_sequence", sql`${table.sequence} > 0`),
    check(
      "civic_data_candidate_events_state_known",
      sql`${table.state} IN ('FETCHED', 'SOURCE_BLOCKED', 'NORMALIZED', 'PARSE_INVALID', 'IDENTITY_UNRESOLVED', 'TEMPORAL_INVALID', 'SEMANTIC_INVALID', 'HORIZON_UNRESOLVED', 'DEPENDENT_CONSUMER_INVALID', 'CANNOT_TELL', 'VALIDATED', 'PROMOTED')`,
    ),
    check("civic_data_candidate_events_detail_nonempty", sql`length(btrim(${table.detail})) > 0`),
  ],
);

export const civicDataPromotions = pgTable(
  "civic_data_promotions",
  {
    key: text("key").primaryKey(),
    sourceId: text("source_id").notNull(),
    recordClass: text("record_class").notNull(),
    scope: text("scope").notNull(),
    currentVersionId: text("current_version_id").notNull(),
    lastKnownGoodVersionId: text("last_known_good_version_id").notNull(),
    promotedAt: timestamp("promoted_at", { withTimezone: true, mode: "string" }).notNull(),
    payload: jsonb("payload").notNull(),
    validationReceipt: jsonb("validation_receipt").notNull(),
  },
  (table) => [
    uniqueIndex("civic_data_promotions_record_scope_idx").on(table.recordClass, table.scope),
    index("civic_data_promotions_state_idx").on(sql`civic_scope_state(${table.scope})`, table.key),
    check(
      "civic_data_promotions_key_coherent",
      sql`${table.key} = ${table.recordClass} || ':' || ${table.scope}`,
    ),
    check(
      "civic_data_promotions_lkg_is_current",
      sql`${table.currentVersionId} = ${table.lastKnownGoodVersionId}`,
    ),
    check(
      "civic_data_promotions_receipt_identity_coherent",
      sql`
        jsonb_typeof(${table.validationReceipt}) IS NOT DISTINCT FROM 'object'
        AND (${table.validationReceipt}->>'decision') IS NOT DISTINCT FROM 'GOOD'
        AND (${table.validationReceipt}->>'candidateId') IS NOT DISTINCT FROM ${table.currentVersionId}
        AND (${table.validationReceipt}->>'sourceId') IS NOT DISTINCT FROM ${table.sourceId}
        AND (${table.validationReceipt}->>'recordClass') IS NOT DISTINCT FROM ${table.recordClass}
        AND (${table.validationReceipt}->>'scope') IS NOT DISTINCT FROM ${table.scope}
        AND (${table.validationReceipt}->'contractVersion') IS NOT DISTINCT FROM '2'::jsonb
        AND ((((${table.validationReceipt}->>'validatedAt')::timestamptz <= ${table.promotedAt})) IS TRUE)
      `,
    ),
    foreignKey({
      name: "civic_data_promotions_current_candidate_fk",
      columns: [table.currentVersionId, table.sourceId, table.recordClass, table.scope],
      foreignColumns: [
        civicDataCandidates.id,
        civicDataCandidates.sourceId,
        civicDataCandidates.recordClass,
        civicDataCandidates.scope,
      ],
    }).onDelete("restrict").onUpdate("restrict"),
    foreignKey({
      name: "civic_data_promotions_lkg_candidate_fk",
      columns: [table.lastKnownGoodVersionId, table.sourceId, table.recordClass, table.scope],
      foreignColumns: [
        civicDataCandidates.id,
        civicDataCandidates.sourceId,
        civicDataCandidates.recordClass,
        civicDataCandidates.scope,
      ],
    }).onDelete("restrict").onUpdate("restrict"),
  ],
);

export const civicDataReaderProjections = pgTable(
  "civic_data_reader_projections",
  {
    key: text("key").primaryKey(),
    recordClass: text("record_class").notNull(),
    scope: text("scope").notNull(),
    sequence: integer("sequence").notNull(),
    payload: jsonb("payload").notNull(),
    composedFrom: jsonb("composed_from").notNull(),
    factSha256: text("fact_sha256").notNull(),
    generatedAt: text("generated_at").notNull(),
    composedAt: timestamp("composed_at", { withTimezone: true, mode: "string" }).notNull(),
    sourceThrough: text("source_through"),
    retrievedAt: text("retrieved_at"),
    promotedThrough: text("promoted_through"),
  },
  (table) => [
    uniqueIndex("civic_data_reader_projections_record_scope_idx").on(table.recordClass, table.scope),
    check(
      "civic_data_reader_projections_key_coherent",
      sql`${table.key} = ${table.recordClass} || ':' || ${table.scope}`,
    ),
    check("civic_data_reader_projections_sequence_positive", sql`${table.sequence} > 0`),
  ],
);


/** Raw click history lives in Blobs; these are retry keys and coarse aggregates. */
export const readerEventBatches = pgTable("reader_event_batches", {
  batchId: text("batch_id").primaryKey(),
  archiveKey: text("archive_key").notNull(),
  payloadSha256: text("payload_sha256").notNull(),
  eventCount: integer("event_count").notNull(),
});
const readerEventDimensions = () => ({
  period: text("period").notNull(), periodStart: date("period_start").notNull(),
  zip: text("zip").notNull(), district: text("district").notNull(),
  topic: text("topic").notNull(), eventType: text("event_type").notNull(),
});
export const readerEventMembers = pgTable("reader_event_members", {
  ...readerEventDimensions(), readerHash: text("reader_hash").notNull(),
}, t => [primaryKey({ columns: [t.period, t.periodStart, t.zip, t.district, t.topic, t.eventType, t.readerHash] })]);
export const readerEventTotals = pgTable("reader_event_totals", {
  ...readerEventDimensions(), events: bigint("events", { mode: "number" }).notNull(), users: bigint("users", { mode: "number" }).notNull(),
}, t => [primaryKey({ columns: [t.period, t.periodStart, t.zip, t.district, t.topic, t.eventType] }),
  index("reader_event_totals_period_idx").on(t.period, t.periodStart)]);
