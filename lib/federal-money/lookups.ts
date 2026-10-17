export function federalMoneyLookupPath(kind: "id" | "uei" | "report", values: readonly string[]): string {
  let terms = [...new Set(values)].map(value => `@ == ${JSON.stringify(`${kind}:${value}`)}`);
  if (!terms.length) throw new Error("A federal native-key lookup requires at least one value.");
  while (terms.length > 1) terms = terms.flatMap((term, index) => index % 2 ? [] : [index + 1 < terms.length ? `(${term} || ${terms[index + 1]})` : term]);
  return `$[*] ? (${terms[0]})`;
}
