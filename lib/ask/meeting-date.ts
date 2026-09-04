/** An explicit reader date, never a model-invented time or an inferred year. */
export interface RequestedMeetingDate { date: string | null; mentioned: string }

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function checkedDate(year: number, month: number, day: number): string | null {
  const value = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  const instant = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value ? value : null;
}

/** ISO and named-month dates are unambiguous. Multiple or invalid dates fail closed. */
export function meetingDateInQuestion(question: string): RequestedMeetingDate | null {
  const found: RequestedMeetingDate[] = [];
  for (const match of question.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    found.push({ date: checkedDate(Number(match[1]), Number(match[2]), Number(match[3])), mentioned: match[0] });
  }
  const months = MONTHS.map((month) => `${month.slice(0, 3)}(?:${month.slice(3)})?`).join("|");
  for (const match of question.matchAll(new RegExp(`\\b(${months})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,|\\s)\\s*(\\d{4})\\b`, "gi"))) {
    found.push({ date: checkedDate(Number(match[3]), MONTHS.findIndex((month) => month.startsWith(match[1].toLowerCase())) + 1, Number(match[2])), mentioned: match[0] });
  }
  for (const match of question.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${months})\\.?\\s+(\\d{4})\\b`, "gi"))) {
    found.push({ date: checkedDate(Number(match[3]), MONTHS.findIndex((month) => month.startsWith(match[2].toLowerCase())) + 1, Number(match[1])), mentioned: match[0] });
  }
  if (!found.length) return null;
  return { date: found.every((entry) => entry.date && entry.date === found[0].date) ? found[0].date : null, mentioned: found.map((entry) => entry.mentioned).join(", ") };
}
