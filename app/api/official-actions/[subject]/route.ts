import { settleOfficialActionHoldingAnswer } from "./holdings";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ subject: string }> }) {
  const { subject } = await context.params;
  if (!subject || subject.length > 512) return Response.json({ error: "subject required" }, { status: 400 });
  const settled = await settleOfficialActionHoldingAnswer(subject);
  if (settled.kind === "HOLDING_UNAVAILABLE") {
    return Response.json({
      error: "Official-action records are temporarily unavailable",
      holdingStatus: "HOLDING_UNAVAILABLE",
      unavailableAuthorities: settled.unavailableAuthorities,
    }, { status: 503 });
  }
  return Response.json(settled.answer);
}
