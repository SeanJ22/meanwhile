import { readFileSync } from "node:fs";

import type { OutcomeSnapshot, PersistedSittingOutcomes } from "../../lib/outcomes/types.ts";

/**
 * The official September 22 record as Pima's Legistar Web API published it
 * (event 1828, item 331773), built on a held sitting of the same body, which
 * carries every other field of the tenant's shape.
 */
export function september22Sitting(): PersistedSittingOutcomes {
  const seed = JSON.parse(readFileSync("tests/fixtures/legistar-outcome-store/data/outcomes/legistar-outcomes.json", "utf8")) as OutcomeSnapshot;
  const template = seed.sittings.find((sitting) => sitting.meetingId === "legistar:pima:1848")!;
  const endpoint = "https://webapi.legistar.com/v1/pima/events/1828/eventitems";
  const provenance = { endpoint, sourceOrg: "Pima County Clerk of the Board", readOn: "2026-09-24" };
  return {
    ...template,
    meetingId: "legistar:pima:1828",
    eventId: 1828,
    startsAt: "2026-09-22T17:00:00-07:00",
    sourceUrl: "https://pima.legistar.com/MeetingDetail.aspx?LEGID=1828&GID=243&G=7B470E9E-E35C-4698-8FA6-D778FB28F394",
    agenda: [{
      recordClass: "AGENDA", eventItemId: 331773, eventId: 1828, sequence: 18, agendaNumber: "18.",
      title: "Moratorium on Data Center Development\nRESOLUTION NO. 2026 - 56, of the Board of Supervisors, implementing a moratorium on data center development.",
      matterFile: "File ID 20801", matterType: "Agenda Item", provenance,
    }],
    outcomes: [{
      recordClass: "ACTION_SUMMARY", eventItemId: 331773, eventId: 1828, matterFile: "File ID 20801",
      action: "approve as amended", disposition: "PASSED", dispositionRaw: "Pass", dispositionConflict: null, dispositionGap: null,
      mover: "Matt Heinz", seconder: "Rex Scott",
      tallyText: "Motion 1: Motion by Supervisor Heinz, seconded by Supervisor Scott, approved to amend Section B 4-1, Supervisor Christy voted nay.\r\n\r\nMotion 2: Motion by Supervisor Heinz, seconded by Supervisor Cano, approved as amended with 2 conditions 3-2, Supervisors Christy and Scott voted nay.",
      matterStatus: "Approved", onConsentCalendar: false, rollCall: "OUTCOME_WITHOUT_ROLL_CALL", rollCallGap: null, provenance,
    }],
    rollCalls: [],
  } as PersistedSittingOutcomes;
}
