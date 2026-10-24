export const ECHO_PROGRAM_ID_FIELDS=["AIR_IDS","NPDES_IDS","RCRA_IDS","SDWA_IDS","TRI_IDS"] as const;
const text=(value:unknown)=>value===null||value===undefined?"":String(value).trim();
/** A program-only ECHO row keeps its published program identity; it never acquires an invented FRS ID. */
export function echoSourceIdentity(row:Readonly<Record<string,unknown>>):{key:string;identifiers:Readonly<Record<string,string>>}|null {
  const registry=text(row.REGISTRY_ID??row.RegistryID);
  if(registry)return {key:registry,identifiers:{registry_id:registry}};
  let url:URL;
  try {url=new URL(text(row.DFR_URL));}catch{return null;}
  if(!["http:","https:"].includes(url.protocol)||url.hostname!=="echo.epa.gov"||url.port||url.username||url.password||
    url.pathname!=="/detailed-facility-report"||url.searchParams.getAll("fid").length!==1)return null;
  const fid=text(url.searchParams.get("fid"));
  if(!/^[A-Za-z0-9._ -]+$/.test(fid))return null;
  const programs=ECHO_PROGRAM_ID_FIELDS.filter(field=>text(row[field]).split(/[,;|]+/).map(value=>value.trim()).includes(fid));
  if(programs.length!==1)return null;
  const field=programs[0].toLowerCase();
  return {key:`program:${field}:${fid}`,identifiers:{echo_fid:fid,[field]:text(row[programs[0]])}};
}
