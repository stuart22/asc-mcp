import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig, ConfigError } from "../src/config.ts";

const HOME = "/Users/someone";
const KEY_ID = "ABCDE12345";
const ISSUER = "57246542-96fe-1a63-e053-0824d011072a";

test("individual key by default, key in Keychain", () => {
  const c = parseConfig({ ASC_KEY_ID: KEY_ID }, HOME);
  assert.equal(c.keyId, KEY_ID);
  assert.equal(c.keyType, "individual");
  assert.equal(c.issuerId, undefined);
  assert.deepEqual(c.keyLocation, { kind: "keychain", service: "asc-mcp", account: KEY_ID });
});

test("team key when issuer set", () => {
  const c = parseConfig({ ASC_KEY_ID: KEY_ID, ASC_ISSUER_ID: ISSUER }, HOME);
  assert.equal(c.keyType, "team");
  assert.equal(c.issuerId, ISSUER);
});

test("blank issuer is treated as unset", () => {
  const c = parseConfig({ ASC_KEY_ID: KEY_ID, ASC_ISSUER_ID: "  " }, HOME);
  assert.equal(c.keyType, "individual");
});

test("rejects missing key id", () => {
  assert.throws(() => parseConfig({}, HOME), (e: unknown) => e instanceof ConfigError && /ASC_KEY_ID/.test(e.message));
});

test("rejects malformed key id", () => {
  assert.throws(() => parseConfig({ ASC_KEY_ID: "abc" }, HOME), ConfigError);
});

test("rejects malformed issuer", () => {
  assert.throws(() => parseConfig({ ASC_KEY_ID: KEY_ID, ASC_ISSUER_ID: "not-a-uuid" }, HOME), ConfigError);
});

test("explicit keychain", () => {
  const c = parseConfig({ ASC_KEY_ID: KEY_ID, ASC_PRIVATE_KEY: "keychain" }, HOME);
  assert.equal(c.keyLocation.kind, "keychain");
});

test("op:// reference selects 1Password", () => {
  const c = parseConfig({ ASC_KEY_ID: KEY_ID, ASC_PRIVATE_KEY: "op://Work/ASC key/private key" }, HOME);
  assert.deepEqual(c.keyLocation, { kind: "1password", ref: "op://Work/ASC key/private key" });
});

test("~ path expands with home dir", () => {
  const c = parseConfig({ ASC_KEY_ID: KEY_ID, ASC_PRIVATE_KEY: "~/keys/AuthKey.p8" }, HOME);
  assert.deepEqual(c.keyLocation, { kind: "file", path: "/Users/someone/keys/AuthKey.p8" });
});

test("absolute path accepted", () => {
  const c = parseConfig({ ASC_KEY_ID: KEY_ID, ASC_PRIVATE_KEY: "/secure/AuthKey.p8" }, HOME);
  assert.deepEqual(c.keyLocation, { kind: "file", path: "/secure/AuthKey.p8" });
});

test("rejects relative path", () => {
  assert.throws(() => parseConfig({ ASC_KEY_ID: KEY_ID, ASC_PRIVATE_KEY: "keys/AuthKey.p8" }, HOME), ConfigError);
});

test("rejects pasted PEM without echoing it", () => {
  const pem = "-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49SECRETSECRET\n-----END PRIVATE KEY-----";
  assert.throws(
    () => parseConfig({ ASC_KEY_ID: KEY_ID, ASC_PRIVATE_KEY: pem }, HOME),
    (e: unknown) => e instanceof ConfigError && /paste/i.test(e.message) && !e.message.includes("SECRET"),
  );
});

test("rejects pasted base64 key body without echoing it", () => {
  const body = "MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgSECRETSECRETSECRETSECRETSECRET";
  assert.throws(
    () => parseConfig({ ASC_KEY_ID: KEY_ID, ASC_PRIVATE_KEY: body }, HOME),
    (e: unknown) => e instanceof ConfigError && !e.message.includes("SECRET"),
  );
});
