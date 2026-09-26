import { billingStale, billingTotal, type ProviderBillingSnapshot } from "@/lib/control-plane/provider-billing.ts";
import s from "./mw.module.css";
import type { BillingAttribution } from "@/lib/control-plane/provider-billing-attribution.ts";

const mst = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) + " MST";
/** Server-rendered cached figures: no billing credential or provider request reaches the browser. */
const dollars = (value: number | null) => value === null ? "unavailable" : `$${value.toFixed(2)}`;
export function ProviderSyncPanel({ snapshot, attribution, now }: { readonly snapshot: ProviderBillingSnapshot | null; readonly attribution: BillingAttribution | null; readonly now: string }) {
  if (!snapshot) return <section className={s.card}><h2 className={s.h2Card}>Provider reporting</h2><p>The standing collector has not published provider reports yet. This does not block a hunt.</p></section>;
  const total = billingTotal(snapshot.readings, now.slice(0,7) + "-01T00:00:00.000Z", now);
  return <section className={`${s.card} ${s.gap32}`} aria-label="Automatic provider reporting">
    <h2 className={s.h2Card}>Automatic provider reporting</h2>
    <p>Current month: ${total.reportedUsd.toFixed(2)} provider-reported usage + ${total.estimatedUsd.toFixed(2)} estimates = ${total.combinedUsd.toFixed(2)} combined{total.missing ? ` (partial; ${total.missing} providers have no current dollar total)` : ""}. Reports may lag requests and are not final invoices.</p>
    <p>One amount per provider. Hunt request costs are a subset of account costs and are never added again. Shared hosting, database and development costs stay under platform costs. Credits, discounts and reservations are not extra charges; a credit balance is not consumption. Hunt token admission uses its concurrent reservations, independently of these delayed reports.</p>
    <h3>Hunt costs and reservations</h3>
    {!attribution?.hunts ? <p>Hunt attribution was not read.</p> : attribution.hunts.length === 0 ? <p>No hunt accounting period has been activated. No hunt has been started by this collector.</p> : <>
      <p>Entire hunt since its start, across days and restarts. Shared requests can belong to more than one hunt; these rows must not be added together.</p>
      <table><thead><tr><th>Hunt / started</th><th>Anthropic tokens</th><th>Reserved</th><th>Token budget</th><th>Other services</th></tr></thead><tbody>{attribution.hunts.map(h => <tr key={h.key}><td>{h.label} · {mst(h.startedAt)}</td><td>{dollars(h.anthropicUsd)}</td><td>{dollars(h.reservedUsd)}</td><td>{dollars(h.budgetUsd)}</td><td>{dollars(h.otherUsd)}{h.unpriced ? ` · ${h.unpriced} unpriced attempts` : ""}</td></tr>)}</tbody></table>
    </>}
    {attribution && <><h3>Account reconciliation</h3><p>Matched to each provider report’s period. Request costs are estimates from recorded usage and rates. The difference can include other account users, unrecorded platform activity, discounts and provider lag; it is not assigned to a hunt. Hosting, Neon and GitHub are shared platform costs. Other recorded request costs are outside an active hunt or unattributed.</p><table><thead><tr><th>Service</th><th>Hunt requests</th><th>Other recorded requests</th><th>Provider report</th><th>Unreconciled difference</th></tr></thead><tbody>{attribution.providers.map(p => <tr key={p.provider}><td>{p.provider}</td><td>{dollars(p.huntUsd)}</td><td>{dollars(p.otherRecordedUsd)}</td><td>{dollars(p.providerUsd)}</td><td>{dollars(p.differenceUsd)}</td></tr>)}</tbody></table></>}
    {snapshot.readings.map(r => <details key={r.provider} className={s.inset}>
      <summary>{r.provider} · {r.status.replaceAll("_", " ")}{billingStale(r, now) ? " · STALE" : ""} · last sync {r.syncedAt ? mst(r.syncedAt) : "never"}</summary>
      <p>Provider-reported: {dollars(r.reportedUsd)}. Estimate: {dollars(r.estimatedUsd)}.</p>
      <p>Reporting period {mst(r.periodStart)}–{mst(r.periodEnd)}. Last attempt {mst(r.attemptedAt)}. {r.error ? `Error: ${r.error}. ` : ""}{r.detail}</p>
      {r.credits && <p>{r.credits.kind.replaceAll("_", " ")}: {r.credits.amount.toLocaleString("en-US")} {r.credits.unit}</p>}
      {r.accountIds.length > 0 && <p>Reporting accounts/projects/keys: {r.accountIds.join(", ")}</p>}
      {r.existingLimits.map((limit,i) => <p key={i}>Existing limit: {limit}</p>)}
      {r.units.length > 0 && <table><thead><tr><th>Reported component</th><th>Usage</th></tr></thead><tbody>{r.units.map((u,i) => <tr key={i}><td>{u.label}</td><td>{u.value.toLocaleString("en-US")} {u.unit}</td></tr>)}</tbody></table>}
    </details>)}
  </section>;
}
