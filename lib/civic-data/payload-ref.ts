export const REF = "$civicPayloadPart";
export type Ref = { readonly $civicPayloadPart: string };
export const isCivicPayloadPart = (value: unknown): value is Ref => value !== null && typeof value === "object" &&
  !Array.isArray(value) && Object.keys(value).length === 1 && typeof (value as Ref)[REF] === "string";
