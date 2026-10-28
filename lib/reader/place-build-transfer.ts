import { CivicReadCache } from "../db/civic-read-cache.ts";
import { versionedSelect, type VersionedRowRetention } from "../db/versioned-query.ts";
import type { Query } from "../facts/publish.ts";

export type PlaceBuildTransfer = (query: Query, statement: string, params: readonly unknown[]) => Promise<readonly Record<string,unknown>[]>;

/** One body's unchanged facts survive another body's insertion, removal or reordering in the ZIP selection. */
export function sharedPlaceBuildRead(scope:string,retention?:VersionedRowRetention):PlaceBuildTransfer {
  // Only the turn's bounded memory holds input copies; nothing generated is saved to the host cache.
  const transient=new CivicReadCache({read:async()=>null,write:async()=>{}});
  const select=versionedSelect(`place-build:${scope}`,transient,{rowScope:scope,retention,retainRow:row=>row.section!=="__header__"});
  return async(query,statement,params)=>{
    const rows=await select(query,`WITH selected AS MATERIALIZED (${statement}), fields AS MATERIALIZED (
      SELECT f.key,f.value,jsonb_typeof(f.value) AS kind FROM selected,LATERAL jsonb_each(coalesce(selected.row,'{}'::jsonb)) f
    ), elements AS MATERIALIZED (
      SELECT f.key AS section,a.n AS ordinal,a.value,
        encode(sha256(convert_to(coalesce((CASE WHEN f.key IN ('fields','rosters','sittings','comments') THEN 'facts:' ELSE f.key||':' END)||coalesce(a.value->>'body_id',a.value->>'entity_id',a.value->>'id',a.value->>'scope',a.value->>'ocdId'),'array:'||f.key),'UTF8')),'hex') AS group_key
      FROM fields f,LATERAL jsonb_array_elements(CASE WHEN f.kind='array' THEN f.value ELSE '[]'::jsonb END) WITH ORDINALITY a(value,n)
    ), numbered AS MATERIALIZED (
      SELECT *,row_number() OVER(PARTITION BY section,group_key ORDER BY value::text,ordinal)-1 AS local_index FROM elements
    ), section_values AS (
      SELECT section,group_key,jsonb_agg(value ORDER BY value::text,ordinal) AS value FROM numbered GROUP BY section,group_key
      UNION ALL SELECT key,encode(sha256(convert_to('scalar:'||key,'UTF8')),'hex'),value FROM fields WHERE kind<>'array' AND key<>'parts'
    ), groups AS MATERIALIZED (
      SELECT group_key,jsonb_object_agg(section,value) AS value FROM section_values GROUP BY group_key
    ), text_values AS MATERIALIZED (
      SELECT DISTINCT text.value FROM selected,LATERAL jsonb_path_query(selected.row,'strict $.** ? (@.type() == "string")') text(value)
      WHERE octet_length(text.value::text)>256
    ), group_keys AS MATERIALIZED (
      SELECT group_key,row_number() OVER(ORDER BY group_key)-1 AS group_index FROM groups
    ), layouts AS (
      SELECT n.section,jsonb_agg(jsonb_build_array(g.group_index,n.local_index) ORDER BY n.ordinal) AS value
      FROM numbered n JOIN group_keys g USING(group_key) GROUP BY n.section
    ) SELECT '__header__'::text AS section,''::text AS chunk,
      jsonb_build_object('metadata',to_jsonb(selected)-'row','kinds',coalesce((SELECT jsonb_object_agg(key,kind) FROM fields),'{}'::jsonb),
        'layout',coalesce((SELECT jsonb_object_agg(section,value) FROM layouts),'{}'::jsonb)) AS value FROM selected
      UNION ALL SELECT 'data',group_key,reader_place_build_pack(value) FROM groups
      UNION ALL SELECT 'text',encode(sha256(convert_to(value::text,'UTF8')),'hex'),value FROM text_values
      UNION ALL SELECT 'parts:'||p.key,'',reader_place_build_pack(jsonb_build_object(p.key,p.value)) FROM fields f,
        LATERAL jsonb_each(CASE WHEN f.key='parts' THEN f.value ELSE '{}'::jsonb END) p ORDER BY section,chunk`,params);
    const header=rows.find(row=>row.section==='__header__')?.value as {
      metadata:Record<string,unknown>;kinds:Record<string,string>;layout:Record<string,readonly (readonly [number,number])[]>;
    }|undefined;
    if(!header)throw new Error("PLACE_BUILD_TRANSFER_HEADER_MISSING");
    if(header.metadata.reused_page_id)return [header.metadata];
    const row:Record<string,unknown>=Object.fromEntries(Object.entries(header.kinds).map(([key,kind])=>[key,kind==='array'?[]:kind==='object'?{}:null]));
    const textValues=new Map(rows.filter(part=>part.section==='text').map(part=>[String(part.chunk),part.value]));
    const expand=(packed:unknown):unknown=>{
      if(!Array.isArray(packed) || packed.length!==3 || !Array.isArray(packed[0]))throw new Error("PLACE_BUILD_TRANSFER_PACK_INVALID");
      const [dictionary,keySets,shape]=packed as [unknown[],number[][],unknown];
      const strings:string[]=[];
      for(const entry of dictionary){
        if(typeof entry==='string')strings.push(entry);
        else if(Array.isArray(entry))strings.push(Array.from(strings.at(-1)??'').slice(0,entry[0]).join('')+entry[1]);
        else {
          const hash=(entry as {text:string}).text;
          if(!textValues.has(hash))throw new Error("PLACE_BUILD_TRANSFER_TEXT_MISSING");
          strings.push(textValues.get(hash) as string);
        }
      }
      const decode=(value:unknown):unknown=>{
        if(typeof value==='number'){
          const string=strings[value];
          if(!Number.isSafeInteger(value) || string===undefined)throw new Error("PLACE_BUILD_TRANSFER_STRING_MISSING");
          return string;
        }
        if(Array.isArray(value)){
          const keys=keySets[value[0]];
          if(!keys || keys.length!==value.length-1)throw new Error("PLACE_BUILD_TRANSFER_KEYS_INVALID");
          return Object.fromEntries(keys.map((key,index)=>[decode(key),decode(value[index+1])] as [string,unknown]));
        }
        if(!value || typeof value!=='object')throw new Error("PLACE_BUILD_TRANSFER_NODE_INVALID");
        if(Object.hasOwn(value,'a'))return (value as {a:unknown[]}).a.map(decode);
        if(Object.hasOwn(value,'v'))return (value as {v:unknown}).v;
        throw new Error("PLACE_BUILD_TRANSFER_NODE_INVALID");
      };
      return decode(shape);
    };
    const groups=rows.filter(part=>part.section==='data').map(part=>expand(part.value) as Record<string,unknown>);
    for(const group of groups)for(const [key,value] of Object.entries(group))if(header.kinds[key]!=='array')row[key]=value;
    for(const [key,layout] of Object.entries(header.layout))row[key]=layout.map(([group,index])=>(groups[group]![key] as unknown[])[index]);
    for(const part of rows)if(String(part.section).startsWith('parts:'))Object.assign(row.parts as Record<string,unknown>,expand(part.value));
    return [{...header.metadata,row}];
  };
}
