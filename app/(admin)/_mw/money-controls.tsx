"use client";

/**
 * **THE MONEY SCREEN'S CONTROLS, THROUGH THE ONE GATEWAY DOOR.** (Admin
 * redesign, 2026-09-23.)
 *
 * ```
 *   CeilingDial      the Fleet spend dial, moved here unchanged: the same
 *                    `config.setFleetSpendCeiling` action, input, validation and
 *                    fetch → JSON → refresh path it has had since #336
 *   DiscoverySearchSwitch
 *                    the owner's switch for PAID discovery search, on the
 *                    search line → `config.setDiscoverySearch`. Off by default;
 *                    turning it on is said twice
 *   BillingEntry     a figure read where the system cannot look, or a usage
 *                    export summed in the browser → `billing.fact.record`
 *   RemoveFact       → `billing.fact.remove`
 * ```
 *
 * Every control posts JSON with `Accept: application/json` and refreshes the
 * server render on success, so the row it changed is read back from the store
 * rather than drawn from what was typed. A plain form post would answer with a
 * redirect built from the request URL, which on the host lands on the wrong
 * domain; this path returns a body and no redirect.
 */
import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  CADENCES,
  KIND_WORDS,
  PROVIDER_DEFINITIONS,
  providerDefinition,
  type BillingFactKind,
  type BillingProvider,
} from "@/lib/control-plane/billing-facts.ts";

import s from "./mw.module.css";

const ACTION_ROUTE = "/api/admin/action";

type Sent = { readonly ok: boolean; readonly says: string } | null;

async function post(type: string, subject: string, input: Record<string, unknown>, key: string, returnTo: string): Promise<{ ok: boolean; says: string }> {
  try {
    const res = await fetch(ACTION_ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ type, subject, input, idempotencyKey: key, returnTo }),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; receipt?: { says?: string } } | null;
    if (!res.ok || body?.ok === false) return { ok: false, says: body?.receipt?.says ?? `Nothing was recorded. The server answered ${res.status}.` };
    return { ok: true, says: body?.receipt?.says ?? "Recorded." };
  } catch (e) {
    return { ok: false, says: e instanceof Error ? `Nothing was recorded: ${e.message}` : "The console could not reach the server; nothing was recorded." };
  }
}

/* ==================================================================== *
 * THE SPEND DIAL
 * ==================================================================== */

export function CeilingDial(props: { readonly currentUsd: number; readonly maxUsd: number; readonly returnTo: string }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(props.currentUsd));
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Sent>(null);

  async function submit() {
    const parsed = Number(value.trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setSent({ ok: false, says: "Enter a dollar amount greater than $0 — to stop the Fleet, pause the runner instead." });
      return;
    }
    setSending(true);
    setSent(null);
    // A nonce per submit, never the value alone: a value-keyed key would dedup a
    // deliberate re-set of a previously-set amount and silently keep the newer one.
    const out = await post("config.setFleetSpendCeiling", "fleet spend ceiling", { rollingCeilingUsd: parsed }, `set-fleet-ceiling:${parsed}:${Date.now()}`, props.returnTo);
    setSending(false);
    setSent(out);
    if (out.ok) router.refresh();
  }

  if (!open) {
    return (
      <button type="button" className={s.btnLink} onClick={() => setOpen(true)}>
        Change the ceiling
      </button>
    );
  }
  return (
    <div className={s.stack8}>
      <div className={s.row10}>
        <label htmlFor={id} className={s.label}>
          New rolling 24-hour ceiling ($)
        </label>
        <input
          id={id}
          className={s.input}
          type="number"
          min={1}
          max={props.maxUsd}
          step="1"
          inputMode="decimal"
          value={value}
          disabled={sending}
          onChange={(e) => setValue(e.target.value)}
          aria-label="New rolling 24-hour spend ceiling in US dollars"
        />
        <button type="button" className={s.btnPrimary} disabled={sending} onClick={() => void submit()}>
          {sending ? "Setting…" : "Set the spend ceiling"}
        </button>
        <button type="button" className={s.btnSecondary} disabled={sending} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <span className={s.note}>
        The runner reads it at the start of its next cycle. Raising it removes a brake; it starts no run and opens no paid lane.
      </span>
      {sent && <span className={sent.ok ? s.cTeal : s.refusal}>{sent.says}</span>}
    </div>
  );
}

/* ==================================================================== *
 * THE PAID DISCOVERY SEARCH SWITCH
 * ==================================================================== */

/**
 * The owner's switch for paid discovery search (Brave and Exa). The runner reads
 * it at the start of each cycle and builds no search step unless it is on; the
 * free site walks run either way. Turning it ON spends money, so that direction
 * asks again before it posts.
 */
export function DiscoverySearchSwitch(props: {
  readonly on: boolean;
  readonly decidedWords: string | null;
  /** The runner's acknowledgement, in words the server composed from its heartbeat. */
  readonly acknowledgement: string;
  readonly returnTo: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Sent>(null);

  async function set(enabled: boolean) {
    setSending(true);
    setSent(null);
    const out = await post(
      "config.setDiscoverySearch",
      "paid discovery search",
      enabled ? { enabled: true, confirmed: true } : { enabled: false },
      `set-discovery-search:${enabled ? "on" : "off"}:${Date.now()}`,
      props.returnTo,
    );
    setSending(false);
    setConfirming(false);
    setSent(out);
    if (out.ok) router.refresh();
  }

  return (
    <div className={s.stack8}>
      <span className={s.note}>
        Paid discovery search is {props.on ? "on" : "off"}
        {props.decidedWords ? ` (you set it ${props.decidedWords}).` : " (the default)."} It runs only while this is on, and then only
        inside the runner&apos;s caps. The research pause does not stop it; only this switch does. The free site walks run either way.
      </span>
      <span className={s.note}>{props.acknowledgement}</span>
      {props.on ? (
        <button type="button" className={s.btnSecondary} disabled={sending} onClick={() => void set(false)}>
          {sending ? "Turning it off…" : "Turn paid discovery search off"}
        </button>
      ) : confirming ? (
        <div className={s.row10}>
          <button type="button" className={s.btnPrimary} disabled={sending} onClick={() => void set(true)}>
            {sending ? "Turning it on…" : "Yes, allow paid discovery search"}
          </button>
          <button type="button" className={s.btnSecondary} disabled={sending} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className={s.btnLink} onClick={() => setConfirming(true)}>
          Allow paid discovery search
        </button>
      )}
      {sent && <span className={sent.ok ? s.cTeal : s.refusal}>{sent.says}</span>}
    </div>
  );
}

/* ==================================================================== *
 * A BILLING FIGURE
 * ==================================================================== */

const PERIOD_KINDS: readonly BillingFactKind[] = ["BILLED", "MONTH_TO_DATE", "USAGE_IMPORT"];

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** One CSV row into fields, honouring quotes. Enough for a provider's usage export; not a general parser. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

interface Parsed {
  readonly fileName: string;
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

function money(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw.replace(/[$,\s]/g, ""));
  return raw.trim() !== "" && Number.isFinite(n) ? n : null;
}

function isoDay(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = /(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (m) return m[1];
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

export function BillingEntry(props: { readonly returnTo: string; readonly initialProvider?: BillingProvider }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [provider, setProvider] = useState<BillingProvider>(props.initialProvider ?? "anthropic-api");
  const def = providerDefinition(provider);
  const [kind, setKind] = useState<BillingFactKind>(def.kinds[0]);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [cadence, setCadence] = useState<string>("MONTHLY");
  const [renewsOn, setRenewsOn] = useState("");
  const [asOf, setAsOf] = useState(todayUtc());
  const [source, setSource] = useState("");
  const [csv, setCsv] = useState<Parsed | null>(null);
  const [amountCol, setAmountCol] = useState(-1);
  const [dateCol, setDateCol] = useState(-1);
  const [sent, setSent] = useState<Sent>(null);

  const imported = useMemo(() => {
    if (!csv || amountCol < 0) return null;
    let total = 0;
    let counted = 0;
    let first: string | null = null;
    let last: string | null = null;
    for (const row of csv.rows) {
      const n = money(row[amountCol]);
      if (n === null) continue;
      total += n;
      counted++;
      const day = dateCol >= 0 ? isoDay(row[dateCol]) : null;
      if (day) {
        if (first === null || day < first) first = day;
        if (last === null || day > last) last = day;
      }
    }
    return { total: Math.round(total * 100) / 100, counted, skipped: csv.rows.length - counted, first, last };
  }, [csv, amountCol, dateCol]);

  function chooseProvider(next: BillingProvider) {
    setProvider(next);
    setKind(providerDefinition(next).kinds[0]);
    setSent(null);
    setCsv(null);
  }

  async function readFile(file: File) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length < 2) {
      setSent({ ok: false, says: "That file has no rows under its header." });
      return;
    }
    const header = splitCsvLine(lines[0]);
    const rows = lines.slice(1).map(splitCsvLine);
    setCsv({ fileName: file.name.slice(0, 120), header, rows });
    setAmountCol(header.findIndex((h) => /cost|amount|usd|price|spend|total/i.test(h)));
    setDateCol(header.findIndex((h) => /date|day|time|period/i.test(h)));
    setSent(null);
  }

  function applyImport() {
    if (!imported || !csv) return;
    setAmount(imported.total.toFixed(2));
    if (imported.first) setPeriodStart(imported.first);
    if (imported.last) setPeriodEnd(imported.last);
    if (source.trim() === "") setSource(`${def.name} usage export`);
  }

  function submit() {
    const input: Record<string, unknown> = { provider, kind, amountUsd: amount, asOf, source, label: label.trim() === "" ? null : label };
    if (PERIOD_KINDS.includes(kind)) {
      input.periodStart = periodStart;
      input.periodEnd = periodEnd;
    }
    if (kind === "SUBSCRIPTION" || kind === "LIMIT") input.cadence = cadence;
    if (kind === "SUBSCRIPTION") input.renewsOn = renewsOn === "" ? null : renewsOn;
    if (kind === "USAGE_IMPORT" && csv && imported) input.imported = { fileName: csv.fileName, rows: imported.counted };
    setSent(null);
    startTransition(async () => {
      const out = await post("billing.fact.record", "a billing figure", input, `billing:${provider}:${kind}:${Date.now()}`, props.returnTo);
      setSent(out);
      if (out.ok) {
        setAmount("");
        setCsv(null);
        router.refresh();
      }
    });
  }

  const cadences = kind === "LIMIT" ? CADENCES.filter((c) => c !== "ANNUAL") : CADENCES.filter((c) => c !== "DAILY");
  const idBase = useId();
  return (
    <div className={s.stack14}>
      <div className={s.composerGrid}>
        <label className={s.stack6} htmlFor={`${idBase}-p`}>
          <span className={s.label}>Provider</span>
          <select id={`${idBase}-p`} className={s.select} value={provider} onChange={(e) => chooseProvider(e.target.value as BillingProvider)} disabled={pending}>
            {PROVIDER_DEFINITIONS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className={s.stack6} htmlFor={`${idBase}-k`}>
          <span className={s.label}>What kind of figure</span>
          <select
            id={`${idBase}-k`}
            className={s.select}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as BillingFactKind);
              setCadence(e.target.value === "LIMIT" ? "DAILY" : "MONTHLY");
            }}
            disabled={pending}
          >
            {def.kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_WORDS[k]}
              </option>
            ))}
          </select>
        </label>
        {(def.needsLabel || kind === "SUBSCRIPTION") && (
          <label className={s.stack6} htmlFor={`${idBase}-l`}>
            <span className={s.label}>{def.needsLabel ? "Which product" : "Plan name (optional)"}</span>
            <input id={`${idBase}-l`} className={s.inputText} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} disabled={pending} />
          </label>
        )}
        <label className={s.stack6} htmlFor={`${idBase}-a`}>
          <span className={s.label}>Amount (US dollars)</span>
          <input id={`${idBase}-a`} className={s.inputText} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={pending} />
        </label>
        {PERIOD_KINDS.includes(kind) && (
          <>
            <label className={s.stack6} htmlFor={`${idBase}-ps`}>
              <span className={s.label}>Period starts</span>
              <input id={`${idBase}-ps`} className={s.inputText} type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} disabled={pending} />
            </label>
            <label className={s.stack6} htmlFor={`${idBase}-pe`}>
              <span className={s.label}>Period ends</span>
              <input id={`${idBase}-pe`} className={s.inputText} type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} disabled={pending} />
            </label>
          </>
        )}
        {(kind === "SUBSCRIPTION" || kind === "LIMIT") && (
          <label className={s.stack6} htmlFor={`${idBase}-c`}>
            <span className={s.label}>{kind === "LIMIT" ? "The cap is" : "It bills"}</span>
            <select id={`${idBase}-c`} className={s.select} value={cadence} onChange={(e) => setCadence(e.target.value)} disabled={pending}>
              {cadences.map((c) => (
                <option key={c} value={c}>
                  {c === "DAILY" ? "Per day" : c === "MONTHLY" ? (kind === "LIMIT" ? "Per month" : "Monthly") : "Yearly"}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "SUBSCRIPTION" && (
          <label className={s.stack6} htmlFor={`${idBase}-r`}>
            <span className={s.label}>Renews on (optional)</span>
            <input id={`${idBase}-r`} className={s.inputText} type="date" value={renewsOn} onChange={(e) => setRenewsOn(e.target.value)} disabled={pending} />
          </label>
        )}
        <label className={s.stack6} htmlFor={`${idBase}-d`}>
          <span className={s.label}>The day you read it</span>
          <input id={`${idBase}-d`} className={s.inputText} type="date" value={asOf} max={todayUtc()} onChange={(e) => setAsOf(e.target.value)} disabled={pending} />
        </label>
        <label className={s.stack6} htmlFor={`${idBase}-s`}>
          <span className={s.label}>Where you read it</span>
          <input
            id={`${idBase}-s`}
            className={s.inputText}
            value={source}
            maxLength={200}
            placeholder="The console page, the invoice or the export"
            onChange={(e) => setSource(e.target.value)}
            disabled={pending}
          />
        </label>
      </div>

      {kind === "USAGE_IMPORT" && (
        <div className={s.insetBox}>
          <div className={s.stack10}>
            <span className={s.titleStrong14}>Import the usage export</span>
            <span className={s.note}>
              The file is read in this browser and only its total, its row count and its date range are recorded — never the file itself.
            </span>
            <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])} disabled={pending} />
            {csv && (
              <div className={s.stack8}>
                <div className={s.row10}>
                  <label className={s.stack6}>
                    <span className={s.label}>Amount column</span>
                    <select className={s.select} value={amountCol} onChange={(e) => setAmountCol(Number(e.target.value))}>
                      <option value={-1}>— choose —</option>
                      {csv.header.map((h, i) => (
                        <option key={`${h}-${i}`} value={i}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={s.stack6}>
                    <span className={s.label}>Date column</span>
                    <select className={s.select} value={dateCol} onChange={(e) => setDateCol(Number(e.target.value))}>
                      <option value={-1}>— none —</option>
                      {csv.header.map((h, i) => (
                        <option key={`${h}-${i}`} value={i}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {imported && (
                  <span className={s.text14}>
                    {csv.fileName}: ${imported.total.toFixed(2)} across {imported.counted.toLocaleString("en-US")} rows
                    {imported.skipped > 0 ? ` (${imported.skipped.toLocaleString("en-US")} rows had no amount and were not counted)` : ""}
                    {imported.first && imported.last ? `, ${imported.first} to ${imported.last}` : ", with no dates read"}.{" "}
                    <button type="button" className={s.btnLink} onClick={applyImport}>
                      Use these figures
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className={s.row10}>
        <button type="button" className={s.btnPrimary} disabled={pending} onClick={submit}>
          {pending ? "Recording…" : "Record this figure"}
        </button>
        <span className={s.note}>
          {def.fallback}. Entering the same provider, kind and period again corrects it rather than adding a second figure.
        </span>
      </div>
      {sent && <span className={sent.ok ? s.cTeal : s.refusal}>{sent.says}</span>}
    </div>
  );
}

export function RemoveFact(props: { readonly id: string; readonly returnTo: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState<Sent>(null);
  return (
    <span className={s.row10}>
      <button
        type="button"
        className={s.btnLink}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const out = await post("billing.fact.remove", "a billing figure", { id: props.id }, `billing-remove:${Date.now()}`, props.returnTo);
            setSent(out);
            if (out.ok) router.refresh();
          })
        }
      >
        {pending ? "Removing…" : "Remove"}
      </button>
      {sent && !sent.ok && <span className={s.refusal}>{sent.says}</span>}
    </span>
  );
}
