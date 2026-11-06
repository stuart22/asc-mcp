import { AscClient } from "./asc/client.ts";
import { AppResolver } from "./asc/resolveApp.ts";
import { TokenProvider } from "./auth/jwt.ts";
import { loadPrivateKey, nodeKeySourceDeps } from "./auth/keySource.ts";
import { parseConfig, ConfigError, type KeyLocation } from "./config.ts";
import type { ToolDeps } from "./format/common.ts";

export type CreatedDeps = {
  deps: ToolDeps;
  /** One-line, secret-free description for the startup log. */
  summary: string;
  /** Set when configuration is invalid; every tool then returns this message. */
  problem?: string;
};

const SOURCE_NAMES: Record<KeyLocation["kind"], string> = { keychain: "macOS Keychain", "1password": "1Password", file: "file" };

/**
 * Wires config → key → token → client. The private key is loaded lazily on the first
 * request, so a missing key is reported through the tool result (which Claude can
 * relay with the fix) rather than as a server that silently fails to start.
 */
export function createDeps(
  env: Record<string, string | undefined>,
  homeDir: string,
  serverDir: string,
  fetchImpl?: typeof fetch,
): CreatedDeps {
  let config;
  try {
    config = parseConfig(env, homeDir);
  } catch (err) {
    const message = err instanceof ConfigError ? err.message : "Invalid configuration.";
    const fail = async (): Promise<never> => {
      throw new ConfigError(message);
    };
    return {
      deps: { client: { get: fail }, apps: { resolve: fail, listAll: fail }, now: Date.now },
      summary: "not configured",
      problem: message,
    };
  }

  const tokens = new TokenProvider({
    keyId: config.keyId,
    ...(config.issuerId !== undefined ? { issuerId: config.issuerId } : {}),
    loadKey: () => loadPrivateKey(config.keyLocation, nodeKeySourceDeps(serverDir)),
  });
  const client = new AscClient({ tokens, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  return {
    deps: { client, apps: new AppResolver(client), now: Date.now },
    summary: `${config.keyType} key ${config.keyId}, key from ${SOURCE_NAMES[config.keyLocation.kind]}, read-only`,
  };
}
