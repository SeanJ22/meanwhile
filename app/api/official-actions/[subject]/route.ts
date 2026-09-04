import { officialActionsForTarget } from "@/lib/officials/reader-actions";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ subject: string }> }) {
  const { subject } = await context.params;
  if (!subject || subject.length > 512) return Response.json({ error: "subject required" }, { status: 400 });
  try { return Response.json(officialActionsForTarget(subject)); }
  catch { return Response.json({ error: "Official-action records are temporarily unavailable" }, { status: 503 }); }
}
