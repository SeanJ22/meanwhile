import { readerRoute } from "@/lib/api/reader-route";
import {
  prlProfileForSubject,
  refreshPrlFromPromoted,
} from "@/lib/sources/prl/snapshot";
import { readPrlForSubject } from "@/lib/sources/prl/person";
import { ensureReaderAuthorityEdge, readReaderAuthorityManifest } from "@/lib/meetings/edge-serving";
import { withReaderAuthorityEdge } from "@/lib/registry/runtime-edge";

export const runtime = "nodejs";
export const GET = readerRoute("/api/profile/[subject]", async function GET(_request: Request, { params }: { params: Promise<{ subject: string }> }) {
  const subject = decodeURIComponent((await params).subject);
  if (!subject || subject.length > 128) return Response.json({ error: "subject required" }, { status: 400 });
  try {
    const manifest = await readReaderAuthorityManifest().catch(() => null);
    const edge = manifest ? await ensureReaderAuthorityEdge(manifest, undefined, ["registry-runtime", "federal-directory", "prl-archives", "prl-profiles"]) : null;
    return await withReaderAuthorityEdge(edge, async () => {
      const [profile, archive] = await Promise.allSettled([
        /^congress:[A-Z]\d{6}$/.test(subject) ? refreshPrlFromPromoted().then(() => prlProfileForSubject(subject)) : Promise.resolve(null),
        readPrlForSubject(subject),
      ]);
      if (profile.status === "rejected" && archive.status === "rejected") throw new Error("Statement sources unavailable");
      return Response.json({ profile: profile.status === "fulfilled" ? profile.value : null,
        archive: archive.status === "fulfilled" ? archive.value : { statements: [], summaries: [], gaps: ["Archived statements are temporarily unavailable."] } },
      { headers: { "cache-control": "public, max-age=300" } });
    });
  } catch (error) {
    console.error("profile holding unavailable", error);
    return Response.json({ error: "profile data unavailable" }, { status: 503 });
  }
});
