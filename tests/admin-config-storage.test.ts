import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { pgAggregateRepository } from "../lib/control-plane/repository/pg-store.ts";
import { ADMIN_SECTIONS, ADMIN_SECTIONS_DDL, ADMIN_SECTIONS_EXPAND_DDL, ADMIN_SECTIONS_CONTRACT_DDL, backfillAdminSections, pgAdminConfigRepository, storedAdminConfigRepository, type AdminSection, type StoredAdminSection } from "../lib/control-plane/repository/admin-config.ts";
import { createFileRepositories, fileAggregateRepository } from "../lib/control-plane/repository/file-store.ts";
import { memoryAggregateRepository, memoryLockManager } from "../lib/control-plane/repository/memory.ts";
import type { AggregateRepository } from "../lib/control-plane/repository/types.ts";
import { defaultAdminConfig, type AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { settingUndo, withSetting } from "../lib/control-plane/settings.ts";

const now = "2026-10-15T12:00:00.000Z";

test("Admin history migrates once; settings reads transfer a body only when the revision changes", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE TABLE cp_admin_config (id text PRIMARY KEY, revision bigint NOT NULL, updated_at timestamptz NOT NULL, value jsonb NOT NULL, changed_at timestamptz DEFAULT now())");
    const settingHistory = Array.from({ length: 2000 }, (_, n) => ({ id: `change-${n}`, key: "alerts.on", before: false, after: true, at: now, why: `change ${n}` }));
    await pg.query("INSERT INTO cp_admin_config VALUES ('current',1,$1,$2,now())", [now, JSON.stringify({ ...defaultAdminConfig(now), settingHistory })]);
    for (const ddl of ADMIN_SECTIONS_EXPAND_DDL) await pg.exec(ddl);
    const pageSizes: number[] = [];
    await backfillAdminSections(async (statement, params) => {
      const rows = (await pg.query<Record<string, unknown>>(statement, [...(params ?? [])])).rows;
      if (statement.startsWith("WITH source") && statement.includes("INSERT INTO cp_admin_setting_history")) pageSizes.push(Number(rows[0].count));
      return rows;
    });
    assert.deepEqual(pageSizes, [...Array<number>(20).fill(100), 0]);
    assert.deepEqual((await pg.query<{ id: string }>("SELECT id FROM cp_admin_setting_history ORDER BY ordinal")).rows.map(row => row.id), settingHistory.map(row => row.id));
    for (const ddl of ADMIN_SECTIONS_CONTRACT_DDL) await pg.exec(ddl);
    const transferred: Record<string, unknown>[][] = [];
    const sql = { async query(text: string, params?: readonly unknown[]) { return (await pg.query(text, [...(params ?? [])])).rows as Record<string, unknown>[]; } };
    const repo = pgAdminConfigRepository(pgAggregateRepository<AdminConfig>(sql, "AdminConfig", "cp_admin_config"), async (text, params) => {
      const rows = await sql.query(text, params) as Record<string, unknown>[]; transferred.push(rows); return rows;
    });
    const first = await repo.mustRead("current");
    assert.equal(first.value.settingHistory, undefined);
    assert.equal((await repo.mustRead("current")).revision, first.revision);
    assert.equal(transferred.at(-1)?.[0]?.value, null);
    const log = await repo.mustRead("current", { settingHistory: { latestPerKey: 10 } });
    assert.equal(log.value.settingHistory?.length, 10);
    assert.equal(log.value.settingHistory?.at(-1)?.id, "change-1999");
    const settings = await repo.save(log, withSetting(log.value, { id: "next", key: "alerts.on", after: true, at: now, why: "turn on" }), now);
    assert.deepEqual(settingUndo(settings.value, "next"), { key: "alerts.on", value: false, why: "Undo: turn on", undoOf: "next" });
    await assert.rejects(repo.save(log, withSetting(log.value, { id: "stale", key: "alerts.on", after: false, at: now, why: "" }), now), /modified concurrently/);
    await assert.rejects(repo.save(log, log.value, now), /modified concurrently/);
    assert.equal((await repo.mustRead("current", { settingHistory: { ids: ["stale"] } })).value.settingHistory?.length, 0);
    const undo = withSetting(settings.value, { id: "undo", key: "alerts.on", after: false, at: now, why: "Undo", undoOf: "next" });
    await repo.save(settings, undo, now);
    assert.equal((await repo.mustRead("current")).value.settings?.["alerts.on"], false);
    const stored = await sql.query("SELECT value FROM cp_admin_config");
    assert.equal((stored[0] as {value:AdminConfig}).value.settingHistory, undefined);
    assert.equal(Number((await sql.query("SELECT count(*) AS n FROM cp_admin_setting_history"))[0].n), 2002);
  } finally { await pg.close(); }
});

test("saving one place target leaves other places intact, including clearing its target", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE TABLE cp_admin_config (id text PRIMARY KEY, revision bigint NOT NULL, updated_at timestamptz NOT NULL, value jsonb NOT NULL, changed_at timestamptz DEFAULT now())");
    for (const ddl of ADMIN_SECTIONS_DDL) await pg.exec(ddl);
    const sql = { async query(text: string, params?: readonly unknown[]) { return (await pg.query(text, [...(params ?? [])])).rows as Record<string, unknown>[]; } };
    const repo = pgAdminConfigRepository(pgAggregateRepository<AdminConfig>(sql, "AdminConfig", "cp_admin_config"), sql.query);
    const target = (key: string) => ({ key, goalPercent: 75, setAt: now, decidedBy: "owner", receiptId: key });
    await repo.save(null, { ...defaultAdminConfig(now), placeTargets: [target("st:az"), target("st:ca")] }, now);
    const az = await repo.mustRead("current", { placeTargets: { ids: ["st:az"] } });
    await repo.save(az, { ...az.value, placeTargets: [] }, now);
    assert.deepEqual((await repo.mustRead("current", { placeTargets: true })).value.placeTargets, [target("st:ca")]);
  } finally { await pg.close(); }
});

function localStore() {
  const base = memoryAggregateRepository<AdminConfig>("AdminConfig");
  const sections = Object.fromEntries(Object.keys(ADMIN_SECTIONS).map(key => [key, memoryAggregateRepository<StoredAdminSection>(key)])) as Record<AdminSection, AggregateRepository<StoredAdminSection>>;
  const locks = memoryLockManager();
  return { base, sections, open: () => storedAdminConfigRepository(base, sections, locks) };
}
const change = (id: string, after: boolean) => ({ id, key: "alerts.on", before: !after, after, at: now, why: "" });

test("local histories remain hidden when a write stops before committing the config revision", async () => {
  const store = localStore(), repo = store.open();
  const first = await repo.save(null, { ...defaultAdminConfig(now), settingHistory: [change("old", false)] }, now);
  const writeHead = store.base.compareAndSet.bind(store.base);
  store.base.compareAndSet = async () => { throw new Error("interrupted before head commit"); };
  await assert.rejects(repo.save(first, { ...first.value, settingHistory: [change("old", true), change("abandoned", true)] }, now), /interrupted/);
  store.base.compareAndSet = writeHead;
  const reopened = store.open();
  const held = await reopened.mustRead("current", { settingHistory: true });
  assert.deepEqual(held.value.settingHistory, [change("old", false)]);
  const next = await reopened.save(held, { ...held.value, settings: { "alerts.on": true } }, now);
  assert.deepEqual((await reopened.mustRead("current", { settingHistory: true })).value.settingHistory, [change("old", false)]);
  assert.equal((await reopened.mustRead("current")).value.settingHistory, undefined);
  const before = (await store.sections.settingHistory.list()).map(row => row.revision);
  await assert.rejects(reopened.save(first, { ...first.value, settingHistory: [change("stale", true)] }, now), /modified concurrently/);
  assert.deepEqual((await store.sections.settingHistory.list()).map(row => row.revision), before);
  await assert.rejects(reopened.save(first, first.value, now), /modified concurrently/);
  const saved = await reopened.save(next, { ...next.value, settingHistory: [...next.value.settingHistory!, change("abandoned", false)] }, now);
  assert.deepEqual(saved.value.settingHistory?.map(row => row.id), ["old", "abandoned"]);
});

test("local repeated identical puts do not rewrite settings or history", async () => {
  const store = localStore(), repo = store.open();
  const config = { ...defaultAdminConfig(now), settingHistory: [change("first", true)] };
  const first = await repo.put("current", config, now);
  const second = await repo.put("current", config, now);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.persisted.revision, first.persisted.revision);
  assert.equal((await store.sections.settingHistory.list())[0].revision, 1);
  const held = await repo.mustRead("current", { settingHistory: { limit: 1 } });
  assert.equal((await repo.save(held, held.value, now)).revision, held.revision);
});

test("file repositories migrate embedded Admin history once before exposing the new reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "cp-admin-migrate-"));
  try {
    const base = fileAggregateRepository<AdminConfig>(root, "AdminConfig", "admin-config");
    const config = { ...defaultAdminConfig(now), settingHistory: [change("first", false), change("second", true)] };
    await base.put("current", config, now);
    const repos = await createFileRepositories(root);
    const migrated = await repos.adminConfig.mustRead("current");
    assert.deepEqual(migrated.value, defaultAdminConfig(now));
    assert.equal((await base.mustRead("current")).value.settingHistory, undefined);
    assert.deepEqual((await repos.adminConfig.mustRead("current", { settingHistory: true })).value.settingHistory, config.settingHistory);
    const reopened = await createFileRepositories(root);
    assert.equal((await reopened.adminConfig.mustRead("current")).revision, migrated.revision);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a delayed revision-cache read uses its own cached body and cannot replace a newer save", async () => {
  let revision = 1, reads = 0;
  const pause = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const initial = { ...defaultAdminConfig(now), settings: { "alerts.on": false } };
  const repo = pgAdminConfigRepository(memoryAggregateRepository<AdminConfig>("AdminConfig"), async (statement, params) => {
    if (statement.startsWith("WITH saved")) { revision = 2; return [{ id: "current", revision, updated_at: now }]; }
    const observed = revision;
    reads++;
    if (reads === 2) { started.resolve(); await pause.promise; }
    return [{ id: "current", revision: observed, updated_at: now, value: params?.[1] === observed ? null : initial }];
  });
  const held = await repo.mustRead("current");
  const delayed = repo.mustRead("current");
  await started.promise;
  await repo.save(held, { ...held.value, settings: { "alerts.on": true } }, now);
  pause.resolve();
  assert.equal((await delayed).value.settings?.["alerts.on"], false);
  const latest = await repo.mustRead("current");
  assert.equal(latest.value.settings?.["alerts.on"], true);
  Object.assign(latest.value.settings!, { "alerts.on": false });
  assert.equal((await repo.mustRead("current")).value.settings?.["alerts.on"], true);
});

test("a limited settings log includes a prior receipt so replay cannot append it again", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE TABLE cp_admin_config (id text PRIMARY KEY, revision bigint NOT NULL, updated_at timestamptz NOT NULL, value jsonb NOT NULL, changed_at timestamptz DEFAULT now())");
    for (const ddl of ADMIN_SECTIONS_DDL) await pg.exec(ddl);
    const query = async (statement: string, params?: readonly unknown[]) => (await pg.query(statement, [...(params ?? [])])).rows as Record<string, unknown>[];
    const sql = { query }, repo = pgAdminConfigRepository(pgAggregateRepository<AdminConfig>(sql, "AdminConfig", "cp_admin_config"), query);
    const config = { ...defaultAdminConfig(now), settingHistory: [change("first", false), change("second", true)] };
    await repo.put("current", config, now);
    assert.equal((await repo.put("current", config, now)).created, false);
    const held = await repo.mustRead("current", { settingHistory: { where: { path: ["key"], value: "alerts.on" }, limit: 1, includeIds: ["first"] } });
    assert.deepEqual(held.value.settingHistory?.map(row => row.id), ["first", "second"]);
    const replayed = withSetting(held.value, { id: "first", key: "alerts.on", after: false, at: now, why: "" });
    assert.equal(replayed, held.value);
    assert.equal((await repo.save(held, replayed, now)).revision, held.revision);
    assert.equal(Number((await query("SELECT count(*) AS n FROM cp_admin_setting_history"))[0].n), 2);
  } finally { await pg.close(); }
});

test("a config read retries when a section changes after its revision was read", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE TABLE cp_admin_config (id text PRIMARY KEY, revision bigint NOT NULL, updated_at timestamptz NOT NULL, value jsonb NOT NULL, changed_at timestamptz DEFAULT now())");
    for (const ddl of ADMIN_SECTIONS_DDL) await pg.exec(ddl);
    const query = async (statement: string, params?: readonly unknown[]) => (await pg.query(statement, [...(params ?? [])])).rows as Record<string, unknown>[];
    const base = pgAggregateRepository<AdminConfig>({ query }, "AdminConfig", "cp_admin_config");
    const writer = pgAdminConfigRepository(base, query);
    const first = await writer.save(null, { ...defaultAdminConfig(now), settings: { "alerts.on": false }, settingHistory: [] }, now);
    let headers = 0, changed = false;
    const reader = pgAdminConfigRepository(base, async (statement, params) => {
      if (statement.startsWith("SELECT id, revision")) headers++;
      if (statement.startsWith("SELECT id, value, ordinal") && !changed) {
        changed = true;
        await writer.save(first, withSetting(first.value, { id: "concurrent", key: "alerts.on", after: true, at: now, why: "" }), now);
      }
      return query(statement, params);
    });
    const held = await reader.mustRead("current", { settingHistory: { limit: 1 } });
    assert.equal(headers, 2);
    assert.equal(held.revision, 2);
    assert.equal(held.value.settings?.["alerts.on"], true);
    assert.equal(held.value.settingHistory?.[0]?.id, "concurrent");
  } finally { await pg.close(); }
});

test("expand captures late old-build writes and contract removes the embedded histories and capture trigger", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE TABLE cp_admin_config (id text PRIMARY KEY, revision bigint NOT NULL, updated_at timestamptz NOT NULL, value jsonb NOT NULL, changed_at timestamptz DEFAULT now())");
    const target = (key: string) => ({ key, goalPercent: 75, setAt: now, decidedBy: "owner", receiptId: key });
    const history = Array.from({ length: 205 }, (_, index) => change(`history-${index}`, false));
    const config = { ...defaultAdminConfig(now), settingHistory: history, placeTargets: [target("st:az"), target("st:ca")] };
    await pg.query("INSERT INTO cp_admin_config VALUES ('current',1,$1,$2,now())", [now, JSON.stringify(config)]);
    for (const ddl of ADMIN_SECTIONS_EXPAND_DDL) await pg.exec(ddl);
    const oldBuildWrite = async (settingHistory: typeof history) => pg.query("UPDATE cp_admin_config SET revision=revision+1,value=$1 WHERE id='current'", [JSON.stringify({ ...config,
      settingHistory, placeTargets: [target("st:az")] })]);
    await oldBuildWrite([...history.slice(101), change("late", true)]);
    const batchCounts: number[] = [];
    const query = async (statement: string, params?: readonly unknown[]) => {
      const rows = (await pg.query(statement, [...(params ?? [])])).rows as Record<string, unknown>[];
      if (statement.startsWith("WITH source")) {
        batchCounts.push(Number(rows[0].count));
        if (batchCounts.length === 1) await oldBuildWrite([change("later", false)]);
      }
      return rows;
    };
    await backfillAdminSections(query);
    assert.ok(batchCounts.includes(100));
    assert.ok(batchCounts.every(count => count <= 100));
    await backfillAdminSections(query);
    for (const ddl of ADMIN_SECTIONS_CONTRACT_DDL) await pg.exec(ddl);
    assert.equal(Number((await query("SELECT count(*) AS n FROM cp_admin_setting_history"))[0].n), 207);
    assert.deepEqual((await query("SELECT id FROM cp_admin_place_targets")).map(row => row.id), ["st:az"]);
    assert.equal(((await query("SELECT value FROM cp_admin_config"))[0].value as AdminConfig).settingHistory, undefined);
    assert.equal(Number((await query("SELECT count(*) AS n FROM pg_trigger WHERE tgname='cp_capture_admin_sections'"))[0].n), 0);
  } finally { await pg.close(); }
});
