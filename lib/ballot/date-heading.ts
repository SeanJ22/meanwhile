/**
 * The heading a dated row prints. The source's category stays unless the row's
 * own words say it is about something else: a "registration" row that never
 * mentions registering, or one that speaks of early voting before it speaks of
 * registering, and an "early voting" row that is absentee voting or a request.
 */
export function dateHeading(step: { readonly label: string; readonly detail: string | null }): string {
  const text = step.detail ?? "";
  const earlyAt = text.search(/\bearly[- ](?:in[- ]person\b|vot)|\bvote early\b|\bearly vote\b|\bEV\b/i);
  if (step.label === "Voter registration") {
    const registerAt = text.search(/\bregist/i);
    if (registerAt < 0) {
      if (earlyAt >= 0) return "Early voting";
      if (/\babsentee\b|\bballot\b/i.test(text)) return "Mail-ballot request";
      if (/^\s*on election day\b|\bpolling place\b/i.test(text)) return "Election Day";
    } else if (earlyAt >= 0 && earlyAt < registerAt) return "Early voting";
  }
  if (step.label === "Early voting" && earlyAt < 0 && (/\babsentee\b/i.test(text) || /\b(?:apply|request)\b/i.test(text))) return "Absentee voting";
  return step.label;
}
