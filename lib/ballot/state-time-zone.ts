/** The zone a state's election offices keep: the one most of its voters live in. */
const STATE_TIME_ZONE: Readonly<Record<string, string>> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago", CA: "America/Los_Angeles",
  CO: "America/Denver", CT: "America/New_York", DE: "America/New_York", DC: "America/New_York", FL: "America/New_York",
  GA: "America/New_York", HI: "Pacific/Honolulu", ID: "America/Boise", IL: "America/Chicago", IN: "America/Indiana/Indianapolis",
  IA: "America/Chicago", KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago", ME: "America/New_York",
  MD: "America/New_York", MA: "America/New_York", MI: "America/Detroit", MN: "America/Chicago", MS: "America/Chicago",
  MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago", NV: "America/Los_Angeles", NH: "America/New_York",
  NJ: "America/New_York", NM: "America/Denver", NY: "America/New_York", NC: "America/New_York", ND: "America/Chicago",
  OH: "America/New_York", OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", UT: "America/Denver",
  VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles", WV: "America/New_York", WI: "America/Chicago",
  WY: "America/Denver", AS: "Pacific/Pago_Pago", GU: "Pacific/Guam", MP: "Pacific/Saipan", PR: "America/Puerto_Rico",
  VI: "America/St_Thomas",
};

/** Today's date, `YYYY-MM-DD`, where the state is. An unknown state falls back to Eastern, the product's clock. */
export function stateToday(state: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: STATE_TIME_ZONE[state] ?? "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
