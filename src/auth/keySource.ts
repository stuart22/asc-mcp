import { execFile as execFileCb } from "node:child_process";
import { createPrivateKey, type KeyObject } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { KeyLocation } from "../config.ts";

/** Absolute path so it works when Claude Desktop starts the server without the shell's PATH. */
const SECURITY_BIN = "/usr/bin/security";
/** Where the 1Password CLI is normally installed (Homebrew on Apple silicon, Intel, then PATH). */
const OP_CANDIDATES = ["/opt/homebrew/bin/op", "/usr/local/bin/op", "op"];

export class KeySourceError extends Error {
  override name = "KeySourceError";
}

export type KeySourceDeps = {
  /** Runs a program with an argument array (never a shell) and returns stdout. */
  execFile: (cmd: string, args: string[]) => Promise<string>;
  readFile: (p: string) => Promise<string>;
  stat: (p: string) => Promise<{ mode: number }>;
  /** The server's own install folder; keys must not live inside it. */
  serverDir: string;
};

/** Real implementations of the dependencies. */
export function nodeKeySourceDeps(serverDir: string): KeySourceDeps {
  return {
    execFile: (cmd, args) =>
      new Promise((resolve, reject) => {
        execFileCb(cmd, args, { timeout: 15_000, maxBuffer: 64 * 1024, encoding: "utf8" }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout);
        });
      }),
    readFile: (p) => readFile(p, "utf8"),
    stat: (p) => stat(p),
    serverDir,
  };
}

/**
 * Accepts a PEM, a single-line base64 PKCS#8 DER, or either of those hex-encoded
 * (which is how `security -w` prints secrets that contain newlines).
 * Requires an EC P-256 key. Errors never include the input.
 */
export function parsePrivateKey(text: string): KeyObject {
  let s = text.trim();
  if (/^[0-9a-f]+$/i.test(s) && s.length % 2 === 0 && s.length > 100) {
    s = Buffer.from(s, "hex").toString("utf8").trim();
  }
  let key: KeyObject;
  try {
    key = s.includes("-----BEGIN")
      ? createPrivateKey({ key: s.replace(/\r\n/g, "\n"), format: "pem" })
      : createPrivateKey({ key: Buffer.from(s.replace(/\s+/g, ""), "base64"), format: "der", type: "pkcs8" });
  } catch {
    throw new KeySourceError("The stored App Store Connect key couldn't be read as a private key. Re-store the .p8 file you downloaded from App Store Connect.");
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new KeySourceError("That key isn't an App Store Connect API key (expected an EC P-256 .p8 key).");
  }
  return key;
}

export async function loadPrivateKey(loc: KeyLocation, deps: KeySourceDeps): Promise<KeyObject> {
  switch (loc.kind) {
    case "keychain": {
      let out: string;
      try {
        out = await deps.execFile(SECURITY_BIN, ["find-generic-password", "-s", loc.service, "-a", loc.account, "-w"]);
      } catch {
        throw new KeySourceError(
          `No key for ${loc.account} found in the macOS Keychain (service "${loc.service}"). Store it with: npm run store-key -- /path/to/AuthKey_${loc.account}.p8`,
        );
      }
      return parsePrivateKey(out);
    }
    case "1password": {
      for (const op of OP_CANDIDATES) {
        try {
          return parsePrivateKey(await deps.execFile(op, ["read", loc.ref]));
        } catch (err) {
          if (err instanceof KeySourceError) throw err;
          if ((err as { code?: unknown }).code === "ENOENT") continue; // not installed here; try the next location
          throw new KeySourceError(
            "Couldn't read the key from 1Password. Check the op:// reference in ASC_PRIVATE_KEY, and that you're signed in to the 1Password CLI (and its desktop-app integration is on).",
          );
        }
      }
      throw new KeySourceError("The 1Password CLI (op) isn't installed. Install it, or store the key in the Keychain with npm run store-key.");
    }
    case "file": {
      const rel = path.relative(path.resolve(deps.serverDir), path.resolve(loc.path));
      if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
        throw new KeySourceError("Keep your .p8 key outside the asc-mcp folder (e.g. ~/.appstoreconnect/) so it can never be committed.");
      }
      let mode: number;
      try {
        mode = (await deps.stat(loc.path)).mode;
      } catch {
        throw new KeySourceError(`Key file not found at ${loc.path}. Check ASC_PRIVATE_KEY.`);
      }
      if ((mode & 0o077) !== 0) {
        throw new KeySourceError(`Key file ${loc.path} can be read by other users. Run: chmod 600 "${loc.path}"`);
      }
      return parsePrivateKey(await deps.readFile(loc.path));
    }
  }
}
