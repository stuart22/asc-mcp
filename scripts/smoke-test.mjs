// Manual smoke test against the REAL App Store Connect API, using your own key.
// It starts the built server exactly as Claude would (stdio), then calls each
// read-only tool and prints what Claude would see.
//
//   ASC_KEY_ID=XXXXXXXXXX npm run smoke -- "My App"
//
// Uses the same env vars as the Claude config (ASC_KEY_ID, optional ASC_ISSUER_ID,
// optional ASC_PRIVATE_KEY). Only reads data; never changes anything.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appArg = process.argv[2];

const child = spawn(process.execPath, [path.join(root, "dist", "index.js")], {
  env: process.env,
  stdio: ["pipe", "pipe", "inherit"],
});

let buffer = "";
const waiting = new Map();
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined) waiting.get(msg.id)?.(msg);
  }
});

let nextId = 0;
function request(method, params) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 60_000);
    waiting.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

let failures = 0;
async function call(name, args) {
  console.log(`\n── ${name} ${JSON.stringify(args)}`);
  const res = await request("tools/call", { name, arguments: args });
  if (res.error) {
    failures++;
    console.log(`PROTOCOL ERROR: ${res.error.message}`);
    return "";
  }
  const text = res.result.content.map((c) => c.text).join("\n");
  if (res.result.isError) failures++;
  console.log(res.result.isError ? `ERROR: ${text}` : text);
  return res.result.isError ? "" : text;
}

try {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "asc-mcp-smoke-test", version: "1" },
  });
  if (!init.result) throw new Error(`initialize failed: ${JSON.stringify(init.error)}`);
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const tools = (await request("tools/list", {})).result.tools;
  console.log(`Tools: ${tools.map((t) => t.name).join(", ")}`);

  const apps = await call("list_apps", { limit: 10 });
  // Default to the first app listed ("• Name · bundle.id · Apple ID 123 …").
  const app = appArg ?? /Apple ID (\d+)/.exec(apps)?.[1];
  if (!app) throw new Error("No app to test with. Pass one: npm run smoke -- \"My App\"");

  await call("get_app", { app });
  await call("list_builds", { app, limit: 5 });
  await call("list_builds", { app, status: "processing" });
  await call("list_beta_groups", { app, limit: 10 });
  await call("list_beta_testers", { app, limit: 5 });
  await call("list_app_store_versions", { app, limit: 5 });
  await call("list_customer_reviews", { app, limit: 3 });
} catch (err) {
  failures++;
  console.error(`\nSmoke test aborted: ${err.message}`);
} finally {
  child.kill();
}

console.log(failures ? `\n✗ ${failures} call(s) failed — see messages above.` : "\n✓ All tools answered.");
process.exitCode = failures ? 1 : 0;
