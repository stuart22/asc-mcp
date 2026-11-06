import path from "node:path";

/** Keychain service name the server and `npm run store-key` agree on. */
export const KEYCHAIN_SERVICE = "asc-mcp";

export type KeyLocation =
  | { kind: "keychain"; service: typeof KEYCHAIN_SERVICE; account: string }
  | { kind: "1password"; ref: string }
  | { kind: "file"; path: string };

export type Config = {
  keyId: string;
  /** Present only for team keys. */
  issuerId?: string;
  keyType: "team" | "individual";
  keyLocation: KeyLocation;
};

export class ConfigError extends Error {
  override name = "ConfigError";
}

const KEY_ID_RE = /^[A-Z0-9]{10}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A long run of base64 characters is almost certainly a pasted key, not a location.
const LOOKS_LIKE_KEY_BODY = /^[A-Za-z0-9+/=\s]{60,}$/;

/**
 * Reads non-secret settings from the environment. Never reads the private key itself.
 * Error messages never echo the offending value, in case it is a secret.
 */
export function parseConfig(env: Record<string, string | undefined>, homeDir: string): Config {
  const keyId = env.ASC_KEY_ID?.trim();
  if (!keyId) {
    throw new ConfigError(
      "ASC_KEY_ID is not set. Set it to your App Store Connect API key ID (10 characters, e.g. from the AuthKey_XXXXXXXXXX.p8 filename).",
    );
  }
  if (!KEY_ID_RE.test(keyId)) {
    throw new ConfigError("ASC_KEY_ID doesn't look like an App Store Connect key ID (expected 10 uppercase letters/digits).");
  }

  const issuerRaw = env.ASC_ISSUER_ID?.trim();
  const issuerId = issuerRaw ? issuerRaw : undefined;
  if (issuerId !== undefined && !UUID_RE.test(issuerId)) {
    throw new ConfigError(
      "ASC_ISSUER_ID doesn't look like an issuer ID (expected a UUID from the Team Keys page). Leave it unset for an individual key.",
    );
  }

  return {
    keyId,
    ...(issuerId !== undefined ? { issuerId } : {}),
    keyType: issuerId !== undefined ? "team" : "individual",
    keyLocation: parseKeyLocation(env.ASC_PRIVATE_KEY, keyId, homeDir),
  };
}

function parseKeyLocation(raw: string | undefined, keyId: string, homeDir: string): KeyLocation {
  const value = raw?.trim() ?? "";
  if (value === "" || value === "keychain") {
    return { kind: "keychain", service: KEYCHAIN_SERVICE, account: keyId };
  }
  if (value.includes("-----BEGIN") || LOOKS_LIKE_KEY_BODY.test(value)) {
    throw new ConfigError(
      "ASC_PRIVATE_KEY looks like the key itself. Don't paste the key into Claude's config; store it in the Keychain (npm run store-key) and set ASC_PRIVATE_KEY to 'keychain', an op:// reference, or a file path.",
    );
  }
  if (value.startsWith("op://")) {
    return { kind: "1password", ref: value };
  }
  if (value === "~" || value.startsWith("~/")) {
    return { kind: "file", path: path.join(homeDir, value.slice(1)) };
  }
  if (path.isAbsolute(value)) {
    return { kind: "file", path: path.normalize(value) };
  }
  throw new ConfigError(
    "ASC_PRIVATE_KEY must be 'keychain' (default), an op:// 1Password reference, or an absolute or ~/ path to your .p8 file.",
  );
}
