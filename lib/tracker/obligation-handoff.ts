/**
 * **THE PRODUCER SIDE OF THE TRACKER HANDOFF.** (RULING 228, 2026-08-31.)
 *
 * ## Why this file exists at all
 *
 * It did not, and that is why the seam broke. The converting lane hand-authored
 * `docs/tracker-obligation-handoff.json`; the consuming lane wrote a reader for
 * `data/tracker/obligation-handoff.json`; and because there was no producer
 * FUNCTION, there was nothing a test could run into the consumer. The two
 * halves could only be compared by a human reading both, and a human read both
 * and did not notice.
 *
 * RULING 228 requires the compatibility test to construct output through the
 * REAL PRODUCER. So there has to be one. This is it.
 *
 * ## What it does NOT do
 *
 * It does not decide which tracker rows convert — that is the triage's
 * judgement, recorded by the converting lane, and inventing it here would be a
 * session taking the author's decision. It does not manufacture routes: a row
 * with no executable representation emits `routes: []`, which the contract
 * defines as *converted, not yet executable*, and the consumer defers it.
 *
 * **Every row below is the converting lane's, carried across unchanged**, and
 * `needsBeforeItCanCarryANextDue` is quoted verbatim because the consumer
 * prints it as the deferral reason. If the triage converts more rows, they are
 * added here; the shape is the contract's and cannot drift from it, because
 * this module imports the type rather than resembling it.
 */

import type { HandoffRow, TrackerHandoffArtifact } from "../contracts/tracker-handoff.ts";

/**
 * The rows LANE TRACKER's triage converted under its state (b), as it recorded
 * them on 2026-08-31.
 *
 * Seven rows, none schedulable. That is the true state of the conversion and
 * not a placeholder: each names, in the triage's own words, what it lacks
 * before it could carry a next-due. RULING 208 — naming an obligation does not
 * discharge the record obligation behind it, and none of these is closed by
 * appearing here.
 */
export const CONVERTED_ROWS: readonly HandoffRow[] = [
  {
    trackerId: "NH27",
    recordClass: "meetings",
    subjectId: "nh-springfield-governing-bodies",
    subjectLabel:
      "Springfield, New Hampshire — eight enumerated bodies, recorded KNOWN_UNCOVERED",
    readerImpactAt: null,
    routes: [],
    needsBeforeItCanCarryANextDue: [
      "an adapter for the live HTML route (the iCal route must not be the cadence source — it cannot go fresh)",
      "an observedChangeRateHours reading, which needs at least two observations of the HTML route",
      "a declaredCycleHours if the town publishes a meeting schedule",
    ],
  },
  {
    trackerId: "NH197",
    recordClass: "meetings",
    subjectId: "nh197-meeting-window-headroom",
    subjectLabel: "the meeting fetch window's headroom",
    readerImpactAt: null,
    routes: [],
    needsBeforeItCanCarryANextDue: [
      "a decision on whether headroom is a property of the source or of the fetch window",
      "an observedChangeRateHours reading once that is settled",
    ],
  },
  {
    trackerId: "NH206",
    recordClass: "meetings-snapshot",
    subjectId: "nh206-snapshot-staleness",
    subjectLabel: "the meetings snapshot's own staleness bound",
    readerImpactAt: null,
    routes: [],
    needsBeforeItCanCarryANextDue: [
      "a route that can observe the snapshot's inputs rather than the snapshot",
      "a declaredCycleHours or an observed rate",
    ],
  },
  {
    trackerId: "NH115",
    recordClass: "roster",
    subjectId: "nh115-roster-recheck",
    subjectLabel: "the roster recheck cadence",
    readerImpactAt: null,
    routes: [],
    needsBeforeItCanCarryANextDue: [
      "an adapter for the roster page class",
      "at least two observations before a rate can be derived",
    ],
  },
  {
    trackerId: "NH244",
    recordClass: "ballot-contest",
    subjectId: "nh244-contest-recheck",
    subjectLabel: "the ballot contest recheck",
    readerImpactAt: null,
    routes: [],
    needsBeforeItCanCarryANextDue: [
      "the filing deadline as a declared cycle, which the state publishes",
      "an adapter for the contest source",
    ],
  },
  {
    trackerId: "PB04",
    recordClass: "source-registry",
    subjectId: "pb04-source-registry-recheck",
    subjectLabel: "the source registry's own recheck",
    readerImpactAt: null,
    routes: [],
    needsBeforeItCanCarryANextDue: [
      "a decision on whether the registry is a record or an index of records",
      "a route that observes whichever it is",
    ],
  },
  {
    /*
     * Split out of OWN03 by the governance lane on 2026-08-31. Tom Horne was
     * named among nine portraits queued for the author's approval and was never
     * queued: his decode reads NOT_AN_IMAGE because azed.gov answered a
     * Cloudflare challenge. Under RULING 206 the owed thing is ANOTHER
     * REPRESENTATION of the same record, which is hunt work and not a decision
     * for the author — so it leaves his queue and enters this one.
     */
    trackerId: "OWN03-HORNE-SPLIT",
    recordClass: "portrait",
    subjectId: "az-superintendent-portrait",
    subjectLabel:
      "the portrait the Arizona Department of Education publishes of its own Superintendent",
    readerImpactAt: null,
    routes: [],
    needsBeforeItCanCarryANextDue: [
      "another representation of the same record — the known file is 60px against a 96px floor, so defeating the challenge would not yield a usable portrait",
      "a route that is not the azed.gov image URL (door 3, an alternate first-party page, an archive, another custodian)",
      "permission is NOT the blocker: docs/sources.md already records azed.gov as ALLOWED at rung 4",
    ],
  },
];

/**
 * Build the handoff artifact.
 *
 * `generatedAt` is a parameter rather than a clock read, because an agent does
 * not know today's date and a plausible one is a fabrication. Callers pass
 * `pnpm stamp`'s answer.
 */
export function buildTrackerHandoff(
  generatedAt: string,
  rows: readonly HandoffRow[] = CONVERTED_ROWS,
): TrackerHandoffArtifact {
  return {
    generatedAt,
    generatedBy: "lane-tracker triage (b), via lib/tracker/obligation-handoff.ts",
    whatThisIs:
      "Tracker rows the triage converted into obligations the control plane should carry, so " +
      "that 'the owner reported it' and 'a machine owes it' stop being two records.",
    notClosedByThisHandoff:
      "RULING 208 — naming an obligation does not discharge the record obligation behind it, and " +
      "none of these rows is closed by appearing here. Each stays OPEN in docs/tracker-working.csv " +
      "until the conversion actually lands.",
    rows,
  };
}
