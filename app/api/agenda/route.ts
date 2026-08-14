import { readSnapshot } from "@/lib/meetings/snapshot";

/**
 * GET /api/agenda?meetingId=<source-namespaced id>
 *
 * The stored agenda documents for one meeting, from the committed snapshot —
 * the append-only versions the retrieval pass already fetched (4c). The
 * documents are ALREADY in the repository; this route exists because the
 * meeting surface was linking them while rendering their content as absent.
 *
 * Newest version first. A document whose extraction failed is returned with
 * its note and null text — the surface says so honestly and links the
 * document rather than pretending nothing exists.
 */

export const runtime = "nodejs";

export async function GET(request: Request) {
  const meetingId = new URL(request.url).searchParams.get("meetingId");
  if (!meetingId || meetingId.length > 200) {
    return Response.json({ error: "meetingId required" }, { status: 400 });
  }

  const snapshot = readSnapshot();
  if (!snapshot) {
    // No snapshot is an honest empty, not a 500.
    return Response.json({ documents: [] });
  }

  const documents = snapshot.agendaDocuments
    .filter((doc) => doc.meetingId === meetingId)
    .sort((a, b) => Date.parse(b.retrievedAt) - Date.parse(a.retrievedAt))
    .map((doc) => ({
      documentUrl: doc.documentUrl,
      retrievedAt: doc.retrievedAt,
      contentType: doc.contentType,
      extraction: doc.extraction,
      extractionNote: doc.extractionNote,
      text: doc.text,
      sourceOrg: doc.sourceOrg,
    }));

  return Response.json({ documents });
}
