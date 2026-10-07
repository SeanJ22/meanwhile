/**
 * An old Admin link lands on the command-center view that took over. Signed in, a retired page redirects (keeping a scope); signed out, it still
 * gets the login page and learns nothing about where the page went.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { middleware } from "@/middleware.ts";
import { MOVED_ADMIN_PAGES, movedAdminPage } from "@/lib/control-plane/moved-pages.ts";
import { VIEW_IDS, parseView } from "../app/(admin)/_mw/admin-v6/view-param.ts";
import { ADMIN_HOST, adminSessionCookie, withAdminSessionKey } from "./admin-session.ts";

test("every retired page maps to a view the command center has", () => {
  for (const [from, to] of Object.entries(MOVED_ADMIN_PAGES)) {
    const url = new URL(to, "https://admin.test");
    assert.equal(url.pathname, "/admin", `${from} must land on the command center`);
    const view = url.searchParams.get("view");
    assert.ok(view === null || (VIEW_IDS as readonly string[]).includes(view), `${from} names a view that does not exist: ${view}`);
    assert.equal(parseView(view ?? undefined), view ?? "now");
  }
});

test("a scope on an old link is kept, and a path that never moved is left alone", () => {
  assert.equal(movedAdminPage("/admin/chat", null), "/admin?view=chat");
  assert.equal(movedAdminPage("/admin/chat", "state:az"), "/admin?view=chat&scope=state%3Aaz");
  assert.equal(movedAdminPage("/admin/fleet", "state:az"), "/admin?scope=state%3Aaz");
  assert.equal(movedAdminPage("/admin/sources", null), "/admin?view=workers", "publication status moved to Workers");
  assert.equal(movedAdminPage("/admin/money", "az.zcta.85635"), "/admin?view=money&scope=az.zcta.85635");
  assert.equal(movedAdminPage("/readiness/cost", null), "/admin?view=money");
  assert.equal(movedAdminPage("/readiness/work", null), "/admin?view=queue");
  assert.equal(movedAdminPage("/readiness", null), "/admin?view=checklist");
  assert.equal(movedAdminPage("/readiness/done", null), "/admin?view=checklist");
  assert.equal(movedAdminPage("/readiness/az", null), "/admin?view=checklist&scope=az", "a state's readiness page is the Checklist at that state");
  assert.equal(movedAdminPage("/readiness/az", "az.zcta.85635"), "/admin?view=checklist&scope=az.zcta.85635", "a scope the link carried wins");
  assert.equal(movedAdminPage("/admin/agents", null), "/admin");
  assert.equal(movedAdminPage("/admin/auth/callback", null), null);
  assert.equal(movedAdminPage("/admin", null), null);
});

test("signed in, a retired page redirects; signed out, it goes to the login", async () => {
  await withAdminSessionKey(async () => {
    const cookie = await adminSessionCookie();
    const moved = await middleware(new NextRequest(`https://${ADMIN_HOST}/admin/feedback`, { headers: { host: ADMIN_HOST, cookie } }));
    assert.equal(moved.status, 307);
    assert.equal(new URL(moved.headers.get("location") ?? "").pathname + new URL(moved.headers.get("location") ?? "").search, "/admin?view=reports");
    const signedOut = await middleware(new NextRequest(`https://${ADMIN_HOST}/admin/feedback`, { headers: { host: ADMIN_HOST } }));
    assert.equal(signedOut.status, 307);
    assert.match(signedOut.headers.get("location") ?? "", /\/admin\/login/);
  });
});
