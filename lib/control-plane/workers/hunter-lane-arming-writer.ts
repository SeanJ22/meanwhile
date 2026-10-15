import { mkdirSync, renameSync, writeFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { HunterLaneArming } from "./hunter-lane-arming.ts";
import { HUNTER_LANE_ARMING_MAX_AGE_MS } from "./hunter-lane-arming.ts";
import { openArmingDatabase, type ArmingIndexHeader } from "./hunter-lane-arming-index.ts";

export function writeLaneArming(path: string, arming: HunterLaneArming): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const indexFile = `arming-${randomUUID()}.sqlite`, indexPath = join(directory, indexFile);
  const db = openArmingDatabase(indexPath);
  try {
    db.exec(`CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE sends(key TEXT PRIMARY KEY,known INTEGER NOT NULL DEFAULT 0,spec TEXT,usd REAL);
      CREATE TABLE reached(obligation TEXT PRIMARY KEY,keys TEXT NOT NULL);
      CREATE TABLE scopes(key TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE members(subject TEXT NOT NULL,scope TEXT NOT NULL,PRIMARY KEY(subject,scope));
      CREATE TABLE unresolved(state TEXT NOT NULL,scope TEXT NOT NULL,PRIMARY KEY(state,scope));
      CREATE TABLE lifetime(subject TEXT PRIMARY KEY); BEGIN`);
    db.prepare("INSERT INTO metadata VALUES ('readAt',?)").run(arming.readAt);
    const known = db.prepare("INSERT INTO sends(key,known) VALUES (?,1) ON CONFLICT(key) DO UPDATE SET known=1");
    for (const key of arming.sends.knownKeys) known.run(key);
    const spec = db.prepare("INSERT INTO sends(key,known,spec) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET known=1,spec=excluded.spec");
    for (const row of arming.sends.specs) spec.run(row.key, JSON.stringify(row));
    const history = db.prepare("INSERT INTO sends(key,usd) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET usd=excluded.usd");
    for (const [key, spend] of arming.sends.historical ?? []) history.run(key, spend.usd);
    const reached = db.prepare("INSERT INTO reached VALUES (?,?)");
    for (const [obligation, keys] of arming.sends.reached) if (keys.length) reached.run(obligation, JSON.stringify(keys));
    const scope = db.prepare("INSERT INTO scopes VALUES (?,?)"), member = db.prepare("INSERT OR IGNORE INTO members VALUES (?,?)");
    const unresolved = db.prepare("INSERT OR IGNORE INTO unresolved VALUES (?,?)");
    for (const { members, ...row } of arming.areas?.scopes ?? []) {
      scope.run(row.key, JSON.stringify(row));
      if (row.resolved) for (const subject of members) member.run(subject, row.key);
      else for (const state of row.states) unresolved.run(state, row.key);
    }
    const lifetime = db.prepare("INSERT OR IGNORE INTO lifetime VALUES (?)");
    for (const subject of arming.lifetimeHuntSubjects) lifetime.run(subject);
    db.exec("COMMIT");
  } finally { db.close(); }
  const header: ArmingIndexHeader = { format: arming.format, readAt: arming.readAt, indexFile,
    costsReadable: arming.sends.historical !== null, worstCaseUsd: arming.worstCaseUsd, circuits: arming.circuits,
    areas: arming.areas === null ? null : { malformedScopes: arming.areas.malformedScopes,
      hasSelectedHunts: arming.areas.scopes.some(scope => scope.lifetime) } };
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(header));
  renameSync(temporary, path);
  for (const file of readdirSync(directory)) {
    if (file !== indexFile && /^arming-[a-f0-9-]+\.sqlite$/.test(file) &&
      Date.now() - statSync(join(directory, file)).mtimeMs > HUNTER_LANE_ARMING_MAX_AGE_MS * 2) unlinkSync(join(directory, file));
  }
}
