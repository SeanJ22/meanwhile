/** Upload one immutable national archive to the existing Netlify site. Never put tiles in git. */
import { getStore } from "@netlify/blobs";
import { openAsBlob } from "node:fs";
import { basename } from "node:path";

const file = process.argv[2], key = process.argv[3] ?? (file ? basename(file) : "");
if (!file || !/^census-\d{4}-[a-z0-9-]+\.pmtiles$/.test(key)) throw new Error("Usage: publish-boundaries.mts <archive.pmtiles> census-2025-v1.pmtiles");
const siteID = process.env.WTP_BLOBS_SITE_ID, token = process.env.WTP_BLOBS_TOKEN;
if (!siteID || !token) throw new Error("Set the existing site's WTP_BLOBS_SITE_ID and WTP_BLOBS_TOKEN");
const store = getStore({ name: "map-tiles", siteID, token });
const blob = await openAsBlob(file);
await store.set(key, blob, { onlyIfNew: true, metadata: { contentType: "application/vnd.pmtiles", bytes: blob.size } });
console.log(JSON.stringify({ archive: key, bytes: blob.size, url: `/api/boundaries/${key}` }));
