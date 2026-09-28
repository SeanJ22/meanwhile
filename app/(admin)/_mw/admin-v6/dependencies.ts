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
    need: "Per-state totals (hunts, stuck, checklist items by status, checked on the public page) with cursor paging, counting shared work once.",
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
    need: "Per-worker jobs, waiting reasons and a plain event feed. The live pulse only says the workers checked in, not what they did. The local runner-progress read (81c2c791) is not deployed yet.",
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
  learning: {
    id: "DEP-LEARNING",
    owner: "Codex (MW-027)",
    need: "Weekly learning measurements with their counted-out-of numbers.",
  },
  fixes: {
    id: "DEP-FIX-LIFECYCLE",
    owner: "Codex (fix lifecycle)",
    need: "Open fixes with owner, resources and task stages, and fixed history with recheck, results since, what was saved, who uses it and learning status from evidence.",
  },
  decided: {
    id: "DEP-DECISIONS",
    owner: "Codex (decision log)",
    need: "Decisions already made and waiting on implementation.",
  },
} as const satisfies Record<string, Dependency>;
