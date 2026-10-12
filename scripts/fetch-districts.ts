import { readZipEntries } from "../lib/sources/archive.ts";
/** Build one national PMTiles archive from Census boundaries, outside git.
 * node --experimental-strip-types scripts/fetch-districts.ts --output=<file.pmtiles>
 * Requires the official `pmtiles` CLI on PATH (or PMTILES_CLI). No state/county clip.
 * MapLibre's tiler simplifies at each zoom; the original cartographic geometry is
 * retained at max zoom. Each layer runs in a separate process to release its index.
 */
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
type SqlValue = string | number | Uint8Array | null;
interface SqlStatement { run(...params:SqlValue[]):void; get(...params:SqlValue[]):Record<string,SqlValue>|undefined; iterate(...params:SqlValue[]):Iterable<Record<string,SqlValue>> }
interface SqlDatabase { exec(sql:string):void; prepare(sql:string):SqlStatement; close():void }
const {DatabaseSync} = createRequire(import.meta.url)('node:sqlite') as {DatabaseSync: new(path:string,options?:{readOnly:boolean})=>SqlDatabase};
import { GeoJSONVT } from '@maplibre/geojson-vt';
import { fromGeojsonVt, fromVectorTileJs } from '@maplibre/vt-pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { countyIdentity, legislativeIdentity, placeIdentity, schoolIdentity, subdivisionIdentity, type DivisionIdentity } from '../lib/ocd/divisions.ts';
import { districtIdentity } from '../lib/ocd/fips.ts';


const VINTAGE = '2025';
const BASE = `https://www2.census.gov/geo/tiger/GENZ${VINTAGE}/shp`;
const TIGER_BASE = `https://www2.census.gov/geo/tiger/TIGER${VINTAGE}`;
const argument = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const output = resolve(argument('output') ?? '../national-boundaries.pmtiles');
const cache = resolve(process.env.DISTRICTS_CACHE ?? join(dirname(output), 'census-boundary-cache'));
const maxZoom = Number(argument('maxzoom') ?? 11);
type Row = Record<string, string>;
const layers = [
  ['cd119', 'congressional'], ['sldu', 'state-senate'], ['sldl', 'state-house'],
  ['county', 'county'], ['place', 'municipal'], ['cousub', 'municipal'],
  ['unsd', 'school-unified'], ['elsd', 'school-elementary'], ['scsd', 'school-secondary'],
] as const;
function extractAll(zip: Buffer): Map<string, Buffer> {
  return new Map(readZipEntries(zip, { maxMemberBytes: 512 * 1024 * 1024, maxTotalBytes: 1024 * 1024 * 1024 }).map(entry => [entry.name, entry.data]));
}

/* ------------------------------------------------------------------ dbf --- */

/** Attribute table rows, as strings. Numeric coercion is the caller's job. */
function parseDbf(buf: Buffer): Record<string, string>[] {
  const recordCount = buf.readUInt32LE(4);
  const headerLength = buf.readUInt16LE(8);
  const recordLength = buf.readUInt16LE(10);

  const fields: { name: string; length: number }[] = [];
  for (let offset = 32; offset < headerLength - 1; offset += 32) {
    if (buf[offset] === 0x0d) break;
    const name = buf
      .subarray(offset, offset + 11)
      .toString("latin1")
      .replace(/\0.*$/, "")
      .trim();
    fields.push({ name, length: buf[offset + 16] });
  }

  const rows: Record<string, string>[] = [];
  for (let r = 0; r < recordCount; r++) {
    const start = headerLength + r * recordLength;
    // First byte is the deletion flag; 0x2a marks a deleted record.
    if (buf[start] === 0x2a) continue;

    let cursor = start + 1;
    const row: Record<string, string> = {};
    for (const field of fields) {
      row[field.name] = buf
        .subarray(cursor, cursor + field.length)
        .toString("latin1")
        .trim();
      cursor += field.length;
    }
    rows.push(row);
  }

  return rows;
}

/* ------------------------------------------------------------------ shp --- */

type Ring = [number, number][];
/** One polygon: exterior ring first, then any holes. */
type Polygon = Ring[];

/**
 * Signed area by the shoelace formula. Positive is counter-clockwise.
 * Shapefiles wind exterior rings clockwise and holes counter-clockwise, so
 * this sign test is what tells an outer ring from a hole.
 */
function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return sum / 2;
}

/** Polygon geometries, one entry per shapefile record, in file order. */
function parseShp(buf: Buffer): Polygon[][] {
  const shapes: Polygon[][] = [];
  let offset = 100; // file header

  while (offset < buf.length) {
    const contentLength = buf.readInt32BE(offset + 4) * 2;
    const content = offset + 8;
    const shapeType = buf.readInt32LE(content);

    // 0 is a null shape; 5 is Polygon. Nothing else appears in a cb_ cd file.
    if (shapeType === 0) {
      shapes.push([]);
      offset = content + contentLength;
      continue;
    }
    if (shapeType !== 5) {
      throw new Error(`Unexpected shape type ${shapeType} at byte ${content}.`);
    }

    const numParts = buf.readInt32LE(content + 36);
    const numPoints = buf.readInt32LE(content + 40);
    const partsStart = content + 44;
    const pointsStart = partsStart + numParts * 4;

    const partIndex: number[] = [];
    for (let p = 0; p < numParts; p++) {
      partIndex.push(buf.readInt32LE(partsStart + p * 4));
    }

    const rings: Ring[] = [];
    for (let p = 0; p < numParts; p++) {
      const from = partIndex[p];
      const to = p + 1 < numParts ? partIndex[p + 1] : numPoints;
      const ring: Ring = [];
      for (let i = from; i < to; i++) {
        const at = pointsStart + i * 16;
        ring.push([buf.readDoubleLE(at), buf.readDoubleLE(at + 8)]);
      }
      rings.push(ring);
    }

    // A clockwise ring (negative area) opens a new polygon; counter-clockwise
    // rings are holes belonging to the polygon that opened before them.
    const polygons: Polygon[] = [];
    for (const ring of rings) {
      if (signedArea(ring) < 0 || polygons.length === 0) polygons.push([ring]);
      else polygons[polygons.length - 1].push(ring);
    }

    shapes.push(polygons);
    offset = content + contentLength;
  }

  return shapes;
}

async function download(url: string): Promise<Buffer> {
  const dest = join(cache, new URL(url).pathname.split('/').at(-1)!);
  if (existsSync(dest)) return readFile(dest);
  await mkdir(cache, {recursive:true});
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      if (attempt < 3 && (response.status === 429 || response.status >= 500)) {
        await new Promise(r => setTimeout(r, 1000 * 2 ** attempt)); continue;
      }
      throw new Error(`Census ${response.status}: ${url}`);
    }
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(`${dest}.part`));
    await rename(`${dest}.part`, dest);
    console.log(`saved ${dest}`);
    return readFile(dest);
  }
}
function shapeFile(zip: Buffer) {
  const files = extractAll(zip);
  const entry = (suffix: string) => files.get([...files.keys()].find(name => name.endsWith(suffix))!)!;
  const rows = parseDbf(entry('.dbf')), shapes = parseShp(entry('.shp'));
  if (rows.length !== shapes.length) throw new Error('Census attribute/geometry row mismatch');
  return {rows, shapes};
}
function identity(layer: string, row: Row): DivisionIdentity | null {
  if (layer === 'cd119') return districtIdentity(row.STATEFP, row.CD119FP);
  if (layer === 'sldu' || layer === 'sldl') return legislativeIdentity(row.STATEFP, layer, row[layer === 'sldu' ? 'SLDUST' : 'SLDLST'], row.NAMELSAD);
  if (layer === 'county') return countyIdentity(row.STATEFP, row.NAME);
  if (layer === 'place') return placeIdentity(row.STATEFP, row.NAME, row.LSAD, row.FUNCSTAT, row.CLASSFP);
  if (layer === 'cousub') return subdivisionIdentity(row.STATEFP, row.NAMELSADCO, row.NAMELSAD, row.LSAD, row.FUNCSTAT, row.CLASSFP);
  // Census's no-school pseudo-district is not a school government.
  if (/not defined|not assigned/i.test(row.NAME)) return null;
  return schoolIdentity(row.STATEFP, row.NAME);
}
async function buildLayer(layer: string, boundaryType: string) {
  const {rows, shapes} = shapeFile(await download(`${BASE}/cb_${VINTAGE}_us_${layer}_500k.zip`));
  if (layer === 'place' || layer === 'cousub') {
    for (const state of new Set(rows.map(row => row.STATEFP))) {
      const files = extractAll(await download(`${TIGER_BASE}/${layer.toUpperCase()}/tl_${VINTAGE}_${state}_${layer}.zip`));
      const dbf = files.get([...files.keys()].find(name => name.endsWith('.dbf'))!)!;
      const attrs = new Map(parseDbf(dbf).map(row => [row.GEOID, row]));
      for (const row of rows) if (row.STATEFP === state) {
        const match = attrs.get(row.GEOID);
        if (!match) throw new Error(`Missing TIGER attributes for ${layer} ${row.GEOID}`);
        row.FUNCSTAT = match.FUNCSTAT; row.CLASSFP = match.CLASSFP;
      }
    }
  }
  const features: {type:"Feature"; properties: DivisionIdentity & {boundaryType:string;censusLayer:string;geoid:string;west:number;south:number;east:number;north:number};geometry:{type:"MultiPolygon";coordinates:Polygon[]}}[] = [];
  for (let i=0;i<rows.length;i++) {
    const row = rows[i], id = identity(layer, row), polygons = shapes[i];
    if (!id || polygons.length === 0) continue;
    const points = polygons.flatMap(p=>p[0]);
    let west=180,south=90,east=-180,north=-90;
    for (const [x,y] of points) {west=Math.min(west,x);south=Math.min(south,y);east=Math.max(east,x);north=Math.max(north,y);}
    features.push({type:'Feature', properties:{...id,boundaryType,censusLayer:layer,geoid:row.GEOID,west,south,east,north},geometry:{type:'MultiPolygon',coordinates:polygons}});
  }
  // Preserve existing names; disambiguate every side of a real within-layer name collision.
  const counts = new Map<string,number>();
  for (const f of features) counts.set(f.properties!.ocdId,(counts.get(f.properties!.ocdId)??0)+1);
  for (const f of features) if (counts.get(f.properties!.ocdId)!>1) f.properties!.ocdId += `_${f.properties!.geoid}`;
  console.log(`${layer}: ${features.length} national features, ${new Set(features.map(f=>f.properties!.state)).size} states/territories`);
  const index = new GeoJSONVT({type:'FeatureCollection',features},{maxZoom,indexMaxZoom:4,indexMaxPoints:50000,tolerance:3,extent:4096,buffer:64});
  const db = new DatabaseSync(join(cache,`${layer}.sqlite`));
  db.exec('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; DROP TABLE IF EXISTS tiles; CREATE TABLE tiles (z INTEGER,x INTEGER,y INTEGER,data BLOB,PRIMARY KEY(z,x,y)); BEGIN');
  const insert = db.prepare('INSERT INTO tiles VALUES (?,?,?,?)');
  let count=0;
  const visit = (z:number,x:number,y:number) => {
    const tile = index.getTile(z,x,y);
    if (!tile || tile.features.length===0) return;
    insert.run(z,x,y,gzipSync(fromGeojsonVt({districts:tile})));
    count++;
    if (z<maxZoom) for (let dy=0;dy<2;dy++) for (let dx=0;dx<2;dx++) visit(z+1,x*2+dx,y*2+dy);
  };
  visit(0,0,0);
  db.exec('COMMIT'); db.close();
  console.log(`${layer}: ${count} tiles; RSS ${(process.memoryUsage().rss/2**20).toFixed(0)} MiB`);
}
async function main() {
  await mkdir(cache,{recursive:true});
  const one = argument('layer');
  if (one) { const layer=layers.find(([key])=>key===one); if (!layer) throw new Error(`Unknown layer ${one}`); await buildLayer(layer[0],layer[1]); return; }
  for (const [layer] of layers) {
    if (process.argv.includes('--reuse-tiles') && existsSync(join(cache,`${layer}.sqlite`))) continue;
    const child=spawnSync(process.execPath,['--max-old-space-size=3072','--experimental-strip-types',process.argv[1],`--layer=${layer}`,`--output=${output}`,`--maxzoom=${maxZoom}`],{stdio:'inherit'});
    if(child.status!==0) throw new Error(`${layer} builder exited ${child.status}`);
  }
  const mbtiles=output.replace(/\.pmtiles$/,'.mbtiles');
  const db=new DatabaseSync(mbtiles);
  db.exec('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; DROP TABLE IF EXISTS tiles; DROP TABLE IF EXISTS metadata; CREATE TABLE tiles (zoom_level INTEGER,tile_column INTEGER,tile_row INTEGER,tile_data BLOB,PRIMARY KEY(zoom_level,tile_column,tile_row)); CREATE TABLE metadata(name TEXT,value TEXT); CREATE TEMP TABLE coords(z INTEGER,x INTEGER,y INTEGER,PRIMARY KEY(z,x,y));');
  const parts=layers.map(([key])=>new DatabaseSync(join(cache,`${key}.sqlite`),{readOnly:true}));
  db.exec('BEGIN');
  const coord=db.prepare('INSERT OR IGNORE INTO coords VALUES (?,?,?)');
  for(const part of parts) for(const row of part.prepare('SELECT z,x,y FROM tiles').iterate()) coord.run(row.z,row.x,row.y);
  const get=parts.map(part=>part.prepare('SELECT data FROM tiles WHERE z=? AND x=? AND y=?'));
  const insert=db.prepare('INSERT INTO tiles VALUES (?,?,?,?)');
  let count=0;
  for(const {z,x,y} of db.prepare('SELECT z,x,y FROM coords ORDER BY z,x,y').iterate()) {
    const tiles=get.flatMap(stmt=>{const r=stmt.get(z,x,y);return r?[new VectorTile(new PbfReader(gunzipSync(r.data as Uint8Array))).layers.districts]:[];});
    const features=tiles.flatMap(tile=>Array.from({length:tile.length},(_,i)=>tile.feature(i)));
    const merged={version:2,name:'districts',extent:4096,length:features.length,feature:(i:number)=>features[i]};
    insert.run(z,x,2**Number(z)-1-Number(y),gzipSync(fromVectorTileJs({layers:{districts:merged}})));
    if(++count%10000===0) console.log(`merged ${count} tiles`);
  }
  const meta=db.prepare('INSERT INTO metadata VALUES (?,?)');
  for(const [name,value] of Object.entries({name:`Census ${VINTAGE} national boundaries`,format:'pbf',minzoom:'0',maxzoom:String(maxZoom),bounds:'-180,-15,180,85',type:'overlay',version:'1',attribution:'U.S. Census Bureau',json:JSON.stringify({vector_layers:[{id:'districts',fields:{ocdId:'String',label:'String',boundaryType:'String',censusLayer:'String'},minzoom:0,maxzoom:maxZoom}]})})) meta.run(name,value);
  db.exec('COMMIT'); db.close(); for(const part of parts) part.close();
  const result=spawnSync(process.env.PMTILES_CLI??'pmtiles',['convert',mbtiles,output],{stdio:'inherit'});
  if(result.status!==0) throw new Error(`pmtiles convert exited ${result.status}`);
  console.log(`National boundary archive: ${output}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
