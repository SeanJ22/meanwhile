/** Official APIs sometimes put a vacancy label in the holder's name field. */
export function rosterHolderName(value:unknown):string|null {
  if(typeof value!=="string")return null;
  const name=value.trim();
  return !name||/^(?:vacant|vacancy|vacant seat|unfilled|unassigned|tbd|to be (?:appointed|determined))$/i.test(name)?null:name;
}
