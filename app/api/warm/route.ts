/**
 * **KEEP A FEW SERVER INSTANCES BOOTED, AND READY FOR A COLD ASK (C21, C20;
 * 2026-09-24/25. The owner: a load over 3 s is not a win; he chose a keep-warm
 * pinger over more memory.)**
 *
 * Every route shares one Netlify server function, and a new instance of it
 * spends 2.7-3.7 s booting Next before it runs any page code (function logs,
 * 2026-09-24 9:17 PM EDT, M4). Traffic that lands on a booted instance does
 * not pay that.
 *
 * `netlify/functions/keep-warm.mts` calls this route fourteen times at once
 * every five minutes. A marked call holds for up to a second, so the calls
 * overlap and keep instances booted. Measured 2026-09-24 11:54 PM to 2026-09-25
 * 12:47 AM MST, overlapping calls reach fewer instances than calls (ten reached
 * 8-9, fourteen 10-11), and the calls sharing an instance wait for each other.
 *
 * A booted instance can still be cold for an Ask: on 38e2a643 (11:41 PM MST)
 * two of five concurrent Pima Asks spent 1.9-2.1 s in the server loading the
 * reader edge on their instance (the manifest ~0.2 s, the authority families
 * ~0.65 s, the meetings ~0.2-0.4 s), and a request queued behind one of them
 * reached 3.27 s end to end. So a marked call also loads, on its instance, what
 * a cold Ask reads first: the edge manifest, the authority families
 * (`ensureReaderAuthorityEdge`, cached per version per process) and the
 * published meeting artifacts (`readReaderEdgeMeetings`). It never reads the
 * database: without an edge store or manifest it loads nothing, and the
 * meetings read's database fallback is refused.
 *
 * An unmarked call, or a hold asked beyond the cap, is answered at once or
 * capped, loads nothing, and cannot hold an instance longer than that.
 */
import { numericInRange, refuse, rejectUnknown } from "@/lib/api/params";
import { ensureReaderAuthorityEdge, readReaderEdgeMeetings, readReaderManifest } from "@/lib/meetings/edge-serving";

/** The synthetic-run marker the pinger sends (`x-wtp-synthetic-run`). */
export const KEEP_WARM_MARKER = "keep-warm";
/** The longest a marked call holds its instance. */
export const MAX_HOLD_MS = 1000;

const bootedAt = new Date().toISOString();

export interface ReaderEdgePrimed {
  readonly manifest: boolean;
  readonly authorityFamilies: number;
  readonly meetings: boolean;
}

/** Loads, on this instance, what a cold Ask reads first from the reader edge. Never the database. */
export async function primeReaderEdge(): Promise<ReaderEdgePrimed> {
  const manifest = await readReaderManifest().catch(() => null);
  if (!manifest) return { manifest: false, authorityFamilies: 0, meetings: false };
  const bundle = manifest.authorityArtifacts ? await ensureReaderAuthorityEdge(manifest).catch(() => null) : null;
  const meetings = await readReaderEdgeMeetings({
    manifest,
    fallback: () => Promise.reject(new Error("keep-warm loads the edge only, never the database")),
  }).then(() => true, () => false);
  return { manifest: true, authorityFamilies: bundle ? Object.keys(bundle).length : 0, meetings };
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const unknown = rejectUnknown(params, ["hold"]);
  if (!unknown.ok) return refuse(unknown.error);
  const asked = numericInRange(params, "hold", 0, MAX_HOLD_MS, { default: 0 });
  if (!asked.ok) return refuse(asked.error);
  const marked = request.headers.get("x-wtp-synthetic-run") === KEEP_WARM_MARKER;
  const primed = marked ? await primeReaderEdge() : null;
  const heldMs = marked ? Math.round(asked.value) : 0;
  if (heldMs > 0) await new Promise((resolve) => setTimeout(resolve, heldMs));
  return Response.json(
    { warm: true, heldMs, bootedAt, primed },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}
