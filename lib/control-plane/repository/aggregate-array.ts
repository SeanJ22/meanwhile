import { jsonTextAtPath, projectRecord, type AggregateArrayQuery, type AggregateArrayRetention } from "./types.ts";

export function arrayPageLimit(query: AggregateArrayQuery): number {
  const limit = query.limit ?? 32;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128 || !Number.isSafeInteger(query.after ?? 0) || (query.after ?? 0) < 0)
    throw new Error("AGGREGATE_ARRAY_PAGE_INVALID");
  return limit;
}
/** The memory provider mirrors the database's member filtering and revision fence. */
export function aggregateArrayPage(value: unknown, field: string | readonly string[], query: AggregateArrayQuery): {values: unknown[]; next: number|null; nextKey?:string|null} {
  const limit = arrayPageLimit(query), values: unknown[] = [];
  let array = value;
  for (const key of typeof field === "string" ? [field] : field) array = (array as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(array)) return {values, next: null};
  if (query.order) {
    const ordered = array.map((member,index) => ({member,index,key:jsonTextAtPath(member,query.order!.path)}))
      .filter(row => row.key !== null && (query.order!.after === undefined || row.key > query.order!.after) &&
        (!query.match || jsonTextAtPath(row.member,query.match.path)===query.match.value))
      .sort((a,b) => a.key! < b.key! ? -1 : a.key! > b.key! ? 1 : a.index-b.index).slice(0,limit);
    return {values:ordered.map(row=>query.projection?projectRecord(row.member,query.projection):row.member),next:null,
      nextKey:ordered.length===limit?ordered.at(-1)!.key:null};
  }
  let last = query.after ?? 0;
  for (let index = last; index < array.length; index++) {
    if (query.match && jsonTextAtPath(array[index], query.match.path) !== query.match.value) continue;
    last = index + 1;
    values.push(query.projection ? projectRecord(array[index], query.projection) : array[index]);
    if (values.length === limit) break;
  }
  return {values, next: values.length === limit ? last : null};
}
export function replaceAggregateArrayItem(value: Readonly<Record<string, unknown>>, field: string, keyPath: readonly string[], key: string,
  next: unknown|null, now: string, retention?: AggregateArrayRetention): Record<string, unknown> {
  const held = Array.isArray(value[field]) ? value[field] as unknown[] : [];
  let found = false;
  let members = held.flatMap(member => {
    if (jsonTextAtPath(member, keyPath) !== key) return [member];
    found = true; return next === null ? [] : [next];
  });
  if (!found && next !== null) members.push(next);
  if (retention?.pruneBefore) members=members.filter(member=>
    !(Date.parse(jsonTextAtPath(member,retention.pruneBefore!.path)??"")<Date.parse(retention.pruneBefore!.at)));
  if (retention && members.length > retention.limit) {
    const discarded = new Set(members.map((member, index) => ({member, index}))
      .filter(({member}) => jsonTextAtPath(member, retention.discardPath) === retention.discardValue &&
        (!retention.discardAlso || jsonTextAtPath(member, retention.discardAlso.path) === retention.discardAlso.value))
      .sort((a,b) => (jsonTextAtPath(a.member, retention.oldestPath) ?? "").localeCompare(jsonTextAtPath(b.member, retention.oldestPath) ?? "") || a.index-b.index)
      .slice(0, members.length-retention.limit).map(row => row.index));
    members = members.filter((_,index) => !discarded.has(index));
  }
  return {...value, [field]: members, updatedAt: now};
}
