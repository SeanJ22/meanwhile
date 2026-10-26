import { types as postgresTypes } from "./client.ts";
import { isVersionedSelectStatement, versionedSelect } from "./versioned-query.ts";
import { readsStoredRows } from "./statement-kind.ts";

export interface DriverField { readonly name: string; readonly dataTypeID: number; readonly format?: string; readonly [key: string]: unknown }
export interface DriverResult { readonly fields: readonly DriverField[]; readonly rows: readonly (readonly unknown[])[];
  readonly command: string; readonly rowCount: number | null; readonly [key: string]: unknown }
export interface DriverParsers { getTypeParser(oid: number, format?: string): (value: never) => unknown }
interface DriverRow { readonly values: readonly unknown[]; readonly fields: readonly DriverField[] }
const ENVELOPE = "__checked_driver_row__";
const RAW_TYPES = { getTypeParser: () => (value: unknown) => value };
export const rawDriverTypes = RAW_TYPES;
function pgBoolean(value: unknown): boolean {
  if (value === true || value === "t" || value === "true" || value === "\u0001" || value === 1) return true;
  if (value === false || value === "f" || value === "false" || value === "\u0000" || value === 0) return false;
  if (ArrayBuffer.isView(value) && value.byteLength === 1) {
    const byte = new Uint8Array(value.buffer, value.byteOffset, 1)[0];
    if (byte === 0 || byte === 1) return byte === 1;
  }
  throw new Error("The database returned an invalid row-version confirmation");
}
const META = /^db04_(?:ordinal|etag|unchanged|version|retained)_[a-f0-9]+$/;

export function needsVersionedRead(text: string): boolean {
  return !isVersionedSelectStatement(text) && readsStoredRows(text);
}

/** The transport always saves raw cells. A caller's current type parsers run
 * after validation, so one caller's decoder cannot taint another caller's copy. */
export async function checkedDriverRead(connection: string, text: string, params: readonly unknown[],
  run: (text: string, params: readonly unknown[]) => Promise<DriverResult>): Promise<DriverResult> {
  let latest: DriverResult | undefined;
  const rows = await versionedSelect(connection + "\u0000driver-raw:v1")(async (query, values) => {
    latest = await run(query, values);
    const columns = latest.fields.map((field, index) => ({ field, index }));
    const body = columns.filter(column => !META.test(column.field.name));
    const metadata = columns.filter(column => META.test(column.field.name));
    return latest.rows.map(values => ({
      [ENVELOPE]: { fields: body.map(column => column.field), values: body.map(column => values[column.index]) },
      ...Object.fromEntries(metadata.map(({field,index}) => [field.name,
        field.dataTypeID === 16 && (values[index] !== null || /^db04_retained_/.test(field.name)) ? pgBoolean(values[index]) : values[index]])),
    }));
  }, text, params);
  if (!latest) throw new Error("A database body was returned without checking its version");
  const envelopes = rows.map(row => row[ENVELOPE] as DriverRow);
  return { ...latest, fields: latest.fields.filter(field => !META.test(field.name)),
    rows: envelopes.map(row => row.values), rowCount: rows.length, command: "SELECT" };
}

/** Preserve the driver's object/array row contract and decode even held cells
 * with the parsers selected for this invocation. */
export function decodeDriverResult(result: DriverResult, options: {
  readonly arrayMode?: boolean; readonly fullResults?: boolean; readonly types?: DriverParsers;
} = {}) {
  const parsers = result.fields.map(field => (options.types ?? postgresTypes as unknown as DriverParsers)
    .getTypeParser(field.dataTypeID, field.format ?? "text"));
  const tuples = result.rows.map(row => row.map((value, index) => value === null ? null : parsers[index](value as never)));
  const rows = options.arrayMode ? tuples : tuples.map(row => Object.fromEntries(result.fields.map((field, index) => [field.name, row[index]])));
  return options.fullResults ? { ...result, rows, rowAsArray: options.arrayMode === true, viaNeonFetch: true, _parsers: parsers } : rows;
}
