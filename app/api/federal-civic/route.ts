import { readerRoute } from "@/lib/api/reader-route";
import { readFederalMember, readFederalRules } from "@/lib/sources/congress/reader";

export const GET = readerRoute("/api/federal-civic", async function GET(request: Request) {
  const params = new URL(request.url).searchParams, member = params.get("member");
  if (member && !/^congress:[A-Z]\d{6}$/.test(member)) return Response.json({ error: "Invalid member identifier." }, { status: 400 });
  const offsetInput = params.get("offset") ?? "0";
  if (!/^\d+$/.test(offsetInput)) return Response.json({ error: "Invalid page offset." }, { status: 400 });
  const offset = Number(offsetInput);
  if (!Number.isSafeInteger(offset) || offset < 0) return Response.json({ error: "Invalid page offset." }, { status: 400 });
  const payload = member ? await readFederalMember(member, { offset, limit: 20 }) : await readFederalRules({ offset, limit: 20 });
  return Response.json(payload, { headers: { "Cache-Control": "private, max-age=30" } });
});
