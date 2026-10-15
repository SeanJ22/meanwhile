import { RESEARCH_BOUNDS } from "../../lib/control-plane/scheduler/research-policy.ts";
import { scheduleObligation, isScheduled } from "../../lib/control-plane/scheduler/obligation.ts";
import { buildScoutToolkit } from "../../lib/control-plane/scheduler/scout-tools.ts";

const NOW = "2026-10-14T12:00:00.000Z";
const row = scheduleObligation({ id: "hunt:packet:fixture", recordClass: "HUNT_PACKET", subjectId: "ocd-division/country:us/state:az", routeId: "hunter:packet",
  active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }, Date.parse(NOW));
if (!isScheduled(row)) throw new Error("fixture obligation did not schedule");

/** The tools a hunter is offered, read from a toolkit the way a job builds it. */
export const HUNTER_SPECS = buildScoutToolkit({ obligation: row, route: null, providerId: null, attemptId: "at", workItemId: "wi", routeTaskId: "rt", holder: "fixture",
  vault: async () => ({ stored: true, where: "fixture", why: "fixture" }), spaceOut: async () => {}, bound: RESEARCH_BOUNDS.perDispatch, now: () => NOW,
  handed: { artifactIds: [] }, openOne: async () => { throw new Error("fixture never opens"); } }).specs;
