import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {decodeImage,normalizePortrait,MAX_PORTRAIT_BYTES,PORTRAIT_FORMATS,PORTRAIT_DECODER_VERSION} from "../lib/photos/decode.ts";
const source=()=>sharp({create:{width:160,height:120,channels:3,background:{r:30,g:120,b:200}}});

test("the full decoder rejects empty, HTML and a plausible JPEG header without pixels",async()=>{
  for(const bytes of [new Uint8Array(),new TextEncoder().encode("<html>not a portrait</html>"),new Uint8Array([255,216,255,224,0,16,74,70,73,70,0,1])]) assert.equal((await decodeImage(bytes)).ok,false);
});
test("every advertised raster format fully decodes and becomes static WebP",async()=>{
  for(const format of PORTRAIT_FORMATS) {
    const result=await normalizePortrait(await source().toFormat(format).toBuffer());
    assert.equal(result.verdict.ok,true,format);if(!("bytes" in result))throw Error(format);
    const image=await sharp(result.bytes).raw().toBuffer({resolveWithObject:true});
    assert.equal(image.info.width,160);assert.equal(image.info.height,120);
    assert.equal((await sharp(result.bytes).metadata()).format,"webp");
  }
  assert.match(PORTRAIT_DECODER_VERSION,/sharp/);
});
test("truncated compressed pixel data cannot pass its valid image header",async()=>{
  for(const format of ["png","jpeg","webp"] as const) {
    const bytes=await source().toFormat(format).toBuffer();
    assert.equal((await decodeImage(bytes.subarray(0,Math.floor(bytes.length*.6)))).ok,false,format);
  }
});
test("icons and oversized transport bodies are not portraits",async()=>{
  assert.equal((await decodeImage(await sharp({create:{width:32,height:32,channels:3,background:"red"}}).png().toBuffer())).ok,false);
  assert.equal((await decodeImage(new Uint8Array(MAX_PORTRAIT_BYTES+1))).ok,false);
});
test("orientation is applied and all source metadata is removed from the stored image",async()=>{
  const original=await source().withMetadata({orientation:6}).jpeg().toBuffer();
  assert.ok((await sharp(original).metadata()).exif);
  const normalized=await normalizePortrait(original);assert.equal(normalized.verdict.ok,true);if(!("bytes" in normalized))return;
  const meta=await sharp(normalized.bytes).metadata();
  assert.equal(meta.width,120);assert.equal(meta.height,160);assert.equal(meta.exif,undefined);assert.equal(meta.icc,undefined);
});
