type Row = Record<string, unknown>;
const records = (value: unknown): Row[] => Array.isArray(value) ? value as Row[] : [];
const record = (value: unknown): Row => value && typeof value === "object" ? value as Row : {};

/** What PLACE_CHECKS_SQL returns for the facts and calendars of one saved row. */
export interface PlaceChecks { readonly facts?: readonly (readonly [number, string])[] | null; readonly calendars?: Row | null }

/**
 * The facts and calendars of a saved row whose check dates are read apart from its content. `request` is the statement's two parameters (null when
 * the row has nothing to look up); `apply` returns a copy of the row with the dates the statement returned. A read looks dates up after boards folded into
 * others are named as the board they were folded into, so `canonical` names them so for a request made before the pages are merged.
 */
export function placeCheckRequest(row: Row, canonical: (id: string) => string = id => id): { readonly request: readonly [string, string] | null; readonly apply: (checks?: PlaceChecks | null) => Row } {
  const slots: { row: Row; entity: string; field: string; key: string }[] = [];
  const add = (row: Row, entity: string, field: string, key = "checked_at") => { slots.push({row,entity,field,key}); return row; };
  const out = {...row};
  for (const key of ["fields","comments"]) out[key] = records(row[key]).map(value => add({...value},canonical(String(value.entity_id)),String(value.field)));
  out.sittings = records(row.sittings).map(value => add({...value},String(value.entity_id),String(value.field)));
  out.rosters = records(row.rosters).map(value => {
    const from = String(value.body_id), into = canonical(from);
    const member = add({...value},into,`member:${value.person_id}`);
    member.person = Object.fromEntries(Object.entries(record(value.person)).map(([field,value]) =>
      [field,add({...record(value)},String(member.person_id),field.endsWith(`:${from}`) ? `${field.slice(0,-from.length)}${into}` : field,"checked")]));
    return member;
  });
  const calendars = records(row.meeting_rows).filter(part=>records(record(part.payload).sources).some(source=>source.ok===true));
  const request = !slots.length && !calendars.length ? null : [
    JSON.stringify(slots.map(({row,entity,field,key},n)=>({n,entity,field,value:row.value,url:row.url,quote:row.quote??null,at:row[key]}))),
    JSON.stringify(calendars.map(part=>({scope:part.scope,version:part.current_version_id})))] as const;
  return { request, apply: checks => {
    if (!request) return out;
    for (const [n,at] of checks?.facts ?? []) slots[n]!.row[slots[n]!.key] = at;
    out.meeting_rows = records(row.meeting_rows).map(part=>({...part,confirmation:checks?.calendars?.[String(part.scope)]??part.confirmation}));
    return out;
  } };
}
