/**
 * Whole-screen states the design specifies, shared by every area.
 */
import Link from "next/link";

import s from "./mw.module.css";
import type { RenderedNumber, CountClaim } from "@/lib/control-plane/owner-surface.ts";
import { registrationWords, type StateStanding } from "@/lib/control-plane/admin-view/registration-standing.ts";
import { withScope, type MwScope } from "./scope.ts";

/**
 * A scope with no figures of ours: sentences, never arithmetic (ACCEPTANCE
 * §2). What the sentences say follows where the state stands — a state whose
 * registration is promoted is never called one with nothing registered, and
 * one whose registration was not read is called neither.
 */
export function EmptyScope({ name, scope, census, standing, counts }: { name: string; scope: MwScope; census?: string; standing: StateStanding | null; counts?: string | null }) {
  if (standing && standing.kind !== "NOT_REGISTERED" && standing.kind !== "TRACKED") {
    return (
      <div className={s.grid2}>
        <div className={s.card}>
          <h2 className={s.h2CardTight}>{standing.kind === "REGISTERED" ? "Registered, not measured yet" : "Registration not read"}</h2>
          <p className={s.note} style={{ fontSize: 15, lineHeight: 1.55, maxWidth: "48ch" }}>
            {registrationWords(name, standing)}{" "}
            {standing.kind === "REGISTERED"
              ? "A zero here would mean the system measured and found nothing. It has not measured."
              : `${standing.detail} Nothing on this page is claimed about ${name} until it is read.`}
          </p>
          {counts ? (
            <p className={s.note} style={{ fontSize: 15, lineHeight: 1.55, maxWidth: "48ch", marginTop: 12 }}>
              {counts}
            </p>
          ) : null}
          {census ? (
            <p className={s.note} style={{ fontSize: 15, lineHeight: 1.55, maxWidth: "48ch", marginTop: 12 }}>
              {census} That is what exists there, not anything collected.
            </p>
          ) : null}
        </div>
        <div className={s.card}>
          <h2 className={s.h2CardTight}>What you can do</h2>
          <p className={s.note} style={{ fontSize: 15, lineHeight: 1.55, maxWidth: "48ch", marginBottom: 16 }}>
            Choose one of its geographies and send it as an assignment. Nothing about {name}&rsquo;s bodies can be reported until one of them has been read.
          </p>
          <Link href={withScope("/admin/work", scope)} className={s.btnPrimary}>
            Open an assignment here
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className={s.grid2}>
      <div className={s.card}>
        <h2 className={s.h2CardTight}>Nothing is registered here</h2>
        <p className={s.note} style={{ fontSize: 15, lineHeight: 1.55, maxWidth: "48ch" }}>
          {name} has no promoted registration, no registered bodies and no records of ours, so nothing of ours is counted here. A zero would mean the system
          measured and found nothing. It has not measured.
        </p>
        {census ? (
          <p className={s.note} style={{ fontSize: 15, lineHeight: 1.55, maxWidth: "48ch", marginTop: 12 }}>
            {census} That is what exists there, not anything collected.
          </p>
        ) : null}
      </div>
      <div className={s.card}>
        <h2 className={s.h2CardTight}>What you can do</h2>
        <p className={s.note} style={{ fontSize: 15, lineHeight: 1.55, maxWidth: "48ch", marginBottom: 16 }}>
          Choose one of its geographies and send it as an assignment. Nothing in {name} is registered yet, so there is no work there to put first, and nothing about
          it can be reported until a body has been read once.
        </p>
        <Link href={withScope("/admin/work", scope)} className={s.btnPrimary}>
          Open an assignment here
        </Link>
      </div>
    </div>
  );
}

/** The control plane could not be opened: say so, and say that nothing below was checked. */
export function NotAsked({ detail }: { detail: string }) {
  return (
    <div className={s.refusal} role="status">
      <h2 className={s.h2CardTight}>We could not ask.</h2>
      <p className={s.note} style={{ fontSize: 15, lineHeight: 1.6, maxWidth: "80ch" }}>
        {detail} Nothing on this page is missing — nothing on it has been checked. Those are different facts and this page will not print one as the other.
      </p>
    </div>
  );
}

/** The footer every page carries: what it checked about its own figures. */
export function AuditFooter({ numbers, claims, readAt }: { numbers: readonly RenderedNumber[]; claims: readonly CountClaim[]; readAt: string }) {
  return (
    <p className={s.audit}>
      {numbers.length} figure{numbers.length === 1 ? " on this page carries" : "s on this page carry"} a denominator and a stated meaning; {claims.length} count
      {claims.length === 1 ? " was" : "s were"} checked against the rows drawn beneath {claims.length === 1 ? "it" : "them"}. Read at {readAt}.
    </p>
  );
}
