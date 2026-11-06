import { test } from "node:test";
import assert from "node:assert/strict";
import { AscClient, AscApiError, nextCursor, ASC_BASE_URL } from "../src/asc/client.ts";
import { fakeFetch, on } from "./helpers.ts";

const SECRET_TOKEN = "SECRET.TOKEN.SIGNATURE";
const tokens = { getToken: async () => SECRET_TOKEN };

function appleError(status: number, detail: string) {
  return { errors: [{ status: String(status), code: "X", title: "Apple title", detail }] };
}

test("sends GET with bearer token to the fixed Apple host", async () => {
  const f = fakeFetch(on("/v1/apps", { data: [] }));
  await new AscClient({ tokens, fetch: f }).get("/v1/apps");
  const req = f.requests[0]!;
  assert.equal(ASC_BASE_URL, "https://api.appstoreconnect.apple.com");
  assert.equal(req.url.origin, ASC_BASE_URL);
  assert.equal(req.init?.method, "GET");
  assert.equal(new Headers(req.init?.headers).get("authorization"), `Bearer ${SECRET_TOKEN}`);
});

test("encodes query including brackets and drops undefined values", async () => {
  const f = fakeFetch(on("/v1/builds", { data: [] }));
  await new AscClient({ tokens, fetch: f }).get("/v1/builds", { "filter[app]": "123", limit: 20, cursor: undefined });
  const req = f.requests[0]!;
  assert.match(req.url.search, /filter%5Bapp%5D=123/);
  assert.equal(req.url.searchParams.get("filter[app]"), "123");
  assert.equal(req.url.searchParams.get("limit"), "20");
  assert.equal(req.url.searchParams.has("cursor"), false);
});

test("rejects paths that could escape the API (absolute URLs, traversal)", async () => {
  const c = new AscClient({ tokens, fetch: fakeFetch() });
  await assert.rejects(c.get("https://evil.example/v1/apps"), /path/);
  await assert.rejects(c.get("//evil.example/v1/apps"), /path/);
  await assert.rejects(c.get("/v1/apps/../../x"), /path/);
});

for (const [status, hint] of [
  [401, /ASC_KEY_ID/],
  [403, /role|permission/i],
  [404, /not found/i],
  [429, /rate limit/i],
  [500, /Apple/],
] as const) {
  test(`maps ${status} to a readable hint with Apple's detail`, async () => {
    const f = fakeFetch(on("/v1/apps", appleError(status, "Apple says why"), status));
    await assert.rejects(new AscClient({ tokens, fetch: f }).get("/v1/apps"), (e: unknown) => {
      assert.ok(e instanceof AscApiError);
      assert.equal(e.status, status);
      assert.match(e.message, hint);
      assert.match(e.message, /Apple says why/);
      return true;
    });
  });
}

test("error never contains the token, even if Apple echoes it", async () => {
  const f = fakeFetch(on("/v1/apps", appleError(401, `bad token ${SECRET_TOKEN}`), 401));
  await assert.rejects(new AscClient({ tokens, fetch: f }).get("/v1/apps"), (e: unknown) => {
    assert.ok(e instanceof Error);
    assert.equal(e.message.includes(SECRET_TOKEN), false);
    assert.equal(String(e).includes(SECRET_TOKEN), false);
    assert.equal(JSON.stringify(e).includes(SECRET_TOKEN), false);
    return true;
  });
});

test("non-JSON error body still yields a readable error", async () => {
  const f = (async () => new Response("<html>Bad gateway</html>", { status: 502 })) as unknown as typeof fetch;
  await assert.rejects(new AscClient({ tokens, fetch: f }).get("/v1/apps"), (e: unknown) => e instanceof AscApiError && e.status === 502);
});

test("network failure / timeout becomes AscApiError with status 0", async () => {
  const f = (async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  }) as unknown as typeof fetch;
  await assert.rejects(new AscClient({ tokens, fetch: f }).get("/v1/apps"), (e: unknown) => e instanceof AscApiError && e.status === 0 && /reach|timed out/i.test(e.message));
});

test("nextCursor extracts the cursor from links.next", () => {
  assert.equal(nextCursor({ data: [], links: { next: "https://api.appstoreconnect.apple.com/v1/builds?cursor=eyJvIjoyMH0&limit=20" } }), "eyJvIjoyMH0");
  assert.equal(nextCursor({ data: [] }), undefined);
});

test("client exposes no method other than get (read-only by construction)", () => {
  const names = Object.getOwnPropertyNames(AscClient.prototype).filter((n) => n !== "constructor");
  assert.deepEqual(names, ["get"]);
});
