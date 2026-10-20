import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { forEachAggregate, withHistoryIndex, type HistoryIndex } from "../control-plane/workers/streamed-history.ts";
import { readLatestLookPasses, weekDayKeys } from "../control-plane/live-audit-log.ts";
import { absenceReadings, auditReadings, doorReadings, holdReadings, lookReadings, stateOf, type DoorLike, type WorkItemLike } from "./loss-readings.ts";
import { LOSS_KINDS, lossLessonForStudy, repeatLossLesson, type LossLesson, type LossReading, type LossKind } from "./study-all-losses.ts";
import { valuesOf, type PlaceTraits, type SharedTrait } from "./study-losses.ts";

/** Scratch rows are one method/place observation; only counts and shared trait values become a lesson. */
export class LossStudyRows {
  readonly db: HistoryIndex;
  readings = 0; failures = 0;
  constructor(db: HistoryIndex) {
    this.db = db;
    db.exec(`CREATE TABLE readings(method TEXT NOT NULL,place TEXT NOT NULL,failed INTEGER NOT NULL,PRIMARY KEY(method,place));
      CREATE TABLE methods(id TEXT PRIMARY KEY,kind TEXT NOT NULL,subject TEXT NOT NULL,first_words TEXT NOT NULL,last_words TEXT NOT NULL);
      CREATE TABLE traits(place TEXT NOT NULL,trait TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(place,trait));
      CREATE TABLE platforms(place TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(place,value));
      CREATE TABLE plan_states(place TEXT PRIMARY KEY,value TEXT NOT NULL,priority INTEGER NOT NULL);
      CREATE TABLE lessons(kind INTEGER NOT NULL,key TEXT NOT NULL,body TEXT NOT NULL)`);
  }
  addReading(reading: LossReading): void {
    this.readings++; if (reading.failed) this.failures++;
    const method = `${reading.kind}|${reading.subject}`;
    this.db.prepare("INSERT INTO methods VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_words=excluded.last_words")
      .run(method, reading.kind, reading.subject, reading.subjectWords, reading.subjectWords);
    this.db.prepare("INSERT INTO readings VALUES(?,?,?) ON CONFLICT(method,place) DO UPDATE SET failed=MAX(readings.failed,excluded.failed)")
      .run(method, reading.placeId, reading.failed ? 1 : 0);
    const state = stateOf(reading.placeId);
    if (state) this.addTraits(reading.placeId, {state});
  }
  addTraits(place: string, traits: PlaceTraits): void {
    const insert = this.db.prepare("INSERT INTO traits VALUES(?,?,?) ON CONFLICT(place,trait) DO UPDATE SET value=excluded.value");
    for (const [trait, value] of valuesOf(traits)) insert.run(place, trait, value);
  }
  addDoor(door: DoorLike): void {
    if (typeof door.kind !== "string" || !Array.isArray(door.holds) || !["OPEN", "SHUT", "SUSPENDED"].includes(door.status)) return;
    if (door.ocdId) this.db.prepare("INSERT OR IGNORE INTO platforms VALUES(?,?)").run(door.ocdId, door.kind.toLowerCase());
    for (const reading of doorReadings([door])) this.addReading(reading);
  }
  addItem(item: WorkItemLike): void {
    if (item.publicationOutcome?.status !== "HELD" && item.publicationOutcome?.status !== "PUBLISHED") return;
    const state = item.autonomousPlan?.jurisdiction;
    if (state && /^[a-z]{2}$/i.test(state)) this.db.prepare(`INSERT INTO plan_states VALUES(?,?,?) ON CONFLICT(place) DO UPDATE SET
      value=CASE WHEN excluded.priority>=plan_states.priority THEN excluded.value ELSE plan_states.value END,
      priority=MAX(plan_states.priority,excluded.priority)`).run(item.subject, state.toLowerCase(), item.publicationOutcome?.status === "PUBLISHED" ? 1 : 0);
    for (const reading of holdReadings([item])) this.addReading(reading);
  }
  async finish(now: string, emit: (lesson: LossLesson) => Promise<void>): Promise<number> {
    this.db.exec(`INSERT OR REPLACE INTO traits SELECT place,'platform',MIN(value) FROM platforms GROUP BY place HAVING COUNT(*)=1;
      INSERT OR IGNORE INTO traits SELECT place,'state',value FROM plan_states`);
    const counts = this.db.prepare("SELECT SUM(failed) AS failed,SUM(1-failed) AS works FROM readings WHERE method=?");
    const failing = this.db.prepare(`SELECT t.trait,t.value,COUNT(*) AS count FROM readings r JOIN traits t ON t.place=r.place
      WHERE r.method=? AND r.failed=1 GROUP BY t.trait,t.value ORDER BY t.trait`);
    const working = this.db.prepare(`SELECT 1 FROM readings r JOIN traits t ON t.place=r.place WHERE r.method=? AND r.failed=0 AND t.trait=? AND t.value=? LIMIT 1`);
    const insert = this.db.prepare("INSERT INTO lessons VALUES(?,?,?)");
    for (const method of this.db.prepare("SELECT * FROM methods ORDER BY id").iterate()) {
      const total = counts.get(method.id)!;
      const failures = Number(total.failed), works = Number(total.works);
      if (failures < 2) continue;
      const kind = method.kind as LossKind;
      let lesson: LossLesson | null = null;
      if (kind === "front-end") lesson = repeatLossLesson(method.subject, method.first_words, failures, works, now);
      else {
        const shared: SharedTrait[] = [];
        for (const trait of failing.iterate(method.id)) if (Number(trait.count) === failures && !working.get(method.id, trait.trait, trait.value))
          shared.push({trait: trait.trait as SharedTrait["trait"], value: trait.value});
        if (shared.length) lesson = lossLessonForStudy(kind, method.subject, method.last_words,
          {methodId: method.id, failures, works, shared, says: ""}, now);
      }
      if (lesson) insert.run(LOSS_KINDS.indexOf(kind), lesson.key, JSON.stringify(lesson));
    }
    let count = 0;
    for (const row of this.db.prepare("SELECT body FROM lessons ORDER BY kind,key").iterate()) { await emit(JSON.parse(row.body) as LossLesson); count++; }
    return count;
  }
}

export async function runLossStudy(repos: ControlPlaneRepositories, now: string, emit: (lesson: LossLesson) => Promise<void>):
  Promise<{readings: number; failures: number; lessons: number; unread: readonly string[]}> {
  return withHistoryIndex(async db => {
    const rows = new LossStudyRows(db), unread: string[] = [];
    const read = async (name: string, work: () => Promise<void>) => {
      const before = {readings: rows.readings, failures: rows.failures};
      db.exec("SAVEPOINT input");
      try { await work(); db.exec("RELEASE input"); }
      catch { db.exec("ROLLBACK TO input; RELEASE input"); rows.readings = before.readings; rows.failures = before.failures; unread.push(name); }
    };
    await read("doors", () => forEachAggregate(repos.doors, row => rows.addDoor(row.value),
      {kind: true, ocdId: true, holds: true, status: true, updatedAt: true, shutSince: true}));
    await read("hunts", () => forEachAggregate(repos.obligations, row => {
      for (const reading of absenceReadings([row.value], now)) rows.addReading(reading);
    }, {recordClass: true, subjectId: true, lastWorkedAt: true, absentUntil: true, absenceUnlock: ["recordedAt"]}));
    await read("checker holds", () => forEachAggregate(repos.workItems, row => rows.addItem(row.value),
      {subject: true, autonomousPlan: ["jurisdiction", "contract"], publicationOutcome: ["status", "at"]}));
    const days = new Set(weekDayKeys(now));
    await read("auditors' red flags", async () => { await repos.liveAudits.readChangedSince(null, undefined,
      {projection: {kind: true, result: ["family", "area", "verdict", "checkedAt"]}, page: page => {
        for (const {key, record} of page) if (days.has(key) && record.kind === "RESULT") for (const reading of auditReadings([record.result])) rows.addReading(reading);
      }}); });
    await read("front-end red flags", async () => { for (const pass of await readLatestLookPasses(repos, 7)) for (const reading of lookReadings([pass])) rows.addReading(reading); });
    const lessons = await rows.finish(now, emit);
    return {readings: rows.readings, failures: rows.failures, lessons, unread};
  });
}
