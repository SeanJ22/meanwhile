/** Government accounts are distinct from campaign receipts and meeting votes. */
export function governmentFinanceQuestion(question: string) {
  return /\b(?:budget|revenue|expenditures?|spending|debt|audits?|grants?|tax rates?|capital totals?|operating totals?)\b/i.test(question) &&
    !/\b(?:campaign|donors?|contributions?|who voted|how did .*vote|when did .*vote)\b/i.test(question);
}
