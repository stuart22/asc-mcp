import { test } from "node:test";
import assert from "node:assert/strict";
import { createDeps } from "../src/deps.ts";
import { listBuilds } from "../src/tools/builds.ts";
import { listApps } from "../src/tools/apps.ts";

test("valid config summarises key type without secrets", () => {
  const { summary, problem } = createDeps({ ASC_KEY_ID: "ABCDE12345" }, "/home/x", "/opt/asc-mcp");
  assert.equal(problem, undefined);
  assert.equal(summary, "individual key ABCDE12345, key from macOS Keychain, read-only");
});

test("team key from file is described", () => {
  const { summary } = createDeps(
    { ASC_KEY_ID: "ABCDE12345", ASC_ISSUER_ID: "57246542-96fe-1a63-e053-0824d011072a", ASC_PRIVATE_KEY: "~/k/AuthKey.p8" },
    "/home/x",
    "/opt/asc-mcp",
  );
  assert.equal(summary, "team key ABCDE12345, key from file, read-only");
});

test("bad config still yields deps whose tools explain the problem", async () => {
  const { deps, problem } = createDeps({}, "/home/x", "/opt/asc-mcp");
  assert.match(problem!, /ASC_KEY_ID/);
  await assert.rejects(listBuilds(deps, { app: "Acme" }), /ASC_KEY_ID is not set/);
  await assert.rejects(listApps(deps, {}), /ASC_KEY_ID is not set/);
});
