/**
 * **EXPANSION NOW LIVES ON FLEET · WORK.** (Admin redesign, 2026-09-23.)
 *
 * Choosing a geography, its priority and its budget is the composer on
 * Fleet · Work, and the geographies already chosen are listed there with the
 * runner's acknowledgement. The same gateway actions record them.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function ExpansionMoved() {
  redirect("/admin/work");
}
