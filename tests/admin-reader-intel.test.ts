import assert from "node:assert/strict";
import test from "node:test";

import { assertAggregateOnly, auditRenderedNumbers, checkStatedEqualsRendered } from "../lib/control-plane/owner-surface.ts";
import {
  DEFAULT_READER_RUN_CLASS,
  DEFAULT_READER_WINDOW_DAYS,
  DETAIL_KEY_BY_EVENT,
  READER_RUN_CLASSES,
  READER_TOP_N,
  READER_WINDOW_CHOICES,
  READER_WORDS,
  censusCountFor,
  censusReconciles,
  countClaimsOf,
  impossibleNumbersIn,
  openReaderStore,
  readAsk,
  readReaderIntel,
  readerRunClassFromParam,
  readerWindow,
  readerWindowDaysFromParam,
  readerWord,
  renderedNumbersOf,
  scopeSentence,
  share,
  topListSentence,
  windowSentence,
  type ReaderStoreQuery,
} from "../lib/control-plane/reader-intel.ts";
import { SEARCH_LOG_EVENT_TYPES } from "../lib/db/search-log.ts";
import { organicDenominatorSentence } from "../lib/signal/search-log-reads.ts";
import { codeOf } from "./read-code.ts";

/**
 * Reader intelligence: the ORGANIC default excludes synthetic traffic, sensitive identity is not
 * joined, denominators are exact, and empty data renders honestly. The tests hand
 * `readReaderIntel` a recorded store and assert on the SQL it actually issued and on the projection.
 */

const MODULE_PATH = "lib/control-plane/reader-intel.ts";

/** The file's code with its comments blanked — an explanation of a rule is not a breach of it. */
function code(rel: string): string {
  return codeOf(rel);
}

const NOW = "2026-09-06T18:00:00.000Z";

/* ------------------------------------------------------------------ *
 * A RECORDED STORE
 * ------------------------------------------------------------------ */

interface Asked {
  readonly text: string;
  readonly values: readonly unknown[];
}

/** A store that answers from a plan and records every statement, with `$n` where a bound value went. */
function recordedStore(answer: (text: string, values: readonly unknown[]) => Record<string, unknown>[] | Error): {
  sql: ReaderStoreQuery;
  asked: Asked[];
} {
  const asked: Asked[] = [];
  const sql: ReaderStoreQuery = async (strings, ...values) => {
    const text = strings.reduce((out, part, i) => (i === 0 ? part : `${out}$${i}${part}`), "");
    asked.push({ text, values });
    const answered = answer(text, values);
    if (answered instanceof Error) throw answered;
    return answered;
  };
  return { sql, asked };
}

const CENSUS = { organic: 3, synthetic: 500, unknown: 40, author: 7, total: 550 };

/** A full, self-consistent reading: three organic search events, one reaction, one request. */
function fullPlan(text: string): Record<string, unknown>[] {
  if (text.includes("FROM search_log")) {
    if (text.includes("FILTER (WHERE run_class = 'ORGANIC')")) return [CENSUS];
    if (text.includes("GROUP BY event_type")) {
      return [
        { event_type: "SEARCH", n: 2 },
        { event_type: "BODY_OPENED", n: 1 },
      ];
    }
    if (text.includes("to_char(")) return [{ day: "2026-09-05", n: 1 }, { day: "2026-09-06", n: 2 }];
    if (text.includes("GROUP BY coverage_tier")) return [{ coverage_tier: "TIER_0", n: 3 }];
    if (text.includes("left(approximate_location, 3)")) {
      return [{ zip_area: "085", n: 3, distinct_keys: 1, keyed_rows: 3 }];
    }
    if (text.includes("approximate_location AS zip")) {
      return [{ zip: "08540", n: 3, distinct_keys: 1, keyed_rows: 3 }];
    }
    if (text.includes("jsonb_array_elements_text")) {
      return [
        { ocd_id: "ocd-division/country:us/state:nj", n: 3, distinct_keys: 2, keyed_rows: 5 },
        { ocd_id: "ocd-division/country:us/state:nj/county:mercer", n: 2, distinct_keys: 2, keyed_rows: 5 },
      ];
    }
    if (text.includes("detail->>'venueKey'")) {
      return [{ event_type: "BODY_OPENED", subject: "nj-mercer-princeton", n: 1, distinct_keys: 1, keyed_rows: 1 }];
    }
  }
  if (text.includes("FROM reactions")) {
    if (text.includes("FILTER (WHERE run_class = 'ORGANIC')")) return [CENSUS];
    if (text.includes("AS quarantined")) return [{ total: 2, clean: 1, quarantined: 1 }];
    if (text.includes("reaction AS choice")) {
      return [{ target_type: "CANDIDATE", scale_version: 1, choice: "YES", n: 1 }];
    }
    if (text.includes("verification_tier")) return [{ verification_tier: "ANONYMOUS", n: 1 }];
    if (text.includes("target_id")) {
      return [{ target_type: "CANDIDATE", target_id: "nj:2026:x", n: 1, distinct_keys: 1, keyed_rows: 1 }];
    }
  }
  if (text.includes("FROM demand_signals")) {
    if (text.includes("FILTER (WHERE run_class = 'ORGANIC')")) return [CENSUS];
    return [{ subject_id: "nj:county:county-of-mercer", n: 3, distinct_keys: 1, keyed_rows: 3 }];
  }
  if (text.includes("FROM ask_interactions")) return [{ n: 0 }];
  return [];
}

/** Nothing at all in the window, in any class. */
function emptyPlan(text: string): Record<string, unknown>[] {
  if (text.includes("FILTER (WHERE run_class = 'ORGANIC')")) {
    return [{ organic: 0, synthetic: 0, unknown: 0, author: 0, total: 0 }];
  }
  if (text.includes("FROM ask_interactions")) return [{ n: 0 }];
  return [];
}

const WINDOW = readerWindow(NOW, DEFAULT_READER_WINDOW_DAYS);

/* ------------------------------------------------------------------ *
 * 1. THE ORGANIC DEFAULT EXCLUDES SYNTHETIC TRAFFIC
 * ------------------------------------------------------------------ */

test("ADM-C12: the view defaults to ORGANIC and nothing a request says widens it", () => {
  assert.equal(DEFAULT_READER_RUN_CLASS, "ORGANIC");
  assert.equal(readerRunClassFromParam(undefined), "ORGANIC");
  assert.equal(readerRunClassFromParam(""), "ORGANIC");
  assert.equal(readerRunClassFromParam("   "), "ORGANIC");
  // The shapes a hand-edited query string actually takes.
  assert.equal(readerRunClassFromParam("ALL"), "ORGANIC");
  assert.equal(readerRunClassFromParam("*"), "ORGANIC");
  assert.equal(readerRunClassFromParam("ORGANIC,SYNTHETIC"), "ORGANIC");
  assert.equal(readerRunClassFromParam("' OR 1=1 --"), "ORGANIC");
  // Deliberate selection is honoured, in either case, including from a repeated param.
  assert.equal(readerRunClassFromParam("author"), "AUTHOR");
  assert.equal(readerRunClassFromParam("SYNTHETIC"), "SYNTHETIC");
  assert.equal(readerRunClassFromParam(["UNKNOWN", "ORGANIC"]), "UNKNOWN");
  // And there is no fifth class to select.
  assert.deepEqual([...READER_RUN_CLASSES], ["ORGANIC", "AUTHOR", "SYNTHETIC", "UNKNOWN"]);
});

test("ADM-C12: every aggregate carries a run-class filter, and only the census does not", async () => {
  const store = recordedStore(fullPlan);
  await readReaderIntel(store.sql, WINDOW, "ORGANIC");
  assert.ok(store.asked.length >= 14, `expected the whole round of reads, saw ${store.asked.length}`);

  const unfiltered: string[] = [];
  for (const asked of store.asked) {
    const isCensus = asked.text.includes("FILTER (WHERE run_class = 'ORGANIC')");
    // The Ask store's one read is an all-class row count that emits no figure about readers.
    const isAskExistence = asked.text.includes("FROM ask_interactions");
    if (isCensus || isAskExistence) continue;
    if (!/run_class = \$\d+/.test(asked.text)) unfiltered.push(asked.text.trim().slice(0, 120));
  }
  assert.deepEqual(unfiltered, [], `these aggregates read the table with no run-class filter:\n${unfiltered.join("\n")}`);

  // The census is the ONE read that describes the whole window, and it names
  // all four classes so the excluded rows are visible rather than absent.
  const censuses = store.asked.filter((a) => a.text.includes("FILTER (WHERE run_class = 'ORGANIC')"));
  assert.equal(censuses.length, 3, "one census per store: search log, reactions, demand signals");
  for (const census of censuses) {
    for (const cls of READER_RUN_CLASSES) {
      assert.match(census.text, new RegExp(`FILTER \\(WHERE run_class = '${cls}'\\)`), `the census omits ${cls}`);
    }
  }
});

test("ADM-C12: 500 synthetic rows never reach a figure the page prints", async () => {
  const store = recordedStore(fullPlan);
  const intel = await readReaderIntel(store.sql, WINDOW, "ORGANIC");
  assert.equal(intel.activity.kind, "HELD");
  if (intel.activity.kind !== "HELD") return;
  // The window holds 550 rows and 500 of them are this project's own walks.
  assert.equal(intel.activity.value.census.total, 550);
  assert.equal(intel.activity.value.census.synthetic, 500);
  // The figure the page states is three, not 550 and not 503.
  assert.equal(intel.activity.value.total, 3);
  const numbers = renderedNumbersOf(intel);
  const headline = numbers.find((n) => n.label === "Events in the selected class");
  assert.equal(headline?.value, 3);
  assert.equal(headline?.denominator, 550);
});

test("ADM-C12: selecting another class binds THAT class, and says it is not a demand figure", async () => {
  const store = recordedStore(fullPlan);
  await readReaderIntel(store.sql, WINDOW, "SYNTHETIC");
  const bound = store.asked.filter((a) => /run_class = \$\d+/.test(a.text));
  assert.ok(bound.length > 0, "no query bound a run class at all");
  for (const asked of bound) {
    assert.ok(
      asked.values.includes("SYNTHETIC"),
      `a filtered query did not bind the selected class: ${asked.text.trim().slice(0, 120)}`,
    );
    assert.ok(!asked.values.includes("ORGANIC"), "a class-filtered query bound ORGANIC while another class was selected");
  }
  const said = scopeSentence("SYNTHETIC", CENSUS);
  assert.match(said, /not readers/i);
  assert.match(said, /Nothing on this screen is a demand figure/);
  // ORGANIC keeps the project's one shared denominator sentence, unchanged.
  assert.match(scopeSentence("ORGANIC", CENSUS), /Counted from 3 reader events/);
  assert.match(scopeSentence("ORGANIC", CENSUS), /An unattributable row is never counted as a reader/);
});

test("ADM-C12: the census is checked for reconciliation rather than assumed to sum", () => {
  assert.equal(censusReconciles(CENSUS), true);
  // `run_class` carries no CHECK constraint, so a fifth value can exist in the
  // data before it exists in the code. That must read as a defect, not vanish.
  assert.equal(censusReconciles({ organic: 1, synthetic: 1, unknown: 1, author: 1, total: 9 }), false);
  assert.equal(censusCountFor(CENSUS, "ORGANIC"), 3);
  assert.equal(censusCountFor(CENSUS, "SYNTHETIC"), 500);
  assert.equal(censusCountFor(CENSUS, "AUTHOR"), 7);
  assert.equal(censusCountFor(CENSUS, "UNKNOWN"), 40);
});

/* ------------------------------------------------------------------ *
 * 2. SENSITIVE IDENTITY IS NOT JOINED
 * ------------------------------------------------------------------ */

/** Columns and tables that could key back to one reader; feedback contact must never be joined to behaviour. */
const NEVER_READ = [
  "feedback_contact",
  "contact_ref",
  "FROM feedback",
  "free_text",
  "reaction_key_hash",
  "ask_key_hash",
  "speak_key_hash",
  "question_scrubbed",
  "answer_text",
  "coverage_tier_distribution",
  "detail->>'question'",
];

test("ADM-C12: the read model never names a column that could key back to one reader", () => {
  const src = code(MODULE_PATH);
  assert.ok(src.length > 4000, `expected the module, read ${src.length} characters`);
  const found = NEVER_READ.filter((name) => src.includes(name));
  assert.deepEqual(found, [], `the reader read model names: ${found.join(", ")}`);
  // A run_id rollup across stores would be session tracking.
  assert.ok(!/\brun_id\b/.test(src), "the read model selects run_id — there is no session in this product");
});

test("ADM-C12: PLANT — a reader-level field anywhere in the reading refuses the render", async () => {
  const store = recordedStore(fullPlan);
  const intel = await readReaderIntel(store.sql, WINDOW, "ORGANIC");
  // The real reading passes.
  assertAggregateOnly(intel, "the reader-intelligence reading");
  // The same reading with one reader-level field three objects down does not —
  // which is the property the real call in `readReaderIntel` is relying on.
  assert.throws(
    () =>
      assertAggregateOnly(
        { ...intel, activity: { kind: "HELD", value: { top: [{ zip: "08540", freeText: "hello" }] } } },
        "the reader-intelligence reading",
      ),
    /freeText/,
  );
});

test("ADM-C12: a missing handle names the variable and never a value", () => {
  const refused = openReaderStore({});
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.match(refused.detail, /DATABASE_URL is not set/);
  assert.match(refused.detail, /nothing has been counted/i);
  assert.ok(!refused.detail.includes("postgres://"), "a refusal must never carry a connection string");
  assert.ok(!refused.detail.includes("@"), "a refusal must never carry a connection string");

  const opened = openReaderStore({ DATABASE_URL: "postgres://u:p@example.neon.tech/db" });
  assert.equal(opened.ok, true);
});

/* ------------------------------------------------------------------ *
 * 3. DENOMINATORS ARE EXACT
 * ------------------------------------------------------------------ */

test("ADM-C12: every number the page prints carries a denominator and a contract", async () => {
  const store = recordedStore(fullPlan);
  const intel = await readReaderIntel(store.sql, WINDOW, "ORGANIC");
  const numbers = renderedNumbersOf(intel);
  assert.ok(numbers.length > 20, `expected the page's declared numbers, saw ${numbers.length}`);
  const verdict = auditRenderedNumbers(numbers);
  assert.equal(verdict.ok, true, verdict.detail);
  for (const number of numbers) {
    assert.equal(typeof number.denominator, "number", `${number.label} has no denominator`);
    assert.ok((number.contract ?? "").trim().length > 20, `${number.label} has no interpretation contract`);
  }
  // A numerator larger than its denominator means two different populations.
  assert.deepEqual(impossibleNumbersIn(numbers), []);
});

test("ADM-C12: PLANT — a bare number and an impossible one are both caught", () => {
  assert.equal(
    auditRenderedNumbers([{ label: "Searches", value: 18, denominator: null, contract: "x" }]).ok,
    false,
  );
  assert.equal(
    auditRenderedNumbers([{ label: "Searches", value: 18, denominator: 42, contract: "  " }]).ok,
    false,
  );
  assert.deepEqual(
    impossibleNumbersIn([{ label: "Searches", value: 43, denominator: 42, contract: "x" }]),
    ["Searches: 43 counted out of 42"],
  );
});

test("ADM-C12: a rate states its exact denominator, and a zero denominator is a named gap", () => {
  const ok = share(18, 42, "Searches that named a ZIP, out of every organic search in the window.", "the search log");
  assert.equal(ok.held, true);
  if (!ok.held) return;
  assert.equal(ok.value.value, 18);
  assert.equal(ok.value.denominator, 42);
  assert.ok(ok.value.contract.length > 20);
  assert.ok(ok.value.denominatorSource.length > 0);

  // Nought out of nought is not nought percent; it is a question nobody asked.
  const none = share(0, 0, "x is y", "the search log over this window");
  assert.equal(none.held, false);
  if (none.held) return;
  assert.equal(none.gap.whose, "OURS");
  assert.match(none.gap.says, /nothing to be a share of/);

  // A numerator over its denominator refuses rather than clamping.
  const wrong = share(43, 42, "x is y", "the search log over this window");
  assert.equal(wrong.held, false);
  if (wrong.held) return;
  assert.match(wrong.gap.says, /different populations/);
});

test("ADM-C12: stated N equals the rows actually rendered, and a mismatch is caught", async () => {
  const store = recordedStore(fullPlan);
  const intel = await readReaderIntel(store.sql, WINDOW, "ORGANIC");
  const claims = countClaimsOf(intel);
  assert.ok(claims.length > 5, `expected the page's count claims, saw ${claims.length}`);
  const verdict = checkStatedEqualsRendered(claims);
  assert.equal(verdict.ok, true, verdict.detail);

  assert.equal(checkStatedEqualsRendered([{ label: "Top ZIPs", stated: 7, rendered: 5 }]).ok, false);
});

test("ADM-C12: PLANT — a list rendered short of what the database counted is caught", async () => {
  const store = recordedStore(fullPlan);
  const intel = await readReaderIntel(store.sql, WINDOW, "ORGANIC");
  if (intel.activity.kind !== "HELD") throw new Error("expected a held reading");
  // Postgres counted two distinct districts; the projection draws one.
  const list = intel.activity.value.topDivisions;
  assert.equal(list.distinct, 2);
  const cut = {
    ...intel,
    activity: {
      ...intel.activity,
      value: { ...intel.activity.value, topDivisions: { ...list, rows: list.rows.slice(0, 1) } },
    },
  };
  const verdict = checkStatedEqualsRendered(countClaimsOf(cut));
  assert.equal(verdict.ok, false);
  assert.match(verdict.detail, /Top districts: stated 2, rendered 1/);
});

test("ADM-C12: a top list says how many exist behind it, so it never implies it showed everything", () => {
  const one = [{ key: "a", label: "a", count: 3 }];
  assert.equal(
    topListSentence({ rows: one, distinct: 61, keyed: 90 }, "body", "bodies"),
    "The top 1 of 61 bodies named in this window, out of 90 events that named one.",
  );
  assert.equal(
    topListSentence({ rows: one, distinct: 1, keyed: 3 }, "body", "bodies"),
    "All 1 body named in this window, out of 3 events that named one.",
  );
  assert.equal(
    topListSentence({ rows: one, distinct: 1, keyed: 1 }, "ZIP", "ZIPs"),
    "All 1 ZIP named in this window, out of 1 event that named one.",
  );
  // Nought is a named absence, never a list with nothing in it.
  assert.equal(
    topListSentence({ rows: [], distinct: 0, keyed: 0 }, "body", "bodies"),
    "No body was named by any event in this window.",
  );
});

test("ADM-C12: the window is bounded, stated, and computed once for every panel", () => {
  assert.deepEqual([...READER_WINDOW_CHOICES], [7, 30, 90]);
  assert.equal(DEFAULT_READER_WINDOW_DAYS, 30);
  assert.equal(readerWindowDaysFromParam(undefined), 30);
  assert.equal(readerWindowDaysFromParam("7"), 7);
  assert.equal(readerWindowDaysFromParam("90"), 90);
  // There is no "all time", and no arbitrary span a query string can ask for.
  assert.equal(readerWindowDaysFromParam("100000"), 30);
  assert.equal(readerWindowDaysFromParam("0"), 30);
  assert.equal(readerWindowDaysFromParam("-1"), 30);
  assert.equal(readerWindowDaysFromParam("all"), 30);

  const w = readerWindow(NOW, 7);
  assert.equal(w.toIso, NOW);
  assert.equal(w.fromIso, "2026-08-30T18:00:00.000Z");
  assert.equal(w.days, 7);
  assert.match(windowSentence(w), /last 7 days only/);
  assert.match(windowSentence(w), /reads the whole history/);
  assert.throws(() => readerWindow("not a time", 7), /render clock/);
});

test("ADM-C12: every query is bounded by that window and cut inside the database", async () => {
  const store = recordedStore(fullPlan);
  await readReaderIntel(store.sql, WINDOW, "ORGANIC", READER_TOP_N);
  for (const asked of store.asked) {
    assert.match(
      asked.text,
      /occurred_at >= \$\d+::timestamptz AND occurred_at < \$\d+::timestamptz/,
      `a read ran unbounded over the whole table: ${asked.text.trim().slice(0, 120)}`,
    );
    assert.ok(
      asked.values.includes(WINDOW.fromIso) && asked.values.includes(WINDOW.toIso),
      "a read used bounds other than the one window this render computed",
    );
  }
  // Every ranked list is cut in Postgres, never in JavaScript after loading it.
  const ranked = store.asked.filter((a) => a.text.includes("ROW_NUMBER() OVER"));
  assert.ok(ranked.length >= 6, `expected the ranked projections, saw ${ranked.length}`);
  for (const asked of ranked) {
    assert.match(asked.text, /WHERE rk <= \$\d+::int/, "a ranked list was not cut inside the database");
    assert.ok(asked.values.includes(READER_TOP_N), "a ranked list was cut at something other than the stated limit");
  }
});

/* ------------------------------------------------------------------ *
 * 4. EMPTY DATA RENDERS HONESTLY
 * ------------------------------------------------------------------ */

test("ADM-C12: an empty window is NOT_RECORDED, and says the store answered", async () => {
  const store = recordedStore(emptyPlan);
  const intel = await readReaderIntel(store.sql, WINDOW, "ORGANIC");
  for (const [what, outcome] of [
    ["activity", intel.activity],
    ["reactions", intel.reactions],
    ["demand", intel.demand],
  ] as const) {
    assert.equal(outcome.kind, "NOT_RECORDED", `${what} should report an answered, empty store`);
    if (outcome.kind === "NOT_RECORDED") {
      assert.match(outcome.detail, /(read and holds no rows|answered)/i, `${what} does not say the store answered`);
      assert.ok(!/^0/.test(outcome.detail), `${what} leads with a zero rather than a sentence`);
    }
  }
});

test("ADM-C12: a store that cannot be reached is not a store that holds nothing", async () => {
  const store = recordedStore(() => new Error("ECONNREFUSED"));
  const intel = await readReaderIntel(store.sql, WINDOW, "ORGANIC");
  for (const outcome of [intel.activity, intel.reactions, intel.demand, intel.ask]) {
    assert.equal(outcome.kind, "STORE_UNREACHABLE");
    if (outcome.kind === "STORE_UNREACHABLE") assert.match(outcome.detail, /could not ask/i);
  }
});

test("ADM-C12: zero in the selected class is HELD with a zero, not an empty store", async () => {
  // Stores default `run_class` to UNKNOWN, so an ORGANIC view can be near-empty while the store holds rows.
  const plan = (text: string): Record<string, unknown>[] => {
    if (text.includes("FILTER (WHERE run_class = 'ORGANIC')")) {
      return [{ organic: 0, synthetic: 0, unknown: 550, author: 0, total: 550 }];
    }
    if (text.includes("AS quarantined")) return [{ total: 0, clean: 0, quarantined: 0 }];
    if (text.includes("FROM ask_interactions")) return [{ n: 0 }];
    return [];
  };
  const store = recordedStore(plan);
  const intel = await readReaderIntel(store.sql, WINDOW, "ORGANIC");
  assert.equal(intel.activity.kind, "HELD");
  if (intel.activity.kind !== "HELD") return;
  assert.equal(intel.activity.value.total, 0);
  assert.equal(intel.activity.value.census.total, 550);
  assert.equal(intel.activity.value.census.unknown, 550);
  // Every event type is still listed, at zero — a kind that vanished from the
  // list would read as a kind of interaction the product does not have.
  assert.equal(intel.activity.value.byEvent.length, SEARCH_LOG_EVENT_TYPES.length);
  assert.ok(intel.activity.value.byEvent.every((e) => e.count === 0));
  assert.equal(intel.reactions.kind, "HELD");
});

/* ------------------------------------------------------------------ *
 * 5. THE WORDING, AND THE QUERY THAT MUST MATCH IT
 * ------------------------------------------------------------------ */

test("ADM-C12: every stored constant this page can print has owner words", () => {
  for (const event of SEARCH_LOG_EVENT_TYPES) {
    const word = readerWord(event);
    assert.ok(word.label.length > 0, `${event} has no words`);
    assert.ok(!word.label.includes("_"), `${event} reaches the face as a machine constant`);
    assert.ok(word.means.length > 20, `${event} has no sentence saying what it means`);
  }
  for (const cls of READER_RUN_CLASSES) {
    assert.ok(!readerWord(cls).label.includes("_"));
    assert.ok(readerWord(cls).means.length > 20, `${cls} has no sentence saying what it means`);
  }
  // Anything the dictionary does not carry still never reaches the face with
  // underscores in it.
  assert.equal(readerWord("SOME_NEW_STATE").label, "Some new state");
  // ...and an id-shaped key is left exactly as it is, because inventing words
  // for a government's key would be inventing a name.
  assert.equal(readerWord("nj:county:county-of-mercer").label, "nj:county:county-of-mercer");
  assert.equal(readerWord(null).label, "");
});

test("ADM-C12: the detail-key map and the SQL that reads it cannot drift apart", () => {
  const src = code(MODULE_PATH);
  const entries = Object.entries(DETAIL_KEY_BY_EVENT);
  assert.ok(entries.length >= 5, `expected the detail-key map, saw ${entries.length} entries`);
  for (const [event, key] of entries) {
    assert.ok(
      (SEARCH_LOG_EVENT_TYPES as readonly string[]).includes(event),
      `${event} is not a search-log event type`,
    );
    // A map that drifted from the query would produce an empty "top bodies"
    // list looking exactly like nobody ever opening a body.
    assert.ok(
      src.includes(`WHEN '${event}'`) && src.includes(`detail->>'${key}'`),
      `the SQL does not read ${key} for ${event}`,
    );
  }
  for (const word of Object.keys(READER_WORDS)) {
    assert.ok(word.trim() === word && word.length > 0, "a dictionary key is malformed");
  }
});
