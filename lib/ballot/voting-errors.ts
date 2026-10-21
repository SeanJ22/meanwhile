export interface VotingFailureContext {
  stage: string;
  state?: string;
  precision?: "ADDRESS" | "ZIP";
}

/** Request inputs and credential-bearing URLs never enter voting diagnostics. */
export function votingFailureDetail(error: unknown, privateInput?: string): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current; depth++) {
    if (current instanceof Error) {
      parts.push(`${current.name}: ${current.message}`);
      current = current.cause;
    } else { parts.push(String(current)); break; }
  }
  let detail = parts.join("; caused by ") || "Unknown failure";
  if (privateInput) detail = detail.split(privateInput).join("[address removed]")
    .split(encodeURIComponent(privateInput)).join("[address removed]");
  return detail.replace(/(?:https?|postgres(?:ql)?):\/\/[^\s"'<>]+/gi, value => {
    try { const url = new URL(value); return `${url.protocol}//${url.host}${url.pathname}`; }
    catch { return "[URL removed]"; }
  }).slice(0, 1600);
}

export function recordVotingFailure(context: VotingFailureContext, error: unknown, privateInput?: string): void {
  console.error(JSON.stringify({ event: "voting_lookup_failed", at: new Date().toISOString(),
    ...context, detail: votingFailureDetail(error, privateInput) }));
}
