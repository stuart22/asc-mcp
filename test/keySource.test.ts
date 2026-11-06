import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { parsePrivateKey, loadPrivateKey, KeySourceError, type KeySourceDeps } from "../src/auth/keySource.ts";
import type { KeyLocation } from "../src/config.ts";

const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
const PEM = ec.export({ format: "pem", type: "pkcs8" }).toString();
const DER_B64 = ec.export({ format: "der", type: "pkcs8" }).toString("base64");
const KEY_ID = "ABCDE12345";

function deps(overrides: Partial<KeySourceDeps> = {}): KeySourceDeps & { calls: Array<[string, string[]]> } {
  const calls: Array<[string, string[]]> = [];
  return {
    calls,
    execFile: async (cmd, args) => {
      calls.push([cmd, args]);
      return DER_B64 + "\n";
    },
    readFile: async () => PEM,
    stat: async () => ({ mode: 0o100600 }),
    serverDir: "/opt/asc-mcp",
    ...overrides,
  };
}

const keychain: KeyLocation = { kind: "keychain", service: "asc-mcp", account: KEY_ID };

test("parses PEM", () => {
  assert.equal(parsePrivateKey(PEM).asymmetricKeyDetails?.namedCurve, "prime256v1");
});

test("parses PEM with Windows line endings and surrounding whitespace", () => {
  assert.ok(parsePrivateKey(`\n  ${PEM.replace(/\n/g, "\r\n")}  \n`));
});

test("parses single-line base64 DER", () => {
  assert.ok(parsePrivateKey(DER_B64));
});

test("parses hex output from security", () => {
  // `security find-generic-password -w` prints hex when the secret contains newlines.
  assert.ok(parsePrivateKey(Buffer.from(PEM, "utf8").toString("hex")));
});

test("rejects RSA keys", () => {
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  assert.throws(() => parsePrivateKey(rsa), (e: unknown) => e instanceof KeySourceError && /P-256/.test(e.message));
});

test("rejects garbage without echoing it", () => {
  assert.throws(
    () => parsePrivateKey("SECRETSECRET-not-a-key"),
    (e: unknown) => e instanceof KeySourceError && !e.message.includes("SECRETSECRET"),
  );
});

test("keychain uses an argument array", async () => {
  const d = deps();
  await loadPrivateKey(keychain, d);
  assert.deepEqual(d.calls, [["/usr/bin/security", ["find-generic-password", "-s", "asc-mcp", "-a", KEY_ID, "-w"]]]);
});

test("keychain not found gives setup hint", async () => {
  const d = deps({
    execFile: async () => {
      throw new Error("security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.");
    },
  });
  await assert.rejects(loadPrivateKey(keychain, d), (e: unknown) => e instanceof KeySourceError && /npm run store-key/.test(e.message));
});

test("1Password uses op read with an argument array", async () => {
  const d = deps({
    execFile: async (cmd, args) => {
      d.calls.push([cmd, args]);
      return PEM;
    },
  });
  const ref = "op://Work/ASC key/private key";
  await loadPrivateKey({ kind: "1password", ref }, d);
  assert.deepEqual(d.calls, [["/opt/homebrew/bin/op", ["read", ref]]]);
});

test("1Password failure gives a hint", async () => {
  const d = deps({
    execFile: async () => {
      throw Object.assign(new Error("spawn op ENOENT"), { code: "ENOENT" });
    },
  });
  await assert.rejects(loadPrivateKey({ kind: "1password", ref: "op://a/b/c" }, d), (e: unknown) => e instanceof KeySourceError && /op/.test(e.message));
});

test("file key loads when only the owner can read it", async () => {
  assert.ok(await loadPrivateKey({ kind: "file", path: "/secure/AuthKey.p8" }, deps()));
});

test("file rejects group/world-readable", async () => {
  const d = deps({ stat: async () => ({ mode: 0o100644 }) });
  await assert.rejects(loadPrivateKey({ kind: "file", path: "/secure/AuthKey.p8" }, d), (e: unknown) => e instanceof KeySourceError && /chmod 600/.test(e.message));
});

test("file rejects path inside the server's own folder", async () => {
  await assert.rejects(
    loadPrivateKey({ kind: "file", path: "/opt/asc-mcp/keys/AuthKey.p8" }, deps()),
    (e: unknown) => e instanceof KeySourceError && /outside/.test(e.message),
  );
});

test("missing file gives a readable error", async () => {
  const d = deps({
    stat: async () => {
      throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    },
  });
  await assert.rejects(loadPrivateKey({ kind: "file", path: "/secure/AuthKey.p8" }, d), (e: unknown) => e instanceof KeySourceError && /not found/i.test(e.message));
});

test("1Password is found in standard install locations without PATH (Claude Desktop)", async () => {
  const calls: string[] = [];
  const d = deps({
    execFile: async (cmd) => {
      calls.push(cmd);
      if (cmd !== "/usr/local/bin/op") throw Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: "ENOENT" });
      return PEM;
    },
  });
  assert.ok(await loadPrivateKey({ kind: "1password", ref: "op://a/b/c" }, d));
  assert.deepEqual(calls, ["/opt/homebrew/bin/op", "/usr/local/bin/op"]);
});

test("1Password CLI missing everywhere says so", async () => {
  const d = deps({
    execFile: async (cmd) => {
      throw Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: "ENOENT" });
    },
  });
  await assert.rejects(loadPrivateKey({ kind: "1password", ref: "op://a/b/c" }, d), (e: unknown) => e instanceof KeySourceError && /isn't installed/.test(e.message));
});

test("1Password installed but failing points at sign-in / reference", async () => {
  const d = deps({
    execFile: async () => {
      throw Object.assign(new Error("[ERROR] not signed in"), { code: 1 });
    },
  });
  await assert.rejects(loadPrivateKey({ kind: "1password", ref: "op://a/b/c" }, d), (e: unknown) => e instanceof KeySourceError && /signed in/.test(e.message) && !/isn't installed/.test(e.message));
});
