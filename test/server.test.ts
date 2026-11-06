import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer, TOOL_NAMES } from "../src/server.ts";
import { AREA_NAMES, type AreaName } from "../src/areas/areas.ts";
import { POLISHED } from "../src/areas/polished.ts";
import { AscClient } from "../src/asc/client.ts";
import { AppResolver } from "../src/asc/resolveApp.ts";
import { TokenProvider } from "../src/auth/jwt.ts";
import { fakeFetch, on, ACME, TEST_NOW, type Route } from "./helpers.ts";

type Msg = { jsonrpc: "2.0"; id?: number; result?: any; error?: any; method?: string };

/** Starts the real stdio entry over an in-memory pipe and returns a tiny JSON-RPC client. */
async function connect(fetchImpl: typeof fetch, opts: { hidden?: AreaName[] } = {}) {
  const key = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
  const tokens = new TokenProvider({ keyId: "ABCDE12345", loadKey: async () => key });
  const client = new AscClient({ tokens, fetch: fetchImpl });
  const deps = { client, apps: new AppResolver(client, () => TEST_NOW), now: () => TEST_NOW };

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const pending = new Map<number, (m: Msg) => void>();
  clientSide.onmessage = (m) => {
    const msg = m as Msg;
    if (msg.id !== undefined && pending.has(msg.id)) pending.get(msg.id)!(msg);
  };
  await clientSide.start();
  const handle = serveStdio(() => createServer(deps, opts), { transport: serverSide });

  let nextId = 1;
  const request = (method: string, params: unknown) =>
    new Promise<Msg>((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      void clientSide.send({ jsonrpc: "2.0", id, method, params } as never);
    });

  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test-client", version: "0.0.0" },
  });
  assert.ok(init.result, `initialize failed: ${JSON.stringify(init.error)}`);
  await clientSide.send({ jsonrpc: "2.0", method: "notifications/initialized" } as never);

  return {
    request,
    callTool: (name: string, args: Record<string, unknown>) => request("tools/call", { name, arguments: args }),
    close: () => handle.close(),
    key,
    tokens,
  };
}

const buildsRoute: Route = on("/v1/builds", {
  data: [{ type: "builds", id: "b1", attributes: { version: "7", processingState: "PROCESSING", uploadedDate: "2026-11-05T14:00:00Z" } }],
});

test("tools/list returns the 16 read-only area tools", async () => {
  const s = await connect(fakeFetch(on("/v1/apps", { data: [ACME] })));
  try {
    const res = await s.request("tools/list", {});
    const tools = res.result.tools as Array<{ name: string; description: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }>;
    assert.deepEqual(tools.map((t) => t.name), [...AREA_NAMES]);
    assert.deepEqual([...TOOL_NAMES], [...AREA_NAMES]);
    assert.equal(tools.length, 16);
    for (const t of tools) {
      assert.equal(t.annotations?.readOnlyHint, true, `${t.name} must be read-only`);
      assert.equal(t.annotations?.destructiveHint, false);
      assert.ok(t.description.startsWith("Read-only."), t.name);
      assert.match(t.description, /Call with no `lookup` to see what you can look up here\.$/);
    }
  } finally {
    await s.close();
  }
});

test("hidden areas are not registered", async () => {
  const s = await connect(fakeFetch(on("/v1/apps", { data: [ACME] })), { hidden: ["game_center"] });
  try {
    const res = await s.request("tools/list", {});
    const names = (res.result.tools as Array<{ name: string }>).map((t) => t.name);
    assert.equal(names.length, 15);
    assert.equal(names.includes("game_center"), false);
  } finally {
    await s.close();
  }
});

test("builds tool lists processing builds", async () => {
  const s = await connect(fakeFetch(on("/v1/apps", { data: [ACME] }), buildsRoute));
  try {
    const res = await s.callTool("builds", { lookup: "list", app: "Acme", params: { status: "processing" } });
    assert.equal(res.result.isError ?? false, false);
    assert.match(res.result.content[0].text, /^Processing builds for Acme \(com\.acme\.app\)/);
  } finally {
    await s.close();
  }
});

test("out-of-range limit is rejected by the schema", async () => {
  const f = fakeFetch(on("/v1/apps", { data: [ACME] }));
  const s = await connect(f);
  try {
    const res = await s.callTool("builds", { lookup: "list", app: "Acme", limit: 5000 });
    const failed = res.error !== undefined || res.result?.isError === true;
    assert.ok(failed, "limit above 200 must be rejected");
    assert.equal(f.requests.length, 0);
  } finally {
    await s.close();
  }
});

test("tool error does not crash the server", async () => {
  let calls = 0;
  const flaky = (async (input: URL) => {
    calls++;
    if (calls === 1) throw new TypeError("fetch failed");
    return fakeFetch(on("/v1/apps", { data: [ACME] }), buildsRoute)(input);
  }) as unknown as typeof fetch;
  const s = await connect(flaky);
  try {
    const bad = await s.callTool("builds", { lookup: "list", app: "Acme" });
    assert.equal(bad.result.isError, true);
    assert.match(bad.result.content[0].text, /Couldn't reach App Store Connect/);
    const good = await s.callTool("builds", { lookup: "list", app: "Acme" });
    assert.equal(good.result.isError ?? false, false);
  } finally {
    await s.close();
  }
});

test("no secret appears in tool results", async () => {
  const f = fakeFetch(on("/v1/apps", { errors: [{ status: "401", code: "NOT_AUTHORIZED", title: "Unauthorized", detail: "bad" }] }, 401));
  const s = await connect(f);
  try {
    const token = await s.tokens.getToken();
    const pem = s.key.export({ format: "pem", type: "pkcs8" }).toString();
    const pemBody = pem.split("\n")[1]!;
    const outputs = [];
    for (const name of TOOL_NAMES) {
      if (POLISHED[name].some((p) => p.name === "list")) outputs.push(JSON.stringify(await s.callTool(name, { lookup: "list", app: "Acme" })));
    }
    assert.match(outputs[0]!, /401/);
    for (const name of TOOL_NAMES) outputs.push(JSON.stringify(await s.callTool(name, {})));
    const everything = outputs.join("\n"); // stderr is covered by test/stdio.test.ts
    assert.equal(everything.includes(token), false, "token leaked");
    assert.equal(everything.includes(token.split(".")[2]!), false, "signature leaked");
    assert.equal(everything.includes(pemBody), false, "key leaked");
    assert.equal(/authorization|bearer/i.test(everything), false, "auth header leaked");
  } finally {
    await s.close();
  }
});
