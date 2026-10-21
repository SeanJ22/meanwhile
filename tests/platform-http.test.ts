import assert from "node:assert/strict";
import test from "node:test";
import { platformHttpResponse } from "../lib/doors/platform-http.ts";

test("platform HTTP preserves the document after interim headers and keeps redirects as actual redirects", async () => {
  const body = "BEGIN:VCALENDAR\r\nSUMMARY:Conseil municipal é\r\n\r\nEND:VCALENDAR";
  const response = platformHttpResponse(Buffer.from(`HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: text/calendar\r\nContent-Encoding: gzip\r\n\r\n${body}`));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), body);
  assert.equal(response.headers.get("content-type"), "text/calendar");
  assert.equal(response.headers.get("content-encoding"), null);
  const redirect = platformHttpResponse(Buffer.from("HTTP/1.1 302 Found\r\nLocation: https://example.gov/Calendar.aspx\r\n\r\nMoved"));
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "https://example.gov/Calendar.aspx");
  assert.throws(() => platformHttpResponse(Buffer.from("HTTP/1.1 200 OK\r\npartial headers")), /no complete HTTP headers/);
});
