/**
 * **ASSIGNMENTS NOW LIVE ON FLEET · WORK.** (Admin redesign, 2026-09-23.)
 *
 * The end-to-end assignment list was replaced by Fleet · Work, where every
 * assignment opens in place by its id. A saved link keeps working: `?id=`
 * opens that assignment there.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AssignmentsMoved({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.id) ? sp.id[0] : sp.id;
  const id = typeof raw === "string" ? raw.trim() : "";
  redirect(id === "" ? "/admin/work" : `/admin/work?open=${encodeURIComponent(id)}`);
}
