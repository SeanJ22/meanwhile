"use client";

/**
 * **ASK FOR SOMETHING NEW — the one instruction, one reference.** (Admin
 * redesign, 2026-09-23; the design's composer on Fleet · Work.)
 *
 * What it really does, in the system's own terms:
 *
 * ```
 *   Where        a Census geography: pick the kind first, then one of that
 *                kind. Changing the kind replaces the choices and clears the
 *                pick, so a county can never stay chosen under a district.
 *   the preview  the geography's real codes and the bodies reaching them,
 *                read before anything is sent (/api/admin/geography-preview),
 *                and per state how many governments a Send creates work for
 *                and whether a reviewed registry or registration names them
 *   Send it      `expansion.scope.set`: your geography, its priority, its
 *                rolling 24-hour budget for paid work there, and your words.
 *                At its next cycle the runner creates the work the registry
 *                defines there that no clock carries yet (MW-028, bounded per
 *                cycle and per geography), orders all work there first, and
 *                enforces the budget on paid research there.
 * ```
 *
 * The questions travel as their own typed field on `expansion.scope.set`
 * (MW-002): kept on the scope decision and recorded by the runner on every
 * obligation the Send reaches. The categories and stop rule have no command
 * that carries them; they are written into your words — kept, shown back, and
 * not acted on — and the panel says so before you send.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { DISPATCH_WORK_TARGET_CAP, DISPATCH_WORK_WRITE_BUDGET } from "@/lib/control-plane/expansion/dispatch-work-bounds.ts";
import { WORK_QUESTIONS, WORK_QUESTION_WORDS, type WorkQuestion } from "@/lib/control-plane/work-question.ts";

import { fnv } from "./fnv.ts";
import s from "./mw.module.css";
import { FigList, Pill } from "./ui.tsx";

export interface GeoOption {
  readonly type: string;
  readonly geoid: string;
  readonly version: string;
  readonly label: string;
  readonly stateAbbr: string;
}

export const KIND_WORDS: Readonly<Record<string, string>> = {
  county: "County",
  congressional_district: "Congressional district",
  cbsa: "Metro or micro area",
  state_leg_upper: "State senate district",
  state_leg_lower: "State house district",
};
const KINDS = Object.keys(KIND_WORDS);

interface CodeRow {
  readonly zcta5: string;
  readonly whole: boolean;
  readonly fraction: number | null;
  readonly indexed: boolean;
  readonly counts: { readonly bodies: number; readonly wayIn: number; readonly neverWalked: number; readonly lookedNoRoute: number } | null;
}
interface Preview {
  readonly ok: boolean;
  readonly says?: string;
  readonly codes?: readonly CodeRow[];
  readonly totals?: {
    readonly bodies: number;
    readonly wayIn: number;
    readonly neverWalked: number;
    readonly lookedNoRoute: number;
    readonly codes: number;
    readonly wholeCodes: number;
    readonly indexedCodes: number;
    readonly readerVisibleRecords: number | null;
    readonly watched: Readonly<Record<string, number>>;
  } | null;
  readonly totalsGap?: string | null;
  /** Per state the geography reaches: what a Send creates there, and whether a reviewed registry or registration names its governments. */
  readonly send?: {
    readonly states: readonly (
      | { readonly kind: "REVIEWED_REGISTRY"; readonly state: string }
      | { readonly kind: "REGISTRATION"; readonly state: string; readonly versionId: string; readonly governments: readonly string[]; readonly edge: readonly string[] }
      | { readonly kind: "NOT_READ"; readonly state: string; readonly why: string }
    )[];
    readonly says: readonly string[];
  };
}

/* MW-002: the six questions, in the gateway's own vocabulary — sent typed, never folded into the words. */
const QUESTIONS: readonly (readonly [WorkQuestion, string])[] = WORK_QUESTIONS.map((q) => [q, WORK_QUESTION_WORDS[q]] as const);
const CATEGORIES = [
  ["meetings", "Meetings and agendas"],
  ["bodies", "Governments and bodies"],
  ["elections", "Elections and candidates"],
  ["finance", "Campaign finance"],
  ["votes", "Legislative votes"],
] as const;
const STOPS = [
  ["budget", "When my budget is reached, then show me", true],
  ["first", "When the first useful thing is found", false],
  ["once", "When every body has been looked at once", false],
  ["never", "Keep going until I say stop", false],
] as const;

/** The gateway's limit on the note. */
const NOTE_MAX = 500;

function overlapWords(whole: boolean, fraction: number | null): string {
  if (whole) return "wholly inside";
  if (fraction === null) return "partly inside — whole code included";
  const p = Math.round(fraction * 100);
  return `${p < 1 ? "under 1" : p}% inside — whole code included`;
}

type Sent =
  | { readonly kind: "IDLE" }
  | { readonly kind: "SENDING" }
  | { readonly kind: "SAVED"; readonly receiptId: string; readonly at: string; readonly says: string; readonly key: string; readonly label: string }
  | { readonly kind: "FAILED"; readonly says: string };

export function Composer(props: {
  readonly states: readonly { readonly code: string; readonly name: string }[];
  readonly stateCode: string;
  readonly geographies: Readonly<Record<string, readonly GeoOption[]>>;
  readonly geographiesGap: string | null;
  readonly initial: { readonly type: string; readonly geoid: string } | null;
  readonly ceilingUsd: number;
  readonly paidLaneClosedBecause: string | null;
  readonly selected: Readonly<Record<string, { readonly priority: number; readonly budgetUsd: number }>>;
  readonly actionRoute: string;
  readonly previewRoute: string;
  /** Where a state change goes (a server round trip: each state's choices are read for it). */
  readonly stateHref: Readonly<Record<string, string>>;
  readonly workHref: string;
}) {
  const router = useRouter();
  // One nonce per page, made on the first send (never during render), so a retry of the same send dedupes.
  const nonceRef = useRef<string | null>(null);
  const nonce = (): string => (nonceRef.current ??= Math.random().toString(36).slice(2, 10));
  const [kind, setKind] = useState<string>(props.initial?.type ?? "");
  const [geoid, setGeoid] = useState<string>(props.initial?.geoid ?? "");
  // The preview for one geography; a key that does not match the choice is still loading, so nothing is set during an effect.
  const [preview, setPreview] = useState<{ readonly key: string; readonly p: Preview } | null>(null);
  const [questions, setQuestions] = useState<readonly WorkQuestion[]>([]);
  const [categories, setCategories] = useState<readonly string[]>([]);
  const [stop, setStop] = useState<string>("budget");
  const [budget, setBudget] = useState<string>("0");
  const [priority, setPriority] = useState<string>("1");
  const [words, setWords] = useState<string>("");
  const [sent, setSent] = useState<Sent>({ kind: "IDLE" });

  const options = kind ? props.geographies[kind] ?? [] : [];
  const chosen = options.find((o) => o.geoid === geoid) ?? null;
  const key = chosen ? `${chosen.type}|${chosen.geoid}` : "";

  useEffect(() => {
    if (key === "") return;
    const [type, id] = key.split("|");
    let live = true;
    fetch(`${props.previewRoute}?type=${encodeURIComponent(type)}&geoid=${encodeURIComponent(id)}`, { headers: { accept: "application/json" }, cache: "no-store" })
      .then((r) => r.json())
      .then((p: Preview) => {
        if (live) setPreview({ key, p });
      })
      .catch(() => {
        if (live) setPreview({ key, p: { ok: false, says: "The preview could not be read just now. Nothing about this geography is claimed until it is." } });
      });
    return () => {
      live = false;
    };
  }, [key, props.previewRoute]);

  const p = preview && preview.key === key ? preview.p : null;
  const t = p?.totals ?? null;
  const already = chosen ? props.selected[`${chosen.type}|${chosen.geoid}`] ?? null : null;
  const budgetNum = Number(budget);
  const priorityNum = Number(priority);
  const budgetOk = budget.trim() !== "" && Number.isFinite(budgetNum) && budgetNum >= 0 && budgetNum <= 10_000;
  const priorityOk = Number.isInteger(priorityNum) && priorityNum >= 1 && priorityNum <= 999;

  const composedNote = useMemo(() => {
    const parts: string[] = [];
    if (words.trim()) parts.push(words.trim());
    if (categories.length) parts.push(`Categories: ${CATEGORIES.filter(([id]) => categories.includes(id)).map(([, l]) => l).join(", ")}.`);
    const st = STOPS.find(([id]) => id === stop);
    if (st && stop !== "budget") parts.push(`Stop: ${st[1]}.`);
    return parts.join(" ");
  }, [words, categories, stop]);
  const questionsSent = useMemo(() => WORK_QUESTIONS.filter((q) => questions.includes(q)), [questions]);
  const noteTooLong = composedNote.length > NOTE_MAX;
  const canSend = chosen !== null && budgetOk && priorityOk && !noteTooLong && sent.kind !== "SENDING";

  async function send() {
    if (!chosen || !canSend) return;
    setSent({ kind: "SENDING" });
    try {
      const idempotencyKey = `scope:${chosen.geoid}:${fnv(`${priorityNum}|${budgetNum}|${composedNote}|${questionsSent.join(",")}`)}:${nonce()}`;
      const res = await fetch(props.actionRoute, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          type: "expansion.scope.set",
          subject: `${chosen.version}/${chosen.geoid}`,
          input: {
            geography: { type: chosen.type, geoid: chosen.geoid, version: chosen.version, label: chosen.label, stateAbbr: chosen.stateAbbr },
            priority: priorityNum,
            budgetUsd: budgetNum,
            note: composedNote === "" ? null : composedNote,
            questions: questionsSent,
          },
          idempotencyKey,
          returnTo: props.workHref,
        }),
      });
      const body = (await res.json().catch(() => null)) as { receipt?: { outcome?: string; says?: string; receiptId?: string; completedAt?: string } } | null;
      const r = body?.receipt;
      if (!res.ok || !r || r.outcome === "REFUSED") {
        setSent({ kind: "FAILED", says: r?.says ?? `The server answered ${res.status}. Nothing was saved.` });
        return;
      }
      setSent({ kind: "SAVED", receiptId: r.receiptId ?? idempotencyKey, at: r.completedAt ?? new Date().toISOString(), says: r.says ?? "Saved.", key: `scope:${chosen.version}/${chosen.geoid}`, label: chosen.label });
      router.refresh();
    } catch (e) {
      setSent({ kind: "FAILED", says: e instanceof Error ? `Nothing was saved: ${e.message}.` : "Nothing was saved." });
    }
  }

  /* Governments a Send here creates work for, where registration names them (the reviewed registries' count is the runner's). */
  const registrationStates = (p?.send?.states ?? []).filter((x) => x.kind === "REGISTRATION");
  const sendCount = registrationStates.length === 0 ? null : registrationStates.reduce((n, x) => n + x.governments.length, 0);
  const sendEdge = registrationStates.reduce((n, x) => n + x.edge.length, 0);
  const watchedNow = t ? Object.values(t.watched ?? {}).reduce((a, b) => a + b, 0) : 0;
  const stuck = t?.watched?.STUCK ?? 0;

  return (
    <div className={s.card} style={{ marginBottom: 32 }} id="composer">
      <h2 className={s.h2Inline} style={{ marginBottom: 4 }}>
        Ask for something new
      </h2>
      <p className={s.note} style={{ fontSize: 14, marginBottom: 22, maxWidth: "74ch" }}>
        One instruction, one reference. It puts the work already registered in a geography first and bounds what paid work may spend there — and it tells you
        exactly that before you send it.
      </p>
      <div className={s.composerGrid}>
        <div>
          <div className={s.label}>1 · Where</div>
          <div className={s.stack8}>
            <select
              className={`${s.select} ${s.selectWide}`}
              aria-label="State"
              value={props.stateCode}
              onChange={(e) => {
                const href = props.stateHref[e.target.value];
                if (href) router.push(href);
              }}
            >
              {props.states.map((st) => (
                <option key={st.code} value={st.code}>
                  {st.name}
                </option>
              ))}
            </select>
            <select
              className={`${s.select} ${s.selectWide}`}
              aria-label="Kind of geography"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setGeoid("");
                setPreview(null);
                setSent({ kind: "IDLE" });
              }}
            >
              <option value="">— choose a kind —</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_WORDS[k]}
                </option>
              ))}
            </select>
            <select
              className={`${s.select} ${s.selectWide}`}
              aria-label="Geography"
              value={geoid}
              disabled={kind === ""}
              onChange={(e) => {
                setGeoid(e.target.value);
                setSent({ kind: "IDLE" });
              }}
            >
              <option value="">{kind === "" ? "— choose a kind first —" : `— choose one of ${options.length} —`}</option>
              {options.map((o) => (
                <option key={o.geoid} value={o.geoid}>
                  {o.label}
                </option>
              ))}
            </select>
            {props.geographiesGap && <p className={s.goldNote}>{props.geographiesGap}</p>}
          </div>
          <div className={s.inset} style={{ marginTop: 14 }}>
            <div className={s.name14} style={{ fontSize: 13, marginBottom: 10 }}>
              The geographic scope you are about to send
            </div>
            {chosen === null ? (
              <p className={s.note}>Choose a kind, then a geography. Its codes and the bodies reaching them appear here before anything is sent.</p>
            ) : p === null ? (
              <p className={s.note} role="status">
                Reading {chosen.label}…
              </p>
            ) : !p.ok ? (
              <p className={s.goldNote}>{p.says}</p>
            ) : (
              <>
                <div className={s.stack8} style={{ maxHeight: 300, overflowY: "auto" }}>
                  {(p.codes ?? []).map((c) => (
                    <div key={c.zcta5} className={s.row10}>
                      <span className={s.monoText}>{c.zcta5}</span>
                      <span className={s.note} style={{ flex: "1 1 140px" }}>
                        {overlapWords(c.whole, c.fraction)}
                      </span>
                      <span className={s.mono}>{c.counts === null ? "not indexed" : `${c.counts.bodies} ${c.counts.bodies === 1 ? "body" : "bodies"}`}</span>
                    </div>
                  ))}
                </div>
                <p className={`${s.note} ${s.dividerTight}`}>
                  {t
                    ? `${t.codes} codes, ${t.wholeCodes} wholly inside; ${t.bodies} distinct bodies reach them, each counted once. A code partly inside is included whole — nothing is clipped to the boundary.${t.indexedCodes < t.codes ? ` ${t.codes - t.indexedCodes} codes are outside the ZIP index, so bodies reaching only those are not counted yet.` : ""}`
                    : typeof p.totalsGap === "string" && p.totalsGap !== ""
                      ? p.totalsGap
                      : "The preview returned no count of bodies, and no reason for it."}
                </p>
                {(p.send?.says ?? []).map((line) => (
                  <p key={line} className={s.note} style={{ marginTop: 8 }}>
                    {line}
                  </p>
                ))}
              </>
            )}
          </div>
          <div className={s.label} style={{ marginTop: 22 }}>
            In your own words
          </div>
          <textarea
            className={s.textarea}
            value={words}
            maxLength={NOTE_MAX}
            aria-label="Your instruction in your own words"
            placeholder="Every body here, whole codes where they overlap. Find what we do not have and catch changes."
            onChange={(e) => setWords(e.target.value)}
          />
        </div>

        <div>
          <div className={s.label}>2 · What it is for</div>
          <div className={s.rowCenter} style={{ gap: 8 }}>
            {QUESTIONS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`${s.chip} ${questions.includes(id) ? s.chipOn : ""}`}
                aria-pressed={questions.includes(id)}
                onClick={() => setQuestions((q) => (q.includes(id) ? q.filter((x) => x !== id) : [...q, id]))}
              >
                {label}
              </button>
            ))}
          </div>
          <p className={s.note} style={{ marginTop: 12 }}>
            Sent as the instruction&rsquo;s questions, and recorded by the runner on every piece of work it creates or puts first. They say what the instruction is for; they
            do not yet change how the work runs.
          </p>
          <div className={`${s.label} ${s.labelSpaced}`}>3 · Categories</div>
          <div className={s.rowCenter} style={{ gap: 8 }}>
            {CATEGORIES.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`${s.chip} ${categories.includes(id) ? s.chipOn : ""}`}
                aria-pressed={categories.includes(id)}
                onClick={() => setCategories((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))}
              >
                {label}
              </button>
            ))}
          </div>
          <p className={s.note} style={{ marginTop: 12 }}>
            Kept in your words too. The runner orders every kind of registered work in the geography, so a category narrows nothing yet.
          </p>
        </div>

        <div>
          <div className={s.label}>4 · What already exists here</div>
          <div className={s.inset}>
            {t ? (
              <FigList
                tight
                small
                lines={[
                  { key: "b", fig: String(t.bodies), text: "registered bodies in scope, each counted once across its codes" },
                  { key: "w", fig: String(t.wayIn), tone: "accent", text: "have a way in recorded" },
                  { key: "n", fig: String(t.neverWalked), tone: "gold", text: `have never been walked${t.lookedNoRoute ? `, and ${t.lookedNoRoute} were looked at with no route` : ""} — the work` },
                  { key: "m", fig: String(watchedNow), text: `are read on the standing clock now${stuck ? ` (${stuck} stuck)` : ""}` },
                  {
                    key: "r",
                    fig: t.readerVisibleRecords === null ? null : String(t.readerVisibleRecords),
                    unknown: "NOT READ",
                    tone: "teal",
                    text: "meetings here a reader was confirmed able to open",
                  },
                ]}
              />
            ) : (
              <p className={s.note}>{chosen ? "Counted once the geography is read." : "Choose a geography to see what already exists in it."}</p>
            )}
          </div>
          <div className={`${s.label} ${s.labelSpaced}`}>5 · When to stop, and what it may spend</div>
          <div className={s.stack6}>
            {STOPS.map(([id, label, enforced]) => (
              <button key={id} type="button" className={`${s.rowChoice} ${stop === id ? s.rowChoiceOn : ""}`} aria-pressed={stop === id} onClick={() => setStop(id)}>
                {label}
                {enforced ? "" : " — kept in your words only"}
              </button>
            ))}
          </div>
          <div className={s.rowCenter} style={{ marginTop: 14 }}>
            <span className={s.dollar}>$</span>
            <input className={s.input} value={budget} inputMode="decimal" aria-label="Budget for paid work, rolling 24 hours" onChange={(e) => setBudget(e.target.value)} />
            <span className={s.note}>most paid work here may spend in any rolling 24 hours</span>
          </div>
          <div className={s.rowCenter} style={{ marginTop: 10 }}>
            <input className={s.input} style={{ width: 70 }} value={priority} inputMode="numeric" aria-label="Priority (1 runs first)" onChange={(e) => setPriority(e.target.value)} />
            <span className={s.note}>priority — 1 runs first among your geographies</span>
          </div>
          <p className={s.goldNote}>
            Enforced by the runner: once paid research in this geography has spent this much in a rolling 24 hours, it is held back there. The ${props.ceilingUsd.toFixed(2)} ceiling
            inside the application still binds first, over everything. Plain-code reads are free and never limited by it.
            {!budgetOk ? " Enter an amount from $0 to $10,000." : ""}
            {!priorityOk ? " Priority is a whole number from 1 to 999." : ""}
          </p>
        </div>
      </div>

      <div className={s.divider} style={{ marginTop: 24 }}>
        <h3 className={s.titleStrong} style={{ margin: "0 0 14px" }}>
          What pressing send does
        </h3>
        <div className={s.stack10}>
          <div className={s.row}>
            <Pill tone="slate">CREATES MISSING WORK</Pill>
            <span className={`${s.note} ${s.growWide}`} style={{ fontSize: 14 }}>
              At its next cycle the runner creates the work the registry defines here that no clock carries yet — at most {DISPATCH_WORK_WRITE_BUDGET} a cycle and{" "}
              {DISPATCH_WORK_TARGET_CAP.toLocaleString("en-US")} for this geography — and counts what it created, reordered and could not reach. It invents nothing no
              registry defines: a state&apos;s governments come from its reviewed registry, or where it has none from its registration (the 2022 Census of Governments),
              and a state whose registration cannot be read is named as blocked.
              {sendCount !== null
                ? ` Here that is ${sendCount} ${sendCount === 1 ? "government" : "governments"} from registration${sendEdge > 0 ? `, and up to ${sendEdge} more at the edge` : ""}.`
                : ""}
              {t && t.neverWalked > 0 ? ` ${t.neverWalked} bodies here have never been walked; finding a way in is paid research` : " Finding a way in to a body is paid research"}
              {props.paidLaneClosedBecause ? `, and that lane is ${props.paidLaneClosedBecause}` : ", which this budget bounds."}
            </span>
          </div>
          <div className={s.row}>
            <Pill tone="cyan">MOVES EXISTING WORK</Pill>
            <span className={`${s.note} ${s.growWide}`} style={{ fontSize: 14 }}>
              From its next cycle the runner puts the standing work about governments in this geography ahead of the rest, at priority {priorityOk ? priorityNum : "—"}. It
              counts that work when it reads the instruction, and the acknowledgement below shows the count.
            </span>
          </div>
          {stuck > 0 && (
            <div className={s.row}>
              <Pill tone="amber">NEEDS ENGINEERING</Pill>
              <span className={`${s.note} ${s.growWide}`} style={{ fontSize: 14 }}>
                {stuck} {stuck === 1 ? "body we read here is" : "bodies we read here are"} stuck — the source refuses the read or lists nothing. Fixing a source is engineering
                work; ordering it first does not fix it.
              </span>
            </div>
          )}
          <div className={s.row}>
            <Pill tone={budgetNum === 0 ? "gold" : "teal"}>{budgetNum === 0 ? "HOLDS ALL PAID WORK" : "BUDGET ENFORCED"}</Pill>
            <span className={`${s.note} ${s.growWide}`} style={{ fontSize: 14 }}>
              {budgetOk
                ? budgetNum === 0
                  ? "A $0 budget holds back every paid research call in this geography; plain-code work still runs."
                  : `Your $${budgetNum.toFixed(2)} is enforced on paid research here, in any rolling 24 hours. The $${props.ceilingUsd.toFixed(2)} ceiling over everything binds first.`
                : "Enter a budget to see what it enforces."}
            </span>
          </div>
          {already && (
            <div className={s.row}>
              <Pill tone="slate">ALREADY AN ASSIGNMENT</Pill>
              <span className={`${s.note} ${s.growWide}`} style={{ fontSize: 14 }}>
                This geography is already on your list at priority {already.priority} with ${already.budgetUsd.toFixed(2)}; sending changes it, and the earlier values stay on the
                record.
              </span>
            </div>
          )}
          {questions.length > 0 && (
            <div className={s.row}>
              <Pill tone="teal">YOUR QUESTIONS GO WITH IT</Pill>
              <span className={`${s.note} ${s.growWide}`} style={{ fontSize: 14 }}>
                {questions.length === 1 ? "Your question is" : `Your ${questions.length} questions are`} sent as their own field, kept on the instruction and recorded on every
                piece of work it reaches. They do not yet change how the work runs.
              </span>
            </div>
          )}
          {(categories.length > 0 || stop !== "budget") && (
            <div className={s.row}>
              <Pill tone="stone">KEPT IN YOUR WORDS</Pill>
              <span className={`${s.note} ${s.growWide}`} style={{ fontSize: 14 }}>
                Your categories and stop rule are written into your words ({composedNote.length} of {NOTE_MAX} characters) and not acted on.
                {noteTooLong ? " That is too long to send — shorten your words." : ""}
              </span>
            </div>
          )}
        </div>
        <div className={s.actions} style={{ marginTop: 20 }}>
          <button type="button" className={s.btnPrimary} disabled={!canSend} onClick={() => void send()}>
            {sent.kind === "SENDING" ? "Sending…" : "Send it"}
          </button>
          {sent.kind !== "IDLE" && sent.kind !== "SENDING" && (
            <button type="button" className={s.btnSecondary} onClick={() => setSent({ kind: "IDLE" })}>
              Clear the acknowledgement
            </button>
          )}
        </div>
        {sent.kind === "FAILED" && (
          <p className={s.goldNote} role="alert">
            Not saved. {sent.says}
          </p>
        )}
        {sent.kind === "SAVED" && (
          <div className={s.accentBox} role="status">
            <div className={s.row} style={{ marginBottom: 6 }}>
              <Pill tone="slate">SAVED</Pill>
              <strong className={s.titleStrong16}>Saved — the runner has not read it yet</strong>
              <span className={`${s.mono} ${s.pushRight}`}>{sent.receiptId}</span>
            </div>
            <p className={s.note} style={{ fontSize: 14, marginBottom: 18, maxWidth: "76ch" }}>
              The confirmation is the proof, not the button press. Each fact below gets its own time when it happens — an instruction saved is not an instruction running.
            </p>
            <div className={s.stack2}>
              {[
                { pill: "SAVED", tone: "slate" as const, text: sent.says, at: sent.at },
                { pill: "NOT YET READ", tone: "stone" as const, text: "The runner reads your list at the start of its next cycle. This page shows the time it did.", at: null },
                { pill: "NOT YET PLACED", tone: "stone" as const, text: "Placed first once the runner has resolved the geography; the count of work it moved appears then.", at: null },
                { pill: "NOT RUNNING", tone: "stone" as const, text: "Queued is not running, and neither is a claim about results.", at: null },
                ...(props.paidLaneClosedBecause ? [{ pill: "PARTLY BLOCKED", tone: "amber" as const, text: `Paid research here waits: the lane is ${props.paidLaneClosedBecause}`, at: new Date().toISOString() }] : []),
              ].map((f) => (
                <div key={f.pill} className={s.activityRow}>
                  <Pill tone={f.tone}>{f.pill}</Pill>
                  <span className={`${s.text14} ${s.grow}`}>{f.text}</span>
                  <span className={s.monoSmall}>{f.at ? new Date(f.at).toLocaleTimeString("en-US", { timeZone: "America/New_York" }) + " ET" : "—"}</span>
                </div>
              ))}
            </div>
            <div className={s.actions}>
              <Link href={`${props.workHref}${props.workHref.includes("?") ? "&" : "?"}open=${encodeURIComponent(sent.key)}#assignments`} className={s.btnPrimary}>
                Follow this assignment
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
