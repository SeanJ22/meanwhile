import {
  prlProfileForSubject,
  refreshPrlFromPromoted,
} from "@/lib/sources/prl/snapshot";

export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ subject: string }> }) {
  const subject = decodeURIComponent((await params).subject);
  if (!subject || subject.length > 128) return Response.json({ error: "subject required" }, { status: 400 });
  try {
    await refreshPrlFromPromoted();
    return Response.json({ profile: prlProfileForSubject(subject) }, { headers: { "cache-control": "public, max-age=3600" } });
  } catch (error) {
    console.error("profile holding unavailable", error);
    return Response.json({ error: "profile data unavailable" }, { status: 503 });
  }
}
