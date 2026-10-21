import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readerZipStarts } from "../lib/geo/reader-zip-start.ts";

const [centroids, postal] = await Promise.all([
  readFile("lib/geo/zcta-centroids.json", "utf8").then(JSON.parse),
  readFile("lib/geo/postal-zips.json", "utf8").then(JSON.parse),
]);
const shards = readerZipStarts(centroids.centroids, postal.zips);
await mkdir("public/geo/reader-zips", { recursive: true });
await Promise.all(shards.map((shard, index) => writeFile(`public/geo/reader-zips/${String(index).padStart(2, "0")}.json`, JSON.stringify(shard))));
console.log(`reader ZIP starts: ${shards.reduce((count, shard) => count + Object.keys(shard.locations).length, 0)} source-resolved ZIPs in 100 regional files`);
