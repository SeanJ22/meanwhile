import { Suspense } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { LiveRefresh } from "../../_mw/live-refresh.tsx";
import { LiveCommandCenter } from "../../_mw/admin-v6/live-command-center.tsx";
import { liveReference } from "../../_mw/admin-v6/reference.ts";
import { placeKeyOf } from "../../_mw/admin-v6/places.ts";
import { parseScope, type MwScope } from "../../_mw/scope.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

type SearchParams = Record<string, string | string[] | undefined>;

/** Real Admin route. Unannounced v6 sections stay visibly unavailable. */
export default async function CommandCenterPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [requestHeaders, jar, params] = await Promise.all([headers(), cookies(), searchParams]);
  const observedAt = new Date().toISOString();
  const guard = await guardAdminRequest({ headers: requestHeaders,
    cookie: jar.get(ADMIN_SESSION_COOKIE)?.value, checkOrigin: false,
    nowSeconds: Math.floor(Date.parse(observedAt) / 1000) });
  if (!guard.ok) {
    if (guard.status === 404) notFound();
    redirect("/admin/login");
  }
  const scope: MwScope = parseScope(params.scope);
  const reference = liveReference({ scope, observedAt });
  return (
    <div className="admin">
      <LiveRefresh />
      <Suspense fallback={<p role="status">Loading the command center…</p>}>
        <LiveCommandCenter reference={reference} initialScopeKey={placeKeyOf(scope)}
          access={{ role: "owner", canSpend: false, outreachAuthorized: false }} initialView="now" />
      </Suspense>
    </div>
  );
}
