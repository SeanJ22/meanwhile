/**
 * **THE READS v6 NEEDS AND DOES NOT HAVE YET.** One entry per screen section.
 *
 * Each is shown on screen as "Not connected yet" with its owner, and listed in
 * ACCEPTANCE.md with the exact missing interface. None of these is invented
 * here: they come from the Codex boundary inventory (2026-09-28) and the v6
 * INTERACTIONS-AND-DATA "Data each screen needs" table.
 */
import type { Dependency } from "./model.ts";

export const SECTION_DEP = {
  places: {
    id: "DEP-SCOPE-IDENTITIES",
    owner: "Codex (admin-view)",
    need: "County, ZIP, body and hunt identities with explicit coverage relationships. The deployed scope carries only the country, a state or one Census geography.",
  },
  national: {
    id: "DEP-NATIONAL",
    owner: "Codex (admin-view)",
    need: "Per-state rows (hunts, ZIPs worked, place score, stuck), a state's congressional districts, and a district's ZIPs, each counting shared work once.",
  },
  hunts: {
    id: "DEP-HUNTS",
    owner: "Codex (admin-view, ledger)",
    need: "Every hunt with its place, lifetime limit and where it came from, spent, set aside and unpriced entries.",
  },
  results: {
    id: "DEP-READER-PROOF",
    owner: "Codex (MW-011)",
    need: "Reader results with their six stages, saved files, publication versions, and the exact public page with the time it was seen.",
  },
  stuck: {
    id: "DEP-STUCK",
    owner: "Codex (admin-view)",
    need: "Stuck items for this scope with cause, age, what was tried, owner, next step and linked fix.",
  },
  work: {
    id: "DEP-WORK-ROWS",
    owner: "Codex (admin-view)",
    need: "Work rows by stage with server-side search, exact totals and cursor paging for this scope.",
  },
  history: {
    id: "DEP-RECEIPT-HISTORY",
    owner: "Codex (gateway)",
    need: "A read of saved action receipts for this scope, with later executor evidence. Until then only sends made on this page are listed.",
  },
  workers: {
    id: "DEP-WORKER-EVENTS",
    owner: "Codex (runner progress read)",
    need: "The detailed Workers reading (admin-v6/workers@1): waiting reasons, recent changes and last useful progress for this place. Until it arrives, the live pulse only says the workers checked in, not what they did.",
  },
  workerActive: {
    id: "DEP-WORKER-ACTIVE-INDEX",
    owner: "Codex (worker repository)",
    need: "The work claims running now could not be read.",
  },
  agents: {
    id: "DEP-AGENT-RUNS",
    owner: "S12 (admin-view)",
    need: "The recent agent runs: role, model tier, cost, what each found, and the saved source page.",
  },
  spend: {
    id: "DEP-SPEND-READ",
    owner: "S12 (admin-view)",
    need: "Anthropic spend by model tier and by day from the cost ledger, search spend, and the database's daily transfer.",
  },
  sends: {
    id: "DEP-SENT-INSTRUCTIONS",
    owner: "S12 (admin-view)",
    need: "The instructions sent to the fleet, where each stands, and whether the runner has recorded a cancel.",
  },
  reliability: {
    id: "DEP-SOURCE-RELIABILITY",
    owner: "S12 (admin-view), S8 (reducer)",
    need: "Each source's successes, failures, failures in a row and next retry, from the workers' completed reads.",
  },
  publication: {
    id: "DEP-PUBLICATION-STATUS",
    owner: "S12 (admin-view)",
    need: "Each routine contract's published version and whether the reader read back exactly that version.",
  },
  workerVersion: {
    id: "DEP-WORKER-VERSION",
    owner: "Codex (runner adoption)",
    need: "The website’s version against the workers’ version, and whether an update is waiting for a restart.",
  },
  checklistItems: {
    id: "DEP-CHECKLIST-ITEMS",
    owner: "Codex (readiness)",
    need: "Checklist items for this scope with status, proof and missing proof for each part, applicability and owner, with search and cursor paging.",
  },
  systemAudit: {
    id: "DEP-SYSTEM-AUDIT",
    owner: "Codex (readiness)",
    need: "The audit status of each whole-system definition.",
  },
  money: {
    id: "DEP-MONEY-READ",
    owner: "Codex (accounting)",
    need: "The money read: account readings by provider, limits in force and per-work AI costs for this scope. The ledger exists; its exact read shape is not confirmed.",
  },
  scoreboard: {
    id: "DEP-SCOREBOARD",
    owner: "Claude (measures)",
    need: "The Scoreboard's numbers with the counts behind each, and the weekly learning measurements.",
  },
  fixes: {
    id: "DEP-FIX-LIFECYCLE",
    owner: "Codex (fix lifecycle)",
    need: "Open fixes with owner, resources and task stages, and fixed history with recheck, results since, what was saved and who uses it.",
  },
  decided: {
    id: "DEP-DECISIONS",
    owner: "Codex (decision log)",
    need: "Decisions already made and waiting on implementation.",
  },
} as const satisfies Record<string, Dependency>;
