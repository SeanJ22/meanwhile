/**
 * The recipe menu: every number on any screen is one small named recipe.
 *
 * To add a number, add one object to `RECIPES` below. Nothing else changes: the one read (`read.ts`) finds it by id, checks
 * the switch, cuts the slice, runs it and rebuilds the result from its shape's fields only; Admin lists it from the same array.
 * A recipe is `{ id, label, says, shape, source, run }`:
 *
 *  - `shape` is what comes out: `totals` (named numbers), `words` (a word cloud) or `verbatim` (people's own words).
 *  - `source` is what it runs over. `totals` rows are the store's cheap exact counts by day or week, place, topic and type
 *    (one query, no events read). `cohorts` rows say how many readers were new in each period. `events` are the captured
 *    events themselves, for anything that needs a card, a residency stamp or the words.
 *  - `run` is plain code over that input and the slice. It returns `totals(...)`, `words(...)` or `verbatim(...)`, whatever it
 *    puts in is rebuilt by field in `leavable()`, and a recipe that returns the wrong shape is refused.
 *
 * Recipes see the day an event happened, never the time, and may use the anonymous reader hash to count distinct people. None
 * of them can return it: no result shape has a field for it.
 */
import type { CapturedEvent, CohortRow, ResultBody, Slice, TotalsEntry, TotalsRow, VerbatimEntry, WordEntry } from "./types.ts";
import { districtLabel, periodOf, topicLabel } from "./slice.ts";

interface RecipeBase {
  /** Lowercase letters, digits and hyphens. The switch and the dashboard name a recipe by this. */
  readonly id: string;
  readonly label: string;
  /** One plain sentence: what this number is. Shown in Admin beside its switch. */
  readonly says: string;
}
export type Recipe =
  | (RecipeBase & { readonly shape: ResultBody["shape"]; readonly source: "totals"; readonly by?: "zip" | "district"; readonly run: (rows: readonly TotalsRow[], slice: Slice) => ResultBody })
  | (RecipeBase & { readonly shape: ResultBody["shape"]; readonly source: "cohorts"; readonly run: (rows: readonly CohortRow[], slice: Slice) => ResultBody })
  | (RecipeBase & { readonly shape: ResultBody["shape"]; readonly source: "events"; readonly run: (events: readonly CapturedEvent[], slice: Slice) => ResultBody });

/* ------------------------------------------------------------------------------------------------------ helpers */

const totals = (rows: readonly TotalsEntry[]): ResultBody => ({ shape: "totals", rows });
const words = (rows: readonly WordEntry[]): ResultBody => ({ shape: "words", rows });
const verbatim = (rows: readonly VerbatimEntry[]): ResultBody => ({ shape: "verbatim", rows });
const pct = (part: number, whole: number): number | null => (whole <= 0 ? null : Math.round((part / whole) * 1000) / 10);
const entry = (e: Partial<TotalsEntry> & Pick<TotalsEntry, "label" | "value">): TotalsEntry => ({ period: null, series: null, percent: null, readers: null, ...e });

/** Newest period first, then biggest first, then by name: the same order every time. */
const byPeriodThenValue = (a: TotalsEntry, b: TotalsEntry) =>
  (b.period ?? "").localeCompare(a.period ?? "") || b.value - a.value || a.label.localeCompare(b.label) || (a.series ?? "").localeCompare(b.series ?? "");

/** Sum totals rows into one number per (period, key); `readers` is kept only when one row stood alone, since readers cannot be added across groups. */
function sumRows(rows: readonly TotalsRow[], key: (row: TotalsRow) => string | null): Map<string, { period: string; key: string; events: number; users: number; merged: number }> {
  const out = new Map<string, { period: string; key: string; events: number; users: number; merged: number }>();
  for (const row of rows) {
    const k = key(row);
    if (k === null) continue;
    const id = `${row.period}\u0000${k}`;
    const at = out.get(id) ?? { period: row.period, key: k, events: 0, users: 0, merged: 0 };
    at.events += row.events;
    at.users += row.users;
    at.merged += 1;
    out.set(id, at);
  }
  return out;
}
const readersOf = (g: { users: number; merged: number }): number | null => (g.merged === 1 ? g.users : null);

function distinctReaders(events: readonly CapturedEvent[], key: (e: CapturedEvent) => string | null): Map<string, { events: number; readers: Set<string> }> {
  const out = new Map<string, { events: number; readers: Set<string> }>();
  for (const e of events) {
    const k = key(e);
    if (k === null) continue;
    const at = out.get(k) ?? { events: 0, readers: new Set<string>() };
    at.events += 1;
    at.readers.add(e.reader);
    out.set(k, at);
  }
  return out;
}

/** What each reaction value means for a name. Funding and contribution scales share the like/dislike ends. */
const SUPPORT = new Set(["YES", "LOVE", "LIKE"]);
const OPPOSE = new Set(["NO", "DISLIKE", "HATE"]);
const sideOf = (reaction: string | null): "Support" | "Oppose" | "Not sure" | null =>
  reaction === null ? null : SUPPORT.has(reaction.toUpperCase()) ? "Support" : OPPOSE.has(reaction.toUpperCase()) ? "Oppose" : "Not sure";

const STOP = new Set(("a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for " +
  "from further get got had has have having he her here hers him his how i if in into is it its just like me more most my no nor not now of off on once only or other our out over own " +
  "same she should so some such than that the their them then there these they this those through to too under until up us very was we were what when where which while who whom " +
  "why will with would you your yours tell whats").split(" "));
const WORD = /[a-z][a-z']{2,29}/g;

/** The distinct words in a text: lowercased, three letters or more, without the common small words. */
export function wordsIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.toLowerCase().matchAll(WORD)) {
    const word = match[0].replace(/'s$/, "").replace(/^'+|'+$/g, "");
    if (word.length >= 3 && !STOP.has(word)) out.add(word);
  }
  return out;
}

export const WORD_CLOUD_LIMIT = 100;
export const VERBATIM_LIMIT = 200;

/* ------------------------------------------------------------------------------------------------------ the menu */

export const RECIPES: readonly Recipe[] = [
  {
    id: "topic-share",
    label: "Share of questions by topic",
    says: "Of the questions asked in each day or week, the share that fell under each topic.",
    shape: "totals",
    source: "totals",
    run(rows) {
      const asks = rows.filter((r) => r.type === "ASK");
      const whole = sumRows(asks.filter((r) => r.topic === "*"), () => "*");
      return totals([...sumRows(asks.filter((r) => r.topic !== "*"), (r) => r.topic).values()].map((g) =>
        entry({ period: g.period, label: topicLabel(g.key), value: g.events, percent: pct(g.events, whole.get(`${g.period}\u0000*`)?.events ?? 0), readers: readersOf(g) })).sort(byPeriodThenValue));
    },
  },
  {
    id: "topic-vs-free-form",
    label: "Questions in a topic and free-form",
    says: "How many questions were sorted into a topic and how many stayed free-form, by day or week.",
    shape: "totals",
    source: "totals",
    run(rows) {
      const asks = rows.filter((r) => r.type === "ASK" && r.topic !== "*");
      const g = sumRows(asks, (r) => (r.topic === "free-form" ? "Free-form" : "In a topic"));
      const whole = new Map<string, number>();
      for (const v of g.values()) whole.set(v.period, (whole.get(v.period) ?? 0) + v.events);
      return totals([...g.values()].map((v) => entry({ period: v.period, label: v.key, value: v.events, percent: pct(v.events, whole.get(v.period) ?? 0) })).sort(byPeriodThenValue));
    },
  },
  {
    id: "events-by-type",
    label: "Events recorded by type",
    says: "How many of each kind of event were recorded each day or week: questions, ZIP views, card opens, reactions and the rest.",
    shape: "totals",
    source: "totals",
    run(rows) {
      return totals([...sumRows(rows.filter((r) => r.topic === "*" && r.type !== "*"), (r) => r.type).values()].map((g) =>
        entry({ period: g.period, label: g.key, value: g.events, readers: readersOf(g) })).sort(byPeriodThenValue));
    },
  },
  {
    id: "usage-by-district",
    label: "Usage by district",
    says: "Events and distinct readers in each congressional or legislative district, so one state's districts can sit beside another's.",
    shape: "totals",
    source: "totals",
    by: "district",
    run(rows) {
      const g = sumRows(rows.filter((r) => r.topic === "*" && r.type === "*" && r.district !== null), (r) => r.district);
      const whole = new Map<string, number>();
      for (const v of g.values()) whole.set(v.period, (whole.get(v.period) ?? 0) + v.events);
      return totals([...g.values()].map((v) => entry({ period: v.period, label: districtLabel(v.key), series: v.key, value: v.events, percent: pct(v.events, whole.get(v.period) ?? 0), readers: readersOf(v) })).sort(byPeriodThenValue));
    },
  },
  {
    id: "new-vs-returning",
    label: "New and returning readers",
    says: "In each day or week, how many readers had never been seen before and how many had.",
    shape: "totals",
    source: "cohorts",
    run(rows) {
      const out: TotalsEntry[] = [];
      for (const r of rows) {
        out.push(entry({ period: r.period, label: "New readers", value: r.newReaders, percent: pct(r.newReaders, r.readers), readers: r.newReaders }));
        out.push(entry({ period: r.period, label: "Returning readers", value: r.readers - r.newReaders, percent: pct(r.readers - r.newReaders, r.readers), readers: r.readers - r.newReaders }));
      }
      return totals(out.sort(byPeriodThenValue));
    },
  },
  {
    id: "support-vs-oppose",
    label: "Support and oppose, per name",
    says: "For each person or measure readers reacted to, how many reactions were for it, against it, or unsure, with the distinct readers behind each.",
    shape: "totals",
    source: "events",
    run(events) {
      const g = distinctReaders(events.filter((e) => e.type === "REACTION" && e.cardId !== null && sideOf(e.reaction) !== null), (e) => JSON.stringify([e.cardId, sideOf(e.reaction)]));
      const named = new Map<string, number>();
      for (const [k, v] of g) { const card = (JSON.parse(k) as string[])[0]; named.set(card, (named.get(card) ?? 0) + v.events); }
      return totals([...g].map(([k, v]) => {
        const [card, side] = JSON.parse(k) as string[];
        return entry({ label: cardLabel(card), series: side, value: v.events, percent: pct(v.events, named.get(card) ?? 0), readers: v.readers.size });
      }).sort(byPeriodThenValue));
    },
  },
  {
    id: "residents-vs-outsiders",
    label: "Residents and outsiders",
    says: "How much of the use came from readers looking at their own ZIP and how much from readers looking at somewhere else.",
    shape: "totals",
    source: "events",
    run(events, slice) {
      const group = (e: CapturedEvent) => `${periodOf(e.day, slice.grain)}\u0000${e.residency === "HOME" ? "Residents" : e.residency === "UNKNOWN" ? "Not stamped" : "Outsiders"}`;
      const g = distinctReaders(events, group);
      const whole = new Map<string, number>();
      for (const [k, v] of g) whole.set(k.split("\u0000")[0], (whole.get(k.split("\u0000")[0]) ?? 0) + v.events);
      return totals([...g].map(([k, v]) => { const [period, label] = k.split("\u0000"); return entry({ period, label, value: v.events, percent: pct(v.events, whole.get(period) ?? 0), readers: v.readers.size }); }).sort(byPeriodThenValue));
    },
  },
  {
    id: "word-cloud",
    label: "Word cloud of what readers ask",
    says: "The words readers used most in their questions, counted by how many different readers used each.",
    shape: "words",
    source: "events",
    run(events) {
      const used = new Map<string, Set<string>>();
      for (const e of events) {
        if (e.type !== "ASK" || e.text === null) continue;
        for (const w of wordsIn(e.text)) (used.get(w) ?? used.set(w, new Set()).get(w)!).add(e.reader);
      }
      return words([...used].map(([word, readers]) => ({ word, readers: readers.size }))
        .sort((a, b) => b.readers - a.readers || a.word.localeCompare(b.word)).slice(0, WORD_CLOUD_LIMIT));
    },
  },
  {
    id: "verbatim-messages",
    label: "What readers typed, in their own words",
    says: "The questions readers typed, as they wrote them after personal details were removed, with the day and topic but never who or when.",
    shape: "verbatim",
    source: "events",
    run(events) {
      // Newest day first, then alphabetical: the order within a day says nothing about when or by whom.
      return verbatim(events.filter((e) => e.type === "ASK" && e.text !== null && e.text.trim() !== "")
        .map((e) => ({ day: e.day, topic: e.topic, place: e.zip ?? e.district, text: e.text!.trim() }))
        .sort((a, b) => b.day.localeCompare(a.day) || a.text.localeCompare(b.text) || (a.place ?? "").localeCompare(b.place ?? ""))
        .slice(0, VERBATIM_LIMIT));
    },
  },
];

/** "ocd-division/…/cd:7" is a district; any other card id becomes words ("jane-doe_ca12" → "Jane doe ca12"). */
function cardLabel(card: string): string {
  if (card.startsWith("ocd-division/")) return districtLabel(card);
  const tail = card.split(/[#/]/).filter(Boolean).pop() ?? card;
  const spoken = tail.replace(/[_+=.-]+/g, " ").trim();
  return spoken === "" ? card : spoken.charAt(0).toUpperCase() + spoken.slice(1);
}

export const recipeById = (id: string, book: readonly Recipe[] = RECIPES): Recipe | null => book.find((r) => r.id === id) ?? null;
