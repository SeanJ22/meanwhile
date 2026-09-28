import { billingStale, billingTotal, type ProviderBillingSnapshot } from "@/lib/control-plane/provider-billing.ts";
import s from "./mw.module.css";
import type { BillingAttribution } from "@/lib/control-plane/provider-billing-attribution.ts";

const mst = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) + " MST";
/** Server-rendered cached figures: no billing credential or provider request reaches the browser. */
const dollars = (value: number | null) => value === null ? "unavailable" : `$${value.toFixed(2)}`;
export function ProviderSyncPanel({ snapshot, attribution, now }: { readonly snapshot: ProviderBillingSnapshot | null; readonly attribution: BillingAttribution | null; readonly now: string }) {
  const total = snapshot ? billingTotal(snapshot.readings, now.slice(0,7) + "-01T00:00:00.000Z", now) : null;
  return <section className={`${s.card} ${s.gap32}`} aria-label="Automatic provider reporting">
    <h2 className={s.h2Card}>Automatic provider reporting</h2>
    {total ? <p>Current month: ${total.reportedUsd.toFixed(2)} provider-reported usage + ${total.estimatedUsd.toFixed(2)} estimates = ${total.combinedUsd.toFixed(2)} combined{total.missing ? ` (partial; ${total.missing} providers have no current dollar total)` : ""}. Reports may lag requests and are not final invoices.</p>
      : <p>The standing collector has not published provider reports yet. Hunt request accounting is shown below when it was read.</p>}
    <p>One amount per provider. Hunt request costs are a subset of account costs and are never added again. Shared hosting, database and development costs stay under platform costs. Credits, discounts and reservations are not extra charges; a credit balance is not consumption. Hunt token admission uses its concurrent reservations, independently of these delayed reports.</p>
    <h3>Hunt costs and reservations</h3>
    {!attribution?.hunts ? <p>Hunt attribution was not read.</p> : attribution.hunts.length === 0 ? <p>No hunt accounting period has been activated. No hunt has been started by this collector.</p> : <>
      <p>Entire hunt since its start, across days and restarts. A shared token request consumes every applicable allowance; for combined reporting its cost is allocated once. Do not add allowance consumption across hunts.</p>
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Hunt / started</th><th>Anthropic allocated once</th><th>Token allowance consumed</th><th>Reserved</th><th>Available allowance</th><th>Other services allocated</th><th>Known combined allocated cost</th><th>Unpriced token requests on allowance</th></tr></thead><tbody>{attribution.hunts.map(h => <tr key={`${h.key}:${h.receiptId ?? h.startedAt}`}><td>{h.label} · {mst(h.startedAt)} · token allowance {dollars(h.budgetUsd)}</td><td>{dollars(h.anthropicKnownUsd)} known{h.anthropicUsd === null ? " · allocated total incomplete" : ""}</td><td>{h.budgetConsumedKnownUsd === undefined ? "unavailable" : `${dollars(h.budgetConsumedKnownUsd)} known`}</td><td>{dollars(h.reservedUsd)}</td><td>{h.budgetConsumedKnownUsd === undefined ? "unavailable" : dollars(h.availableUsd)}{h.availableUsd === null ? " · cannot confirm until reservations and token charges are read" : ""}</td><td>{dollars(h.otherKnownUsd)} known{h.otherUsd === null ? " · allocated total incomplete" : ""}</td><td>{dollars(h.knownCombinedUsd)} known</td><td>{h.budgetUnpriced === undefined ? "unavailable" : h.budgetUnpriced.toLocaleString("en-US")}</td></tr>)}</tbody></table></div>
    </>}
    {attribution && <><h3>Account reconciliation</h3><p>Matched to each provider report’s period. Request costs are estimates from recorded usage and rates. The difference can include other account users, unrecorded platform activity, discounts and provider lag; it is not assigned to a hunt. Hosting, Neon and GitHub are shared platform costs. Other recorded request costs are outside an active hunt or unattributed.</p><div style={{ overflowX: "auto" }}><table><thead><tr><th>Service</th><th>Hunt requests</th><th>Other recorded requests</th><th>Provider report</th><th>Unreconciled difference</th><th>Unpriced requests</th></tr></thead><tbody>{attribution.providers.map(p => <tr key={p.provider}><td>{p.provider}</td><td>{dollars(p.huntKnownUsd)} known{p.huntUsd === null ? " · incomplete" : ""}</td><td>{dollars(p.otherKnownUsd)} known{p.otherRecordedUsd === null ? " · incomplete" : ""}</td><td>{dollars(p.providerUsd)}</td><td>{dollars(p.differenceUsd)}</td><td>{p.unpriced.toLocaleString("en-US")}</td></tr>)}</tbody></table></div></>}
    {(snapshot?.readings ?? []).map(r => <details key={r.provider} className={s.inset}>
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
