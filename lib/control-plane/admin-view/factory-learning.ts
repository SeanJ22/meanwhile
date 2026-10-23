
/** Measurements, not a publication gate. Partial work is not coverage. */
export interface CoverageLearningObservation {
  readonly subjectId: string;
  readonly targetSet: string;
  readonly ordinal: 1 | 2;
  readonly startedAt: string;
  readonly coveredAt: string;
}
/** Machine-observed acquisition activity, never inferred from a door merely handed to a model. */
export interface HeadStartObservation {
  readonly attemptId: string; readonly targetId: string; readonly solved: boolean; readonly headStartOnly: boolean | null;
}
export interface FactoryLearning {
  readonly secondCoverage: { readonly pairs: number; readonly firstMs: number; readonly secondMs: number; readonly ratio: number | null };
  readonly headStart: { readonly solved: number; readonly measured: number; readonly share: number | null };
  readonly detectiveReuse: number | null;
  readonly factsByWeek: readonly { readonly week: string; readonly facts: number; readonly observedHours: number; readonly perHour: number }[];
}

/** Comparable complete target sets only. Replay cannot multiply an observation. */
export function coverageLearning(observations: readonly CoverageLearningObservation[], targets: readonly HeadStartObservation[] = []): Pick<FactoryLearning, "secondCoverage" | "headStart"> {
  const groups = new Map<string, Map<number, CoverageLearningObservation>>();
  for (const row of observations) {
    const start = Date.parse(row.startedAt), end = Date.parse(row.coveredAt);
    if (!row.subjectId || !row.targetSet || !Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    const key = JSON.stringify([row.subjectId, row.targetSet]);
    const group = groups.get(key) ?? new Map();
    const prior = group.get(row.ordinal);
    if (!prior || row.coveredAt < prior.coveredAt) group.set(row.ordinal, row);
    groups.set(key, group);
  }
  let pairs = 0, firstMs = 0, secondMs = 0, measured = 0, solved = 0;
  for (const group of groups.values()) {
    const a = group.get(1), b = group.get(2);
    if (!a || !b || Date.parse(b.startedAt) < Date.parse(a.coveredAt)) continue;
    pairs++; firstMs += Date.parse(a.coveredAt) - Date.parse(a.startedAt); secondMs += Date.parse(b.coveredAt) - Date.parse(b.startedAt);
  }
  const unique = new Map(targets.map(target => [JSON.stringify([target.attemptId, target.targetId]), target]));
  for (const target of unique.values()) if (typeof target.headStartOnly === "boolean") { measured++; if (target.solved && target.headStartOnly) solved++; }
  return { secondCoverage: { pairs, firstMs, secondMs, ratio: pairs && firstMs > 0 ? secondMs / firstMs : null },
    headStart: { solved, measured, share: measured ? solved / measured : null } };
}

export function weeklyFactRates(rows: readonly { week: string; facts: number }[], from: string, through: string): FactoryLearning["factsByWeek"] {
  const start = Date.parse(from), end = Date.parse(through);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw Error("LEARNING_WINDOW_INVALID");
  return rows.flatMap(row => {
    const week = Date.parse(row.week), hours = (Math.min(end, week + 7*86_400_000) - Math.max(start, week)) / 3_600_000;
    if (!Number.isFinite(hours) || hours <= 0 || !Number.isSafeInteger(row.facts) || row.facts < 0) return [];
    return [{ week: new Date(week).toISOString(), facts: row.facts, observedHours: hours, perHour: row.facts / hours }];
  });
}
