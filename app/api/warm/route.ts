/**
 * **KEEP A FEW SERVER INSTANCES BOOTED (C21, 2026-09-24. The owner: a load
 * over 3 s is not a win; he chose a keep-warm pinger over more memory.)**
 *
 * Every route shares one Netlify server function, and a new instance of it
 * spends 2.7-3.7 s booting Next before it runs any page code (function logs,
 * 2026-09-24 9:17 PM EDT, M4). Traffic that lands on a booted instance does
 * not pay that: the reader's first `/api/meetings` on a booted instance
 * measured 1.8-1.9 s in the handler, about 2.1-2.2 s end to end.
 *
 * `netlify/functions/keep-warm.mts` calls this route ten times at once every
 * five minutes. A marked call holds for up to a second, so the ten overlap and
 * each keeps its own instance booted; overlapping requests cannot share one.
 * An unmarked call, or a hold asked beyond the cap, is answered at once or
 * capped, so the route cannot be used to hold instances longer than that.
 * Nothing is read or written here: it touches no store, no log and no reader
 * module.
 */
import { numericInRange, refuse, rejectUnknown } from "@/lib/api/params";

/** The synthetic-run marker the pinger sends (`x-wtp-synthetic-run`). */
export const KEEP_WARM_MARKER = "keep-warm";
/** The longest a marked call holds its instance. */
export const MAX_HOLD_MS = 1000;

const bootedAt = new Date().toISOString();

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const unknown = rejectUnknown(params, ["hold"]);
  if (!unknown.ok) return refuse(unknown.error);
  const asked = numericInRange(params, "hold", 0, MAX_HOLD_MS, { default: 0 });
  if (!asked.ok) return refuse(asked.error);
  const marked = request.headers.get("x-wtp-synthetic-run") === KEEP_WARM_MARKER;
  const heldMs = marked ? Math.round(asked.value) : 0;
  if (heldMs > 0) await new Promise((resolve) => setTimeout(resolve, heldMs));
  return Response.json(
    { warm: true, heldMs, bootedAt },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}
