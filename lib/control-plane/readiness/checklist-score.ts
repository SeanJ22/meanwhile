import profile from "./checklist-profile.json" with { type: "json" };

/** Receipt projection only: this module neither creates work nor owns civic data. */
export const CHECKLIST_PROFILE = profile;

/** Floored display cannot turn a near-complete value into an exact 100. */
export function checklistFraction(passed: number, due: number, unresolved: number) {
  const percent = due > 0 ? Math.floor(passed / due * 1000) / 10 : null;
  return { passed, due, owed: due - passed, unresolved, percent,
    label: due === 0 ? "Not measured" : `${passed} of ${due} known items pass${unresolved ? `; ${unresolved} unresolved — incomplete assessment` : passed < due ? `; ${due-passed} still owed` : ""}` };
}
