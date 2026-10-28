import { sourceContentHash } from "../../civic-data/source-hash.ts";
import { requiredPrlDataset } from "./inventory.ts";
import { PRL_RHETORIC_ATTRIBUTION } from "./types.ts";

export interface PrlSourceProbe {
  readonly formatVersion:1;
  readonly parserVersion:string;
  readonly complete:boolean;
  readonly requests:readonly {datasetId:string;requestedUrl:string;finalUrl:string;rawHash:string;member:string|null}[];
}
export function prlSourceContentHash(probe:PrlSourceProbe):string {
  const datasets=probe.requests.map(request=>{
    const {id,url,file,target,format,key,cursorField,dateField,scope}=requiredPrlDataset(request.datasetId);
    return {id,url,file,target,format,key,cursorField,dateField,scope};
  }).sort((a,b)=>a.id.localeCompare(b.id));
  // The exact archive SHA already includes its member name; a conditional shortcut need not reopen the ZIP directory.
  return sourceContentHash(probe.requests.map(request=>({...request,capture:{rawHash:request.rawHash},request:{datasetId:request.datasetId}})),
    {parserVersion:probe.parserVersion,datasets,attribution:PRL_RHETORIC_ATTRIBUTION});
}
