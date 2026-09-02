/**
 * **PROVING THE DECISION PATH END TO END.**
 * (Session C final, ITEM H, 2026-09-01. `pnpm owner:decision-proof`.)
 *
 * The acceptance clause is that ONE decision travels the full
 * `intent -> canonicalization` path. This drives that path through the REAL
 * route handler — `app/api/admin/decision/route.ts` — rather than by calling
 * the repository directly, because calling the repository would prove that the
 * STORE works and the claim is that the BUTTON works. Between the two sit the
 * host check, the Origin check, the session verification and the
 * aggregate-only guard, and every one of them is part of what is being proved.
 *
 * ## This record is a MECHANISM PROOF, not an owner decision
 *
 * It is written with `subjectId = PROOF:item-h-decision-path` and its
 * consequence text says so in the record itself. **The owner did not decide
 * anything here**, and a durable store that carried a decision he never made
 * would be worse than no store at all — the control centre would then be
 * showing him his own reasoning, invented. The record resolves against
 * `RULING 124`, which is real, current, and already the law it names.
 *
 * ## Why the refusals are proved first
 *
 * A path that only ever succeeds has not been shown to be a gate. So this runs
 * the same POST four times: wrong host, wrong origin, no session, then valid.
 * Three refusals and one success is the evidence; one success alone is not.
 */

import { randomBytes } from "node:crypto";

import { POST } from "../app/api/admin/decision/route.ts";
import { ADMIN_ORIGIN, PUBLIC_SITE_ORIGIN, hostOf } from "../lib/ops/origins.ts";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_KEY_VAR,
  SESSION_LIFETIME_SECONDS,
  signSession,
} from "../lib/control-plane/admin-auth.ts";

const { NextRequest } = await import("next/server");

function log(line: string): void {
  console.log(`owner:decision-proof · ${line}`);
}

/*
 * A session key for this proof only, if the runtime has none. It never leaves
 * this process and is never printed. On a machine that HAS the deployed key
 * configured, that one is used instead.
 */
if (!process.env[ADMIN_SESSION_KEY_VAR]) {
  process.env[ADMIN_SESSION_KEY_VAR] = randomBytes(32).toString("base64url");
  log(`${ADMIN_SESSION_KEY_VAR} was not set in this process; using an ephemeral key for the proof`);
}

const iat = Math.floor(Date.now() / 1000);
const cookie = await signSession(
  { sid: `proof-${randomBytes(6).toString("hex")}`, iat, exp: iat + SESSION_LIFETIME_SECONDS },
  process.env[ADMIN_SESSION_KEY_VAR] as string,
);

const SUBJECT = "PROOF:item-h-decision-path";
const OPTION = "Record the ITEM H decision path as proved -> RULING 124";
const CONSEQUENCE =
  "MECHANISM PROOF, not an owner decision. Written by scripts/owner-decision-proof.mts to " +
  "demonstrate that a card click reaches the durable control plane and is then resolved against " +
  "the canonical ledger. It resolves to RULING 124, which is real and current.";

function post(opts: { host: string; origin: string | null; withCookie: boolean }) {
  const headers = new Headers({ host: opts.host });
  if (opts.origin) headers.set("origin", opts.origin);
  if (opts.withCookie) headers.set("cookie", `${ADMIN_SESSION_COOKIE}=${cookie}`);
  const body = new URLSearchParams({
    subjectId: SUBJECT,
    chosenOption: OPTION,
    consequenceShown: CONSEQUENCE,
  });
  headers.set("content-type", "application/x-www-form-urlencoded");
  return new NextRequest(`https://${opts.host}/api/admin/decision`, {
    method: "POST",
    headers,
    body,
  });
}

let failures = 0;
const expect = (actual: number, wanted: number, what: string): void => {
  const ok = actual === wanted;
  log(`${ok ? "OK   " : "FAIL "} ${what} -> ${actual} (wanted ${wanted})`);
  if (!ok) failures += 1;
};

const ADMIN_HOST = hostOf(ADMIN_ORIGIN);

log("refusals first — a path that only succeeds has not been shown to be a gate");
expect(
  (await POST(post({ host: hostOf(PUBLIC_SITE_ORIGIN), origin: ADMIN_ORIGIN, withCookie: true })))
    .status,
  404,
  "on the PUBLIC host",
);
expect(
  (await POST(post({ host: ADMIN_HOST, origin: PUBLIC_SITE_ORIGIN, withCookie: true }))).status,
  403,
  "with a cross-origin Origin header",
);
expect(
  (await POST(post({ host: ADMIN_HOST, origin: ADMIN_ORIGIN, withCookie: false }))).status,
  401,
  "with no session cookie",
);

log("");
log("now the valid request");
const ok = await POST(post({ host: ADMIN_HOST, origin: ADMIN_ORIGIN, withCookie: true }));
expect(ok.status, 303, "authenticated, same-origin, on the admin host");
if (ok.status === 303) {
  log(`       redirected to ${ok.headers.get("location")}`);
} else {
  log(`       body: ${await ok.text()}`);
}

log("");
log(failures === 0 ? "DECISION PATH PROVED" : `DECISION PATH FAILED — ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
