import type { AutonomousWorkPlan } from "./autonomous-plan.ts";

/** Every persisted plan uses the same coordinator. Owner paid-work controls still govern dispatch. */
export function plannedForHunters(plan: AutonomousWorkPlan | undefined): plan is AutonomousWorkPlan {
  return plan !== undefined;
}
