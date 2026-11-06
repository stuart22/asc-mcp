import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify, type KeyObject } from "node:crypto";
import { createToken, TokenProvider } from "../src/auth/jwt.ts";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const KEY_ID = "ABCDE12345";
const ISSUER = "57246542-96fe-1a63-e053-0824d011072a";
const NOW = 1_800_000_000;

function decode(token: string) {
  const [h, p, s] = token.split(".");
  assert.ok(h && p && s, "token has three parts");
  return {
    header: JSON.parse(Buffer.from(h, "base64url").toString("utf8")),
    payload: JSON.parse(Buffer.from(p, "base64url").toString("utf8")),
    signingInput: `${h}.${p}`,
    signature: Buffer.from(s, "base64url"),
  };
}

test("team token header and claims", () => {
  const t = decode(createToken({ keyId: KEY_ID, issuerId: ISSUER, privateKey, nowSeconds: NOW }));
  assert.deepEqual(t.header, { alg: "ES256", kid: KEY_ID, typ: "JWT" });
  assert.deepEqual(t.payload, { iss: ISSUER, iat: NOW, exp: NOW + 900, aud: "appstoreconnect-v1" });
});

test("individual token has sub=user and no iss", () => {
  const t = decode(createToken({ keyId: KEY_ID, privateKey, nowSeconds: NOW }));
  assert.deepEqual(t.payload, { sub: "user", iat: NOW, exp: NOW + 900, aud: "appstoreconnect-v1" });
  assert.equal("iss" in t.payload, false);
});

test("signature verifies with the public key (ES256, raw r||s)", () => {
  const t = decode(createToken({ keyId: KEY_ID, privateKey, nowSeconds: NOW }));
  assert.equal(t.signature.length, 64);
  assert.ok(verify("sha256", Buffer.from(t.signingInput), { key: publicKey, dsaEncoding: "ieee-p1363" }, t.signature));
});

test("rejects lifetime over 20 minutes", () => {
  assert.throws(() => createToken({ keyId: KEY_ID, privateKey, nowSeconds: NOW, lifetimeSeconds: 1201 }), /20 minutes/);
});

test("rejects non-P-256 keys", () => {
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  assert.throws(() => createToken({ keyId: KEY_ID, privateKey: rsa, nowSeconds: NOW }), /P-256/);
});

test("provider caches until 60s before expiry and loads key once", async () => {
  let nowMs = NOW * 1000;
  let loads = 0;
  const provider = new TokenProvider({
    keyId: KEY_ID,
    loadKey: async (): Promise<KeyObject> => {
      loads++;
      return privateKey;
    },
    now: () => nowMs,
  });
  const a = await provider.getToken();
  nowMs += 839_000; // 61 s before expiry
  const b = await provider.getToken();
  assert.equal(a, b);
  nowMs += 2_000; // 59 s before expiry -> refresh
  const c = await provider.getToken();
  assert.notEqual(c, a);
  assert.equal(decode(c).payload.iat, NOW + 841);
  assert.equal(loads, 1);
});

test("provider shares one key load across concurrent calls", async () => {
  let loads = 0;
  const provider = new TokenProvider({
    keyId: KEY_ID,
    loadKey: async () => {
      loads++;
      await new Promise((r) => setTimeout(r, 5));
      return privateKey;
    },
  });
  await Promise.all([provider.getToken(), provider.getToken(), provider.getToken()]);
  assert.equal(loads, 1);
});

test("provider retries key load after a failure", async () => {
  let calls = 0;
  const provider = new TokenProvider({
    keyId: KEY_ID,
    loadKey: async () => {
      calls++;
      if (calls === 1) throw new Error("keychain locked");
      return privateKey;
    },
  });
  await assert.rejects(provider.getToken(), /keychain locked/);
  assert.ok(await provider.getToken());
});
