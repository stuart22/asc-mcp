import { sign, type KeyObject } from "node:crypto";

/** Apple rejects tokens that live longer than 20 minutes (for the endpoints we use). */
const MAX_LIFETIME_SECONDS = 20 * 60;
const DEFAULT_LIFETIME_SECONDS = 15 * 60;
/** Refresh this long before expiry so a token never expires mid-request. */
const REFRESH_MARGIN_SECONDS = 60;

export type CreateTokenOptions = {
  keyId: string;
  /** Team keys only. Individual keys use `sub: "user"` instead. */
  issuerId?: string;
  privateKey: KeyObject;
  nowSeconds: number;
  lifetimeSeconds?: number;
};

/**
 * Builds an App Store Connect API JWT (ES256).
 * Team keys: `iss` = issuer ID. Individual keys: no `iss`, `sub` = "user".
 */
export function createToken(opts: CreateTokenOptions): string {
  const lifetime = opts.lifetimeSeconds ?? DEFAULT_LIFETIME_SECONDS;
  if (lifetime <= 0 || lifetime > MAX_LIFETIME_SECONDS) {
    throw new Error("Token lifetime must be between 1 second and 20 minutes.");
  }
  if (opts.privateKey.asymmetricKeyType !== "ec" || opts.privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("App Store Connect keys must be EC P-256 (.p8) private keys.");
  }

  const header = { alg: "ES256", kid: opts.keyId, typ: "JWT" };
  const iat = Math.floor(opts.nowSeconds);
  const subject = opts.issuerId !== undefined ? { iss: opts.issuerId } : { sub: "user" };
  const payload = { ...subject, iat, exp: iat + lifetime, aud: "appstoreconnect-v1" };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = sign("sha256", Buffer.from(signingInput), { key: opts.privateKey, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${signature.toString("base64url")}`;
}

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

export type TokenProviderOptions = {
  keyId: string;
  issuerId?: string;
  /** Loads the private key; called once (retried only if it fails). */
  loadKey: () => Promise<KeyObject>;
  /** Clock in milliseconds; injectable for tests. */
  now?: () => number;
};

/** Hands out a cached token and signs a fresh one shortly before it expires. */
export class TokenProvider {
  readonly #opts: TokenProviderOptions;
  readonly #now: () => number;
  #key: Promise<KeyObject> | undefined;
  #cached: { token: string; exp: number } | undefined;

  constructor(opts: TokenProviderOptions) {
    this.#opts = opts;
    this.#now = opts.now ?? Date.now;
  }

  async getToken(): Promise<string> {
    const nowSeconds = Math.floor(this.#now() / 1000);
    if (this.#cached && nowSeconds < this.#cached.exp - REFRESH_MARGIN_SECONDS) {
      return this.#cached.token;
    }
    const privateKey = await this.#loadKeyOnce();
    const token = createToken({
      keyId: this.#opts.keyId,
      ...(this.#opts.issuerId !== undefined ? { issuerId: this.#opts.issuerId } : {}),
      privateKey,
      nowSeconds,
    });
    this.#cached = { token, exp: nowSeconds + DEFAULT_LIFETIME_SECONDS };
    return token;
  }

  #loadKeyOnce(): Promise<KeyObject> {
    if (!this.#key) {
      this.#key = this.#opts.loadKey().catch((err: unknown) => {
        this.#key = undefined; // allow a retry, e.g. after the user unlocks the Keychain
        throw err;
      });
    }
    return this.#key;
  }
}
