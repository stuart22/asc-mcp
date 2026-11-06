// Runs the real entry point (src/index.ts) as a child process, like Claude does,
// and checks everything it writes to stdout and stderr. No network: the key-file
// problem is reported before any request to Apple.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "index.ts");

async function run(env: Record<string, string>, calls: Array<{ name: string; arguments: Record<string, unknown> }>) {
  const child = spawn(process.execPath, [entry], { env: { PATH: process.env.PATH ?? "", HOME: os.homedir(), ...env }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
  const responses = new Map<number, any>();
  const waiters = new Map<number, () => void>();
  child.stdout.setEncoding("utf8").on("data", (d: string) => {
    stdout += d;
    for (const line of d.split("\n").filter(Boolean)) {
      const msg = JSON.parse(line);
      if (msg.id !== undefined) {
        responses.set(msg.id, msg);
        waiters.get(msg.id)?.();
      }
    }
  });
  const send = (id: number, method: string, params: unknown) =>
    new Promise<any>((resolve) => {
      waiters.set(id, () => resolve(responses.get(id)));
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  await send(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const results = [];
  let id = 2;
  for (const c of calls) results.push(await send(id++, "tools/call", c));
  child.kill();
  await new Promise((r) => child.on("close", r));
  return { stdout, stderr, results };
}

test("real server: stderr has only the startup line and nothing secret reaches either stream", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "asc-mcp-test-"));
  const keyFile = path.join(dir, "AuthKey_ABCDE12345.p8");
  const pem = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  await writeFile(keyFile, pem);
  await chmod(keyFile, 0o644); // readable by others -> server must refuse before reading or using it
  try {
    const { stdout, stderr, results } = await run({ ASC_KEY_ID: "ABCDE12345", ASC_PRIVATE_KEY: keyFile }, [
      { name: "list_builds", arguments: { app: "Acme" } },
      { name: "list_customer_reviews", arguments: { app: "Acme" } },
    ]);
    for (const r of results) {
      assert.equal(r.result.isError, true);
      assert.match(r.result.content[0].text, /chmod 600/);
    }
    assert.deepEqual(stderr.trim().split("\n"), ["asc-mcp 0.1.0 ready (individual key ABCDE12345, key from file, read-only)"]);
    const body = pem.split("\n").slice(1, -2).join("");
    for (const chunk of [body.slice(0, 24), body.slice(-24)]) {
      assert.equal((stdout + stderr).includes(chunk), false, "key material leaked");
    }
    assert.equal(/bearer|authorization/i.test(stdout + stderr), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("real server: missing config is explained on stderr and in tool results", async () => {
  const { stderr, results } = await run({}, [{ name: "list_apps", arguments: {} }]);
  assert.match(stderr, /configuration problem — ASC_KEY_ID is not set/);
  assert.match(results[0].result.content[0].text, /ASC_KEY_ID is not set/);
});
